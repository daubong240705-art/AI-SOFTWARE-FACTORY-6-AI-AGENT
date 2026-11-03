#!/usr/bin/python3
"""Root-owned deployment boundary. Inputs are numeric CI IDs and a full commit SHA.

No path, URL, Compose file, shell fragment or image name is accepted from SSH.
Configuration and Compose are installed independently by the host administrator.
"""

import fcntl
import hashlib
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path("/opt/asf-control")
ETC = Path("/etc/asf-control")
CONFIG = json.loads((ETC / "deploy.json").read_text()) if ETC.exists() else {}


def command(args: list[str], **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def api(path: str, target: Path | None = None):
    import ssl

    request = urllib.request.Request(
        CONFIG["gitlab_url"] + "/api/v4/" + path,
        headers={"PRIVATE-TOKEN": (ETC / "gitlab-read-token").read_text().strip()},
    )
    with urllib.request.urlopen(
        request, context=ssl.create_default_context(cafile=str(ETC / "caddy-root.crt")), timeout=120
    ) as response:
        if target:
            with target.open("wb") as out:
                while block := response.read(1024 * 1024):
                    out.write(block)
            return None
        return json.load(response)


def compose(sha: str, *args: str):
    return [
        "docker",
        "compose",
        "--project-name",
        "asf-control",
        "--env-file",
        str(ETC / "release-base.env"),
        "-f",
        str(ROOT / "compose.yml"),
        *args,
    ], dict(os.environ, RELEASE_SHA=sha)


def dc(sha: str, *args: str):
    cmd, env = compose(sha, *args)
    command(cmd, env=env)


def audit(action: str, **details):
    with (ROOT / "deploy-audit.jsonl").open("a") as out:
        out.write(json.dumps({"at": time.time(), "action": action, **details}) + "\n")


def validate_pipeline(sha: str, pipeline_id: int, deploy_id: int):
    project = CONFIG["project_id"]
    pipeline = api(f"projects/{project}/pipelines/{pipeline_id}")
    assert pipeline["sha"] == sha and pipeline["ref"] == "main"
    branch = api(f"projects/{project}/repository/branches/main")
    assert branch["protected"] and branch["commit"]["id"] == sha, (
        "Only current protected main may deploy"
    )
    jobs = api(f"projects/{project}/pipelines/{pipeline_id}/jobs?per_page=100")
    deploy = next(j for j in jobs if j["id"] == deploy_id)
    assert deploy["name"] == "deploy_control" and deploy["status"] == "running"
    required = {
        "backend_checks",
        "frontend_checks",
        "image_api",
        "image_dashboard",
        "package_images",
    }
    successful = {j["name"] for j in jobs if j["status"] == "success"}
    assert required <= successful, "All required jobs must succeed"
    return next(j["id"] for j in jobs if j["name"] == "package_images" and j["status"] == "success")


def verify_images(directory: Path, sha: str):
    checksums = {}
    for line in (directory / "SHA256SUMS").read_text().splitlines():
        digest, name = line.split()
        assert name in {"api.tar", "dashboard.tar", "manifest.json"}
        assert name not in checksums and re.fullmatch(r"[0-9a-f]{64}", digest)
        checksums[name] = digest
    assert set(checksums) == {"api.tar", "dashboard.tar", "manifest.json"}
    for name, digest in checksums.items():
        with (directory / name).open("rb") as stream:
            assert hashlib.file_digest(stream, "sha256").hexdigest() == digest
    manifest = json.loads((directory / "manifest.json").read_text())
    assert manifest["sha"] == sha and manifest["schema"] == "0003_auth"
    for name in ("api", "dashboard"):
        image = manifest["images"][name]
        path = directory / f"{name}.tar"
        with path.open("rb") as stream:
            assert hashlib.file_digest(stream, "sha256").hexdigest() == image["sha256"]
        assert image["tag"] == f"asf-{name}:{sha}"
        with tarfile.open(path) as archive:
            info = json.load(archive.extractfile("manifest.json"))
            assert len(info) == 1 and info[0]["RepoTags"] == [image["tag"]]
            raw = archive.extractfile(info[0]["Config"]).read()
            assert "sha256:" + hashlib.sha256(raw).hexdigest() == image["image_id"]
            assert json.loads(raw)["config"]["Labels"]["org.opencontainers.image.revision"] == sha
        command(["docker", "load", "--input", str(path)], stdout=subprocess.DEVNULL)
        # Docker's containerd image store may report a manifest digest as .Id.
        # Compare the loaded config bytes instead of assuming .Id is a config digest.
        with tempfile.TemporaryFile() as loaded:
            command(["docker", "image", "save", image["tag"]], stdout=loaded)
            loaded.seek(0)
            with tarfile.open(fileobj=loaded) as archive:
                info = json.load(archive.extractfile("manifest.json"))
                assert len(info) == 1 and image["tag"] in info[0]["RepoTags"]
                raw = archive.extractfile(info[0]["Config"]).read()
                assert "sha256:" + hashlib.sha256(raw).hexdigest() == image["image_id"]
    return manifest


def health(sha: str):
    for _ in range(60):
        try:
            with urllib.request.urlopen("http://192.168.1.14:18101/healthz", timeout=3) as response:
                assert json.load(response)["release_sha"] == sha
            with urllib.request.urlopen("http://192.168.1.14:18101/readyz", timeout=3) as response:
                assert response.status == 200
            with urllib.request.urlopen("http://192.168.1.14:18100/login", timeout=3) as response:
                assert response.status == 200
            return
        except Exception:
            time.sleep(2)
    raise RuntimeError("Release health check failed")


def activate(sha: str):
    # Only application containers are replaced; DB/Redis and volumes are independent.
    dc(sha, "up", "-d", "--wait", "--wait-timeout", "120", "postgres", "redis")
    dc(sha, "stop", "dispatcher", "workflow-worker", "api", "dashboard")
    dc(sha, "run", "--rm", "--no-deps", "migrate")
    dc(sha, "up", "-d", "--no-deps", "api", "dashboard", "dispatcher", "workflow-worker")
    health(sha)


def main():
    os.umask(0o077)
    match = re.fullmatch(
        r"deploy ([0-9a-f]{40}) ([1-9][0-9]{0,12}) ([1-9][0-9]{0,12})",
        sys.argv[1] if len(sys.argv) == 2 else "",
    )
    if not match:
        raise SystemExit("Denied: expected deploy <full SHA> <pipeline ID> <deploy job ID>")
    sha, pipeline, job = match.group(1), int(match.group(2)), int(match.group(3))
    with (ROOT / "deploy.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        package = validate_pipeline(sha, pipeline, job)
        audit("deploy.started", sha=sha, pipeline=pipeline, job=job)
        previous = (ROOT / "current").read_text().strip() if (ROOT / "current").exists() else None
        release = ROOT / "releases" / sha
        release.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="asf-release-", dir=ROOT) as temp:
            directory = Path(temp)
            artifact = directory / "package.zip"
            api(f"projects/{CONFIG['project_id']}/jobs/{package}/artifacts", artifact)
            with zipfile.ZipFile(artifact) as archive:
                for name in ("api.tar", "dashboard.tar", "manifest.json", "SHA256SUMS"):
                    with (
                        archive.open("release/" + name) as src,
                        (directory / name).open("wb") as dest,
                    ):
                        while block := src.read(1024 * 1024):
                            dest.write(block)
            manifest = verify_images(directory, sha)
            assert manifest["pipeline_id"] == pipeline
            (release / "manifest.json").write_text(json.dumps(manifest, indent=2))
        # Pre-migration, off-host DB backup is mandatory after the initial installation.
        if previous:
            command(["/usr/local/sbin/asf-backup"])
        try:
            activate(sha)
        except Exception:
            audit("deploy.failed", sha=sha)
            if previous:
                activate(previous)
                audit("deploy.rolled_back", sha=previous, failed_sha=sha)
            raise
        if previous:
            (ROOT / "previous").write_text(previous + "\n")
        (ROOT / "current.new").write_text(sha + "\n")
        (ROOT / "current.new").replace(ROOT / "current")
        audit("deploy.succeeded", sha=sha, pipeline=pipeline, job=job)
        print("ASF release active:", sha)


if __name__ == "__main__":
    main()
