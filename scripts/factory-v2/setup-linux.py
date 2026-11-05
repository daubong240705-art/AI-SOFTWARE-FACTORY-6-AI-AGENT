"""Reviewed rootless setup recipe. Default: plan only. --apply writes one explicit Linux root."""

import argparse
import base64
import hashlib
import json
import os
import platform
import posixpath
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path, PurePosixPath

REPO = Path(__file__).resolve().parents[2]
LOCK = Path(__file__).with_name("linux-toolchain.lock.json")
MAX_DOWNLOAD = 200 * 1024 * 1024
MAX_UNPACKED = 1024 * 1024 * 1024


def account_home():
    if sys.platform == "linux":
        import pwd

        return Path(pwd.getpwuid(os.getuid()).pw_dir)
    return Path.home()


def verify_digest(data, artifact):
    digest = hashlib.new(artifact["algorithm"], data).digest()
    if "integrity" in artifact:
        expected = artifact["integrity"].split("-", 1)[1]
        actual = base64.b64encode(digest).decode("ascii")
    else:
        expected, actual = artifact["digest"], digest.hex()
    if expected != actual:
        raise ValueError("Artifact checksum mismatch")


def validate_members(members, prefix):
    total = 0
    for member in members:
        path = PurePosixPath(member.name)
        if (
            path.is_absolute()
            or ".." in path.parts
            or not path.parts
            or path.parts[0] != prefix
            or member.isdev()
            or member.isfifo()
        ):
            raise ValueError("Unsafe archive entry")
        if member.issym() or member.islnk():
            target = PurePosixPath(member.linkname)
            combined = path.parent / target if member.issym() else target
            normalized = posixpath.normpath(str(combined))
            if target.is_absolute() or not normalized.startswith(prefix + "/"):
                raise ValueError("Unsafe archive link")
        total += member.size
        if total > MAX_UNPACKED:
            raise ValueError("Archive exceeds extraction limit")


def validate_root(root, home):
    # No alternate system dirs, shared mounts, traversal or symlink parents.
    expected = home / "factory-v2"
    if root != expected or root.resolve() != expected:
        raise ValueError("Root must be the user's literal ~/factory-v2 directory")
    for part in [root, *root.parents]:
        if part.is_symlink():
            raise ValueError("Symlinked install root/ancestor is not allowed")


def write_new_or_identical(path, data):
    if path.is_symlink():
        raise ValueError("Refusing symlink target")
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError("Existing configuration differs; refusing overwrite")
        return
    with path.open("xb") as output:
        output.write(data)


def setup(root, lock):
    if sys.platform != "linux" or platform.machine() != "x86_64" or os.getuid() == 0:
        raise ValueError("Requires non-root Linux x86_64 user")
    validate_root(root, account_home())
    existing = root if root.exists() else root.parent
    fs = subprocess.check_output(
        ["/usr/bin/findmnt", "-T", str(existing), "-n", "-o", "FSTYPE"], text=True
    ).strip()
    if fs not in ("ext4", "xfs", "btrfs"):
        raise ValueError("Requires native Linux filesystem")
    if shutil.disk_usage(existing).free < 2 * 1024**3:
        raise ValueError("Requires at least 2 GiB free")
    if root.exists() and not (root / ".factory-v2-setup.json").exists():
        raise ValueError("Existing root has no setup marker; refusing to adopt user data")
    root.mkdir(mode=0o700, exist_ok=True)
    marker = json.dumps({"schemaVersion": 1, "toolchain": lock}, indent=2).encode() + b"\n"
    write_new_or_identical(root / ".factory-v2-setup.json", marker)
    for name in ("downloads", "ca", "home", "config", "data", "state", "cache", "workspaces"):
        target = root / name
        if target.is_symlink():
            raise ValueError("Refusing symlinked setup directory")
        target.mkdir(mode=0o700, exist_ok=True)
    ca = (REPO / lock["caddyCa"]["source"]).read_bytes()
    if hashlib.sha256(ca).hexdigest() != lock["caddyCa"]["sha256"]:
        raise ValueError("Caddy CA differs from reviewed fingerprint")
    write_new_or_identical(root / "ca/caddy-root.crt", ca)
    for name in ("node", "opencode"):
        artifact = lock[name]
        target = root / artifact["destination"]
        stamp = root / ("." + name + "-artifact.json")
        stamp_data = json.dumps(artifact, sort_keys=True).encode() + b"\n"
        if target.exists() or target.is_symlink():
            if (
                target.is_symlink()
                or not stamp.is_file()
                or stamp.is_symlink()
                or stamp.read_bytes() != stamp_data
            ):
                raise ValueError("Existing toolchain differs; refusing overwrite")
            continue
        archive = root / "downloads" / Path(artifact["url"]).name
        if archive.is_symlink():
            raise ValueError("Refusing archive symlink")
        if not archive.exists():
            with urllib.request.urlopen(artifact["url"], timeout=30) as response:
                data = response.read(MAX_DOWNLOAD + 1)
            if len(data) > MAX_DOWNLOAD:
                raise ValueError("Download too large")
            verify_digest(data, artifact)
            write_new_or_identical(archive, data)
        else:
            verify_digest(archive.read_bytes(), artifact)
        # Only staging created by this invocation is automatically cleaned up.
        with tempfile.TemporaryDirectory(prefix="extract-", dir=root / "downloads") as temp:
            with tarfile.open(archive) as bundle:
                members = bundle.getmembers()
                validate_members(members, artifact["archiveRoot"])
                bundle.extractall(temp, members=members, filter="data")
            extracted = Path(temp) / artifact["archiveRoot"]
            extracted.rename(target)
        write_new_or_identical(stamp, stamp_data)
    values = {
        "FACTORY_V2_ROOT": str(root),
        "HOME": str(root / "home"),
        "XDG_CONFIG_HOME": str(root / "config"),
        "XDG_DATA_HOME": str(root / "data"),
        "XDG_STATE_HOME": str(root / "state"),
        "XDG_CACHE_HOME": str(root / "cache"),
        "NODE_EXTRA_CA_CERTS": str(root / "ca/caddy-root.crt"),
        "NO_PROXY": "localhost,127.0.0.1,::1,ai.lazy.local",
        "OPENCODE_DISABLE_AUTOUPDATE": "true",
        "OPENCODE_DISABLE_MODELS_FETCH": "true",
    }
    lines = ["# Source only in the dedicated V2 shell/process; no credentials are stored here."]
    lines += [f"export {key}={shlex.quote(value)}" for key, value in values.items()]
    lines += [
        "export PATH="
        + shlex.quote(f"{root}/node/bin:{root}/opencode/bin:/usr/local/bin:/usr/bin:/bin")
    ]
    write_new_or_identical(root / "env.sh", ("\n".join(lines) + "\n").encode())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=account_home() / "factory-v2")
    parser.add_argument("--apply", action="store_true", help="Requires authorization for this root")
    args = parser.parse_args()
    lock = json.loads(LOCK.read_text())
    plan = {
        "mode": "apply" if args.apply else "plan-only",
        "root": str(args.root),
        "versions": {name: lock[name]["version"] for name in ("node", "opencode")},
        "writes": [
            "node/",
            "opencode/",
            "downloads/",
            "ca/",
            "home/",
            "config/",
            "data/",
            "state/",
            "cache/",
            "workspaces/",
            "env.sh",
            "setup/artifact markers",
        ],
        "changesSystemConfiguration": False,
        "copiesCredentials": False,
        "executesRemoteInstaller": False,
        "startsModelOrServer": False,
    }
    if args.apply:
        setup(args.root, lock)
    print(json.dumps(plan, indent=2))


if __name__ == "__main__":
    main()
