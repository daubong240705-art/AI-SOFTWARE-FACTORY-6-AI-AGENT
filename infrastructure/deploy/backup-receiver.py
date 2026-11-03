#!/usr/bin/python3
"""Forced command for an unprivileged backup account; no arbitrary remote paths."""

import hashlib
import os
import re
import sys
from datetime import datetime
from pathlib import Path


def main():
    os.umask(0o077)
    match = re.fullmatch(
        r"put ([0-9]{8}T[0-9]{6}Z) ([0-9a-f]{64})", os.environ.get("SSH_ORIGINAL_COMMAND", "")
    )
    if not match:
        raise SystemExit("Denied: backup uploads only")
    stamp, digest = match.groups()
    datetime.strptime(stamp, "%Y%m%dT%H%M%SZ")
    root = Path("/srv/asf-backups")
    temporary = root / f".{stamp}-{os.getpid()}.partial"
    target = root / (stamp + ".dump")
    try:
        hasher = hashlib.sha256()
        total = 0
        with temporary.open("xb") as out:
            while block := sys.stdin.buffer.read(1024 * 1024):
                total += len(block)
                if total > 10 * 1024**3:
                    raise RuntimeError("Backup exceeds size limit")
                hasher.update(block)
                out.write(block)
            out.flush()
            os.fsync(out.fileno())
        assert total > 0 and hasher.hexdigest() == digest, "Backup checksum mismatch"
        temporary.replace(target)
        target.with_suffix(".sha256").write_text(digest + "  " + target.name + "\n")
    finally:
        temporary.unlink(missing_ok=True)
    backups = sorted(root.glob("*.dump"), reverse=True)
    keep = set(backups[:7])
    weeks = set()
    for backup in backups:
        week = datetime.strptime(backup.stem, "%Y%m%dT%H%M%SZ").isocalendar()[:2]
        if week not in weeks and len(weeks) < 4:
            weeks.add(week)
            keep.add(backup)
    for backup in backups:
        if backup not in keep:
            backup.unlink()
            backup.with_suffix(".sha256").unlink(missing_ok=True)
    print("Off-host backup verified:", stamp)


if __name__ == "__main__":
    main()
