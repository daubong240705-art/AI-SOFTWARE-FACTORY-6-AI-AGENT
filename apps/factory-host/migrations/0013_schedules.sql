CREATE TABLE schedules (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  kind TEXT NOT NULL CHECK (kind IN ('cron','interval','once')),
  expr TEXT NOT NULL,
  timezone TEXT NOT NULL,
  action_json TEXT NOT NULL CHECK (json_valid(action_json)),
  missed_policy TEXT NOT NULL CHECK (missed_policy IN ('skip','coalesce-once','catch-up-limited')),
  catch_up_limit INTEGER NOT NULL CHECK (catch_up_limit BETWEEN 1 AND 5),
  concurrency TEXT NOT NULL CHECK (concurrency IN ('skip-if-running','queue-one','allow-parallel')),
  parallel_limit INTEGER NOT NULL CHECK (parallel_limit BETWEEN 2 AND 5),
  state TEXT NOT NULL CHECK (state IN ('active','paused','quarantined')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures BETWEEN 0 AND 10),
  next_run_at TEXT,
  last_run_at TEXT,
  last_status TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, name)
) STRICT;
CREATE TABLE schedule_occurrences (
  project_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('time','manual')),
  status TEXT NOT NULL CHECK (status IN ('started','skipped','failed','no-op')),
  reason TEXT CHECK (reason IS NULL OR (length(reason) <= 300 AND reason IN
    ('missed','coalesced','beyond catch-up limit','previous still running','queue full','parallel limit','schedule inactive','workflow start failed'))),
  instance_id TEXT,
  fired_at TEXT NOT NULL,
  PRIMARY KEY (project_id, schedule_id, scheduled_for, trigger),
  FOREIGN KEY (project_id, schedule_id) REFERENCES schedules(project_id, id)
) STRICT;
CREATE INDEX schedules_due ON schedules(state, next_run_at);
