"""Phase 5 trust boundaries, idempotency and persisted fencing against a real DB."""

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from asf_api.auth import token_hash
from asf_api.db import SessionLocal
from asf_api.main import app
from asf_api.models import Artifact, CodingWorker, Execution, ModelCall, Project, Run, User
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import delete, select

from orchestrator import executions
from orchestrator.service import cancel_run
from orchestrator.state import WorkflowError
from shared.config import get_settings
from shared.profiles import IntegrationProfile, allowed_file, model_selection
from workers.coding import safe_path, write_files

integration = pytest.mark.skipif(
    os.getenv("ASF_INTEGRATION_TEST") != "1", reason="Disposable database required"
)
PROFILE = {
    "name": "Validation",
    "gitlab_project_id": 10,
    "repository_url": "https://gitlab.lazy.local/ai-factory/asf-agent-validation.git",
    "openproject_project_id": 7,
}


def test_trusted_target_and_path_validation():
    profile = IntegrationProfile.model_validate(PROFILE)
    for path in ["../x", "src/../x", "/src/x", "src//x", "src/.git/config", ".gitlab-ci.yml"]:
        assert not allowed_file(path, profile)
    assert allowed_file("src/backend/app.py", profile)
    for url in [
        "http://gitlab.lazy.local/a.git",
        "https://evil.local/a.git",
        "https://token@gitlab.lazy.local/a.git",
        "https://gitlab.lazy.local/a.git?x=1",
    ]:
        with pytest.raises(ValidationError):
            IntegrationProfile.model_validate({**PROFILE, "repository_url": url})
    for path in [
        "../secret",
        "/etc/passwd",
        "C:/secret",
        "src/../../secret",
        "a\\b",
        ".git/config",
    ]:
        assert not safe_path(path)


def test_trusted_test_files_readable_with_restrictive_service_umask(tmp_path):
    write_files(tmp_path, {"nested/test_app.py": "# immutable trusted test\n"}, False)
    file = tmp_path / "nested/test_app.py"
    assert file.read_text() == "# immutable trusted test\n"
    assert file.stat().st_mode & 0o444 == 0o444
    assert file.stat().st_mode & 0o222 == 0
    assert (tmp_path / "nested").stat().st_mode & 0o444 == 0o444


def test_models_require_allowed_roles_and_catalog(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "model_catalog", ["coding-main", "review"])
    assert model_selection({"ba": "review"})["be"] == "coding-main"
    assert model_selection({"ba": "review"})["ba"] == "review"
    for overrides in [{"root": "coding-main"}, {"be": "arbitrary"}]:
        with pytest.raises(ValueError):
            model_selection(overrides)


@pytest.fixture
def execution_workspace(monkeypatch):
    class FakeGitLab:
        def __init__(self, project):
            assert project == 10

        def snapshot(self, sha):
            return {
                "src/app.py": "def add(a,b): return a-b\n",
                "tests/test_app.py": "# trusted baseline\n",
            }

        def get(self, path, **params):
            if path.startswith("/repository/branches/"):
                return {"commit": {"id": "a" * 40}}
            raise AssertionError(path)

    monkeypatch.setattr(executions, "GitLab", FakeGitLab)
    with SessionLocal.begin() as session:
        project = Project(name="Lease validation", slug="p5-" + uuid.uuid4().hex)
        session.add(project)
        session.flush()
        run = Run(
            project_id=project.id,
            requirement="Lease validation",
            mode="live",
            status="running",
            config_snapshot={"models": model_selection(), "integration": PROFILE},
        )
        session.add(run)
        session.flush()
        session.add(
            Artifact(
                run_id=run.id,
                kind="spec",
                spec_version=1,
                content={"summary": "add"},
                content_hash="b" * 64,
                simulated=False,
            )
        )
        token = uuid.uuid4().hex
        worker = CodingWorker(
            name="test-" + uuid.uuid4().hex,
            token_hash=token_hash(token),
            capabilities=["be", "fe", "test", "devops"],
        )
        session.add(worker)
        session.flush()
        run_id, project_id, worker_id = run.id, project.id, worker.id
        executions.start(session, run)
    yield run_id, worker_id, token
    with SessionLocal.begin() as session:
        session.execute(delete(Project).where(Project.id == project_id))
        session.execute(delete(CodingWorker).where(CodingWorker.id == worker_id))


@integration
def test_remote_worker_auth_lease_recovery_and_cancel(execution_workspace):
    run_id, worker_id, token = execution_workspace
    with TestClient(app) as client:
        assert client.post("/api/worker/claim").status_code == 401
        client.headers["Authorization"] = "Bearer " + token
        first = client.post("/api/worker/claim").json()["execution"]
        assert first["role"] == "be"
        assert client.post("/api/worker/claim").json()["execution"] is None
        with SessionLocal.begin() as session:
            item = session.get(Execution, uuid.UUID(first["id"]))
            item.lease_until = datetime.now(UTC) - timedelta(seconds=1)
        second = client.post("/api/worker/claim").json()["execution"]
        assert second["id"] == first["id"]
        assert second["lease_token"] != first["lease_token"]
        # The previous uncertain charge survives; recovery grants only the remainder.
        with SessionLocal() as session:
            calls = list(session.scalars(select(ModelCall).where(ModelCall.run_id == run_id)))
            assert len(calls) == 2
            assert sum(c.charged_tokens for c in calls) <= session.get(Run, run_id).token_budget
            assert (
                second["input"]["model_limits"]["tokens"]
                <= first["input"]["model_limits"]["tokens"]
            )
        path = f"/api/worker/executions/{first['id']}"
        assert (
            client.post(path + "/heartbeat", json={"lease_token": first["lease_token"]}).status_code
            == 409
        )
        assert (
            client.post(
                path + "/complete", json={"lease_token": first["lease_token"], "succeeded": True}
            ).status_code
            == 409
        )
        with SessionLocal.begin() as session:
            cancel_run(session, run_id, "cancel during coding")
        result = client.post(
            path + "/complete", json={"lease_token": second["lease_token"], "succeeded": True}
        )
        assert result.status_code == 409
        with SessionLocal() as session:
            assert session.get(Run, run_id).status == "cancelled"
            assert session.get(Execution, uuid.UUID(first["id"])).state == "cancelled"


@integration
def test_execution_completion_is_idempotent_and_paths_restricted(execution_workspace, monkeypatch):
    run_id, worker_id, token = execution_workspace
    writes = []
    original_commit = executions.commit_changes

    def commit(item, changes):
        writes.append(changes)
        return "c" * 40

    monkeypatch.setattr(executions, "commit_changes", commit)
    with TestClient(app) as client:
        client.headers["Authorization"] = "Bearer " + token
        item = client.post("/api/worker/claim").json()["execution"]
        path = f"/api/worker/executions/{item['id']}/complete"
        body = {
            "lease_token": item["lease_token"],
            "succeeded": True,
            "changes": {"src/app.py": "def add(a,b): return a+b\n"},
        }
        assert client.post(path, json=body).status_code == 200
        assert client.post(path, json=body).status_code == 200
        assert len(writes) == 1
        assert client.post(path, json={**body, "changes": {}}).status_code == 409
        fe = client.post("/api/worker/claim").json()["execution"]
        assert fe["role"] == "fe"
        assert fe["input"]["candidate_sha"] == "c" * 40
    # Path policy is enforced by the parent before its first GitLab API mutation.
    with SessionLocal() as session:
        row = session.get(Execution, uuid.UUID(item["id"]))
        # The monkeypatched fake is restored for the actual validation function.
        with pytest.raises(WorkflowError, match="change_path_not_allowed"):
            original_commit(row, {".gitlab-ci.yml": "untrusted"})


@integration
def test_project_model_snapshot_survives_project_edits(authenticated, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "model_catalog", ["coding-main", "review"])
    p = authenticated.post(
        "/api/projects",
        json={
            "name": "Models",
            "slug": "models-" + uuid.uuid4().hex,
            "agent_models": {"ba": "review"},
        },
    ).json()
    try:
        run = authenticated.post(
            f"/api/projects/{p['id']}/runs", json={"requirement": "snapshot"}
        ).json()
        updated = authenticated.patch(
            f"/api/projects/{p['id']}",
            json={"name": p["name"], "slug": p["slug"], "agent_models": {"ba": "coding-main"}},
        )
        assert updated.status_code == 200
        detail = authenticated.get(f"/api/runs/{run['id']}").json()
        assert detail["run"]["config_snapshot"]["models"]["ba"] == "review"
        snapshot = detail["run"]["config_snapshot"]
        assert snapshot["agent_skills"]["be"]["version"] == 1
        assert snapshot["agent_skills"]["be"]["tools"] == ["read", "edit", "glob", "grep"]
        assert snapshot["coding_limits"]["requests"] == settings.coding_model_requests
    finally:
        with SessionLocal.begin() as session:
            session.execute(delete(Project).where(Project.id == p["id"]))


@integration
def test_worker_admin_listing_rotation_revocation_and_role_boundary(authenticated, account):
    name = "test-admin-" + uuid.uuid4().hex
    created = authenticated.post("/api/coding-workers", json={"name": name, "capabilities": ["be"]})
    assert created.status_code == 201
    worker_id, old_token = created.json()["id"], created.json()["token"]
    try:
        assert (
            authenticated.post(
                "/api/coding-workers", json={"name": name, "capabilities": ["root"]}
            ).status_code
            == 422
        )
        catalog = authenticated.get("/api/agent-capabilities").json()
        assert catalog["model_key_in_sandbox"] is False
        assert len(catalog["roles"]) == 6
        with TestClient(app) as machine:
            # Registering does not mark a device online.
            listed = authenticated.get("/api/coding-workers?limit=200").json()
            row = next(w for w in listed["items"] if w["id"] == worker_id)
            assert row["status"] == "never_connected"
            assert "token_hash" not in row and "token" not in row
            # Workspaces in this test DB are empty. No candidate is executed here.
            machine.headers["Authorization"] = "Bearer " + old_token
            assert machine.post("/api/worker/claim").status_code == 200
            listed = authenticated.get("/api/coding-workers?limit=200").json()
            assert next(w for w in listed["items"] if w["id"] == worker_id)["status"] == "online"
            rotated = authenticated.post(f"/api/coding-workers/{worker_id}/rotate", json={})
            assert rotated.status_code == 200 and rotated.json()["token"] != old_token
            assert machine.post("/api/worker/claim").status_code == 401
            machine.headers["Authorization"] = "Bearer " + rotated.json()["token"]
            assert machine.post("/api/worker/claim").status_code == 200
            assert authenticated.delete(f"/api/coding-workers/{worker_id}").status_code == 200
            assert machine.post("/api/worker/claim").status_code == 401
            assert (
                authenticated.post(f"/api/coding-workers/{worker_id}/rotate", json={}).status_code
                == 404
            )
        # Downgrade in DB to exercise the real authorization dependency.
        with SessionLocal.begin() as session:
            session.get(User, account[0]).role = "viewer"
        assert authenticated.get("/api/coding-workers").status_code == 403
        assert authenticated.get("/api/agent-capabilities").status_code == 403
        assert (
            authenticated.post(f"/api/coding-workers/{worker_id}/rotate", json={}).status_code
            == 403
        )
    finally:
        with SessionLocal.begin() as session:
            session.execute(delete(CodingWorker).where(CodingWorker.id == uuid.UUID(worker_id)))


@integration
def test_proxy_quota_failure_accounts_usage_and_stops_run(execution_workspace):
    run_id, _, token = execution_workspace
    with TestClient(app) as client:
        client.headers["Authorization"] = "Bearer " + token
        task = client.post("/api/worker/claim").json()["execution"]
        for invalid in [None, "invalid", {"charged_tokens": -1}, {"input_tokens": True}]:
            assert (
                client.post(
                    f"/api/worker/executions/{task['id']}/complete",
                    json={
                        "lease_token": task["lease_token"],
                        "succeeded": False,
                        "report": {"model_usage": invalid},
                    },
                ).status_code
                == 422
            )
        report = {
            "model_usage": {
                "physical_requests": 2,
                "charged_tokens": 3456,
                "input_tokens": None,
                "output_tokens": None,
                "error_code": "execution_model_quota_exceeded",
            }
        }
        result = client.post(
            f"/api/worker/executions/{task['id']}/complete",
            json={
                "lease_token": task["lease_token"],
                "succeeded": False,
                "report": report,
            },
        )
        assert result.status_code == 200
    with SessionLocal() as session:
        run = session.get(Run, run_id)
        assert run.status == "failed" and run.error_code == "execution_model_quota_exceeded"
        call = session.get(ModelCall, uuid.UUID(task["input"]["model_call_id"]))
        assert call.charged_tokens == 3456 and call.input_tokens is None
        assert session.get(Execution, uuid.UUID(task["id"])).result["report"] == report


@integration
def test_authenticated_webhook_replay_and_sha_match(execution_workspace, monkeypatch):
    run_id, _, _ = execution_workspace
    settings = get_settings()
    from pydantic import SecretStr

    monkeypatch.setattr(settings, "gitlab_webhook_secret", SecretStr("test-webhook-secret"))
    with SessionLocal.begin() as session:
        item = session.scalar(select(Execution).where(Execution.run_id == run_id))
        item.role = "devops"
    from asf_api import execution_routes

    class FakeGitLab:
        def __init__(self, project):
            pass

        def get(self, path):
            return {"sha": "a" * 40, "status": "running"}

    monkeypatch.setattr(execution_routes, "GitLab", FakeGitLab)
    payload = {"project": {"id": 10}, "object_attributes": {"id": 1, "sha": "a" * 40}}
    with TestClient(app) as client:
        path = "/api/webhooks/gitlab"
        assert client.post(path, json=payload).status_code == 401
        client.headers.update(
            {
                "x-gitlab-token": "test-webhook-secret",
                "x-gitlab-event": "Pipeline Hook",
                "x-gitlab-event-uuid": str(uuid.uuid4()),
            }
        )
        assert client.post(path, json=payload).status_code == 200
        assert client.post(path, json=payload).status_code == 200
        payload["object_attributes"]["sha"] = "b" * 40
        assert client.post(path, json=payload).status_code == 409


@integration
def test_deadline_enforced_without_remote_worker(execution_workspace):
    run_id, _, _ = execution_workspace
    with SessionLocal.begin() as session:
        item = session.scalar(select(Execution).where(Execution.run_id == run_id))
        item.deadline = datetime.now(UTC) - timedelta(seconds=1)
    from workers.execution_recovery import sweep

    sweep()
    with SessionLocal() as session:
        run = session.get(Run, run_id)
        assert run.status == "failed"
        assert run.error_code == "execution_timeout"


@integration
def test_release_requires_session_exact_candidate_and_current_checks(
    execution_workspace, authenticated, monkeypatch
):
    from asf_api import execution_routes
    from asf_api.models import ReleaseApproval

    run_id, worker_id, token = execution_workspace
    with SessionLocal.begin() as session:
        item = session.scalar(select(Execution).where(Execution.run_id == run_id))
        item.role, item.state = "devops", "waiting_release"
        item.result = {"candidate_sha": "a" * 40, "pipeline_id": 1, "job_id": 2}
        item_id = item.id
    plays = []
    job_status = "manual"

    class FakeGitLab:
        def __init__(self, project):
            assert project == 10

        def get(self, path, **params):
            if path == "/pipelines/1":
                return {"sha": "a" * 40, "ref": f"asf/{run_id}/{uuid.uuid4()}"}
            if path == "/jobs/2":
                return {
                    "name": "deploy_staging",
                    "commit": {"id": "a" * 40},
                    "pipeline": {"id": 1},
                    "status": job_status,
                }
            if path == "/pipelines/1/jobs":
                return [{"name": "test", "status": "success"}]
            raise AssertionError(path)

        def post(self, path, payload):
            nonlocal job_status
            with SessionLocal() as session:
                approval = session.scalar(
                    select(ReleaseApproval).where(ReleaseApproval.execution_id == item_id)
                )
                assert approval is not None  # Visible before CI starts the deploy job.
            plays.append(path)
            job_status = "pending"
            return {}

    monkeypatch.setattr(execution_routes, "GitLab", FakeGitLab)
    payload = {
        "candidate_sha": "a" * 40,
        "pipeline_id": 1,
        "job_id": 2,
        "comment": "Reviewed candidate",
    }
    path = f"/api/executions/{item_id}/release"
    try:
        with TestClient(app) as machine:
            machine.headers["Authorization"] = "Bearer " + token
            assert machine.post(path, json=payload).status_code == 401
        assert (
            authenticated.post(path, json={**payload, "candidate_sha": "b" * 40}).status_code == 409
        )
        assert plays == []
        assert authenticated.post(path, json=payload).status_code == 200
        assert authenticated.post(path, json=payload).status_code == 200
        assert plays == ["/jobs/2/play"]
        with SessionLocal() as session:
            item = session.get(Execution, item_id)
            assert item.input["release_job_id"] == 2
            assert item.state == "pending"
        with SessionLocal.begin() as session:
            item = session.get(Execution, item_id)
            item.state, item.generation = "leased", 4
            item.deadline = datetime.now(UTC) + timedelta(minutes=5)
            deadline = item.deadline
        assert authenticated.post(path, json=payload).status_code == 200
        with SessionLocal() as session:
            item = session.get(Execution, item_id)
            assert (item.state, item.generation, item.deadline) == ("leased", 4, deadline)
        from pydantic import SecretStr

        monkeypatch.setattr(get_settings(), "staging_verifier_key", SecretStr("stage-test-key"))
        stage_payload = {k: v for k, v in payload.items() if k != "comment"}
        stage_payload["project_id"] = 10
        with TestClient(app) as verifier:
            assert verifier.post("/api/staging/authorize", json=stage_payload).status_code == 401
            verifier.headers["Authorization"] = "Bearer stage-test-key"
            assert verifier.post("/api/staging/authorize", json=stage_payload).status_code == 200
            assert (
                verifier.post(
                    "/api/staging/authorize", json={**stage_payload, "project_id": 9}
                ).status_code
                == 409
            )
            with SessionLocal.begin() as session:
                cancel_run(session, run_id, "Invalidate approved staging candidate")
            assert verifier.post("/api/staging/authorize", json=stage_payload).status_code == 409
    finally:
        with SessionLocal.begin() as session:
            session.execute(delete(ReleaseApproval).where(ReleaseApproval.execution_id == item_id))


@integration
def test_deploy_retry_preserves_tested_candidate_and_requires_new_release(execution_workspace):
    from orchestrator.service import retry_run

    run_id, _, _ = execution_workspace
    with SessionLocal.begin() as session:
        run = session.get(Run, run_id)
        previous = session.scalar(select(Execution).where(Execution.run_id == run_id))
        previous.role, previous.state = "devops", "failed"
        candidate = previous.input["candidate_sha"]
        tested = Execution(
            run_id=run_id,
            role="test",
            state="succeeded",
            attempt=1,
            input=dict(previous.input),
            result={"report": {"exit_code": 0}},
        )
        session.add(tested)
        run.status, run.error_code = "failed", "candidate_pipeline_failed"
        retry_run(session, run_id, "Host fixed; fresh pipeline and approval required")
        run.status = "running"  # Dispatcher resumes the previously approved graph.
        assert executions.start(session, run)
        assert executions.start(session, run)  # Dispatcher redelivery is idempotent.
    with SessionLocal() as session:
        items = list(session.scalars(select(Execution).where(Execution.run_id == run_id)))
        fresh = [e for e in items if e.input["run_generation"] == 2]
        assert len(fresh) == 1
        assert fresh[0].role == "devops" and fresh[0].state == "pending"
        assert fresh[0].input["candidate_sha"] == candidate
        assert "release_job_id" not in fresh[0].input
        assert "release_pipeline_id" not in fresh[0].input


@integration
@pytest.mark.parametrize("role", ["be", "fe", "test"])
@pytest.mark.parametrize("same_spec", [True, False])
def test_stage_retry_preserves_candidate_and_requires_same_spec(
    execution_workspace, role, same_spec
):
    from orchestrator.service import retry_run

    run_id, _, _ = execution_workspace
    candidate = "c" * 40
    with SessionLocal.begin() as session:
        run = session.get(Run, run_id)
        previous = session.scalar(select(Execution).where(Execution.run_id == run_id))
        previous.role, previous.state = role, "failed"
        previous.input = {
            **previous.input,
            "candidate_sha": candidate,
            "test_feedback": {"exit_code": 1, "output": "preserve prior feedback"},
        }
        predecessor = {"fe": "be", "test": "fe"}.get(role)
        if predecessor:
            session.add(
                Execution(
                    run_id=run_id,
                    role=predecessor,
                    state="succeeded",
                    attempt=1,
                    input=dict(previous.input),
                    result={"candidate_sha": candidate},
                )
            )
        if not same_spec:
            spec = session.scalar(select(Artifact).where(Artifact.run_id == run_id))
            spec.content_hash = "d" * 64
        run.status, run.error_code = "failed", "worker_execution_failed"
        retry_run(session, run_id, "Retry failed stage without repeating completed coding")
        run.status = "running"
        assert executions.start(session, run)
        assert executions.start(session, run)
    with SessionLocal() as session:
        fresh = list(
            session.scalars(
                select(Execution).where(
                    Execution.run_id == run_id,
                    Execution.input["run_generation"].as_integer() == 2,
                )
            )
        )
        assert len(fresh) == 1
        assert fresh[0].state == "pending"
        assert fresh[0].role == (role if same_spec else "be")
        assert fresh[0].input["candidate_sha"] == (candidate if same_spec else "a" * 40)
        assert fresh[0].input["baseline_sha"] == "a" * 40
        if same_spec:
            assert fresh[0].input["test_feedback"]["output"] == "preserve prior feedback"
