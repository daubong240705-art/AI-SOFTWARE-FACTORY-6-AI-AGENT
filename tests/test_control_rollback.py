import importlib.util
import json
import sys
from types import SimpleNamespace


def release(monkeypatch):
    monkeypatch.setitem(sys.modules, "fcntl", SimpleNamespace())
    spec = importlib.util.spec_from_file_location(
        "control_release", "infrastructure/deploy/asf-release.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_rollback_rejects_incompatible_schema_and_requires_explicit_bridge(monkeypatch):
    module = release(monkeypatch)
    assert module.rollback_compatible({"schema": "0003_auth"}, "0003_auth")
    assert not module.rollback_compatible({"schema": "0003_auth"}, "0004_agents")
    assert module.rollback_compatible(
        {"schema": "0003_auth", "supported_schemas": ["0003_auth", "0004_agents"]}, "0004_agents"
    )
    assert not module.rollback_compatible({"schema": "0004_agents"}, "unknown")


def test_bridge_rollback_skips_old_migrations_and_keeps_workflow_workers_stopped(
    monkeypatch, tmp_path
):
    module = release(monkeypatch)
    sha = "a" * 40
    directory = tmp_path / "releases" / sha
    directory.mkdir(parents=True)
    (directory / "manifest.json").write_text(json.dumps({"schema": "0003_auth"}))
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(module, "database_schema", lambda: "0004_agents")
    calls = []
    monkeypatch.setattr(module, "dc", lambda *args: calls.append(args))
    monkeypatch.setattr(module, "health", lambda _: None)
    module.activate(sha, migrate=False)
    assert not any("migrate" in args for args in calls)
    assert calls[-1] == (sha, "up", "-d", "--no-deps", "api", "dashboard")
