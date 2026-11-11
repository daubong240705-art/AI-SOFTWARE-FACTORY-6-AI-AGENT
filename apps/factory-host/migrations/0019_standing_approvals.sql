CREATE TABLE standing_approvals (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  action_kind TEXT NOT NULL CHECK (action_kind IN ('notify.send-internal','deploy.staging','artifact.publish-to-project')),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('project','team')),
  scope_ref TEXT NOT NULL,
  limit_per_day INTEGER NOT NULL CHECK (limit_per_day BETWEEN 1 AND 50),
  max_tokens_per_use INTEGER CHECK (max_tokens_per_use IS NULL OR max_tokens_per_use > 0),
  state TEXT NOT NULL CHECK (state IN ('active','revoked')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (project_id,id),
  CHECK (expires_at > created_at),
  CHECK ((state='revoked') = (revoked_at IS NOT NULL)),
  CHECK (scope_kind <> 'project' OR scope_ref = project_id)
) STRICT;

CREATE TABLE standing_approval_uses (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  standing_id TEXT NOT NULL,
  used_at TEXT NOT NULL,
  local_day TEXT NOT NULL CHECK (local_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  tokens INTEGER,
  PRIMARY KEY (project_id,id),
  FOREIGN KEY (project_id,standing_id) REFERENCES standing_approvals(project_id,id)
) STRICT;
CREATE INDEX standing_approval_uses_day ON standing_approval_uses(project_id,standing_id,local_day);
