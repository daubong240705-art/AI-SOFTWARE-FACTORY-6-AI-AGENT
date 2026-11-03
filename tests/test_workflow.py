import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from asf_api.db import SessionLocal, engine
from asf_api.main import app
from asf_api.models import Artifact, Dispatch, Project, Run
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError

from agents.contracts import mock_content
from orchestrator import graph as graph_module
from orchestrator.service import cancel_run
from orchestrator.state import WorkflowError, transition
from shared.config import get_settings
from workers.dispatcher import sweep
from workers.jobs import execute

integration = pytest.mark.skipif(
    os.getenv("ASF_INTEGRATION_TEST") != "1", reason="Disposable database required"
)


@pytest.mark.parametrize(
    "source,target",
    [
        ("created", "planning"),
        ("planning", "waiting_approval"),
        ("waiting_approval", "running"),
        ("running", "waiting_integration"),
        ("waiting_approval", "rejected"),
        ("failed", "created"),
    ],
)
def test_valid_transition(source: str, target: str) -> None:
    assert transition(source, target) == target


@pytest.mark.parametrize(
    "source,target",
    [
        ("created", "completed"),
        ("waiting_approval", "waiting_integration"),
        ("cancelled", "created"),
        ("waiting_integration", "running"),
    ],
)
def test_invalid_transition(source: str, target: str) -> None:
    with pytest.raises(WorkflowError, match="invalid_transition"):
        transition(source, target)


@pytest.fixture
def workspace(authenticated):
    client = authenticated
    project = client.post(
        "/api/projects", json={"name": "Workflow check", "slug": "wf-" + uuid.uuid4().hex}
    ).json()
    yield client, project["id"]
    with SessionLocal.begin() as session:
        ids = list(session.scalars(select(Run.id).where(Run.project_id == project["id"])))
        session.execute(delete(Project).where(Project.id == project["id"]))
    with engine.begin() as connection:
        for run_id in ids:
            for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
                connection.execute(
                    text(f"DELETE FROM asf_checkpoints.{table} WHERE thread_id LIKE :prefix"),
                    {"prefix": str(run_id) + ":v%"},
                )


def create(client, project_id, mode="mock") -> str:
    response = client.post(
        f"/api/projects/{project_id}/runs",
        json={"requirement": "Create an internal support portal", "mode": mode},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def drive(run_id: str) -> None:
    sweep()
    with SessionLocal() as session:
        dispatch = session.scalar(
            select(Dispatch)
            .where(Dispatch.run_id == run_id, Dispatch.state == "enqueued")
            .order_by(Dispatch.generation.desc())
        )
        assert dispatch
        dispatch_id, delivery = str(dispatch.id), dispatch.delivery
    execute(dispatch_id, delivery)


def review_payload(detail, decision="approve") -> dict[str, Any]:
    version = detail["run"]["spec_version"]
    spec = next(
        a for a in detail["artifacts"] if a["kind"] == "spec" and a["spec_version"] == version
    )
    return {
        "spec_version": version,
        "spec_hash": spec["content_hash"],
        "decision": decision,
        "comment": "Reviewed current spec",
        "idempotency_key": str(uuid.uuid4()),
    }


@pytest.mark.integration
@integration
def test_approval_checkpoint_idempotency_and_boundary(workspace):
    client, project_id = workspace
    run_id = create(client, project_id)
    assert (
        client.post(f"/api/projects/{project_id}/runs", json={"requirement": "Another"}).status_code
        == 409
    )
    with SessionLocal.begin() as session:
        with pytest.raises(IntegrityError), session.begin_nested():
            session.add(Run(project_id=uuid.UUID(project_id), requirement="Bypass API"))
            session.flush()
    drive(run_id)
    detail = client.get(f"/api/runs/{run_id}").json()
    assert detail["run"]["status"] == "waiting_approval"
    assert len(detail["artifacts"]) == 2
    assert all(a["simulated"] for a in detail["artifacts"])
    assert detail["usage"]["calls"] == 0
    assert all(
        t["status"] == "not_implemented"
        for t in detail["tasks"]
        if t["role"] in ("be", "fe", "test", "devops")
    )
    engine.dispose()  # Reconstruct graph/DB clients, preserving the approval interrupt.
    payload = review_payload(detail)
    assert (
        client.post(
            f"/api/runs/{run_id}/approval", json={**payload, "spec_hash": "0" * 64}
        ).status_code
        == 409
    )
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(lambda _: client.post(f"/api/runs/{run_id}/approval", json=payload), range(2))
        )
    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json()["id"] == responses[1].json()["id"]
    assert (
        client.post(
            f"/api/runs/{run_id}/approval", json={**payload, "comment": "Changed"}
        ).status_code
        == 409
    )
    drive(run_id)
    detail = client.get(f"/api/runs/{run_id}").json()
    assert detail["run"]["status"] == "waiting_integration"
    assert len(detail["approvals"]) == 1 and len(detail["artifacts"]) == 2
    assert (
        client.post(f"/api/runs/{run_id}/retry", json={"comment": "Wrong state"}).status_code == 409
    )
    events = client.get(f"/api/runs/{run_id}/events?limit=2").json()
    following = client.get(f"/api/runs/{run_id}/events?after={events['next_after']}").json()
    assert following["items"][0]["id"] > events["next_after"]
    assert following["items"][-1]["kind"] == "run.waiting_integration"


@pytest.mark.integration
@integration
def test_reject_new_version_stale_approval_and_cancel(workspace):
    client, project_id = workspace
    run_id = create(client, project_id)
    drive(run_id)
    old_review = review_payload(client.get(f"/api/runs/{run_id}").json(), "reject")
    assert client.post(f"/api/runs/{run_id}/approval", json=old_review).status_code == 200
    retry = client.post(f"/api/runs/{run_id}/retry", json={"comment": "Revise scope"})
    assert retry.status_code == 200 and retry.json()["spec_version"] == 2
    drive(run_id)
    detail = client.get(f"/api/runs/{run_id}").json()
    assert len(detail["artifacts"]) == 4
    assert (
        client.post(
            f"/api/runs/{run_id}/approval",
            json={**old_review, "decision": "approve", "idempotency_key": str(uuid.uuid4())},
        ).status_code
        == 409
    )
    assert (
        client.post(f"/api/runs/{run_id}/cancel", json={"comment": "Stop"}).json()["status"]
        == "cancelled"
    )
    assert client.post(f"/api/runs/{run_id}/cancel", json={"comment": "Again"}).status_code == 200
    assert client.post(f"/api/runs/{run_id}/retry", json={"comment": "No"}).status_code == 409


@pytest.mark.integration
@integration
def test_process_loss_redelivery_resumes_after_pm(workspace, monkeypatch):
    client, project_id = workspace
    run_id = create(client, project_id)
    calls = []

    def crash(role, requirement):
        calls.append(role)
        if role == "ba":
            raise SystemExit("Simulated process loss")
        return mock_content(role, requirement)

    monkeypatch.setattr(graph_module, "mock_content", crash)
    with pytest.raises(SystemExit):
        drive(run_id)
    with SessionLocal.begin() as session:
        dispatch = session.scalar(select(Dispatch).where(Dispatch.run_id == run_id))
        dispatch.lease_until = datetime.now(UTC) - timedelta(seconds=1)

    def recovered(role, requirement):
        calls.append(role)
        return mock_content(role, requirement)

    monkeypatch.setattr(graph_module, "mock_content", recovered)
    engine.dispose()
    drive(run_id)
    detail = client.get(f"/api/runs/{run_id}").json()
    assert detail["run"]["status"] == "waiting_approval"
    assert calls.count("pm") == 1
    assert len(detail["artifacts"]) == 2
    assert any(
        e["kind"] == "worker.redelivered"
        for e in client.get(f"/api/runs/{run_id}/events").json()["items"]
    )


@pytest.mark.integration
@integration
def test_cancel_fences_inflight_result(workspace, monkeypatch):
    client, project_id = workspace
    run_id = create(client, project_id)

    def cancel_during_call(role, requirement):
        if role == "ba":
            with SessionLocal.begin() as session:
                cancel_run(session, uuid.UUID(run_id), "Cancel during BA")
        return mock_content(role, requirement)

    monkeypatch.setattr(graph_module, "mock_content", cancel_during_call)
    drive(run_id)
    detail = client.get(f"/api/runs/{run_id}").json()
    assert detail["run"]["status"] == "cancelled"
    assert [a["kind"] for a in detail["artifacts"]] == ["plan"]


@pytest.mark.integration
@integration
def test_failed_retry_reuses_plan_and_has_limit(workspace, monkeypatch):
    client, project_id = workspace
    run_id = create(client, project_id)

    def fail(role, requirement):
        if role == "ba":
            raise WorkflowError("test_unavailable")
        return mock_content(role, requirement)

    monkeypatch.setattr(graph_module, "mock_content", fail)
    for attempt in range(3):
        drive(run_id)
        assert client.get(f"/api/runs/{run_id}").json()["run"]["status"] == "failed"
        result = client.post(f"/api/runs/{run_id}/retry", json={"comment": "Retry transient error"})
        assert result.status_code == (200 if attempt < 2 else 409)
    with SessionLocal() as session:
        assert len(list(session.scalars(select(Artifact).where(Artifact.run_id == run_id)))) == 1


@pytest.mark.integration
@integration
def test_model_attempts_usage_and_budget(workspace, monkeypatch):
    import integrations.router as router

    settings = get_settings()
    monkeypatch.setattr(settings, "live_mode_enabled", True)
    monkeypatch.setattr(settings, "router_api_key", __import__("pydantic").SecretStr("test-key"))
    real_client = httpx.Client
    attempts = []

    def respond(request):
        attempts.append(request)
        return httpx.Response(503, json={"error": "Do not echo provider body"})

    monkeypatch.setattr(
        router.httpx,
        "Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs),
    )
    client, project_id = workspace
    run_id = create(client, project_id, "live")
    drive(run_id)
    assert len(attempts) == 2
    detail = client.get(f"/api/runs/{run_id}").json()
    assert detail["run"]["error_code"] == "model_http_error"
    assert detail["usage"]["calls"] == 2 and detail["usage"]["charged_tokens"] > 0
    with SessionLocal.begin() as session:
        run = session.get(Run, uuid.UUID(run_id))
        run.call_limit = 2
    assert (
        client.post(f"/api/runs/{run_id}/retry", json={"comment": "Budget bounded"}).status_code
        == 200
    )
    drive(run_id)
    assert len(attempts) == 2
    assert client.get(f"/api/runs/{run_id}").json()["run"]["error_code"] == "model_budget_exceeded"


@pytest.mark.integration
@integration
def test_approval_between_db_commit_and_interrupt_checkpoint(workspace, monkeypatch):
    client, project_id = workspace
    run_id = create(client, project_id)
    original = graph_module.interrupt

    def crash_before_checkpoint(_):
        raise SystemExit("Process lost before approval interrupt persisted")

    monkeypatch.setattr(graph_module, "interrupt", crash_before_checkpoint)
    with pytest.raises(SystemExit):
        drive(run_id)
    detail = client.get(f"/api/runs/{run_id}").json()
    assert detail["run"]["status"] == "waiting_approval"
    assert (
        client.post(f"/api/runs/{run_id}/approval", json=review_payload(detail)).status_code == 200
    )
    monkeypatch.setattr(graph_module, "interrupt", original)
    drive(run_id)
    assert client.get(f"/api/runs/{run_id}").json()["run"]["status"] == "waiting_integration"


@pytest.mark.integration
@integration
def test_redis_loss_retains_outbox_and_recovery_is_bounded(workspace, monkeypatch):
    from workers import dispatcher

    client, project_id = workspace
    run_id = create(client, project_id)
    with monkeypatch.context() as patch:

        def unavailable(*args, **kwargs):
            raise ConnectionError("Redis unavailable")

        patch.setattr(dispatcher.Queue, "enqueue", unavailable)
        with pytest.raises(ConnectionError):
            sweep()
    with SessionLocal() as session:
        row = session.scalar(select(Dispatch).where(Dispatch.run_id == run_id))
        assert row.state == "pending" and row.delivery == 0
    for _ in range(3):
        sweep()  # Intentionally do not execute the lost job.
        with SessionLocal.begin() as session:
            row = session.scalar(select(Dispatch).where(Dispatch.run_id == run_id))
            row.lease_until = datetime.now(UTC) - timedelta(seconds=1)
    sweep()
    assert client.get(f"/api/runs/{run_id}").json()["run"]["error_code"] == "worker_recovery_limit"


@pytest.mark.integration
@integration
def test_structured_model_usage_and_invalid_output(workspace, monkeypatch):
    from pydantic import SecretStr

    import integrations.router as router

    settings = get_settings()
    monkeypatch.setattr(settings, "live_mode_enabled", True)
    monkeypatch.setattr(settings, "router_api_key", SecretStr("test-key"))
    real_client = httpx.Client
    count = 0

    def respond(request):
        import json

        nonlocal count
        count += 1
        content = (
            json.dumps(mock_content("pm", "Reviewed requirement")) if count == 1 else '{"bad":true}'
        )
        return httpx.Response(
            200,
            json={
                "model": "resolved-test-model",
                "status": "completed",
                "usage": {"input_tokens": 20, "output_tokens": 10},
                "output": [{"content": [{"type": "output_text", "text": content}]}],
            },
        )

    monkeypatch.setattr(
        router.httpx,
        "Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs),
    )
    client, project_id = workspace
    run_id = create(client, project_id, "live")
    drive(run_id)
    detail = client.get(f"/api/runs/{run_id}").json()
    assert detail["run"]["error_code"] == "model_invalid_output"
    assert detail["usage"] == {
        "calls": 2,
        "charged_tokens": 60,
        "input_tokens": 40,
        "output_tokens": 20,
        "cost": None,
    }
    assert len(detail["artifacts"]) == 1 and not detail["artifacts"][0]["simulated"]


def test_workflow_mutations_require_authentication(monkeypatch):
    monkeypatch.setattr(get_settings(), "environment", "staging")
    with TestClient(app) as client:
        assert (
            client.post(
                f"/api/projects/{uuid.uuid4()}/runs", json={"requirement": "Denied"}
            ).status_code
            == 401
        )


@pytest.mark.integration
@integration
def test_retry_after_approval_reuses_decision(workspace, monkeypatch):
    client, project_id = workspace
    run_id = create(client, project_id)
    drive(run_id)
    detail = client.get(f"/api/runs/{run_id}").json()
    assert (
        client.post(f"/api/runs/{run_id}/approval", json=review_payload(detail)).status_code == 200
    )
    original = graph_module.transition

    def fail_boundary(current, target):
        if target == "waiting_integration":
            raise WorkflowError("temporary_boundary_error")
        return original(current, target)

    with monkeypatch.context() as patch:
        patch.setattr(graph_module, "transition", fail_boundary)
        drive(run_id)
    assert client.get(f"/api/runs/{run_id}").json()["run"]["status"] == "failed"
    assert (
        client.post(
            f"/api/runs/{run_id}/retry", json={"comment": "Resume approved spec"}
        ).status_code
        == 200
    )
    drive(run_id)
    detail = client.get(f"/api/runs/{run_id}").json()
    assert detail["run"]["status"] == "waiting_integration"
    assert len(detail["approvals"]) == 1 and len(detail["artifacts"]) == 2
