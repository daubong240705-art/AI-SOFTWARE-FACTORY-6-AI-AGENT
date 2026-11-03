"""Run only against a disposable database with ASF_INTEGRATION_TEST=1."""

import os
import uuid

import pytest
from asf_api.db import SessionLocal, engine
from asf_api.main import app
from asf_api.models import Event, Project, Run, Task
from fastapi.testclient import TestClient
from sqlalchemy import delete, inspect
from sqlalchemy.exc import IntegrityError

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.getenv("ASF_INTEGRATION_TEST") != "1", reason="Disposable database required"
    ),
]


def test_project_api_and_persistence() -> None:
    slug = "test-" + uuid.uuid4().hex
    project_id = None
    try:
        with TestClient(app) as client:
            assert client.get("/readyz").status_code == 200
            response = client.post(
                "/api/projects", json={"name": "Dá»± Ã¡n kiá»ƒm chá»©ng", "slug": slug}
            )
            assert response.status_code == 201
            project_id = uuid.UUID(response.json()["id"])
            assert (
                client.post("/api/projects", json={"name": "Duplicate", "slug": slug}).status_code
                == 409
            )
            assert client.get(f"/api/projects/{project_id}").json()["slug"] == slug
            assert client.get("/api/projects?limit=1").json()["total"] >= 1
            assert client.get("/api/projects?limit=0").status_code == 422
            assert client.get(f"/api/projects/{uuid.uuid4()}").status_code == 404
        engine.dispose()
        # New client and new DB connections must retain the persisted record.
        with TestClient(app) as restarted:
            assert restarted.get(f"/api/projects/{project_id}").json()["slug"] == slug
    finally:
        if project_id:
            with SessionLocal.begin() as session:
                session.execute(delete(Project).where(Project.id == project_id))


def test_schema_foreign_keys_and_event_idempotency() -> None:
    assert {"projects", "runs", "tasks", "events"} <= set(inspect(engine).get_table_names())
    with SessionLocal() as session:
        project = Project(name="Transaction test", slug="tx-" + uuid.uuid4().hex)
        session.add(project)
        session.flush()
        run = Run(project_id=project.id, requirement="Phase 1 database check")
        session.add(run)
        session.flush()
        task = Task(run_id=run.id, title="Prepare", role="pm")
        key = "event-" + uuid.uuid4().hex
        event = Event(
            run_id=run.id, kind="created", payload={"source": "test"}, idempotency_key=key
        )
        session.add_all([task, event])
        session.flush()
        assert event.id > 0
        assert not task.simulated
        with pytest.raises(IntegrityError):
            with session.begin_nested():
                session.add(Event(run_id=run.id, kind="duplicate", idempotency_key=key))
                session.flush()
        session.rollback()
