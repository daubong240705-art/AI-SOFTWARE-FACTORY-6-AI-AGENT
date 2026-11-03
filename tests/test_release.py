"""Release packaging must reject swapped or falsely labelled images."""

import hashlib
import io
import json
import tarfile

import pytest

from infrastructure.ci.package import describe


def image(path, revision, tag):
    config = json.dumps(
        {"config": {"Labels": {"org.opencontainers.image.revision": revision}}}
    ).encode()
    manifest = json.dumps([{"Config": "config.json", "RepoTags": [tag]}]).encode()
    with tarfile.open(path, "w") as archive:
        for name, value in [("manifest.json", manifest), ("config.json", config)]:
            info = tarfile.TarInfo(name)
            info.size = len(value)
            archive.addfile(info, io.BytesIO(value))
    return config


def test_image_identity_is_derived_from_config(tmp_path):
    sha = "1" * 40
    path = tmp_path / "image.tar"
    raw = image(path, sha, "asf-api:" + sha)
    result = describe(path, "asf-api:" + sha, sha)
    assert result["image_id"] == "sha256:" + hashlib.sha256(raw).hexdigest()
    assert result["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.mark.parametrize(
    "revision,tag", [("2" * 40, "asf-api:" + "1" * 40), ("1" * 40, "asf-api:latest")]
)
def test_reject_unbound_image_identity(tmp_path, revision, tag):
    path = tmp_path / "image.tar"
    image(path, revision, tag)
    with pytest.raises(AssertionError):
        describe(path, "asf-api:" + "1" * 40, "1" * 40)
