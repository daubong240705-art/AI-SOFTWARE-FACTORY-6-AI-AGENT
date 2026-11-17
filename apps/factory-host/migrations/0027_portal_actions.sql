CREATE TABLE portal_settings (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id)
);
CREATE TABLE portal_actions (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('publish','enable','disable','set-version')),
  game_id TEXT NOT NULL,
  target_project_id TEXT REFERENCES projects(id),
  version INTEGER,
  reason TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('proposed','rejected','running','done','failed','unknown')),
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (project_id, approval_id) REFERENCES approvals(project_id,id)
);
CREATE UNIQUE INDEX portal_action_open ON portal_actions(game_id, action)
  WHERE state IN ('proposed','running','unknown');
