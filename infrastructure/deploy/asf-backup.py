#!/usr/bin/python3
"""Dump ASF's complete database, verify checksum and deliver to a second host."""

import hashlib
import json
import os
import subprocess
from datetime import UTC, datetime
from pathlib import Path


def main():
    os.umask(0o077)
    target = Path("/var/backups/asf-control")
    target.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    path = target / f"{stamp}.dump"
    cid = subprocess.check_output(
        [
            "docker",
            "ps",
            "-q",
            "--filter",
            "label=com.docker.compose.project=asf-control",
            "--filter",
            "label=com.docker.compose.service=postgres",
        ],
        text=True,
    ).strip()
    assert cid and "\n" not in cid
    with path.open("wb") as out:
        subprocess.run(
            ["docker", "exec", cid, "pg_dump", "-U", "asf", "-d", "asf", "-Fc"],
            stdout=out,
            check=True,
        )
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    subprocess.run(
        ["docker", "exec", cid, "pg_restore", "--version"], stdout=subprocess.DEVNULL, check=True
    )
    ssh = [
        "ssh",
        "-i",
        "/etc/asf-control/backup-key",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "UserKnownHostsFile=/etc/asf-control/backup-known-hosts",
        "asf-backup@192.168.1.60",
        f"put {stamp} {digest}",
    ]
    with path.open("rb") as stream:
        subprocess.run(ssh, stdin=stream, check=True)
    metadata = {
        "created": stamp,
        "sha256": digest,
        "size": path.stat().st_size,
        "release": Path("/opt/asf-control/current").read_text().strip(),
        "off_host": "192.168.1.60",
    }
    path.with_suffix(".json").write_text(json.dumps(metadata, indent=2))
    for old in sorted(target.glob("*.dump"))[:-7]:
        old.unlink()
        old.with_suffix(".json").unlink(missing_ok=True)
    print("ASF backup delivered and checksummed:", stamp)


if __name__ == "__main__":
    main()
