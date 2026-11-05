"""Boundary tests for probes/setup. No real installs, external requests or user data."""

import base64
import hashlib
import importlib.util
import io
import json
import sys
import tarfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


probe = load("linux_probe", "preflight-linux.py")
setup = load("linux_setup", "setup-linux.py")


class PreflightTests(unittest.TestCase):
    def test_origin_rejects_credentials_and_remote_cleartext(self):
        for value in (
            "https://user:secret@router.local",
            "http://router.local",
            "https://router.local/?key=secret",
            "file:///etc/passwd",
            "https://router.local/path",
            "https://router.local/#secret",
        ):
            with self.assertRaises(ValueError):
                probe.valid_origin(value)
        self.assertEqual(probe.valid_origin("https://ai.lazy.local/"), "https://ai.lazy.local")
        self.assertEqual(probe.valid_origin("http://127.0.0.1:1234"), "http://127.0.0.1:1234")

    def test_model_listing_is_not_runtime_auth_or_inference(self):
        self.assertEqual(probe.models_readiness(200, True, True), "authenticated")
        self.assertEqual(probe.models_readiness(200, False, True), "authenticated")
        self.assertEqual(probe.models_readiness(200, None, True), "unknown")
        self.assertEqual(probe.models_readiness(200, True, False), "unknown")
        self.assertEqual(probe.models_readiness(401, None, True), "needs-auth")
        self.assertEqual(probe.models_readiness(503, None, True), "unknown")

    def test_http_error_does_not_emit_secret_or_response_body(self):
        error = urllib.error.HTTPError(
            "https://router.local", 401, "secret-message", {}, io.BytesIO(b"secret-response")
        )
        with patch.object(probe.urllib.request, "build_opener") as builder:
            builder.return_value.open.side_effect = error
            result, body = probe.http_probe("https://router.local", key="sensitive-token")
        serialized = json.dumps(result)
        for secret in ("secret-message", "secret-response", "sensitive-token"):
            self.assertNotIn(secret, serialized)
        self.assertEqual(result["status"], 401)
        self.assertTrue(result["tlsVerified"])
        self.assertIsNone(body)

    def test_network_error_is_sanitized(self):
        with patch.object(probe.urllib.request, "build_opener") as builder:
            builder.return_value.open.side_effect = urllib.error.URLError("secret-host-info")
            result, _ = probe.http_probe("https://router.local")
        self.assertEqual(result["error"], "network-unavailable")
        self.assertNotIn("secret-host-info", json.dumps(result))

    def test_setup_defaults_to_no_mutations(self):
        with patch.object(sys, "argv", ["setup-linux.py"]), patch.object(setup, "setup") as apply:
            with patch("sys.stdout", new_callable=io.StringIO) as output:
                setup.main()
            result = json.loads(output.getvalue())
        apply.assert_not_called()
        self.assertEqual(result["mode"], "plan-only")
        self.assertFalse(result["copiesCredentials"])

    def test_install_root_cannot_escape_dedicated_home_directory(self):
        home = Path.cwd()
        with patch.object(Path, "is_symlink", return_value=False):
            setup.validate_root(home / "factory-v2", home)
            for root in (home, home / "other", home.parent, Path("/etc/factory-v2")):
                with self.assertRaises(ValueError):
                    setup.validate_root(root, home)
        with patch.object(Path, "is_symlink", return_value=True):
            with self.assertRaises(ValueError):
                setup.validate_root(home / "factory-v2", home)

    def test_checksums_reject_tampering_before_extraction(self):
        data = b"reviewed-artifact"
        for algorithm in ("sha256", "sha512"):
            digest = hashlib.new(algorithm, data).digest()
            artifact = {"algorithm": algorithm}
            if algorithm == "sha256":
                artifact["digest"] = digest.hex()
            else:
                artifact["integrity"] = "sha512-" + base64.b64encode(digest).decode()
            setup.verify_digest(data, artifact)
            with self.assertRaises(ValueError):
                setup.verify_digest(data + b"tampered", artifact)

    def test_tar_rejects_path_traversal_devices_and_escaping_links(self):
        safe = tarfile.TarInfo("package/bin/tool")
        setup.validate_members([safe], "package")
        for path in ("/tmp/evil", "package/../evil", "different/bin/tool"):
            with self.assertRaises(ValueError):
                setup.validate_members([tarfile.TarInfo(path)], "package")
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE):
            entry = tarfile.TarInfo("package/bin/evil")
            entry.type = kind
            entry.linkname = "/etc/passwd"
            with self.assertRaises(ValueError):
                setup.validate_members([entry], "package")
        safe_link = tarfile.TarInfo("package/bin/npm")
        safe_link.type = tarfile.SYMTYPE
        safe_link.linkname = "../lib/node_modules/npm/bin/npm-cli.js"
        setup.validate_members([safe_link], "package")

    def test_tar_decompression_budget(self):
        entry = tarfile.TarInfo("package/big")
        entry.size = setup.MAX_UNPACKED + 1
        with self.assertRaises(ValueError):
            setup.validate_members([entry], "package")

    def test_existing_config_is_never_overwritten(self):
        with (
            patch.object(Path, "is_symlink", return_value=False),
            patch.object(Path, "exists", return_value=True),
            patch.object(Path, "read_bytes", return_value=b"existing"),
            patch.object(Path, "open") as writer,
        ):
            setup.write_new_or_identical(Path("config"), b"existing")
            with self.assertRaises(ValueError):
                setup.write_new_or_identical(Path("config"), b"replacement")
            writer.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
