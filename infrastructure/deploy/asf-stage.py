#!/usr/bin/python3
"""Root-owned, single-project staging deploy boundary; never execute CI-provided commands."""

import hashlib
import json
import os
import re
import ssl
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import quote

ROOT = Path("/opt/asf-validation")
ETC = Path("/etc/asf-validation")


def canonical(files):
    return hashlib.sha256(
        json.dumps(files, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def validate_pipeline(pipeline, jobs, sha, deploy_id):
    if pipeline["sha"] != sha or not re.fullmatch(
        r"asf/[a-f0-9-]{36}/[a-f0-9-]{36}", pipeline["ref"]
    ):
        raise ValueError("candidate_pipeline_mismatch")
    deploy = next(j for j in jobs if j["id"] == deploy_id)
    if (
        deploy["name"] != "deploy_staging"
        or deploy["status"] != "running"
        or deploy["commit"]["id"] != sha
        or deploy["pipeline"]["id"] != pipeline["id"]
    ):
        raise ValueError("deploy_job_mismatch")
    required = {"test", "package_candidate"}
    if not required <= {
        j["name"] for j in jobs if j["status"] == "success" and j["commit"]["id"] == sha
    }:
        raise ValueError("candidate_checks_not_passed")
    return next(
        j["id"] for j in jobs if j["name"] == "package_candidate" and j["status"] == "success"
    )


def main():
    import fcntl

    if os.getuid() != 0:
        raise SystemExit("Root-owned boundary required")
    os.umask(0o077)
    match = re.fullmatch(
        r"stage ([a-f0-9]{40}) ([1-9][0-9]{0,12}) ([1-9][0-9]{0,12})",
        sys.argv[1] if len(sys.argv) == 2 else "",
    )
    if not match:
        raise SystemExit("Denied: stage <SHA> <pipeline ID> <job ID> required")
    sha, pipeline_id, job_id = match[1], int(match[2]), int(match[3])
    config = json.loads((ETC / "deploy.json").read_text())
    ctx = ssl.create_default_context(cafile=str(ETC / "caddy-root.crt"))

    def api(path):
        request = urllib.request.Request(
            config["gitlab_url"] + "/api/v4/projects/" + str(config["project_id"]) + path,
            headers={"PRIVATE-TOKEN": (ETC / "read-token").read_text().strip()},
        )
        with urllib.request.urlopen(request, context=ctx, timeout=30) as response:
            body = response.read(2_000_001)
            if len(body) > 2_000_000:
                raise ValueError("oversized_release")
            return json.loads(body)

    def dc(*args, required=True):
        return subprocess.run(
            ["docker", *args], check=required, capture_output=True, text=True, timeout=90
        )

    ROOT.mkdir(mode=0o755, exist_ok=True)
    ROOT.chmod(0o755)
    with (ROOT / "deploy.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        pipeline = api(f"/pipelines/{pipeline_id}")
        jobs = api(f"/pipelines/{pipeline_id}/jobs?per_page=100")
        if len(jobs) >= 100:
            raise ValueError("job_limit")
        package_id = validate_pipeline(pipeline, jobs, sha, job_id)
        request = urllib.request.Request(
            config["authorization_url"],
            method="POST",
            data=json.dumps(
                {
                    "project_id": config["project_id"],
                    "candidate_sha": sha,
                    "pipeline_id": pipeline_id,
                    "job_id": job_id,
                }
            ).encode(),
            headers={
                "Authorization": "Bearer " + (ETC / "verifier-key").read_text().strip(),
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(request, context=ctx, timeout=10) as response:
            approval = json.load(response)
        if not approval.get("authorized"):
            raise ValueError("staging_approval_required")
        branch = api("/repository/branches/" + quote(pipeline["ref"], safe=""))
        if branch["commit"]["id"] != sha:
            raise ValueError("branch_changed")
        # Attest trusted CI/package scripts independently of the caller's environment.
        import base64

        for name, expected in config["trusted_files"].items():
            item = api("/repository/files/" + quote(name, safe="") + "?ref=" + sha)
            raw = base64.b64decode(item["content"], validate=True)
            if hashlib.sha256(raw).hexdigest() != expected:
                raise ValueError("untrusted_pipeline_definition")
        manifest = api(f"/jobs/{package_id}/artifacts/release/manifest.json")
        files = api(f"/jobs/{package_id}/artifacts/release/source.json")
        if not files or len(files) > 40:
            raise ValueError("invalid_source")
        for name, content in files.items():
            if (
                not re.fullmatch(r"src/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+\.py", name)
                or not isinstance(content, str)
                or len(content.encode()) > 200_000
            ):
                raise ValueError("invalid_source_path")
            item = api("/repository/files/" + quote(name, safe="") + "?ref=" + sha)
            if base64.b64decode(item["content"], validate=True).decode() != content:
                raise ValueError("source_commit_mismatch")
        expected = {
            "project_id": config["project_id"],
            "candidate_sha": sha,
            "pipeline_id": pipeline_id,
            "artifact_sha256": canonical(files),
        }
        if manifest != expected:
            raise ValueError("artifact_manifest_mismatch")
        release = ROOT / "releases" / sha
        release.mkdir(parents=True, exist_ok=True, mode=0o755)
        (ROOT / "releases").chmod(0o755)
        release.chmod(0o755)
        for name, content in files.items():
            target = release / name
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            for directory in target.parents:
                if directory == release:
                    break
                directory.chmod(0o755)
            target.write_text(content)
            target.chmod(0o444)
        (release / "manifest.json").write_text(json.dumps(expected))
        (release / "manifest.json").chmod(0o444)
        if dc("network", "inspect", "asf-validation", required=False).returncode:
            dc(
                "network",
                "create",
                "--opt",
                "com.docker.network.bridge.name=br-asf-stage",
                "asf-validation",
            )
        network = json.loads(dc("network", "inspect", "asf-validation").stdout)[0]
        if (
            network["Internal"]
            or network["Options"].get("com.docker.network.bridge.name") != "br-asf-stage"
        ):
            raise ValueError("staging_network_policy_mismatch")
        subprocess.run(["/usr/local/sbin/asf-validation-firewall"], check=True, timeout=15)
        previous = dc("container", "inspect", "asf-validation", required=False).returncode == 0
        dc("rm", "-f", "asf-validation-previous", required=False)
        if previous:
            dc("stop", "asf-validation")
            dc("rename", "asf-validation", "asf-validation-previous")
        try:
            dc(
                "run",
                "-d",
                "--name",
                "asf-validation",
                "--restart=no",
                "--network=asf-validation",
                "--dns=127.0.0.1",
                "--read-only",
                "--user=10001:10001",
                "--memory=128m",
                "--memory-swap=128m",
                "--cpus=0.2",
                "--pids-limit=32",
                "--cap-drop=ALL",
                "--security-opt=no-new-privileges",
                "--publish",
                "192.168.1.14:18120:8080",
                "--mount",
                f"type=bind,src={release},dst=/artifact,readonly",
                "--mount",
                f"type=bind,src={ETC / 'runtime.py'},dst=/runtime.py,readonly",
                config["runtime_image"],
                "python",
                "-B",
                "/runtime.py",
            )
            healthy = False
            for _ in range(20):
                try:
                    with urllib.request.urlopen(
                        "http://192.168.1.14:18120/healthz", timeout=2
                    ) as r:
                        data = json.load(r)
                    if data == {**expected, "status": "ok"}:
                        healthy = True
                        break
                except Exception:
                    time.sleep(1)
            if not healthy:
                raise ValueError("staging_health_failed")
        except Exception:
            dc("rm", "-f", "asf-validation", required=False)
            if previous:
                dc("rename", "asf-validation-previous", "asf-validation")
                dc("start", "asf-validation")
            raise
        (ROOT / "current").write_text(sha + "\n")
        with (ROOT / "audit.jsonl").open("a") as out:
            out.write(json.dumps({**expected, "job_id": job_id, "at": time.time()}) + "\n")
        print(json.dumps({**expected, "health_verified": True}))


if __name__ == "__main__":
    main()
