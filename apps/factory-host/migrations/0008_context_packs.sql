CREATE TABLE context_packs (
  project_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  built_at TEXT NOT NULL,
  tokens INTEGER NOT NULL CHECK (tokens >= 0),
  max_tokens INTEGER NOT NULL CHECK (max_tokens BETWEEN 500 AND 32000),
  l0_count INTEGER NOT NULL CHECK (l0_count >= 0),
  l1_count INTEGER NOT NULL CHECK (l1_count >= 0),
  omitted_count INTEGER NOT NULL CHECK (omitted_count >= 0),
  pack_json TEXT NOT NULL CHECK (json_valid(pack_json) AND length(pack_json) <= 262144),
  PRIMARY KEY (project_id, attempt_id),
  FOREIGN KEY (project_id, attempt_id) REFERENCES attempts(project_id, id)
) STRICT;
