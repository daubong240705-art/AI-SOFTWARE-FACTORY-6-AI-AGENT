-- CE-0a: accepted task branches awaiting the project integration worker.
CREATE TABLE integration_merges (
  project_id TEXT NOT NULL REFERENCES projects(id),
  task_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','merged','conflict','skipped')),
  merge_sha TEXT,
  error_kind TEXT CHECK (error_kind IS NULL OR error_kind IN ('conflict','git-failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  PRIMARY KEY (project_id, task_id),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id)
) STRICT;
CREATE INDEX integration_merges_pending ON integration_merges(project_id, state, created_at);
