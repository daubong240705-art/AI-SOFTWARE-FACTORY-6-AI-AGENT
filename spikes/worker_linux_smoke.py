"""Run on the Linux worker as its Docker administrator.

Receives NINE_ROUTER_API_KEY via environment or an interactive stdin line.
Only the disposable coding container receives the model key. Test/verification
containers do not. This probe uses model tokens and creates a retained workspace.
"""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def main():
    key = os.environ.get("NINE_ROUTER_API_KEY")
    if not key:
        print("READY_FOR_GATEWAY_KEY", flush=True)
        key = sys.stdin.readline().strip()
    if not key:
        raise SystemExit("Missing gateway key")
    root = Path(tempfile.mkdtemp(prefix="linux-probe-", dir="/opt/asf-worker/workspaces"))
    root.chmod(0o755)
    workspace = root / "workspace"
    workspace.mkdir()
    workspace.chmod(0o755)
    os.chown(workspace, 10001, 10001)
    source = workspace / "app.py"
    source.write_text("def add(a, b):\n    return a - b\n", encoding="utf-8")
    os.chown(source, 10001, 10001)
    tests = root / "test_app.py"
    tests.write_text(
        "import unittest\nfrom app import add\n"
        "class AdditionTests(unittest.TestCase):\n"
        "    def test_positive(self): self.assertEqual(add(2, 3), 5)\n"
        "    def test_negative(self): self.assertEqual(add(-2, -3), -5)\n"
        "    def test_mixed(self): self.assertEqual(add(-2, 3), 1)\n"
        "if __name__ == '__main__': unittest.main()\n", encoding="utf-8"
    )
    tests.chmod(0o444)
    base = [
        "docker", "run", "--rm", "--pull=never", "--read-only", "--user=10001:10001",
        "--memory=3g", "--memory-swap=3g", "--cpus=1.5", "--pids-limit=256",
        "--cap-drop=ALL", "--security-opt=no-new-privileges",
        "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m,mode=1777",
        "--tmpfs", "/home/asf:rw,nosuid,nodev,size=256m,uid=10001,gid=10001,mode=0700",
        "--mount", f"type=bind,src={workspace},dst=/workspace",
        "--mount", f"type=bind,src={tests},dst=/tests/test_app.py,readonly",
        "--workdir=/workspace",
    ]
    image = "asf-worker:opencode-1.19.5"
    test_command = [image, "python", "-B", "/tests/test_app.py"]

    def run_tests():
        return subprocess.run(
            base + ["--network=none", "-e", "PYTHONPATH=/workspace"] + test_command,
            capture_output=True, text=True, timeout=45,
        )

    baseline = run_tests()
    if baseline.returncode == 0 or "AssertionError" not in baseline.stderr:
        raise RuntimeError("Baseline did not fail as expected")
    config = {
        "$schema": "https://opencode.ai/config.json", "model": "nine_router/coding-main",
        "provider": {"nine_router": {
            "npm": "@ai-sdk/openai-compatible", "name": "NineRouter",
            "options": {"baseURL": "https://ai.lazy.local/v1", "apiKey": "{env:NINE_ROUTER_API_KEY}"},
            "models": {"coding-main": {"name": "coding-main", "limit": {"context": 200000, "output": 1000}}},
        }},
        "permission": {"*": "deny", "read": "allow", "edit": "allow"},
    }
    environment = os.environ.copy()
    environment["NINE_ROUTER_API_KEY"] = key
    started = time.monotonic()
    result = subprocess.run(base + [
        "-e", "NINE_ROUTER_API_KEY", "-e", "OPENCODE_CONFIG_CONTENT=" + json.dumps(config),
        "-e", "XDG_CONFIG_HOME=/home/asf/config", "-e", "XDG_DATA_HOME=/home/asf/data",
        "-e", "XDG_STATE_HOME=/home/asf/state", image,
        "opencode", "run", "--pure", "--format", "json", "--dir", "/workspace",
        "Read /workspace/app.py, then fix add(a,b) so it returns the numeric sum. "
        "Edit only app.py using read and edit tools. Do not run commands, access network tools, "
        "inspect any other directories, or delegate. Stop after editing.",
    ], env=environment, capture_output=True, text=True, timeout=150)
    fixed = run_tests()
    isolation = subprocess.run(base + ["--network=none", image, "python", "-c",
        "import os,pathlib,json; assert os.getuid()==10001; "
        "assert not pathlib.Path('/var/run/docker.sock').exists(); "
        "assert not pathlib.Path('/etc/gitlab-runner/config.toml').exists(); "
        "assert not os.environ.get('NINE_ROUTER_API_KEY'); "
        "p=pathlib.Path('/etc/asf-probe'); "
        "assert not os.access('/etc',os.W_OK); "
        "print(json.dumps({'non_root':True,'no_docker_socket':True,'no_runner_config':True,"
        "'test_container_has_no_model_key':True,'root_filesystem_read_only':True}))",
    ], capture_output=True, text=True, timeout=30)
    passed = result.returncode == 0 and fixed.returncode == 0 and isolation.returncode == 0
    report = {
        "passed": passed, "baseline_failed": baseline.returncode != 0,
        "cli_exit_code": result.returncode, "tests_exit_code": fixed.returncode,
        "tests": fixed.stderr.strip(), "source": source.read_text(encoding="utf-8"),
        "isolation_exit_code": isolation.returncode,
        "isolation": isolation.stdout.strip(), "latency_s": round(time.monotonic() - started, 2),
        "workspace": str(workspace),
    }
    (root / "result.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report), flush=True)
    if not passed:
        # Raw transcripts remain unprinted: they can contain model request context.
        raise SystemExit("Linux worker probe did not meet acceptance checks")


if __name__ == "__main__":
    main()
