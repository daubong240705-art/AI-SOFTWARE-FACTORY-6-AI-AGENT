-- Derived search data only. Original versions and verified content remain authoritative.
CREATE VIRTUAL TABLE knowledge_index USING fts5(
  title, abstract, body, project_id UNINDEXED, artifact_id UNINDEXED, version UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE knowledge_indexed (
  project_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  body_indexed INTEGER NOT NULL CHECK (body_indexed IN (0,1)),
  indexed_at TEXT NOT NULL,
  PRIMARY KEY (project_id, artifact_id, version),
  FOREIGN KEY (project_id, artifact_id, version)
    REFERENCES artifact_versions(project_id, artifact_id, version)
) STRICT;
