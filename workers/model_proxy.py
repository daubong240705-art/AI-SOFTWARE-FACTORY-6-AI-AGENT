"""One execution's bounded model gateway. The sandbox never receives the provider key."""

import hmac
import json
import secrets
import ssl
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import TracebackType
from typing import Any
from urllib.parse import urlsplit

import httpx


class ModelProxy:
    def __init__(
        self,
        model: str,
        key: str,
        origin: str,
        bind: str,
        allowance: int,
        requests: int,
        output_tokens: int,
        ca_file: str | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        url = urlsplit(origin)
        if url.scheme != "https" or url.username or url.query or url.fragment or not key:
            raise ValueError("model_proxy_not_configured")
        self.model, self.origin = model, origin.rstrip("/")
        self.allowance, self.max_requests, self.output_tokens = allowance, requests, output_tokens
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.Lock()
        self.requests = self.charged = self.inputs = self.outputs = 0
        self.peak_reservation = 0
        self.usage_complete = True
        self.error: str | None = None
        self.client = httpx.Client(
            verify=ssl.create_default_context(cafile=ca_file),
            transport=transport,
            trust_env=False,
            follow_redirects=False,
            timeout=90,
            headers={"Authorization": "Bearer " + key},
        )
        proxy = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:
                pass

            def do_POST(self) -> None:
                if self.path != "/v1/chat/completions" or not hmac.compare_digest(
                    self.headers.get("authorization", ""), "Bearer " + proxy.token
                ):
                    self.reply(401, {"error": {"message": "execution_model_grant_required"}})
                    return
                try:
                    length = int(self.headers.get("content-length", "0"))
                    if not 0 < length <= 256_000:
                        raise ValueError()
                    self.connection.settimeout(10)
                    payload = json.loads(self.rfile.read(length))
                    if not isinstance(payload, dict) or payload.get("model") != proxy.model:
                        raise ValueError()
                    if payload.get("n", 1) != 1:
                        raise ValueError()
                    streaming = payload.pop("stream", False)
                    payload.pop("stream_options", None)
                    payload.pop("max_completion_tokens", None)
                    requested = payload.get("max_tokens", proxy.output_tokens)
                    if type(requested) is not int or requested <= 0:
                        raise ValueError()
                    payload["max_tokens"] = min(requested, proxy.output_tokens)
                    payload["stream"] = False
                    # A byte-based conservative allowance, not an upstream tokenizer claim.
                    reserve = len(json.dumps(payload, ensure_ascii=False).encode()) + 1024
                    reserve += payload["max_tokens"]
                except (ValueError, TypeError, TimeoutError):
                    self.reply(422, {"error": {"message": "invalid_execution_model_request"}})
                    return
                if not proxy.lock.acquire(blocking=False):
                    self.reply(429, {"error": {"message": "execution_model_busy"}})
                    return
                try:
                    proxy.peak_reservation = max(proxy.peak_reservation, reserve)
                    if (
                        proxy.requests >= proxy.max_requests
                        or proxy.charged + reserve > proxy.allowance
                    ):
                        proxy.error = "execution_model_quota_exceeded"
                        # Immutable execution quota cannot recover by retrying this request.
                        self.reply(403, {"error": {"message": proxy.error}})
                        return
                    proxy.requests += 1
                    proxy.charged += reserve  # Ambiguous delivery remains charged.
                    started = time.monotonic()
                    try:
                        with proxy.client.stream(
                            "POST", proxy.origin + "/chat/completions", json=payload
                        ) as response:
                            if response.status_code != 200:
                                raise ValueError("model_upstream_failed")
                            body = bytearray()
                            for chunk in response.iter_bytes():
                                body.extend(chunk)
                                if len(body) > 1_000_000 or time.monotonic() - started > 90:
                                    raise ValueError("model_response_limit")
                            result = json.loads(body)
                            if (
                                not isinstance(result, dict)
                                or not isinstance(result.get("choices"), list)
                                or not result["choices"]
                                or any(
                                    not isinstance(c, dict)
                                    or not isinstance(c.get("message"), dict)
                                    for c in result["choices"]
                                )
                            ):
                                raise ValueError("model_response_invalid")
                    except (httpx.HTTPError, ValueError):
                        proxy.usage_complete = False
                        proxy.error = "model_upstream_failed"
                        self.reply(502, {"error": {"message": proxy.error}})
                        return
                    usage = result.get("usage") or {}
                    if not isinstance(usage, dict):
                        usage = {}
                    inputs, outputs = usage.get("prompt_tokens"), usage.get("completion_tokens")
                    if type(inputs) is int and type(outputs) is int and min(inputs, outputs) >= 0:
                        proxy.inputs += inputs
                        proxy.outputs += outputs
                        proxy.charged += inputs + outputs - reserve
                    else:
                        proxy.usage_complete = False
                    if streaming:
                        self.stream(result)
                    else:
                        self.reply(200, result)
                except (BrokenPipeError, ConnectionResetError):
                    pass  # Charge remains even when the sandbox disconnects.
                finally:
                    proxy.lock.release()

            def reply(self, status: int, value: dict[str, Any]) -> None:
                body = json.dumps(value).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def stream(self, result: dict[str, Any]) -> None:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Connection", "close")
                self.end_headers()
                base = {
                    "id": result.get("id", "execution"),
                    "object": "chat.completion.chunk",
                    "created": result.get("created", int(time.time())),
                    "model": result.get("model", proxy.model),
                }
                choices = []
                for index, choice in enumerate(result["choices"]):
                    message = dict(choice["message"])
                    if calls := message.get("tool_calls"):
                        message["tool_calls"] = [
                            {**tool, "index": i} for i, tool in enumerate(calls)
                        ]
                    choices.append({"index": index, "delta": message, "finish_reason": None})
                chunks = [
                    {**base, "choices": choices},
                    {
                        **base,
                        "choices": [
                            {"index": i, "delta": {}, "finish_reason": c.get("finish_reason")}
                            for i, c in enumerate(result["choices"])
                        ],
                        **({"usage": result["usage"]} if "usage" in result else {}),
                    },
                ]
                for chunk in chunks:
                    self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()

        try:
            self.server = ThreadingHTTPServer((bind, 0), Handler)
        except OSError:
            self.client.close()
            raise
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def port(self) -> int:
        return int(self.server.server_address[1])

    def report(self) -> dict[str, Any]:
        return {
            "physical_requests": self.requests,
            "peak_request_reservation": self.peak_reservation,
            "charged_tokens": self.charged,
            "input_tokens": self.inputs if self.usage_complete else None,
            "output_tokens": self.outputs if self.usage_complete else None,
            "usage_complete": self.usage_complete,
            "error_code": self.error,
        }

    def __enter__(self) -> "ModelProxy":
        self.thread.start()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=10)
        self.client.close()
