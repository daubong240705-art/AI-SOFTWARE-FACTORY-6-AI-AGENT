#!/usr/bin/python3
"""Administrator-only application rollback; never downgrade or restore a live DB."""

import fcntl
import importlib.util
import json
import os
import subprocess
from pathlib import Path


def main():
    if os.getuid() != 0:
        raise SystemExit("Host administrator required")
    root = Path("/opt/asf-control")
    with (root / "deploy.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        previous = (root / "previous").read_text().strip()
        current = (root / "current").read_text().strip()
        # Extensionless executable: explicitly use the Python source loader.
        from importlib.machinery import SourceFileLoader

        spec = importlib.util.spec_from_loader(
            "asf_release", SourceFileLoader("asf_release", "/usr/local/sbin/asf-release")
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        manifest = json.loads((root / "releases" / previous / "manifest.json").read_text())
        actual = module.database_schema()
        if not module.rollback_compatible(manifest, actual):
            raise SystemExit(
                "Previous application does not support current schema; no DB downgrade"
            )
        subprocess.run(["/usr/local/sbin/asf-backup"], check=True)
        module.activate(previous, migrate=False)
        (root / "current").write_text(previous + "\n")
        (root / "previous").write_text(current + "\n")
        module.audit("rollback.manual", sha=previous, previous=current)
        print("Application rollback healthy:", previous)


if __name__ == "__main__":
    main()
