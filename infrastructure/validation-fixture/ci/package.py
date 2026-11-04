import hashlib,json,os,pathlib
files={p.as_posix():p.read_text(encoding="utf-8") for p in pathlib.Path("src").rglob("*.py")}
raw=json.dumps(files,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()
release=pathlib.Path("release");release.mkdir(exist_ok=True)
(release/"source.json").write_text(raw.decode())
(release/"manifest.json").write_text(json.dumps({"project_id":int(os.environ["CI_PROJECT_ID"]),"candidate_sha":os.environ["CI_COMMIT_SHA"],"pipeline_id":int(os.environ["CI_PIPELINE_ID"]),"artifact_sha256":hashlib.sha256(raw).hexdigest()}))
