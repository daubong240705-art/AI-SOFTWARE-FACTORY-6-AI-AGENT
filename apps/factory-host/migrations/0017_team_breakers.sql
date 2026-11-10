CREATE TABLE team_breakers (
  project_id TEXT NOT NULL REFERENCES projects(id),
  team_id TEXT NOT NULL REFERENCES teams(id),
  state TEXT NOT NULL CHECK (state IN ('open','closed')),
  opened_at TEXT,
  closed_at TEXT,
  failures INTEGER NOT NULL CHECK (failures >= 0),
  reason TEXT,
  PRIMARY KEY (project_id, team_id),
  CHECK ((state='open') = (opened_at IS NOT NULL))
) STRICT;
