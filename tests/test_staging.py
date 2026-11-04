import importlib.util

import pytest

from integrations.releases import candidate_ref, source_digest, verify_pipeline
from orchestrator.state import WorkflowError


def test_candidate_pipeline_requires_owned_ref():
    run = "11111111-1111-1111-1111-111111111111"
    ref = f"asf/{run}/22222222-2222-2222-2222-222222222222"
    assert candidate_ref(ref, run)
    verify_pipeline({"sha": "a" * 40, "ref": ref}, "a" * 40, run)
    for invalid in [{"sha": "b" * 40, "ref": ref}, {"sha": "a" * 40, "ref": "main"}]:
        with pytest.raises(WorkflowError, match="pipeline_candidate_mismatch"):
            verify_pipeline(invalid, "a" * 40, run)


def test_canonical_artifact_digest_ignores_mapping_order():
    assert source_digest({"src/a.py": "a", "src/b.py": "b"}) == source_digest(
        {"src/b.py": "b", "src/a.py": "a"}
    )
    assert source_digest({"src/a.py": "a"}) != source_digest({"src/a.py": "b"})


def test_host_boundary_rejects_wrong_sha_job_and_missing_package():
    spec = importlib.util.spec_from_file_location("stage", "infrastructure/deploy/asf-stage.py")
    stage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(stage)
    sha = "a" * 40
    pipeline = {"id": 1, "sha": sha, "ref": "asf/" + "1" * 36 + "/" + "2" * 36}
    jobs = [
        {"id": i, "name": name, "status": state, "commit": {"id": sha}, "pipeline": {"id": 1}}
        for i, name, state in [
            (1, "test", "success"),
            (2, "package_candidate", "success"),
            (3, "deploy_staging", "running"),
        ]
    ]
    assert stage.validate_pipeline(pipeline, jobs, sha, 3) == 2
    with pytest.raises(ValueError):
        stage.validate_pipeline(pipeline, jobs, "b" * 40, 3)
    with pytest.raises(ValueError):
        stage.validate_pipeline(pipeline, jobs[:1] + jobs[2:], sha, 3)
    with pytest.raises(ValueError):
        stage.validate_pipeline(pipeline, jobs, sha, 1)


def test_deployment_requires_matching_artifact_and_live_health(monkeypatch):
    from integrations import releases
    from shared.profiles import IntegrationProfile

    sha = "a" * 40
    files = {"src/app.py": "def add(a, b): return a+b\n"}
    expected = {
        "project_id": 10,
        "candidate_sha": sha,
        "pipeline_id": 7,
        "artifact_sha256": source_digest(files),
    }
    manifest = dict(expected)
    health = {**expected, "status": "ok"}

    class GitLab:
        def get(self, path):
            assert path == "/jobs/8/artifacts/release/manifest.json"
            return manifest

        def snapshot(self, ref):
            assert ref == sha
            return {**files, "tests/test_app.py": "# frozen tests"}

    class Response:
        status_code = 200
        content = b"{}"

        def json(self):
            return health

    class Client:
        def __init__(self, **kwargs):
            assert kwargs["follow_redirects"] is False

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def get(self, url):
            assert url == "https://asf.lazy.local/validation/healthz"
            return Response()

    monkeypatch.setattr(releases.httpx, "Client", Client)
    profile = IntegrationProfile(
        name="stage",
        gitlab_project_id=10,
        repository_url="https://gitlab.lazy.local/x/y.git",
        openproject_project_id=7,
        allowed_paths=["src/"],
        deployment_url="https://asf.lazy.local/validation/healthz",
    )
    jobs = [{"id": 8, "name": "package_candidate", "status": "success", "commit": {"id": sha}}]
    assert releases.deployment_evidence(profile, GitLab(), sha, 7, jobs)["health_verified"]
    manifest["artifact_sha256"] = "b" * 64
    with pytest.raises(WorkflowError, match="release_artifact_mismatch"):
        releases.deployment_evidence(profile, GitLab(), sha, 7, jobs)
    manifest.update(expected)
    health["pipeline_id"] = 9
    with pytest.raises(WorkflowError, match="deployment_health_mismatch"):
        releases.deployment_evidence(profile, GitLab(), sha, 7, jobs)
    health = []
    with pytest.raises(WorkflowError, match="deployment_health_mismatch"):
        releases.deployment_evidence(profile, GitLab(), sha, 7, jobs)


def test_approved_pipeline_stays_frozen_when_newer_pipeline_exists(monkeypatch):
    from types import SimpleNamespace

    from orchestrator import executions

    run_id = "11111111-1111-1111-1111-111111111111"
    sha = "a" * 40
    requested = []

    class GitLab:
        def __init__(self, project):
            assert project == 10

        def get(self, path, **params):
            requested.append(path)
            if path == "/pipelines":
                return [{"id": 99}]
            if path == "/pipelines/7":
                return {"id": 7, "sha": sha, "ref": f"asf/{run_id}/" + "2" * 36}
            if path == "/pipelines/7/jobs":
                return [{"id": 8, "commit": {"id": sha}, "status": "running"}]
            raise AssertionError(path)

    monkeypatch.setattr(executions, "GitLab", GitLab)
    profile = {
        "name": "stage",
        "gitlab_project_id": 10,
        "repository_url": "https://gitlab.lazy.local/x/y.git",
        "openproject_project_id": 7,
    }
    item = SimpleNamespace(
        input={
            "profile": profile,
            "candidate_sha": sha,
            "release_job_id": 8,
            "release_pipeline_id": 7,
        }
    )
    assert executions.pipeline_check(None, SimpleNamespace(id=run_id), item) is False
    assert "/pipelines/99" not in requested
