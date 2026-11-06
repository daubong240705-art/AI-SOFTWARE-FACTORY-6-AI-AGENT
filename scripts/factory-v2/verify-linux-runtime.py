"""F1-01 native runtime/protocol check. No inference, sessions or V1 data access."""

import base64
import json
import os
import re
import secrets
import signal
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path("/home/lazy/factory-v2")


def runtime_env(home):
    env = {
        "PATH": f"{ROOT}/node/bin:{ROOT}/opencode/bin:/usr/local/bin:/usr/bin:/bin",
        "HOME": str(home / "home"),
        "LANG": "C.UTF-8",
        "NO_COLOR": "1",
        "NODE_EXTRA_CA_CERTS": str(ROOT / "ca/caddy-root.crt"),
        "NO_PROXY": "localhost,127.0.0.1,::1,ai.lazy.local",
    }
    for kind in ("config", "data", "state", "cache"):
        env["XDG_" + kind.upper() + "_HOME"] = str(home / kind)
    for name in (
        "AUTOUPDATE",
        "MODELS_FETCH",
        "DEFAULT_PLUGINS",
        "EXTERNAL_SKILLS",
        "CLAUDE_CODE",
        "LSP_DOWNLOAD",
        "PROJECT_CONFIG",
    ):
        env["OPENCODE_DISABLE_" + name] = "true"
    return env


def get_json(url, password=None):
    headers = {}
    if password:
        headers["Authorization"] = (
            "Basic " + base64.b64encode(("opencode:" + password).encode()).decode()
        )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(urllib.request.Request(url, headers=headers), timeout=4) as response:
            body = response.read(2_000_001)
            if len(body) > 2_000_000:
                raise ValueError("Protocol response exceeds limit")
            return response.status, json.loads(body)
    except urllib.error.HTTPError as error:
        code = error.code
        error.close()
        return code, None


def verify():
    if os.getuid() == 0 or ROOT.is_symlink() or not (ROOT / "env.sh").is_file():
        raise ValueError("Expected dedicated non-root V2 install")
    for binary in (ROOT / "node/bin/node", ROOT / "opencode/bin/opencode"):
        with binary.open("rb") as executable:
            if executable.read(4) != b"\x7fELF":
                raise ValueError("Expected Linux ELF executable")
    probe_dir = ROOT / "probes"
    probe_dir.mkdir(mode=0o700, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="runtime-", dir=probe_dir) as temp:
        home = Path(temp)
        for name in ("home", "config", "data", "state", "cache", "workspace"):
            (home / name).mkdir(mode=0o700)
        env = runtime_env(home)
        node_code = """
const response = await fetch('https://ai.lazy.local/api/health', {
  signal: AbortSignal.timeout(8000)
});
const body = await response.json();
console.log(JSON.stringify({ platform: process.platform, version: process.version,
  status: response.status, healthOk: body.ok === true, caVerified: true }));
"""
        node = subprocess.run(
            [str(ROOT / "node/bin/node"), "--input-type=module", "-e", node_code],
            env=env,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        if node.returncode != 0:
            raise ValueError("Node HTTPS verification failed; raw logs suppressed")
        node_tls = json.loads(node.stdout)
        if node_tls.get("status") != 200 or node_tls.get("healthOk") is not True:
            raise ValueError("Node HTTPS health check failed")
        password = secrets.token_urlsafe(32)
        env["OPENCODE_SERVER_PASSWORD"] = password
        env["OPENCODE_CONFIG_CONTENT"] = json.dumps(
            {
                "enabled_providers": [],
                "plugin": [],
                "mcp": {},
                "lsp": False,
                "formatter": False,
                "share": "disabled",
                "autoupdate": False,
            }
        )
        log_path = home / "server.log"
        stopped = False
        with log_path.open("wb") as log:
            process = subprocess.Popen(
                [
                    str(ROOT / "opencode/bin/opencode"),
                    "serve",
                    "--pure",
                    "--hostname",
                    "127.0.0.1",
                    "--port",
                    "0",
                ],
                env=env,
                cwd=home / "workspace",
                stdout=log,
                stderr=log,
                start_new_session=True,
            )
            try:
                deadline = time.monotonic() + 25
                url = None
                while time.monotonic() < deadline and process.poll() is None:
                    content = log_path.read_bytes()[:65536].decode("utf-8", "replace")
                    match = re.search(r"http://127\.0\.0\.1:(\d+)", content)
                    if match:
                        url = match.group(0)
                        break
                    time.sleep(0.1)
                if url is None:
                    raise ValueError("OpenCode did not publish a loopback endpoint")
                anonymous, _ = get_json(url + "/global/health")
                status, health = get_json(url + "/global/health", password)
                spec_status, spec = get_json(url + "/doc", password)
                required = [
                    "/global/health",
                    "/event",
                    "/session",
                    "/session/{sessionID}/abort",
                    "/session/{sessionID}/prompt_async",
                ]
                paths = spec.get("paths", {}) if isinstance(spec, dict) else {}
                present = {path: path in paths for path in required}
                if (
                    anonymous != 401
                    or status != 200
                    or not isinstance(health, dict)
                    or health.get("healthy") is not True
                    or spec_status != 200
                    or not all(present.values())
                ):
                    raise ValueError("OpenCode auth/health/API schema check failed")
                protocol = {
                    "bind": "127.0.0.1",
                    "anonymousHealthStatus": anonymous,
                    "authenticatedHealthStatus": status,
                    "healthy": True,
                    "version": health.get("version"),
                    "openApiStatus": spec_status,
                    "requiredPathsPresent": present,
                    "sessionsCreated": 0,
                    "modelRequests": 0,
                }
            finally:
                # This process owns this new session/group; never kill by executable name.
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
                try:
                    os.killpg(process.pid, 0)
                except ProcessLookupError:
                    stopped = True
                if not stopped:
                    os.killpg(process.pid, signal.SIGKILL)
                    raise ValueError("Process group still existed after primary exit")
        return {
            "nativeElfExecutablesVerified": True,
            "nodeHttps": node_tls,
            "opencodeProtocol": protocol,
            "ownedProcessExited": stopped,
            "temporaryProbeRemovedOnExit": True,
            "adapterExecutionVerified": False,
            "streamStopResumeModelTurnTested": False,
        }


if __name__ == "__main__":
    try:
        print(json.dumps(verify(), indent=2))
    except (ValueError, OSError, subprocess.SubprocessError):
        print(json.dumps({"error": "runtime-preflight-failed", "rawLogsSuppressed": True}))
        raise SystemExit(1) from None
