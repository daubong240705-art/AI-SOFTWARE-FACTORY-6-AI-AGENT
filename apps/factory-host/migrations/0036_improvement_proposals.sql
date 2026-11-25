CREATE TABLE improvement_proposals (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  flow_id TEXT NOT NULL,
  base_version INTEGER,
  base_draft_revision INTEGER NOT NULL CHECK (base_draft_revision > 0),
  state TEXT NOT NULL CHECK (state IN ('generating','ready','applied','discarded','failed')),
  source TEXT NOT NULL CHECK (source IN ('rules','ai')),
  findings_json TEXT NOT NULL CHECK (json_valid(findings_json)),
  patch_json TEXT NOT NULL CHECK (json_valid(patch_json)),
  setup_proposal_id TEXT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id,id),
  FOREIGN KEY (project_id,flow_id) REFERENCES flows(project_id,id),
  FOREIGN KEY (project_id,flow_id,base_version) REFERENCES flow_versions(project_id,flow_id,version),
  FOREIGN KEY (project_id,setup_proposal_id) REFERENCES setup_proposals(project_id,id)
) STRICT;

CREATE TABLE insight_attempt_queued (
  project_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  queued_at TEXT NOT NULL,
  PRIMARY KEY (project_id,attempt_id),
  FOREIGN KEY (project_id,attempt_id) REFERENCES attempts(project_id,id) ON DELETE CASCADE
) STRICT;
CREATE INDEX improvement_proposals_created ON improvement_proposals(project_id,created_at DESC,id DESC);

CREATE TABLE insight_node_ready (
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  attempt_no INTEGER NOT NULL,
  ready_at TEXT NOT NULL,
  PRIMARY KEY (project_id,run_id,node_id,iteration,attempt_no),
  FOREIGN KEY (project_id,run_id,node_id,iteration,attempt_no)
    REFERENCES flow_node_runs(project_id,run_id,node_id,iteration,attempt_no) ON DELETE CASCADE
) STRICT;
