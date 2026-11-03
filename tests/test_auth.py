"""Authentication, role boundaries, CSRF and revocation against disposable services."""

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from asf_api.auth import COOKIE, hash_password, token_hash, verify_password
from asf_api.db import SessionLocal
from asf_api.main import app
from asf_api.models import Approval, AuditLog, LoginSession, Project, User
from asf_api.stream import cursor, read_events
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from tests.test_workflow import drive, review_payload


def test_password_hash_and_cursor():
    hashed = hash_password("long-example-password")
    assert verify_password("long-example-password", hashed)
    assert not verify_password("wrong", hashed)
    assert not verify_password("wrong", "malformed")
    assert cursor(12, "20") == 20
    assert cursor(20, "12") == 20
    with pytest.raises(HTTPException):
        cursor(0, "-1")


integration = pytest.mark.skipif(
    os.getenv("ASF_INTEGRATION_TEST") != "1", reason="Disposable database required"
)


@pytest.mark.integration
@integration
def test_csrf_origin_expiry_and_logout(account):
    with TestClient(app) as client:
        assert client.get("/api/projects").status_code == 401
        assert client.get("/api/auth/me").status_code == 401
        payload = {"username": account[1], "password": account[2]}
        assert (
            client.post(
                "/api/auth/login", json=payload, headers={"Origin": "https://attacker.example"}
            ).status_code
            == 403
        )
        assert (
            client.post("/api/auth/login", json={**payload, "password": "wrong"}).status_code == 401
        )
        login = client.post("/api/auth/login", json=payload)
        assert login.status_code == 200
        assert "HttpOnly" in login.headers["set-cookie"]
        assert "SameSite=lax" in login.headers["set-cookie"]
        token = client.cookies[COOKIE]
        csrf = login.json()["csrf_token"]
        assert client.get("/api/auth/me").json()["user"]["id"] == str(account[0])
        assert (
            client.post("/api/projects", json={"name": "Denied", "slug": "denied"}).status_code
            == 403
        )
        client.headers["X-CSRF-Token"] = csrf
        assert (
            client.post(
                "/api/auth/logout", json={}, headers={"Origin": "https://attacker.example"}
            ).status_code
            == 403
        )
        with SessionLocal() as session:
            assert session.get(LoginSession, token_hash(token)) is not None
            assert session.get(LoginSession, token) is None
        assert client.post("/api/auth/logout", json={}).status_code == 200
        client.cookies.set(COOKIE, token)
        assert client.get("/api/auth/me").status_code == 401
        client.cookies.clear()
        login = client.post("/api/auth/login", json=payload)
        with SessionLocal.begin() as session:
            row = session.get(LoginSession, token_hash(client.cookies[COOKIE]))
            row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        assert client.get("/api/auth/me").status_code == 401


@pytest.mark.integration
@integration
def test_roles_approval_identity_and_session_revocation(authenticated, account):
    admin = authenticated
    viewer_id = None
    project_id = None
    try:
        username = "viewer-" + uuid.uuid4().hex[:16]
        response = admin.post(
            "/api/users",
            json={"username": username, "password": "test-only-password-1234", "role": "viewer"},
        )
        assert response.status_code == 201
        viewer_id = response.json()["id"]
        assert "password" not in response.text
        assert (
            admin.patch(
                f"/api/users/{account[0]}", json={"role": "viewer", "active": False}
            ).status_code
            == 409
        )
        p = admin.post(
            "/api/projects", json={"name": "Auth test", "slug": "auth-" + uuid.uuid4().hex}
        ).json()
        project_id = p["id"]
        run = admin.post(
            f"/api/projects/{project_id}/runs", json={"requirement": "Role boundaries"}
        ).json()
        run_id = run["id"]
        drive(run_id)
        detail = admin.get(f"/api/runs/{run_id}").json()
        review = review_payload(detail)
        with TestClient(app) as viewer:
            login = viewer.post(
                "/api/auth/login",
                json={"username": username, "password": "test-only-password-1234"},
            )
            viewer.headers["X-CSRF-Token"] = login.json()["csrf_token"]
            assert viewer.get(f"/api/runs/{run_id}").status_code == 200
            assert viewer.get("/api/users").status_code == 403
            assert (
                viewer.post("/api/projects", json={"name": "No", "slug": "no"}).status_code == 403
            )
            assert (
                viewer.post(
                    f"/api/projects/{project_id}/runs", json={"requirement": "No"}
                ).status_code
                == 403
            )
            for action, body in [
                ("approval", review),
                ("cancel", {"comment": "No"}),
                ("retry", {"comment": "No"}),
            ]:
                assert viewer.post(f"/api/runs/{run_id}/{action}", json=body).status_code == 403
            assert (
                admin.patch(
                    f"/api/users/{viewer_id}", json={"role": "approver", "active": True}
                ).status_code
                == 200
            )
            assert viewer.get("/api/auth/me").status_code == 401
            login = viewer.post(
                "/api/auth/login",
                json={"username": username, "password": "test-only-password-1234"},
            )
            viewer.headers["X-CSRF-Token"] = login.json()["csrf_token"]
            assert (
                viewer.post(
                    f"/api/runs/{run_id}/approval", json={**review, "actor": "spoofed"}
                ).status_code
                == 422
            )
            assert viewer.post(f"/api/runs/{run_id}/approval", json=review).status_code == 200
            result = viewer.get(f"/api/runs/{run_id}").json()
            assert result["approvals"][0]["actor"] == username
            assert result["approvals"][0]["actor_user_id"] == viewer_id
            assert result["approvals"][0]["identity_source"] == "authenticated_session"
            token = viewer.cookies[COOKIE]
            rows = read_events(uuid.UUID(run_id), 0, token)
            assert rows and read_events(uuid.UUID(run_id), rows[-1]["id"], token) == []
            assert (
                admin.patch(
                    f"/api/users/{viewer_id}", json={"role": "approver", "active": False}
                ).status_code
                == 200
            )
            with pytest.raises(HTTPException):
                read_events(uuid.UUID(run_id), 0, token)
            assert viewer.get("/api/auth/me").status_code == 401
        admin.post(f"/api/runs/{run_id}/cancel", json={"comment": "Cleanup"})
        with SessionLocal() as session:
            assert session.scalar(
                select(AuditLog).where(
                    AuditLog.action == "approval.approve", AuditLog.user_id == uuid.UUID(viewer_id)
                )
            )
    finally:
        with SessionLocal.begin() as session:
            if project_id:
                session.execute(delete(Project).where(Project.id == uuid.UUID(project_id)))
            if viewer_id:
                session.execute(
                    delete(Approval).where(Approval.actor_user_id == uuid.UUID(viewer_id))
                )
                session.execute(delete(AuditLog).where(AuditLog.user_id == uuid.UUID(viewer_id)))
                session.execute(delete(User).where(User.id == uuid.UUID(viewer_id)))


@pytest.mark.integration
@integration
def test_login_throttle():
    username = "missing-" + uuid.uuid4().hex[:12]
    with TestClient(app) as client:
        for _ in range(10):
            assert (
                client.post(
                    "/api/auth/login", json={"username": username, "password": "incorrect"}
                ).status_code
                == 401
            )
        assert (
            client.post(
                "/api/auth/login", json={"username": username, "password": "incorrect"}
            ).status_code
            == 429
        )
