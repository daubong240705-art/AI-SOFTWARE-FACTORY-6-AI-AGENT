"""Operator-only real model/tool probe; no API, GitLab or project mutations."""

import argparse
import json
import os
import subprocess
import uuid
from typing import Any

from shared.agent_skills import skill_snapshot
from workers.coding import execute


def probe(model: str, allowance: int, requests: int) -> dict[str, Any]:
    item_id = str(uuid.uuid4())
    audits = 0

    def inspect(path: str, payload: dict[str, Any]) -> None:
        nonlocal audits
        inspected = subprocess.run(
            ["docker", "container", "inspect", "asf-task-" + item_id],
            capture_output=True,
            timeout=15,
        )
        # Docker may still be starting, or --rm may have removed a completed container.
        if inspected.returncode:
            return
        raw = inspected.stdout
        config = json.loads(raw)[0]
        environment = dict(value.split("=", 1) for value in config["Config"]["Env"] if "=" in value)
        key = os.environ["NINE_ROUTER_API_KEY"]
        grant = environment.get("NINE_ROUTER_API_KEY")
        if (
            not grant
            or key in raw.decode()
            or not config["HostConfig"]["ReadonlyRootfs"]
            or config["Config"]["User"] != "10001:10001"
            or any("docker.sock" in m["Source"] for m in config["Mounts"])
        ):
            raise ValueError("probe_sandbox_isolation_failed")
        audits += 1

    task = {
        "id": item_id,
        "role": "be",
        "lease_seconds": 6,
        "lease_token": "local-probe-no-api-credential",
        "timeout_seconds": 180,
        "files": {"src/probe.py": 'def marker():\n    return "BROKEN"\n'},
        "input": {
            "profile": {"allowed_paths": ["src/"], "test_profile": "python-unittest"},
            "models": {"be": model},
            "agent_skill": skill_snapshot()["be"],
            "model_limits": {"tokens": allowance, "requests": requests, "output_tokens": 1000},
            "spec": {
                "summary": "Read src/probe.py and change marker() to return exactly ASF_MODEL_OK. "
                "Use glob or grep to locate it, then read and edit it. Change no other files."
            },
        },
    }
    coding = execute(task, inspect)
    changes = coding.get("changes", {})
    result: dict[str, Any] = {
        "model_alias": model,
        "passed": False,
        "sandbox_inspections": audits,
        "model_usage": coding.get("report", {}).get("model_usage", {}),
        "tools_completed": coding.get("report", {}).get("sampled_tools_completed", {}),
    }
    if not coding["succeeded"] or set(changes) != {"src/probe.py"} or audits == 0:
        result["error_code"] = "probe_coding_failed"
        return result
    tools = result["tools_completed"]
    if not (tools.get("read") and tools.get("edit") and (tools.get("glob") or tools.get("grep"))):
        result["error_code"] = "probe_tools_incomplete"
        return result
    task.update(
        id=str(uuid.uuid4()),
        role="test",
        files={"src/probe.py": changes["src/probe.py"]},
        trusted_tests={
            "test_probe.py": (
                "import unittest\nfrom probe import marker\n"
                "class Probe(unittest.TestCase):\n"
                "    def test_marker(self): self.assertEqual(marker(), 'ASF_MODEL_OK')\n"
            )
        },
    )
    tested = execute(task, lambda *_: None)
    result["test_exit_code"] = tested.get("report", {}).get("exit_code")
    result["passed"] = tested["succeeded"] and result["test_exit_code"] == 0
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, help="Exact allowed gateway model alias")
    parser.add_argument("--allowance", type=int, default=60000)
    parser.add_argument("--requests", type=int, default=8)
    args = parser.parse_args()
    if not 5000 <= args.allowance <= 200000 or not 1 <= args.requests <= 30:
        parser.error("allowance must be 5000..200000; requests must be 1..30")
    if not os.environ.get("NINE_ROUTER_API_KEY"):
        parser.error("NINE_ROUTER_API_KEY must be set in the trusted parent environment")
    try:
        result = probe(args.model, args.allowance, args.requests)
    except Exception:
        # Never echo provider/transport errors or environment values into a report.
        result = {"model_alias": args.model, "passed": False, "error_code": "probe_unavailable"}
    print(json.dumps(result), flush=True)
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
