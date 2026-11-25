CREATE TABLE integrations (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision > 0),
  kind TEXT NOT NULL CHECK(kind IN ('mcp-stdio','mcp-http','http-api')),
  name TEXT NOT NULL, scope_group_id TEXT REFERENCES groups(id),
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  status TEXT NOT NULL CHECK(status IN ('untested','checking','ready','error')),
  last_check_at TEXT, last_check_json TEXT CHECK(json_valid(last_check_json)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX integration_global_name ON integrations(name) WHERE scope_group_id IS NULL;
CREATE UNIQUE INDEX integration_group_name ON integrations(scope_group_id,name) WHERE scope_group_id IS NOT NULL;

CREATE TABLE credentials (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision > 0),
  name TEXT NOT NULL, scope_group_id TEXT REFERENCES groups(id),
  ciphertext BLOB NOT NULL, nonce BLOB NOT NULL CHECK(length(nonce) = 12),
  key_id TEXT NOT NULL, last4 TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE integration_tools (
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT NOT NULL, input_schema_json TEXT NOT NULL CHECK(json_valid(input_schema_json)),
  discovered_at TEXT NOT NULL, PRIMARY KEY(integration_id,name)
) STRICT;

CREATE TABLE tool_call_approvals (
  project_id TEXT NOT NULL, seat_id TEXT NOT NULL REFERENCES seats(id), call_hash TEXT NOT NULL,
  approval_id TEXT NOT NULL, consumed_at TEXT, PRIMARY KEY(project_id,seat_id,call_hash),
  FOREIGN KEY(project_id,approval_id) REFERENCES approvals(project_id,id)
) STRICT;

ALTER TABLE effects RENAME TO effects_0031;
DROP TRIGGER effect_unknown_resolves_only_forward;
DROP TRIGGER effect_final;
CREATE TABLE effects (
  project_id TEXT NOT NULL REFERENCES projects(id), id TEXT NOT NULL, attempt_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('git.push-branch','http.request')), idempotency_key TEXT NOT NULL,
  target_json TEXT NOT NULL CHECK(json_valid(target_json)),
  state TEXT NOT NULL CHECK(state IN ('pending','done','failed','unknown')), error TEXT,
  created_at TEXT NOT NULL, completed_at TEXT, output_json TEXT CHECK(json_valid(output_json)),
  PRIMARY KEY(project_id,id), UNIQUE(project_id,idempotency_key),
  FOREIGN KEY(project_id,attempt_id) REFERENCES attempts(project_id,id),
  CHECK(kind <> 'git.push-branch' OR (attempt_id IS NOT NULL AND
    lower(replace(json_extract(target_json,'$.branch'),'refs/heads/','')) NOT IN ('main','master'))),
  CHECK(state <> 'failed' OR (error IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK(state <> 'done' OR completed_at IS NOT NULL)
) STRICT;
INSERT INTO effects SELECT *,NULL FROM effects_0031;
DROP TABLE effects_0031;
CREATE INDEX http_effect_caller ON effects(project_id, json_extract(target_json,'$.caller')) WHERE kind = 'http.request';
CREATE TRIGGER effect_unknown_resolves_only_forward BEFORE UPDATE OF state ON effects
WHEN OLD.state = 'unknown' AND NEW.state NOT IN ('unknown','done','failed')
BEGIN SELECT RAISE(ABORT, 'an unknown effect is reconciled, never retried blindly'); END;
CREATE TRIGGER effect_final BEFORE UPDATE OF state ON effects
WHEN OLD.state = 'done' AND NEW.state <> 'done'
BEGIN SELECT RAISE(ABORT, 'a completed effect is final'); END;
