CREATE TABLE setup_proposals (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  state TEXT NOT NULL CHECK (state IN ('generating','ready','invalid','applied','discarded','failed')),
  request TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('project','flow')),
  flow_id TEXT,
  flow_revision INTEGER,
  proposal_json TEXT CHECK (json_valid(proposal_json)),
  issues_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(issues_json)),
  applied_json TEXT CHECK (json_valid(applied_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  CHECK ((flow_id IS NULL) = (flow_revision IS NULL)),
  CHECK (flow_id IS NULL OR mode = 'flow')
) STRICT;
CREATE INDEX setup_proposals_pending ON setup_proposals(state, created_at, id);

ALTER TABLE usage_records RENAME TO usage_records_before_setup;
CREATE TABLE usage_records (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  task_id TEXT,
  attempt_id TEXT,
  conversation_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT CHECK (effort IN ('low','medium','high','xhigh')),
  input_tokens INTEGER CHECK (input_tokens >= 0),
  cached_input_tokens INTEGER CHECK (cached_input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens >= 0),
  reasoning_output_tokens INTEGER CHECK (reasoning_output_tokens >= 0),
  cost_kind TEXT NOT NULL CHECK (cost_kind IN ('known','unknown')),
  cost_amount REAL CHECK (cost_amount >= 0),
  cost_currency TEXT,
  cost_unknown_reason TEXT,
  recorded_at TEXT NOT NULL,
  estimated_tokens INTEGER CHECK (estimated_tokens IS NULL OR estimated_tokens >= 0),
  setup_proposal_id TEXT,
  PRIMARY KEY (project_id, id),
  CHECK (attempt_id IS NOT NULL OR conversation_id IS NOT NULL OR setup_proposal_id IS NOT NULL),
  CHECK (attempt_id IS NULL OR task_id IS NOT NULL),
  CHECK (setup_proposal_id IS NULL OR (task_id IS NULL AND attempt_id IS NULL AND conversation_id IS NULL)),
  CHECK ((cost_kind = 'known') = (cost_amount IS NOT NULL AND cost_currency IS NOT NULL)),
  CHECK ((cost_kind = 'unknown') = (cost_unknown_reason IS NOT NULL)),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id),
  FOREIGN KEY (project_id, attempt_id) REFERENCES attempts(project_id, id),
  FOREIGN KEY (project_id, conversation_id) REFERENCES conversations(project_id, id),
  FOREIGN KEY (project_id, setup_proposal_id) REFERENCES setup_proposals(project_id, id)
) STRICT;
INSERT INTO usage_records SELECT *, NULL FROM usage_records_before_setup;
DROP TABLE usage_records_before_setup;
CREATE INDEX usage_by_task ON usage_records(project_id, task_id);
CREATE INDEX usage_by_day ON usage_records(project_id, substr(recorded_at, 1, 10));
CREATE INDEX usage_by_setup ON usage_records(project_id, setup_proposal_id) WHERE setup_proposal_id IS NOT NULL;
