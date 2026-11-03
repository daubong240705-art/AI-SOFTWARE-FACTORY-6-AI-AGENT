"""Read OpenProject through MCP over an authenticated SSH tunnel; never mutate data.

Install requirements-infra.txt, set OPENPROJECT_API_TOKEN, then run this file.
SSH password is read from ASF_AUDIT_SSH_PASSWORD or an interactive prompt.
An explicit --ssh-key can be used instead. No credentials are saved to the output.
"""

import argparse
import base64
import collections
import datetime
import getpass
import hashlib
import http.client
import json
import os
from pathlib import Path

import paramiko


class PinnedHost(paramiko.MissingHostKeyPolicy):
    def __init__(self, expected):
        self.expected = expected

    def missing_host_key(self, client, hostname, key):
        fingerprint = "SHA256:" + base64.b64encode(
            hashlib.sha256(key.asbytes()).digest()
        ).decode().rstrip("=")
        if fingerprint != self.expected:
            raise paramiko.SSHException("SSH host fingerprint differs from audit baseline")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ssh-host", default="192.168.1.12")
    parser.add_argument("--ssh-user", default="lazy")
    parser.add_argument("--ssh-key", type=Path)
    parser.add_argument(
        "--ssh-fingerprint",
        default="SHA256:qBOKiAkQrM13XyD4zm0a24qfJX85EqF8tmJ9JphUO4Y",
        help="Fingerprint observed on first survey; verify through a trusted channel",
    )
    parser.add_argument("--project", default="itcare-2026")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    token = os.environ.get("OPENPROJECT_API_TOKEN")
    if not token:
        raise SystemExit("Set OPENPROJECT_API_TOKEN; its value will not be printed")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(PinnedHost(args.ssh_fingerprint))
    auth = {"key_filename": str(args.ssh_key)} if args.ssh_key else {
        "password": os.environ.get("ASF_AUDIT_SSH_PASSWORD")
        or getpass.getpass("SSH password: ")
    }
    ssh.connect(
        args.ssh_host, username=args.ssh_user, timeout=10, auth_timeout=10,
        allow_agent=False, look_for_keys=False, **auth,
    )

    def request(method, path, payload=None):
        connection = http.client.HTTPConnection("openproject.lazy247.space", timeout=40)
        connection.sock = ssh.get_transport().open_channel(
            "direct-tcpip", ("127.0.0.1", 8080), ("127.0.0.1", 0)
        )
        try:
            connection.request(method, path, json.dumps(payload) if payload else None, {
                "Host": "openproject.lazy247.space",
                "X-Forwarded-Proto": "https",
                "Authorization": "Bearer " + token,
                "Accept": "application/json, text/event-stream",
                "Content-Type": "application/json",
            })
            response = connection.getresponse()
            body = response.read()
            if response.status != 200:
                raise RuntimeError(f"OpenProject returned HTTP {response.status}")
            return json.loads(body)
        finally:
            connection.close()

    # This allowlist is deliberately limited to read-only tools.
    permitted = {
        "search_projects", "list_types", "list_statuses", "search_work_packages",
        "search_custom_fields", "list_work_package_relations",
    }

    def call(name, arguments):
        if name not in permitted:
            raise ValueError("Tool is outside the read-only allowlist")
        response = request("POST", "/mcp", {
            "jsonrpc": "2.0", "id": name, "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        })
        if "error" in response or response.get("result", {}).get("isError"):
            raise RuntimeError(f"MCP tool failed: {name}")
        result = response["result"]
        if "structuredContent" not in result:
            raise RuntimeError("MCP server did not return structuredContent")
        return result["structuredContent"]

    try:
        projects = call("search_projects", {"identifier": args.project})["items"]
        if len(projects) != 1:
            raise RuntimeError("Expected exactly one project matching the identifier")
        project = projects[0]
        project_id = project["id"]
        work_packages = []
        page = 1
        expected = None
        while True:
            batch = call("search_work_packages", {
                "project_id": project_id, "level_of_detail": "full", "page": page,
            })
            if expected is None:
                expected = batch["total"]
            if expected != batch["total"]:
                raise RuntimeError("Project changed during pagination; rerun snapshot")
            items = batch["items"]
            work_packages.extend(items)
            if len(work_packages) >= expected:
                break
            if not items:
                raise RuntimeError("Incomplete pagination")
            page += 1
        if len(work_packages) != expected or len({w["id"] for w in work_packages}) != expected:
            raise RuntimeError("Incomplete or duplicate work packages; rerun snapshot")

        def simple_collection(path):
            data = request("GET", path)
            return [{k: item[k] for k in ("id", "name") if k in item}
                    for item in data.get("_embedded", {}).get("elements", [])]

        statuses = call("list_statuses", {})["_embedded"]["elements"]
        rows = [{
            "id": wp["id"], "subject": wp["subject"],
            "type": wp["_links"]["type"], "status": wp["_links"]["status"],
            "parent": wp["_links"].get("parent"),
        } for wp in work_packages]
        output = {
            "observed_at": datetime.datetime.now(datetime.timezone(
                datetime.timedelta(hours=7))).isoformat(),
            "transport": "MCP /mcp over SSH local forwarding to 127.0.0.1:8080",
            "project": {key: project[key] for key in ("id", "identifier", "name")},
            "total": expected, "pages": page,
            "type_counts": dict(collections.Counter(r["type"]["title"] for r in rows)),
            "status_counts": dict(collections.Counter(r["status"]["title"] for r in rows)),
            "enabled_types": simple_collection(f"/api/v3/workspaces/{project_id}/types"),
            "versions": simple_collection(f"/api/v3/workspaces/{project_id}/versions"),
            "categories": simple_collection(f"/api/v3/workspaces/{project_id}/categories"),
            "statuses": [{key: status[key] for key in ("id", "name", "isClosed")}
                         for status in statuses],
            "custom_fields": call("search_custom_fields", {}),
            "work_packages": rows,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n",
                               encoding="utf-8")
        print(json.dumps({key: output[key] for key in (
            "project", "total", "pages", "type_counts", "status_counts"
        )}, ensure_ascii=False))
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
