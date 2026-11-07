-- M0-lite REFERENCE for contracts 0.2.0, not a V1 migration or a production bootstrap script.
-- Applies on top of 001-core.reference.sql in a new/temporary V2 database. M1 owns the real migration.
-- Supersedes from 001 (kept only until M1 replaces them): work_items -> tasks, assignments + run_attempts +
-- leases -> attempts. Nothing here touches V1 data.
PRAGMA foreign_keys = ON;

-- ---- Organisation -----------------------------------------------------------------------------------
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  charter TEXT NOT NULL,
  pack_key TEXT,
  pack_version TEXT,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active','paused','archived')),
  CHECK ((pack_key IS NULL) = (pack_version IS NULL))
) STRICT;

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  name TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('linux','windows','macos')),
  trust TEXT NOT NULL CHECK (trust IN ('server-sandboxed','trusted-workstation','quarantined')),
  state TEXT NOT NULL CHECK (state IN ('online','busy','draining','offline','lost','quarantined')),
  slots_total INTEGER NOT NULL CHECK (slots_total >= 0),
  slots_used INTEGER NOT NULL CHECK (slots_used >= 0),
  last_heartbeat_at TEXT,
  CHECK (slots_used <= slots_total),
  CHECK (trust <> 'quarantined' OR state IN ('quarantined','offline','lost'))
) STRICT;

CREATE TABLE node_capabilities (
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL CHECK (capability_id GLOB '[a-z]*.*' AND capability_id NOT GLOB '*[^a-z0-9.-]*'
    AND capability_id NOT GLOB '*..*' AND capability_id NOT GLOB '*.'),
  level TEXT NOT NULL CHECK (level IN ('declared','verified','observed')),
  observed_at TEXT,
  stale_after TEXT,
  PRIMARY KEY (node_id, capability_id),
  -- Only a verified/observed capability may be used for placement, and it must say how fresh it is.
  CHECK (level = 'declared' OR (observed_at IS NOT NULL AND stale_after IS NOT NULL))
) STRICT;

CREATE TABLE seats (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  profile_revision INTEGER NOT NULL CHECK (profile_revision > 0),
  runtime TEXT NOT NULL CHECK (runtime IN ('fake','native-opencode','api-agent','acp')),
  slots INTEGER NOT NULL CHECK (slots BETWEEN 1 AND 8),
  node_policy TEXT NOT NULL CHECK (node_policy IN ('elastic','dedicated')),
  dedicated_node_id TEXT REFERENCES nodes(id),
  is_lead INTEGER NOT NULL DEFAULT 0 CHECK (is_lead IN (0,1)),
  UNIQUE (team_id, id),
  UNIQUE (team_id, name),
  CHECK ((node_policy = 'dedicated') = (dedicated_node_id IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX one_lead_per_team ON seats(team_id) WHERE is_lead = 1;

CREATE TABLE engagements (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 100),
  max_concurrent INTEGER NOT NULL CHECK (max_concurrent BETWEEN 1 AND 32),
  state TEXT NOT NULL CHECK (state IN ('active','paused','ended')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, team_id, id)
) STRICT;
-- A team has at most one active engagement per project (one seat pool, one priority).
CREATE UNIQUE INDEX one_active_engagement ON engagements(project_id, team_id) WHERE state = 'active';

-- ---- Work ----------------------------------------------------------------------------------------
CREATE TABLE tasks (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  code TEXT NOT NULL CHECK (code GLOB '[A-Z][A-Z]*-[0-9][0-9][0-9]*' AND code NOT GLOB '*[^A-Z0-9-]*'),
  title TEXT NOT NULL,
  goal TEXT NOT NULL CHECK (length(goal) BETWEEN 1 AND 500),
  brief TEXT NOT NULL,
  parent_task_id TEXT,
  engagement_id TEXT,
  owner_seat_id TEXT REFERENCES seats(id),
  origin_kind TEXT NOT NULL CHECK (origin_kind IN ('operator','delegation','cross-team')),
  requester_task_id TEXT,
  request_kind TEXT CHECK (request_kind IN ('clarify','consult','produce','review','decision','notify')),
  hop INTEGER CHECK (hop BETWEEN 0 AND 3),
  state TEXT NOT NULL CHECK (state IN ('draft','proposed','accepted','ready','awaiting-go','active',
    'in-review','done','failed','cancelled','declined','superseded')),
  disposition TEXT NOT NULL DEFAULT 'active' CHECK (disposition IN ('active','parked','archived')),
  placement TEXT NOT NULL DEFAULT 'node-bound' CHECK (placement IN ('portable','repo-bound','node-bound','session-bound')),
  side_effect TEXT NOT NULL DEFAULT 'external-irreversible'
    CHECK (side_effect IN ('none','artifact','external-idempotent','external-irreversible')),
  review_policy TEXT NOT NULL DEFAULT 'human-final' CHECK (review_policy IN ('human-final','automatic','hybrid')),
  requires_go INTEGER NOT NULL DEFAULT 1 CHECK (requires_go IN (0,1)),
  required_capabilities_json TEXT NOT NULL CHECK (json_valid(required_capabilities_json)),
  acceptance_json TEXT NOT NULL CHECK (json_valid(acceptance_json)),
  inputs_json TEXT NOT NULL CHECK (json_valid(inputs_json)),
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, code),
  CHECK (parent_task_id IS NULL OR parent_task_id <> id),
  CHECK (state <> 'awaiting-go' OR requires_go = 1),
  CHECK ((origin_kind = 'cross-team') = (requester_task_id IS NOT NULL AND request_kind IS NOT NULL AND hop IS NOT NULL)),
  CHECK (origin_kind <> 'cross-team' OR owner_seat_id IS NOT NULL OR state IN ('draft','proposed')),
  FOREIGN KEY (project_id, parent_task_id) REFERENCES tasks(project_id, id),
  FOREIGN KEY (project_id, requester_task_id) REFERENCES tasks(project_id, id),
  FOREIGN KEY (project_id, engagement_id) REFERENCES engagements(project_id, id)
) STRICT;
CREATE INDEX task_board ON tasks(project_id, disposition, state, id);
CREATE INDEX task_owner ON tasks(project_id, owner_seat_id, state);

-- Task states that no longer have exits (mirror of TASK_TRANSITIONS in contracts).
CREATE TRIGGER task_terminal_is_final BEFORE UPDATE OF state ON tasks
WHEN OLD.state IN ('cancelled','declined','superseded') AND NEW.state <> OLD.state
BEGIN SELECT RAISE(ABORT, 'task is in a terminal state'); END;
CREATE TRIGGER task_done_only_superseded BEFORE UPDATE OF state ON tasks
WHEN OLD.state = 'done' AND NEW.state NOT IN ('done','superseded')
BEGIN SELECT RAISE(ABORT, 'a done task can only be superseded'); END;

CREATE TABLE task_dependencies (
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  PRIMARY KEY (project_id, task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id),
  FOREIGN KEY (project_id, depends_on_task_id) REFERENCES tasks(project_id, id)
) STRICT;

CREATE TABLE task_holds (
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('input','dependency','cross-team','decision','capacity','budget','permission')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  ref_kind TEXT,
  ref_id TEXT,
  since TEXT NOT NULL,
  needs_action INTEGER NOT NULL CHECK (needs_action IN (0,1)),
  PRIMARY KEY (project_id, task_id, kind),
  CHECK ((ref_kind IS NULL) = (ref_id IS NULL)),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id)
) STRICT;

-- ---- Execution -----------------------------------------------------------------------------------
CREATE TABLE attempts (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  epoch INTEGER NOT NULL CHECK (epoch > 0),
  state TEXT NOT NULL CHECK (state IN ('queued','leased','preparing','running','waiting-input','parked',
    'stopping','stopped','submitting','succeeded','failed','lease-expired','unknown','reconciling','requeued')),
  outcome TEXT NOT NULL CHECK (outcome IN ('known','unknown')),
  node_id TEXT REFERENCES nodes(id),
  runtime TEXT NOT NULL CHECK (runtime IN ('fake','native-opencode','api-agent','acp')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL CHECK (effort IN ('low','medium','high','xhigh')),
  lease_id TEXT UNIQUE,
  lease_expires_at TEXT,
  started_at TEXT,
  ended_at TEXT,
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, task_id, epoch),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id),
  -- queued attempts are not placed; held states always carry a lease and a node.
  CHECK (state <> 'queued' OR (node_id IS NULL AND lease_id IS NULL)),
  CHECK (state NOT IN ('leased','preparing','running','waiting-input','stopping','submitting')
    OR (node_id IS NOT NULL AND lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((state = 'unknown') = (outcome = 'unknown') OR state IN ('reconciling','lease-expired')),
  CHECK (state NOT IN ('succeeded','failed','stopped','requeued') OR ended_at IS NOT NULL)
) STRICT;
-- At most ONE live attempt per task. An unknown outcome counts as live: it blocks a second attempt.
CREATE UNIQUE INDEX one_live_attempt_per_task ON attempts(project_id, task_id)
  WHERE state IN ('queued','leased','preparing','running','waiting-input','stopping','submitting',
                  'lease-expired','unknown','reconciling');
CREATE INDEX attempt_lease_expiry ON attempts(lease_expires_at) WHERE lease_id IS NOT NULL;

CREATE TRIGGER attempt_terminal_is_final BEFORE UPDATE OF state ON attempts
WHEN OLD.state IN ('succeeded','failed','stopped','parked','requeued') AND NEW.state <> OLD.state
BEGIN SELECT RAISE(ABORT, 'attempt is in a terminal state'); END;
-- Fencing: the epoch of an attempt never moves backwards or changes.
CREATE TRIGGER attempt_epoch_is_fixed BEFORE UPDATE OF epoch ON attempts
WHEN NEW.epoch <> OLD.epoch
BEGIN SELECT RAISE(ABORT, 'attempt epoch is immutable'); END;

-- ---- Knowledge -----------------------------------------------------------------------------------
CREATE TABLE artifact_versions (
  project_id TEXT NOT NULL REFERENCES projects(id),
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  media_type TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  status TEXT NOT NULL CHECK (status IN ('draft','in-review','reviewed','approved','rejected','superseded','withdrawn')),
  abstract_l0 TEXT NOT NULL CHECK (length(abstract_l0) BETWEEN 1 AND 400),
  abstract_l1 TEXT,
  produced_by_attempt_id TEXT,
  supersedes_version INTEGER,
  visibility TEXT NOT NULL CHECK (visibility IN ('team-draft','project','organization')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, artifact_id, version),
  CHECK (supersedes_version IS NULL OR supersedes_version < version),
  CHECK (status <> 'approved' OR visibility <> 'team-draft'),
  FOREIGN KEY (project_id, artifact_id, supersedes_version)
    REFERENCES artifact_versions(project_id, artifact_id, version),
  FOREIGN KEY (project_id, produced_by_attempt_id) REFERENCES attempts(project_id, id)
) STRICT;
CREATE INDEX artifact_hash ON artifact_versions(project_id, content_hash);

-- Content is immutable: only the review status may move. A new content hash is a new version.
CREATE TRIGGER artifact_content_is_immutable BEFORE UPDATE ON artifact_versions
WHEN NEW.content_hash <> OLD.content_hash OR NEW.size_bytes <> OLD.size_bytes
  OR NEW.abstract_l0 <> OLD.abstract_l0 OR NEW.version <> OLD.version OR NEW.artifact_id <> OLD.artifact_id
BEGIN SELECT RAISE(ABORT, 'artifact version content is immutable'); END;
CREATE TRIGGER artifact_approved_only_superseded BEFORE UPDATE OF status ON artifact_versions
WHEN OLD.status = 'approved' AND NEW.status NOT IN ('approved','superseded')
BEGIN SELECT RAISE(ABORT, 'an approved version can only be superseded'); END;
CREATE TRIGGER artifact_final_status BEFORE UPDATE OF status ON artifact_versions
WHEN OLD.status IN ('superseded','rejected','withdrawn') AND NEW.status <> OLD.status
BEGIN SELECT RAISE(ABORT, 'artifact version status is final'); END;

CREATE TABLE artifact_inputs (
  project_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  input_artifact_id TEXT NOT NULL,
  input_version INTEGER NOT NULL,
  PRIMARY KEY (project_id, artifact_id, version, input_artifact_id, input_version),
  FOREIGN KEY (project_id, artifact_id, version) REFERENCES artifact_versions(project_id, artifact_id, version),
  FOREIGN KEY (project_id, input_artifact_id, input_version) REFERENCES artifact_versions(project_id, artifact_id, version)
) STRICT;

-- ---- Approval (the only question-and-answer mechanism) -------------------------------------------
CREATE TABLE approvals (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  kind TEXT NOT NULL CHECK (kind IN ('question','review','start-gate')),
  task_id TEXT,
  subject TEXT NOT NULL,
  summary TEXT NOT NULL,
  options_json TEXT NOT NULL CHECK (json_valid(options_json) AND json_array_length(options_json) BETWEEN 2 AND 6),
  recommendation TEXT,
  impact_if_waiting TEXT NOT NULL,
  context_digest TEXT NOT NULL CHECK (length(context_digest) = 64 AND context_digest NOT GLOB '*[^0-9a-f]*'),
  approver TEXT NOT NULL CHECK (approver IN ('operator','team-lead')),
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('requested','pending','approved','rejected','changes-requested',
    'superseded','expired','withdrawn','applied')),
  outcome_option_id TEXT,
  outcome_actor_id TEXT,
  decided_at TEXT,
  applied_by_command_id TEXT UNIQUE, -- exactly-once application
  PRIMARY KEY (project_id, id),
  CHECK (kind <> 'start-gate' OR task_id IS NOT NULL),
  CHECK (expires_at > requested_at),
  -- a decision exists iff the state is a decided one
  CHECK ((state IN ('approved','rejected','changes-requested','applied')) = (outcome_option_id IS NOT NULL)),
  CHECK ((outcome_option_id IS NULL) = (outcome_actor_id IS NULL AND decided_at IS NULL)),
  CHECK ((state = 'applied') = (applied_by_command_id IS NOT NULL)),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id)
) STRICT;
CREATE INDEX approval_inbox ON approvals(project_id, state, expires_at);

CREATE TRIGGER approval_final BEFORE UPDATE OF state ON approvals
WHEN OLD.state IN ('rejected','changes-requested','superseded','expired','withdrawn','applied') AND NEW.state <> OLD.state
BEGIN SELECT RAISE(ABORT, 'approval is final'); END;
CREATE TRIGGER approval_applied_after_approved BEFORE UPDATE OF state ON approvals
WHEN NEW.state = 'applied' AND OLD.state <> 'approved'
BEGIN SELECT RAISE(ABORT, 'only an approved approval can be applied'); END;
-- A decision, once made, is never rewritten.
CREATE TRIGGER approval_decision_immutable BEFORE UPDATE OF outcome_option_id ON approvals
WHEN OLD.outcome_option_id IS NOT NULL AND NEW.outcome_option_id IS NOT OLD.outcome_option_id
BEGIN SELECT RAISE(ABORT, 'approval decision is immutable'); END;

-- ---- Effects: the only side-effect gateway ---------------------------------------------------------
CREATE TABLE effects (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('git.push-branch')),
  idempotency_key TEXT NOT NULL,
  target_json TEXT NOT NULL CHECK (json_valid(target_json)),
  state TEXT NOT NULL CHECK (state IN ('pending','done','failed','unknown')),
  error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, idempotency_key),
  FOREIGN KEY (project_id, attempt_id) REFERENCES attempts(project_id, id),
  -- Never push to the default branch.
  CHECK (kind <> 'git.push-branch'
    OR lower(replace(json_extract(target_json, '$.branch'), 'refs/heads/', '')) NOT IN ('main','master')),
  CHECK (state <> 'failed' OR (error IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK (state <> 'done' OR completed_at IS NOT NULL)
) STRICT;
CREATE TRIGGER effect_unknown_resolves_only_forward BEFORE UPDATE OF state ON effects
WHEN OLD.state = 'unknown' AND NEW.state NOT IN ('unknown','done','failed')
BEGIN SELECT RAISE(ABORT, 'an unknown effect is reconciled, never retried blindly'); END;
CREATE TRIGGER effect_final BEFORE UPDATE OF state ON effects
WHEN OLD.state = 'done' AND NEW.state <> 'done'
BEGIN SELECT RAISE(ABORT, 'a completed effect is final'); END;

-- ---- Usage and budget ------------------------------------------------------------------------------
CREATE TABLE usage_records (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  task_id TEXT,
  attempt_id TEXT,
  conversation_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT CHECK (effort IN ('low','medium','high','xhigh')),
  -- NULL token counts mean "not reported", which is different from zero.
  input_tokens INTEGER CHECK (input_tokens >= 0),
  cached_input_tokens INTEGER CHECK (cached_input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens >= 0),
  reasoning_output_tokens INTEGER CHECK (reasoning_output_tokens >= 0),
  cost_kind TEXT NOT NULL CHECK (cost_kind IN ('known','unknown')),
  cost_amount REAL CHECK (cost_amount >= 0),
  cost_currency TEXT,
  cost_unknown_reason TEXT,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  -- usage belongs to an attempt (task work) or to a conversation turn (Lead chat), never to nothing
  CHECK (attempt_id IS NOT NULL OR conversation_id IS NOT NULL),
  CHECK (attempt_id IS NULL OR task_id IS NOT NULL),
  -- Unknown cost is stored as unknown, never as 0.
  CHECK ((cost_kind = 'known') = (cost_amount IS NOT NULL AND cost_currency IS NOT NULL)),
  CHECK ((cost_kind = 'unknown') = (cost_unknown_reason IS NOT NULL)),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id),
  FOREIGN KEY (project_id, attempt_id) REFERENCES attempts(project_id, id),
  FOREIGN KEY (project_id, conversation_id) REFERENCES conversations(project_id, id)
) STRICT;
CREATE INDEX usage_by_task ON usage_records(project_id, task_id);
CREATE INDEX usage_by_day ON usage_records(project_id, substr(recorded_at, 1, 10));

CREATE TABLE budgets (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  scope TEXT NOT NULL CHECK (scope IN ('task','day')),
  scope_ref TEXT NOT NULL,
  limit_tokens INTEGER NOT NULL CHECK (limit_tokens > 0),
  warn_at_percent INTEGER NOT NULL CHECK (warn_at_percent BETWEEN 1 AND 99),
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, scope, scope_ref),
  CHECK (scope <> 'day' OR (length(scope_ref) = 10 AND scope_ref GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'))
) STRICT;
