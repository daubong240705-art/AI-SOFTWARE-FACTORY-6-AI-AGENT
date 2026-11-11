CREATE TABLE workflow_stage_tasks (
  project_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  stage_key TEXT NOT NULL,
  iteration INTEGER NOT NULL CHECK (iteration >= 1),
  task_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, instance_id, stage_key, iteration, task_id),
  FOREIGN KEY (project_id, instance_id, stage_key) REFERENCES workflow_stages(project_id, instance_id, stage_key),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id),
  UNIQUE (project_id, task_id)
) STRICT;

ALTER TABLE workflow_stages ADD COLUMN blocked_reason TEXT;
ALTER TABLE workflow_stages ADD COLUMN engagement_id TEXT;
