CREATE TABLE workflow_instances (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  key TEXT NOT NULL,
  pack_key TEXT NOT NULL,
  pack_version TEXT NOT NULL,
  definition_revision INTEGER NOT NULL CHECK (definition_revision >= 1),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json) AND length(definition_json) <= 262144),
  params_json TEXT NOT NULL CHECK (json_valid(params_json)),
  title TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('draft','proposed','active','awaiting-approval','paused','resuming','suspended','stalled','completed','failed','cancelled','superseded')),
  state_reason TEXT CHECK (state_reason IS NULL OR length(state_reason) <= 500),
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  PRIMARY KEY (project_id, id),
  CHECK ((ended_at IS NOT NULL) = (state IN ('completed','failed','cancelled','superseded')))
) STRICT;

CREATE TABLE workflow_stages (
  project_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  stage_key TEXT NOT NULL,
  phase TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','ready','active','done','skipped','failed','blocked')),
  optional INTEGER NOT NULL CHECK (optional IN (0,1)),
  loop_count INTEGER NOT NULL DEFAULT 0 CHECK (loop_count BETWEEN 0 AND 10),
  PRIMARY KEY (project_id, instance_id, stage_key),
  FOREIGN KEY (project_id, instance_id) REFERENCES workflow_instances(project_id, id)
) STRICT;
CREATE INDEX workflow_instances_project_state ON workflow_instances(project_id, state);
