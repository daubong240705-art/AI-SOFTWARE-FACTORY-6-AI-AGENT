-- No table references budgets. Rebuild under the runner's BEGIN IMMEDIATE with
-- foreign_keys ON; the runner checks foreign_key_check before committing.
CREATE TABLE budgets_new (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  scope TEXT NOT NULL CHECK (scope IN ('task','day','project','engagement')),
  scope_ref TEXT NOT NULL,
  limit_tokens INTEGER NOT NULL CHECK (limit_tokens > 0),
  warn_at_percent INTEGER NOT NULL CHECK (warn_at_percent BETWEEN 1 AND 99),
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, scope, scope_ref),
  CHECK (scope <> 'day' OR (length(scope_ref) = 10 AND scope_ref GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'))
) STRICT;
INSERT INTO budgets_new (project_id, id, revision, scope, scope_ref, limit_tokens, warn_at_percent)
  SELECT project_id, id, revision, scope, scope_ref, limit_tokens, warn_at_percent FROM budgets;
DROP TABLE budgets;
ALTER TABLE budgets_new RENAME TO budgets;

CREATE TABLE autonomy_settings (
  project_id TEXT NOT NULL REFERENCES projects(id),
  subject TEXT NOT NULL CHECK (subject IN ('project','team')),
  subject_ref TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 4),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, subject, subject_ref),
  CHECK (subject <> 'project' OR subject_ref = project_id)
) STRICT;
