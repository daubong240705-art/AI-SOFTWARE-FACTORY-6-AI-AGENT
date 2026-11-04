import json

import httpx

from workers.model_proxy import ModelProxy


def response(usage=True):
    value = {
        "id": "completion-1",
        "model": "coding-main",
        "choices": [{"message": {"role": "assistant", "content": "done"}, "finish_reason": "stop"}],
    }
    if usage:
        value["usage"] = {"prompt_tokens": 20, "completion_tokens": 5}
    return value


def proxy(handler, **limits):
    return ModelProxy(
        "coding-main",
        "provider-secret",
        "https://router.test/v1",
        "127.0.0.1",
        allowance=limits.get("tokens", 20000),
        requests=limits.get("requests", 2),
        output_tokens=1000,
        transport=httpx.MockTransport(handler),
    )


def post(server, payload=None, token=None):
    return httpx.post(
        f"http://127.0.0.1:{server.port}/v1/chat/completions",
        headers={"Authorization": "Bearer " + (token or server.token)},
        json=payload or {"model": "coding-main", "messages": []},
        trust_env=False,
    )


def test_proxy_caps_physical_requests_clamps_output_and_keeps_provider_key_private():
    requests = []

    def upstream(request):
        assert request.url == "https://router.test/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer provider-secret"
        payload = json.loads(request.content)
        assert payload["max_tokens"] == 1000 and payload["stream"] is False
        assert "stream_options" not in payload
        requests.append(request)
        return httpx.Response(200, json=response())

    with proxy(upstream) as server:
        assert server.token != "provider-secret"
        assert post(server, token="wrong-token").status_code == 401
        assert post(server, {"model": "other-model"}).status_code == 422
        assert post(server, {"model": "coding-main", "n": 10}).status_code == 422
        assert post(server, {"model": "coding-main", "max_tokens": 99999}).status_code == 200
        assert post(server).status_code == 200
        assert post(server).status_code == 403
        assert len(requests) == 2
        assert server.report()["charged_tokens"] == 50
        assert server.report()["physical_requests"] == 2


def test_unknown_usage_keeps_charge_and_denies_oversized_prompt_before_upstream():
    calls = []

    def upstream(request):
        calls.append(request)
        return httpx.Response(200, json=response(False))

    with proxy(upstream, tokens=5000, requests=8) as server:
        assert post(server, {"model": "coding-main", "messages": ["x" * 6000]}).status_code == 403
        assert calls == []
        assert post(server).status_code == 200
        assert server.report()["charged_tokens"] > 2000
        assert server.report()["input_tokens"] is None
        assert post(server).status_code == 200
        assert post(server).status_code == 403
        assert len(calls) == 2


def test_streaming_tool_calls_and_failed_delivery_are_bounded():
    def upstream(request):
        data = response()
        data["choices"] = [
            {
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "read-1",
                            "type": "function",
                            "function": {"name": "read", "arguments": '{"filePath":"src/app.py"}'},
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ]
        return httpx.Response(200, json=data)

    with proxy(upstream, requests=1) as server:
        result = post(server, {"model": "coding-main", "stream": True})
        assert result.headers["content-type"] == "text/event-stream"
        chunks = [
            json.loads(s[6:])
            for s in result.text.splitlines()
            if s.startswith("data: ") and s != "data: [DONE]"
        ]
        assert chunks[0]["choices"][0]["delta"]["tool_calls"][0]["index"] == 0
        assert chunks[1]["choices"][0]["finish_reason"] == "tool_calls"
        assert result.text.endswith("data: [DONE]\n\n")

    with proxy(lambda request: httpx.Response(503), requests=1) as server:
        assert post(server).status_code == 502
        assert server.report()["charged_tokens"] > 0
        assert post(server).status_code == 403
