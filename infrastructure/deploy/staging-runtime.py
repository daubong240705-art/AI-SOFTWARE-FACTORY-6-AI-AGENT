"""Trusted validation harness deployed beside generated src; no credentials in this process."""

import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, "/artifact/src")
from app import add  # type: ignore[import-not-found]  # Generated validation project.
from ui import label  # type: ignore[import-not-found]

metadata = json.loads(Path("/artifact/manifest.json").read_text())


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/healthz":
            self.send_error(404)
            return
        passed = add(2, 3) == 5 and add(-2, -3) == -5 and label(5) == "Result: 5"
        body = json.dumps({**metadata, "status": "ok" if passed else "failed"}).encode()
        self.send_response(200 if passed else 503)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
