import json
import logging
from io import StringIO

import pytest
from asf_api.main import app
from asf_api.schemas import ProjectCreate
from fastapi.testclient import TestClient
from pydantic import ValidationError

from shared.logging import JsonFormatter


def test_validation_does_not_echo_credentials(monkeypatch) -> None:
    import uuid

    from asf_api.auth import Principal, current_user

    monkeypatch.setitem(
        app.dependency_overrides,
        current_user,
        lambda: Principal(uuid.uuid4(), "validation-test", "admin"),
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/projects",
            json={
                "name": "Demo",
                "slug": "demo",
                "repository_url": "https://bot:private@example.com",
            },
        )
    assert response.status_code == 422
    assert "private" not in response.text
    assert response.json()["error"]["code"] == "validation_error"
    assert response.headers["x-request-id"]


def test_whitespace_and_invalid_slugs() -> None:
    assert ProjectCreate(name="  Factory  ", slug="factory").name == "Factory"
    for slug in ["-demo", "demo-", "demo--test", "DEMO", "a/b"]:
        with pytest.raises(ValidationError):
            ProjectCreate(name="Demo", slug=slug)
    with pytest.raises(ValidationError):
        ProjectCreate(name="   ", slug="demo")


def test_json_log_redacts_messages_and_exceptions() -> None:
    stream = StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    logger = logging.Logger("redaction-test")
    logger.addHandler(handler)
    try:
        raise ValueError("postgresql://asf:database-secret@db/asf token=token-secret")
    except ValueError:
        logger.exception("password=password-secret api_key=api-secret")
    output = stream.getvalue()
    for secret in ["database-secret", "token-secret", "password-secret", "api-secret"]:
        assert secret not in output
    assert "[REDACTED]" in json.loads(output)["message"]


def test_health_and_error_envelope() -> None:
    with TestClient(app) as client:
        assert client.get("/healthz").json()["status"] == "ok"
        error = client.get("/missing")
        assert error.status_code == 404
        assert error.json()["request_id"] == error.headers["x-request-id"]
