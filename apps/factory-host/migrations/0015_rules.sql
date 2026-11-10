CREATE TABLE automation_rules (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  event_type TEXT NOT NULL CHECK (event_type IN ('task.status-changed','artifact.status-changed','workflow.state-changed','monitor.changed')),
  condition_json TEXT NOT NULL CHECK (json_valid(condition_json)),
  action_json TEXT NOT NULL CHECK (json_valid(action_json)),
  debounce_seconds INTEGER NOT NULL CHECK (debounce_seconds BETWEEN 0 AND 86400),
  max_fires_per_hour INTEGER NOT NULL CHECK (max_fires_per_hour BETWEEN 1 AND 60),
  state TEXT NOT NULL CHECK (state IN ('active','paused','quarantined')),
  fires_in_window INTEGER NOT NULL DEFAULT 0 CHECK (fires_in_window >= 0),
  window_start TEXT NULL,
  last_fired_at TEXT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures BETWEEN 0 AND 10),
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id,id),
  UNIQUE (project_id,name)
) STRICT;
CREATE TABLE rule_fires (
  project_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  event_sequence INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started','skipped','failed')),
  reason TEXT NULL CHECK (reason IS NULL OR (length(reason) <= 300 AND reason IN
    ('hop limit','rule inactive','debounced','rate limit','previous still running','workflow start failed'))),
  instance_id TEXT NULL,
  depth INTEGER NOT NULL CHECK (depth BETWEEN 0 AND 10),
  fired_at TEXT NOT NULL,
  PRIMARY KEY (project_id,rule_id,event_sequence),
  FOREIGN KEY (project_id,rule_id) REFERENCES automation_rules(project_id,id)
) STRICT;
CREATE TABLE automation_cursors (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0)
) STRICT;
CREATE INDEX automation_rules_events ON automation_rules(project_id,event_type,state);
CREATE INDEX rule_fires_instances ON rule_fires(project_id,instance_id);
