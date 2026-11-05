"""Read-only Linux/WSL readiness probe. JSON output contains facts, never credentials."""

import argparse
import json
import os
import platform
import shutil
import socket
import sqlite3
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

LINUX_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
MIN_NODE = (22, 20, 0)
MODEL = "ds/deepseek-v4-flash"
VERSION_ARGS = {
    "bash": ["--version"],
    "git": ["--version"],
    "node": ["--version"],
    "npm": ["--version"],
    "python3": ["--version"],
    "curl": ["--version"],
    "openssl": ["version"],
    "codex": ["--version"],
    "claude": ["--version"],
    "opencode": ["--version"],
}


def command(argv, env=None, timeout=10):
    """No shell or raw stderr: a failing executable must not leak env/auth into reports."""
    try:
        result = subprocess.run(
            argv, capture_output=True, text=True, env=env, timeout=timeout, check=False
        )
        return result.returncode, result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None, ""


def linux_executable(path):
    if not path:
        return False
    resolved = Path(path).resolve()
    return not str(resolved).startswith("/mnt/") and resolved.is_file()


def tool(name, env):
    inherited = shutil.which(name)
    native = shutil.which(name, path=env["PATH"])
    native = native if linux_executable(native) else None
    code, output = command([native, *VERSION_ARGS[name]], env) if native else (None, "")
    version = output.splitlines()[0][:160] if code == 0 and output else None
    return {
        "installed": bool(native),
        "executable": native,
        "version": version,
        "versionProbeSucceeded": code == 0,
        "windowsPathContamination": bool(inherited and not linux_executable(inherited)),
    }


def nearest_existing(path):
    current = Path(path).resolve()
    while not current.exists() and current.parent != current:
        current = current.parent
    return current


def filesystem(path):
    existing = nearest_existing(path)
    code, output = command(["/usr/bin/findmnt", "-T", str(existing), "-n", "-o", "FSTYPE"])
    usage = shutil.disk_usage(existing)
    kind = output if code == 0 else "unknown"
    return {
        "type": kind,
        "linuxNative": kind in ("ext4", "xfs", "btrfs"),
        "freeBytes": usage.free,
        "totalBytes": usage.total,
        "measuredAtExistingAncestor": existing != Path(path).resolve(),
    }


def valid_origin(value):
    parsed = urllib.parse.urlsplit(value)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise ValueError("Expected an HTTP(S) origin without credentials/path/query")
    if parsed.scheme != "https" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("Plain HTTP is allowed only on loopback")
    return value.rstrip("/")


def http_probe(url, ca=None, key=None, json_body=False):
    """Only GET; no proxy, redirect, insecure TLS, auth persistence, or inference request."""

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    start = time.monotonic()
    headers = {"Accept": "application/json", "User-Agent": "factory-v2-preflight/1"}
    if key:
        headers["Authorization"] = "Bearer " + key
    context = ssl.create_default_context(cafile=str(ca) if ca else None)
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), NoRedirect(), urllib.request.HTTPSHandler(context=context)
    )
    result = {"status": None, "tlsVerified": False, "error": None}
    body = None
    try:
        with opener.open(urllib.request.Request(url, headers=headers), timeout=8) as response:
            result["status"] = response.status
            result["tlsVerified"] = url.startswith("https:")
            if json_body:
                raw = response.read(2_000_001)
                if len(raw) > 2_000_000:
                    result["error"] = "response-too-large"
                else:
                    try:
                        body = json.loads(raw)
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        result["error"] = "invalid-json"
    except urllib.error.HTTPError as error:
        result["status"] = error.code
        result["tlsVerified"] = url.startswith("https:")
        result["error"] = "http-error"
        error.close()
    except urllib.error.URLError as error:
        result["error"] = (
            "tls-untrusted"
            if isinstance(error.reason, ssl.SSLCertVerificationError)
            else "network-unavailable"
        )
    except (OSError, ValueError):
        result["error"] = "network-unavailable"
    result["durationMs"] = round((time.monotonic() - start) * 1000)
    return result, body


def models_readiness(status, model_present, key_provided):
    if status == 200:
        return "authenticated" if key_provided and model_present is not None else "unknown"
    if status in (401, 403) or not key_provided:
        return "needs-auth"
    return "unknown"


def memory():
    values = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key, value = line.split(":", 1)
        if key in ("MemTotal", "MemAvailable", "SwapTotal"):
            values[key] = int(value.strip().split()[0]) * 1024
    return values


def collect(args):
    if sys.platform != "linux":
        raise ValueError("Run with Linux python3 inside WSL, not Windows Python")
    import pwd

    repo = Path(__file__).resolve().parents[2]
    runtime_root = Path(args.runtime_root).resolve() if args.runtime_root else None
    env = {
        **os.environ,
        "PATH": LINUX_PATH,
        "NO_COLOR": "1",
        "OPENCODE_DISABLE_AUTOUPDATE": "true",
        "OPENCODE_DISABLE_MODELS_FETCH": "true",
    }
    if runtime_root:
        env["PATH"] = f"{runtime_root}/opencode/bin:{runtime_root}/node/bin:" + env["PATH"]
        env.update(
            {
                "HOME": str(runtime_root / "home"),
                "XDG_CONFIG_HOME": str(runtime_root / "config"),
                "XDG_DATA_HOME": str(runtime_root / "data"),
                "XDG_STATE_HOME": str(runtime_root / "state"),
                "XDG_CACHE_HOME": str(runtime_root / "cache"),
                "NODE_EXTRA_CA_CERTS": str(runtime_root / "ca/caddy-root.crt"),
            }
        )
    tools = {name: tool(name, env) for name in VERSION_ARGS}
    key = sys.stdin.readline(8193).strip() if args.key_stdin else None
    if key and (len(key) > 8192 or any(c in key for c in "\r\n\0")):
        raise ValueError("Invalid key input")
    origin = valid_origin(args.router_origin)
    hostname = urllib.parse.urlsplit(origin).hostname
    try:
        addresses = sorted({row[4][0] for row in socket.getaddrinfo(hostname, 443)})
    except OSError:
        addresses = []
    ca = repo / "caddy-root.crt"
    default_health, _ = http_probe(origin + "/api/health")
    health, body = http_probe(origin + "/api/health", ca, json_body=True)
    anonymous, _ = http_probe(origin + "/v1/models", ca)
    models, model_body = http_probe(origin + "/v1/models", ca, key, json_body=True)
    data = model_body.get("data") if isinstance(model_body, dict) else None
    ids = (
        [item["id"] for item in data if isinstance(item, dict) and isinstance(item.get("id"), str)]
        if isinstance(data, list)
        else None
    )
    model_present = MODEL in ids if ids is not None else None
    auth = models_readiness(models["status"], model_present, bool(key))
    node = tools["node"]
    try:
        node_version = tuple(map(int, (node["version"] or "").lstrip("v").split(".")))
    except ValueError:
        node_version = ()
    node_ok = len(node_version) == 3 and node_version >= MIN_NODE
    runtimes = {}
    for name in ("codex", "claude", "opencode"):
        item = tools[name]
        runtimes[name] = {
            **item,
            "authentication": "unknown",
            "providerAuthentication": auth if name == "opencode" else "unknown",
            "compatibility": "unknown",
            "ready": False,
            "reason": "not-installed-linux"
            if not item["installed"]
            else "adapter-protocol-not-verified",
        }
    runtime_fs = filesystem(runtime_root or Path.home())
    blockers = []
    if os.getuid() == 0:
        blockers.append("non-root-user-required")
    if not node_ok or not tools["npm"]["versionProbeSucceeded"]:
        blockers.append("linux-node-npm-required")
    if not runtime_fs["linuxNative"]:
        blockers.append("linux-filesystem-required")
    if not any(item["installed"] and item["versionProbeSucceeded"] for item in runtimes.values()):
        blockers.append("linux-agent-runtime-required")
    if health["status"] != 200 or not isinstance(body, dict) or body.get("ok") is not True:
        blockers.append("router-health-unavailable")
    if auth != "authenticated":
        blockers.append("router-auth-required")
    if model_present is not True:
        blockers.append("selected-model-not-verified")
    return {
        "schemaVersion": 1,
        "ticket": "F1-01",
        "observedAt": datetime.now(UTC).isoformat(),
        "scope": (
            "Read-only environment and GET probes; "
            "no inference, runtime session, database or install"
        ),
        "linux": {
            "distribution": platform.freedesktop_os_release().get("PRETTY_NAME"),
            "kernel": platform.release(),
            "architecture": platform.machine(),
            "wsl2": "microsoft" in platform.release().lower()
            and "wsl2" in platform.release().lower(),
            "user": pwd.getpwuid(os.getuid()).pw_name,
            "uid": os.getuid(),
            "cpuLogical": os.cpu_count(),
            "memoryBytes": memory(),
        },
        "filesystems": {"linuxStateCandidate": runtime_fs, "sourceCheckout": filesystem(repo)},
        "sqlite": {"pythonLibraryVersion": sqlite3.sqlite_version, "cliRequired": False},
        "toolchain": tools,
        "nodeMinimumSatisfied": node_ok,
        "router": {
            "origin": origin,
            "resolvedAddresses": addresses,
            "systemTrust": default_health,
            "explicitCaddyCa": health,
            "healthOk": isinstance(body, dict) and body.get("ok") is True,
            "anonymousModels": anonymous,
            "authenticatedModels": models,
            "credentialSuppliedViaStdin": bool(key),
            "authentication": auth,
            "modelCount": len(ids) if ids is not None else None,
            "selectedModel": MODEL,
            "selectedModelPresent": model_present,
            "inferenceTested": False,
        },
        "runtimes": runtimes,
        "readiness": {
            "environmentPrerequisitesSatisfied": not blockers,
            "blockers": blockers,
            "runtimeAdapterVerified": False,
            "hostImplemented": False,
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--router-origin", default="https://ai.lazy.local")
    parser.add_argument("--runtime-root")
    parser.add_argument(
        "--key-stdin", action="store_true", help="Read API key once, never persist/print"
    )
    args = parser.parse_args()
    try:
        print(json.dumps(collect(args), indent=2, ensure_ascii=True))
    except (ValueError, OSError):
        print(
            json.dumps(
                {"error": "preflight-failed", "remedy": "Check Linux paths, CA and arguments"}
            )
        )
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
