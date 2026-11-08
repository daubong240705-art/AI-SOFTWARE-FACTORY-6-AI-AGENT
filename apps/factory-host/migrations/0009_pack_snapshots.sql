CREATE TABLE pack_snapshots (
  digest TEXT PRIMARY KEY CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-fA-F]*'),
  pack_key TEXT NOT NULL,
  pack_version TEXT NOT NULL,
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  captured_at TEXT NOT NULL
) STRICT;

CREATE TABLE pack_files (
  digest TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('profile','skill')),
  name TEXT,
  description TEXT,
  content TEXT NOT NULL CHECK (length(content) <= 65536),
  PRIMARY KEY (digest, path),
  FOREIGN KEY (digest) REFERENCES pack_snapshots(digest)
) STRICT;

ALTER TABLE teams ADD COLUMN pack_digest TEXT REFERENCES pack_snapshots(digest);

CREATE TABLE attempt_instructions (
  project_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  pack_digest TEXT REFERENCES pack_snapshots(digest),
  profile_path TEXT,
  skills_count INTEGER NOT NULL CHECK (skills_count >= 0),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  PRIMARY KEY (project_id, attempt_id),
  FOREIGN KEY (project_id, attempt_id) REFERENCES attempts(project_id, id)
) STRICT;
