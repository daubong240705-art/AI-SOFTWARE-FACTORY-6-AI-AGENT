CREATE TABLE workflow_patches (
  project_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  id TEXT NOT NULL,
  number INTEGER NOT NULL CHECK (number >= 1),
  proposed_by TEXT NOT NULL CHECK (proposed_by IN ('operator','lead')),
  source_task_id TEXT,
  reason TEXT NOT NULL CHECK (length(reason) <= 500),
  ops_json TEXT NOT NULL CHECK (json_valid(ops_json) AND length(ops_json) <= 65536),
  policy TEXT NOT NULL CHECK (policy IN ('auto','approval','operator')),
  state TEXT NOT NULL CHECK (state IN ('applied','pending','rejected','refused')),
  refusal TEXT CHECK (refusal IS NULL OR length(refusal) <= 300),
  decided_by TEXT,
  decided_at TEXT,
  comment TEXT CHECK (comment IS NULL OR length(comment) <= 500),
  created_at TEXT NOT NULL,
  applied_revision INTEGER,
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, instance_id, number),
  FOREIGN KEY (project_id, instance_id) REFERENCES workflow_instances(project_id, id)
) STRICT;

ALTER TABLE workflow_stages ADD COLUMN extra_tasks INTEGER NOT NULL DEFAULT 0 CHECK (extra_tasks BETWEEN 0 AND 20);
ALTER TABLE workflow_stages ADD COLUMN extra_titles TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(extra_titles));
