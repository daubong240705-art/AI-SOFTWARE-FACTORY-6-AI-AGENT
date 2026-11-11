-- A cross-team request is a Task; these tables hold its protocol metadata and thread.
CREATE TABLE ctr_meta (
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  root_task_id TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  target_team_id TEXT NOT NULL REFERENCES teams(id),
  response_mode TEXT NOT NULL CHECK (response_mode IN ('async','blocking')),
  needed_by TEXT,
  expected_response_json TEXT NOT NULL CHECK (json_valid(expected_response_json)),
  context_refs_json TEXT NOT NULL CHECK (json_valid(context_refs_json)),
  excerpt TEXT,
  triage_state TEXT NOT NULL CHECK (triage_state IN ('submitted','need-info','accepted','declined','redirected','merged')),
  triage_by TEXT,
  triage_at TEXT,
  triage_reason TEXT,
  merged_into_task_id TEXT,
  redirected_to_task_id TEXT,
  rounds INTEGER NOT NULL DEFAULT 0 CHECK (rounds BETWEEN 0 AND 4),
  delivered_at TEXT,
  closed_at TEXT,
  PRIMARY KEY (project_id, task_id),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id),
  FOREIGN KEY (project_id, root_task_id) REFERENCES tasks(project_id, id),
  FOREIGN KEY (project_id, merged_into_task_id) REFERENCES tasks(project_id, id),
  FOREIGN KEY (project_id, redirected_to_task_id) REFERENCES tasks(project_id, id)
) STRICT;
CREATE INDEX ctr_dedup ON ctr_meta(project_id, dedup_key);
CREATE INDEX ctr_triage ON ctr_meta(target_team_id, triage_state);

CREATE TABLE ctr_messages (
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq > 0),
  author TEXT NOT NULL CHECK (author IN ('requester','target','operator','system')),
  text TEXT NOT NULL CHECK (length(text) <= 4000),
  at TEXT NOT NULL,
  PRIMARY KEY (project_id, task_id, seq),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id)
) STRICT;
CREATE TRIGGER ctr_message_no_update BEFORE UPDATE ON ctr_messages
BEGIN SELECT RAISE(ABORT, 'request messages are immutable'); END;
CREATE TRIGGER ctr_message_no_delete BEFORE DELETE ON ctr_messages
BEGIN SELECT RAISE(ABORT, 'request messages are immutable'); END;

CREATE TABLE ctr_followers (
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  follower_task_id TEXT NOT NULL,
  since TEXT NOT NULL,
  PRIMARY KEY (project_id, task_id, follower_task_id),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id),
  FOREIGN KEY (project_id, follower_task_id) REFERENCES tasks(project_id, id)
) STRICT;
