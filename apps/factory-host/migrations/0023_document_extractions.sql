-- Derived data only: artifact_versions remains the immutable source of truth.
CREATE TABLE document_extractions (
  project_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','done','failed','skipped')),
  converter TEXT NOT NULL,
  converter_version TEXT NOT NULL,
  pages INTEGER,
  chars INTEGER,
  outline_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{"title":null,"author":null,"language":null}',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  text_hash TEXT,
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, artifact_id, version),
  FOREIGN KEY (project_id, artifact_id, version) REFERENCES artifact_versions(project_id, artifact_id, version)
) STRICT;
