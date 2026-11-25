ALTER TABLE effects RENAME TO effects_0036;
DROP TRIGGER effect_unknown_resolves_only_forward;
DROP TRIGGER effect_final;
CREATE TABLE effects (
  project_id TEXT NOT NULL REFERENCES projects(id), id TEXT NOT NULL, attempt_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('git.push-branch','http.request','bundle.publish')), idempotency_key TEXT NOT NULL,
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
INSERT INTO effects SELECT * FROM effects_0036;
DROP TABLE effects_0036;
CREATE INDEX http_effect_caller ON effects(project_id, json_extract(target_json,'$.caller')) WHERE kind = 'http.request';
CREATE INDEX bundle_effect_caller ON effects(project_id, json_extract(target_json,'$.caller')) WHERE kind = 'bundle.publish';
CREATE TRIGGER effect_unknown_resolves_only_forward BEFORE UPDATE OF state ON effects
WHEN OLD.state = 'unknown' AND NEW.state NOT IN ('unknown','done','failed')
BEGIN SELECT RAISE(ABORT, 'an unknown effect is reconciled, never retried blindly'); END;
CREATE TRIGGER effect_final BEFORE UPDATE OF state ON effects
WHEN OLD.state = 'done' AND NEW.state <> 'done'
BEGIN SELECT RAISE(ABORT, 'a completed effect is final'); END;
