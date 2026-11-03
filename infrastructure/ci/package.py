"""Validate image identity and package immutable, checksummed release artifacts."""

import hashlib
import json
import os
import tarfile
from pathlib import Path


def describe(path: Path, expected_tag: str, sha: str) -> dict[str, str]:
    with tarfile.open(path) as archive:
        manifest_file = archive.extractfile("manifest.json")
        assert manifest_file is not None
        manifest = json.load(manifest_file)
        assert len(manifest) == 1 and manifest[0]["RepoTags"] == [expected_tag]
        config_file = archive.extractfile(manifest[0]["Config"])
        assert config_file is not None
        raw = config_file.read()
        config = json.loads(raw)
        assert config["config"]["Labels"]["org.opencontainers.image.revision"] == sha
        return {
            "tag": expected_tag,
            "image_id": "sha256:" + hashlib.sha256(raw).hexdigest(),
            "sha256": hashlib.file_digest(path.open("rb"), "sha256").hexdigest(),
        }


if __name__ == "__main__":
    sha = os.environ["CI_COMMIT_SHA"]
    release = Path("release")
    images = {
        name: describe(release / f"{name}.tar", f"asf-{name}:{sha}", sha)
        for name in ("api", "dashboard")
    }
    manifest = {
        "sha": sha,
        "pipeline_id": int(os.environ["CI_PIPELINE_ID"]),
        "schema": "0003_auth",
        "images": images,
    }
    (release / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (release / "SHA256SUMS").write_text(
        "".join(
            f"{hashlib.file_digest(p.open('rb'), 'sha256').hexdigest()}  {p.name}\n"
            for p in [release / "api.tar", release / "dashboard.tar", release / "manifest.json"]
        )
    )
    print("Release packaged:", sha)
