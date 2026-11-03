"""Explicit real authenticated clients; production dependencies are never bypassed."""

import secrets
import uuid

import pytest
from asf_api.auth import hash_password
from asf_api.db import SessionLocal
from asf_api.main import app
from asf_api.models import Approval, AuditLog, User
from fastapi.testclient import TestClient
from sqlalchemy import delete, update


@pytest.fixture
def account():
    password = secrets.token_urlsafe(24)
    with SessionLocal.begin() as session:
        user = User(
            username="test-" + uuid.uuid4().hex[:20],
            role="admin",
            password_hash=hash_password(password),
        )
        session.add(user)
        session.flush()
        user_id, username = user.id, user.username
    yield user_id, username, password
    with SessionLocal.begin() as session:
        session.execute(
            update(Approval).where(Approval.actor_user_id == user_id).values(actor_user_id=None)
        )
        session.execute(delete(AuditLog).where(AuditLog.user_id == user_id))
        session.execute(delete(User).where(User.id == user_id))


@pytest.fixture
def authenticated(account):
    with TestClient(app) as client:
        result = client.post(
            "/api/auth/login", json={"username": account[1], "password": account[2]}
        )
        assert result.status_code == 200, result.text
        client.headers["X-CSRF-Token"] = result.json()["csrf_token"]
        yield client
