"""Verify exact pipeline/ref, packaged source and deployed health before completion."""

import hashlib
import json
import re
import ssl
from typing import Any

import httpx

from integrations.services import GitLab
from orchestrator.state import WorkflowError
from shared.config import get_settings
from shared.profiles import IntegrationProfile


def source_digest(files: dict[str, str]) -> str:
    raw = json.dumps(files, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def candidate_ref(ref: str, run_id: str) -> bool:
    return bool(re.fullmatch(r"asf/" + re.escape(run_id) + r"/[a-f0-9-]{36}", ref))


def verify_pipeline(pipeline: dict[str, Any], sha: str, run_id: str) -> None:
    if pipeline["sha"] != sha or not candidate_ref(pipeline["ref"], run_id):
        raise WorkflowError("pipeline_candidate_mismatch")


def deployment_evidence(
    profile: IntegrationProfile, gl: GitLab, sha: str, pipeline_id: int, jobs: list[dict[str, Any]]
) -> dict[str, Any]:
    package = next(
        (
            j
            for j in jobs
            if j["name"] == profile.package_job
            and j["status"] == "success"
            and j["commit"]["id"] == sha
        ),
        None,
    )
    if not package or not profile.deployment_url:
        raise WorkflowError("deployment_evidence_not_configured")
    manifest = gl.get(f"/jobs/{package['id']}/artifacts/release/manifest.json")
    source = gl.snapshot(sha)
    files = {
        name: content
        for name, content in source.items()
        if name.startswith(tuple(profile.allowed_paths))
    }
    digest = source_digest(files)
    expected = {
        "project_id": profile.gitlab_project_id,
        "candidate_sha": sha,
        "pipeline_id": pipeline_id,
        "artifact_sha256": digest,
    }
    if not isinstance(manifest, dict) or any(manifest.get(k) != v for k, v in expected.items()):
        raise WorkflowError("release_artifact_mismatch")
    try:
        with httpx.Client(
            verify=ssl.create_default_context(cafile=get_settings().gitlab_ca_file),
            trust_env=False,
            timeout=8,
            follow_redirects=False,
        ) as client:
            response = client.get(profile.deployment_url)
            if response.status_code != 200 or len(response.content) > 16_000:
                raise WorkflowError("deployment_health_failed")
            health = response.json()
    except (httpx.HTTPError, ValueError):
        raise WorkflowError("deployment_health_failed") from None
    if (
        not isinstance(health, dict)
        or any(health.get(k) != v for k, v in expected.items())
        or health.get("status") != "ok"
    ):
        raise WorkflowError("deployment_health_mismatch")
    return {
        **expected,
        "package_job_id": package["id"],
        "health_url": profile.deployment_url,
        "health_verified": True,
    }
