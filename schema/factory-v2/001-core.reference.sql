-- F0-03 REFERENCE, not a V1 migration or a production bootstrap script.
-- Execute only in a new/temporary V2 database. F1-02 owns transactional migrations.
PRAGMA foreign_keys = ON;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  name TEXT NOT NULL,
  workspace_kind TEXT NOT NULL CHECK (workspace_kind IN ('git','directory','artifact')),
  workspace_root TEXT NOT NULL,
  disposition TEXT NOT NULL DEFAULT 'active' CHECK (disposition IN ('active','parked','archived'))
) STRICT;

CREATE TABLE agents (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  PRIMARY KEY (project_id, id)
) STRICT;

CREATE TABLE workflow_revisions (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  PRIMARY KEY (project_id, id, revision)
) STRICT;

CREATE TABLE workflow_statuses (
  project_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_revision INTEGER NOT NULL,
  id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('backlog','planned','active','review','done')),
  PRIMARY KEY (project_id, workflow_id, workflow_revision, id),
  FOREIGN KEY (project_id, workflow_id, workflow_revision)
    REFERENCES workflow_revisions(project_id, id, revision)
) STRICT;

CREATE TABLE completion_contract_revisions (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  PRIMARY KEY (project_id, id, revision)
) STRICT;

CREATE TABLE work_items (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  title TEXT NOT NULL,
  brief TEXT NOT NULL,
  parent_id TEXT,
  assignee_id TEXT,
  workflow_id TEXT NOT NULL,
  workflow_revision INTEGER NOT NULL,
  status_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  contract_revision INTEGER NOT NULL,
  disposition TEXT NOT NULL DEFAULT 'active' CHECK (disposition IN ('active','parked','archived')),
  PRIMARY KEY (project_id, id),
  CHECK (parent_id IS NULL OR parent_id <> id),
  FOREIGN KEY (project_id, parent_id) REFERENCES work_items(project_id, id),
  FOREIGN KEY (project_id, assignee_id) REFERENCES agents(project_id, id),
  FOREIGN KEY (project_id, workflow_id, workflow_revision, status_id)
    REFERENCES workflow_statuses(project_id, workflow_id, workflow_revision, id),
  FOREIGN KEY (project_id, contract_id, contract_revision)
    REFERENCES completion_contract_revisions(project_id, id, revision)
) STRICT;
CREATE INDEX work_board ON work_items(project_id, disposition, status_id, id);
CREATE INDEX work_assignee ON work_items(project_id, assignee_id, disposition, id);

CREATE TABLE dependencies (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  input_work_id TEXT NOT NULL,
  PRIMARY KEY (project_id, work_id, input_work_id),
  CHECK (work_id <> input_work_id),
  FOREIGN KEY (project_id, work_id) REFERENCES work_items(project_id, id),
  FOREIGN KEY (project_id, input_work_id) REFERENCES work_items(project_id, id)
) STRICT;

CREATE TABLE conversations (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  agent_id TEXT NOT NULL,
  work_id TEXT,
  title TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, agent_id) REFERENCES agents(project_id, id),
  FOREIGN KEY (project_id, work_id) REFERENCES work_items(project_id, id)
) STRICT;

CREATE TABLE command_receipts (
  -- No FK to projects: rejected/creation commands also need durable idempotency receipts.
  command_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^a-f0-9]*'),
  state TEXT NOT NULL CHECK (state IN ('accepted','completed','rejected','outcome-unknown')),
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at TEXT NOT NULL,
  UNIQUE (project_id, command_id)
) STRICT;
CREATE INDEX receipts_project ON command_receipts(project_id, created_at, command_id);

CREATE TABLE messages (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  command_id TEXT UNIQUE,
  body_json TEXT NOT NULL CHECK (json_valid(body_json)),
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, conversation_id, ordinal),
  FOREIGN KEY (project_id, conversation_id) REFERENCES conversations(project_id, id),
  FOREIGN KEY (project_id, command_id) REFERENCES command_receipts(project_id, command_id)
) STRICT;

CREATE TABLE drafts (
  project_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  PRIMARY KEY (project_id, conversation_id, actor_id),
  FOREIGN KEY (project_id, conversation_id) REFERENCES conversations(project_id, id)
) STRICT;

CREATE TABLE assignments (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  work_id TEXT,
  agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  epoch INTEGER NOT NULL CHECK (epoch > 0),
  state TEXT NOT NULL CHECK (state IN ('queued','claimed','waiting','finished','cancelled')),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, work_id) REFERENCES work_items(project_id, id),
  FOREIGN KEY (project_id, agent_id) REFERENCES agents(project_id, id),
  FOREIGN KEY (project_id, conversation_id) REFERENCES conversations(project_id, id)
) STRICT;
-- No global one-active-run index: independent assignments may run concurrently.
CREATE UNIQUE INDEX one_live_assignment_per_work ON assignments(project_id, work_id)
  WHERE work_id IS NOT NULL AND state IN ('queued','claimed','waiting');
CREATE INDEX assignment_queue ON assignments(project_id, state, id);

CREATE TABLE run_attempts (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  epoch INTEGER NOT NULL CHECK (epoch > 0),
  revision INTEGER NOT NULL CHECK (revision > 0),
  state TEXT NOT NULL CHECK (state IN ('queued','starting','running','waiting-input','stopping','succeeded','failed','interrupted')),
  outcome TEXT NOT NULL CHECK (outcome IN ('known','unknown')),
  config_snapshot_json TEXT NOT NULL CHECK (json_valid(config_snapshot_json)),
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, assignment_id, epoch),
  FOREIGN KEY (project_id, assignment_id) REFERENCES assignments(project_id, id)
) STRICT;
CREATE UNIQUE INDEX one_live_attempt_per_assignment ON run_attempts(project_id, assignment_id)
  WHERE state IN ('queued','starting','running','waiting-input','stopping');

CREATE TABLE leases (
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > 0),
  PRIMARY KEY (project_id, run_id),
  FOREIGN KEY (project_id, run_id) REFERENCES run_attempts(project_id, id)
) STRICT;
CREATE INDEX lease_expiry ON leases(expires_at_ms);

CREATE TABLE reservations (
  -- Lock keys derived by Host from canonical paths/resources, never accepted from the UI.
  lock_key TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  units INTEGER NOT NULL CHECK (units > 0),
  FOREIGN KEY (project_id, run_id) REFERENCES run_attempts(project_id, id)
) STRICT;

CREATE TABLE callback_inbox (
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  callback_id TEXT NOT NULL UNIQUE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  PRIMARY KEY (project_id, run_id, sequence),
  FOREIGN KEY (project_id, run_id) REFERENCES run_attempts(project_id, id)
) STRICT;

CREATE TABLE project_streams (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  epoch TEXT NOT NULL,
  last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  UNIQUE (project_id, epoch)
) STRICT;

CREATE TABLE event_log (
  event_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  epoch TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  body_json TEXT NOT NULL CHECK (json_valid(body_json)),
  UNIQUE (project_id, epoch, sequence),
  FOREIGN KEY (project_id, epoch) REFERENCES project_streams(project_id, epoch)
) STRICT;

CREATE TABLE outbox (
  event_id TEXT PRIMARY KEY REFERENCES event_log(event_id),
  delivered_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
) STRICT;
CREATE INDEX undelivered_events ON outbox(event_id) WHERE delivered_at IS NULL;

CREATE TABLE migration_ledger (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;
-- Later F3/F4/F5 migrations: input/document/output revisions, handoffs, decisions/reviews,
-- issue fix budgets, rules, schedules/occurrences, jobs and extension bindings.
-- Their CAS, guard, immutability, cycle and scope checks remain Host transaction responsibilities.
