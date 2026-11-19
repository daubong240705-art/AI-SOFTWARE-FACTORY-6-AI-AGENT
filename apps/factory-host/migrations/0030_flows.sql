CREATE TABLE flows (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  draft_json TEXT NOT NULL CHECK (json_valid(draft_json) AND length(CAST(draft_json AS BLOB)) <= 524288),
  archived INTEGER NOT NULL CHECK (archived IN (0,1)),
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id,id), UNIQUE (project_id,key)
) STRICT;

CREATE TABLE flow_versions (
  project_id TEXT NOT NULL,
  flow_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json) AND length(CAST(definition_json AS BLOB)) <= 524288),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  actor_id TEXT NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY (project_id,flow_id,version), FOREIGN KEY (project_id,flow_id) REFERENCES flows(project_id,id)
) STRICT;

CREATE TABLE flow_runs (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  flow_id TEXT NOT NULL,
  version INTEGER,
  test INTEGER NOT NULL CHECK (test IN (0,1)),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json) AND length(CAST(definition_json AS BLOB)) <= 524288),
  inputs_json TEXT NOT NULL CHECK (json_valid(inputs_json) AND length(CAST(inputs_json AS BLOB)) <= 524288),
  pinned_json TEXT NOT NULL CHECK (json_valid(pinned_json) AND length(CAST(pinned_json AS BLOB)) <= 524288),
  mock_agents INTEGER NOT NULL CHECK (mock_agents IN (0,1)),
  state TEXT NOT NULL CHECK (state IN ('queued','running','waiting','paused','stalled','succeeded','failed','cancelled')),
  state_reason TEXT,
  trigger TEXT NOT NULL,
  parent_run_id TEXT,
  parent_node_id TEXT,
  depth INTEGER NOT NULL CHECK (depth BETWEEN 0 AND 3),
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  PRIMARY KEY (project_id,id),
  FOREIGN KEY (project_id,flow_id) REFERENCES flows(project_id,id),
  FOREIGN KEY (project_id,flow_id,version) REFERENCES flow_versions(project_id,flow_id,version),
  FOREIGN KEY (project_id,parent_run_id) REFERENCES flow_runs(project_id,id),
  CHECK ((ended_at IS NOT NULL) = (state IN ('succeeded','failed','cancelled'))),
  CHECK (test = 1 OR (version IS NOT NULL AND mock_agents = 0)),
  CHECK ((parent_run_id IS NULL) = (parent_node_id IS NULL))
) STRICT;
CREATE INDEX flow_runs_queue ON flow_runs(project_id,flow_id,state,created_at,id);

CREATE TABLE flow_node_runs (
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  iteration INTEGER NOT NULL CHECK (iteration > 0),
  attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
  state TEXT NOT NULL CHECK (state IN ('pending','ready','running','waiting','succeeded','failed','skipped','cancelled')),
  port TEXT,
  input_json TEXT CHECK (input_json IS NULL OR (json_valid(input_json) AND length(CAST(input_json AS BLOB)) <= 524288)),
  output_json TEXT CHECK (output_json IS NULL OR (json_valid(output_json) AND length(CAST(output_json AS BLOB)) <= 65536)),
  error TEXT,
  task_id TEXT,
  approval_id TEXT,
  child_run_id TEXT,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  started_at TEXT,
  ended_at TEXT,
  PRIMARY KEY (project_id,run_id,node_id,iteration,attempt_no),
  FOREIGN KEY (project_id,run_id) REFERENCES flow_runs(project_id,id),
  FOREIGN KEY (project_id,task_id) REFERENCES tasks(project_id,id),
  FOREIGN KEY (project_id,approval_id) REFERENCES approvals(project_id,id),
  FOREIGN KEY (project_id,child_run_id) REFERENCES flow_runs(project_id,id)
) STRICT;
CREATE INDEX flow_node_approvals ON flow_node_runs(project_id,approval_id) WHERE approval_id IS NOT NULL;

CREATE TABLE flow_edge_state (
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  edge_id TEXT NOT NULL,
  iteration INTEGER NOT NULL CHECK (iteration > 0),
  fired INTEGER NOT NULL CHECK (fired IN (0,1)),
  PRIMARY KEY (project_id,run_id,edge_id,iteration),
  FOREIGN KEY (project_id,run_id) REFERENCES flow_runs(project_id,id)
) STRICT;

CREATE TABLE flow_timers (
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  iteration INTEGER NOT NULL CHECK (iteration > 0),
  kind TEXT NOT NULL CHECK (kind IN ('wait','node-timeout','run-timeout','retry-backoff','approval-timeout')),
  due_at TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
  PRIMARY KEY (project_id,run_id,node_id,iteration,kind),
  FOREIGN KEY (project_id,run_id) REFERENCES flow_runs(project_id,id)
) STRICT;
CREATE INDEX flow_timers_due ON flow_timers(due_at,project_id,run_id) WHERE done = 0;

CREATE TABLE flow_tasks (
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  iteration INTEGER NOT NULL CHECK (iteration > 0),
  role TEXT NOT NULL CHECK (role IN ('agent','orchestrator','subtask')),
  PRIMARY KEY (project_id,task_id),
  FOREIGN KEY (project_id,task_id) REFERENCES tasks(project_id,id),
  FOREIGN KEY (project_id,run_id) REFERENCES flow_runs(project_id,id)
) STRICT;
CREATE INDEX flow_tasks_run ON flow_tasks(project_id,run_id,node_id,iteration);

CREATE TABLE flow_approvers (
  project_id TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES seats(id),
  PRIMARY KEY (project_id,approval_id),
  FOREIGN KEY (project_id,approval_id) REFERENCES approvals(project_id,id)
) STRICT;

CREATE TABLE flow_task_results (
  project_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 32768),
  PRIMARY KEY (project_id,attempt_id),
  FOREIGN KEY (project_id,attempt_id) REFERENCES attempts(project_id,id)
) STRICT;
