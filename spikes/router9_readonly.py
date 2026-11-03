"""Probe 9Router without modifying gateway configuration (uses model tokens)."""

import argparse
import json
import os
import time
from pathlib import Path

import requests


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="https://ai.lazy.local/v1")
    parser.add_argument("--model", default="coding-main")
    parser.add_argument("--ca", type=Path, default=Path(__file__).resolve().parents[1] / "caddy-root.crt")
    args = parser.parse_args()
    token = os.environ.get("NINE_ROUTER_API_KEY")
    if not token:
        raise SystemExit("Set NINE_ROUTER_API_KEY; its value will not be printed")
    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}},
              "required": ["ok"], "additionalProperties": False}
    cases = [
        ("chat", "/chat/completions", {
            "model": args.model, "messages": [{"role": "user", "content": "Reply exactly OK."}],
            "max_tokens": 32,
        }),
        ("structured", "/responses", {
            "model": args.model, "input": 'Return {"ok":true}.', "max_output_tokens": 128,
            "text": {"format": {"type": "json_schema", "name": "audit", "strict": True,
                                "schema": schema}},
        }),
        ("tools", "/responses", {
            "model": args.model, "input": "Call audit_ping with ok=true.", "max_output_tokens": 128,
            "tools": [{"type": "function", "name": "audit_ping", "description": "Read only probe",
                       "parameters": schema, "strict": True}],
            "tool_choice": {"type": "function", "name": "audit_ping"},
        }),
    ]
    with requests.Session() as session:
        session.trust_env = False
        session.verify = str(args.ca.resolve())
        session.headers["Authorization"] = "Bearer " + token
        response = session.get(args.url.rstrip("/") + "/models", timeout=(8, 40))
        response.raise_for_status()
        model_ids = [m["id"] for m in response.json()["data"]]
        if args.model not in model_ids:
            raise RuntimeError("Requested model is not listed by the gateway")
        print(json.dumps({"model_listed": True, "model_count": len(model_ids)}))
        for name, endpoint, payload in cases:
            started = time.monotonic()
            response = session.post(args.url.rstrip("/") + endpoint, json=payload, timeout=(8, 60))
            response.raise_for_status()
            result = response.json()
            if name == "chat":
                passed = result["choices"][0]["message"]["content"].strip() == "OK"
            elif name == "structured":
                outputs = [part["text"] for item in result.get("output", [])
                           for part in item.get("content", []) if part.get("type") == "output_text"]
                passed = any(json.loads(part) == {"ok": True} for part in outputs)
            else:
                passed = any(item.get("type") == "function_call"
                             and item.get("name") == "audit_ping"
                             and json.loads(item["arguments"]) == {"ok": True}
                             for item in result.get("output", []))
            print(json.dumps({"probe": name, "passed": passed,
                              "latency_s": round(time.monotonic() - started, 2),
                              "resolved_model": result.get("model"), "usage": result.get("usage")}))
            if not passed:
                raise RuntimeError(f"Response failed semantic verification: {name}")


if __name__ == "__main__":
    main()
