CREATE TABLE knowledge_stale (
  project_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  because_artifact_id TEXT NOT NULL,
  because_version INTEGER NOT NULL,
  since TEXT NOT NULL,
  PRIMARY KEY (project_id, artifact_id, version, because_artifact_id, because_version),
  FOREIGN KEY (project_id, artifact_id, version) REFERENCES artifact_versions(project_id, artifact_id, version),
  FOREIGN KEY (project_id, because_artifact_id, because_version) REFERENCES artifact_versions(project_id, artifact_id, version)
) STRICT;
CREATE INDEX knowledge_stale_because ON knowledge_stale(project_id, because_artifact_id, because_version);
