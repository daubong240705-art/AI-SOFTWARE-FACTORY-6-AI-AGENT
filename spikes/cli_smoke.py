"""Verify an actual file edit by OpenCode through 9Router, outside the repository."""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="coding-main")
    parser.add_argument("--url", default="https://ai.lazy.local/v1")
    args = parser.parse_args()
    if not os.environ.get("NINE_ROUTER_API_KEY"):
        raise SystemExit("Set NINE_ROUTER_API_KEY")
    executable = shutil.which("opencode.cmd") or shutil.which("opencode")
    if not executable:
        raise SystemExit("Install OpenCode before running this probe")
    base = Path(tempfile.mkdtemp(prefix="asf-opencode-probe-"))
    (base / "config").mkdir()
    workspace = base / "workspace"
    workspace.mkdir()
    probe = workspace / "probe.txt"
    probe.write_text("BEFORE\n", encoding="utf-8")
    environment = os.environ.copy()
    environment.pop("OPENPROJECT_API_TOKEN", None)
    environment.update({
        "XDG_CONFIG_HOME": str(base / "config"),
        "XDG_DATA_HOME": str(base / "data"),
        "XDG_STATE_HOME": str(base / "state"),
        "OPENCODE_DISABLE_AUTOUPDATE": "true",
        "NODE_EXTRA_CA_CERTS": str(Path(__file__).resolve().parents[1] / "caddy-root.crt"),
        "OPENCODE_CONFIG_CONTENT": json.dumps({
            "$schema": "https://opencode.ai/config.json",
            "model": "nine_router/" + args.model,
            "provider": {"nine_router": {
                "npm": "@ai-sdk/openai-compatible", "name": "NineRouter",
                "options": {"baseURL": args.url, "apiKey": "{env:NINE_ROUTER_API_KEY}"},
                "models": {args.model: {"name": args.model, "limit": {"context": 200000, "output": 1000}}},
            }},
            "permission": {"*": "deny", "read": "allow", "edit": "allow"},
        }),
    })
    started = time.monotonic()
    result = subprocess.run([
        executable, "run", "--pure", "--format", "json", "--dir", str(workspace),
        "Read existing probe.txt in the current directory, then edit it to contain exactly "
        "ASF_CLI_OK and a newline. Use only read and edit tools. Do not inspect any other "
        "directory. Do not delegate. Stop after the edit.",
    ], env=environment, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90)
    passed = result.returncode == 0 and probe.read_text(encoding="utf-8") == "ASF_CLI_OK\n"
    # Do not save raw model/tool transcripts, which may contain paths or other context.
    print(json.dumps({"passed": passed, "exit_code": result.returncode,
                      "latency_s": round(time.monotonic() - started, 2),
                      "workspace": str(workspace)}))
    if not passed:
        raise SystemExit("CLI did not produce the required file artifact")


if __name__ == "__main__":
    main()
