CREATE TABLE game_releases (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('publish','rollback')),
  game_id TEXT NOT NULL,
  commit_sha TEXT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','done','failed','unknown')),
  version INTEGER NULL CHECK (version IS NULL OR version > 0),
  base_version INTEGER NULL CHECK (base_version IS NULL OR base_version >= 0), -- highest Portal version seen right before the upload; NULL: nothing was sent
  play_path TEXT NULL,
  error TEXT NULL CHECK (error IS NULL OR length(error) <= 500),
  log_tail TEXT NULL CHECK (log_tail IS NULL OR length(log_tail) <= 12000),
  created_at TEXT NOT NULL,
  completed_at TEXT NULL,
  PRIMARY KEY (project_id, id)
) STRICT;

CREATE INDEX game_releases_project_created ON game_releases(project_id, created_at);
