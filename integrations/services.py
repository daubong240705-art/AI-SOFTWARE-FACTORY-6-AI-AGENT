"""Bounded, TLS verified calls to administrator-configured service origins."""

import json
import ssl
import time
from typing import Any, cast
from urllib.parse import quote, urlsplit

import httpx

from orchestrator.state import WorkflowError
from shared.config import get_settings


class Service:
    def __init__(self, kind: str):
        settings = get_settings()
        self.kind = kind
        self.origin = getattr(settings, kind + "_url").rstrip("/")
        token = getattr(settings, kind + "_api_token").get_secret_value()
        if not token or urlsplit(self.origin).scheme != "https":
            raise WorkflowError(kind + "_not_configured")
        self.headers = (
            {"PRIVATE-TOKEN": token} if kind == "gitlab" else {"Authorization": "Bearer " + token}
        )
        self.ca = settings.gitlab_ca_file if kind == "gitlab" else None

    def call(self, method: str, path: str, **kwargs: Any) -> Any:
        prefix = "/api/v4/" if self.kind == "gitlab" else "/api/v3/"
        if not path.startswith(prefix) or ".." in path or "?" in path:
            raise WorkflowError("invalid_service_path")
        try:
            with httpx.Client(
                verify=ssl.create_default_context(cafile=self.ca),
                trust_env=False,
                timeout=httpx.Timeout(20, connect=5),
                follow_redirects=False,
            ) as client:
                with client.stream(method, self.origin + path, headers=self.headers, **kwargs) as r:
                    if not r.is_success:
                        raise WorkflowError(self.kind + "_http_" + str(r.status_code))
                    body = bytearray()
                    for chunk in r.iter_bytes():
                        body.extend(chunk)
                        if len(body) > 4_000_000:
                            raise WorkflowError("service_response_too_large")
                    return json.loads(body)
        except (httpx.HTTPError, ValueError):
            raise WorkflowError(self.kind + "_unavailable") from None


class GitLab(Service):
    def __init__(self, project_id: int):
        super().__init__("gitlab")
        self.path = f"/api/v4/projects/{project_id}"

    def get(self, suffix: str, **params: Any) -> Any:
        return self.call("GET", self.path + suffix, params=params)

    def post(self, suffix: str, payload: dict[str, Any]) -> Any:
        return self.call("POST", self.path + suffix, json=payload)

    def snapshot(self, sha: str) -> dict[str, str]:
        files: dict[str, str] = {}
        size = 0
        started = time.monotonic()
        for page in range(1, 12):
            rows = self.get("/repository/tree", ref=sha, recursive=True, per_page=100, page=page)
            for row in rows:
                if time.monotonic() - started > 25:
                    raise WorkflowError("repository_snapshot_timeout")
                if row["type"] == "tree":
                    continue
                if row.get("mode") not in {"100644", "100755"}:
                    raise WorkflowError("repository_special_file")
                # Fetch bounded text files only; no archive extraction or symlink traversal.
                item = self.get("/repository/files/" + quote(row["path"], safe=""), ref=sha)
                import base64

                raw = base64.b64decode(item["content"], validate=True)
                size += len(raw)
                if size > 1_000_000 or len(raw) > 200_000 or len(files) >= 200:
                    raise WorkflowError("repository_snapshot_limit")
                files[row["path"]] = raw.decode("utf-8")
            if len(rows) < 100:
                return files
        raise WorkflowError("repository_snapshot_limit")


def sync_work_package(
    project_id: int, type_id: int, marker: str, content: dict[str, Any]
) -> dict[str, Any]:
    """Reconcile marker before every create, including after an ambiguous network failure."""
    service = Service("openproject")
    filters = [{"subject": {"operator": "~", "values": [marker]}}]
    result = service.call(
        "GET",
        f"/api/v3/workspaces/{project_id}/work_packages",
        params={"filters": json.dumps(filters), "pageSize": 100},
    )
    matches = [
        w for w in result.get("_embedded", {}).get("elements", []) if w.get("subject") == marker
    ]
    if len(matches) > 1 or result.get("total", 0) > 100:
        raise WorkflowError("openproject_duplicate_marker")
    payload = {
        "subject": marker,
        "description": {
            "format": "markdown",
            "raw": "```json\n" + json.dumps(content, ensure_ascii=False, indent=2) + "\n```",
        },
    }
    if matches:
        wp = matches[0]
        return cast(
            dict[str, Any],
            service.call(
                "PATCH",
                f"/api/v3/work_packages/{wp['id']}",
                json={**payload, "lockVersion": wp["lockVersion"]},
            ),
        )
    return cast(
        dict[str, Any],
        service.call(
            "POST",
            f"/api/v3/workspaces/{project_id}/work_packages",
            json={
                **payload,
                "_links": {"type": {"href": f"/api/v3/types/{type_id}"}},
            },
        ),
    )
