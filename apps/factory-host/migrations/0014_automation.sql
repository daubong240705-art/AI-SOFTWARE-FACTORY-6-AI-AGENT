ALTER TABLE workflow_instances ADD COLUMN last_progress_at TEXT NULL;
CREATE TABLE monitors (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  kind TEXT NOT NULL CHECK (kind IN ('artifact-age','approval-overdue','workflow-stalled','disk-free')),
  params_json TEXT NOT NULL CHECK (json_valid(params_json)),
  comparator TEXT NOT NULL CHECK (comparator IN ('gt','lt')),
  threshold REAL NOT NULL CHECK (threshold >= 0),
  trip_after INTEGER NOT NULL CHECK (trip_after BETWEEN 1 AND 10),
  recover_after INTEGER NOT NULL CHECK (recover_after BETWEEN 1 AND 10),
  interval_seconds INTEGER NOT NULL CHECK (interval_seconds BETWEEN 60 AND 86400),
  state TEXT NOT NULL CHECK (state IN ('active','paused')),
  status TEXT NOT NULL CHECK (status IN ('unknown','ok','tripped')),
  breaches INTEGER NOT NULL DEFAULT 0,
  recoveries INTEGER NOT NULL DEFAULT 0,
  last_value REAL NULL,
  last_checked_at TEXT NULL,
  next_check_at TEXT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id,id),
  UNIQUE (project_id,name)
) STRICT;
CREATE TABLE monitor_events (
  project_id TEXT NOT NULL,
  monitor_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  from_status TEXT NOT NULL CHECK (from_status IN ('unknown','ok','tripped')),
  to_status TEXT NOT NULL CHECK (to_status IN ('unknown','ok','tripped')),
  value REAL NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (project_id,monitor_id,seq),
  FOREIGN KEY (project_id,monitor_id) REFERENCES monitors(project_id,id)
) STRICT;
CREATE INDEX monitors_due ON monitors(state,next_check_at);
