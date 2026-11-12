CREATE TABLE model_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lead_model TEXT NOT NULL,
  lead_effort TEXT NOT NULL CHECK (lead_effort IN ('low','medium','high','xhigh')),
  agent_models TEXT NOT NULL CHECK (json_valid(agent_models) AND json_type(agent_models) = 'array' AND json_array_length(agent_models) BETWEEN 1 AND 8),
  revision INTEGER NOT NULL CHECK (revision > 0),
  updated_at TEXT NOT NULL
) STRICT;

-- CHECK constraints cannot use json_each subqueries.
CREATE TRIGGER model_settings_models_insert BEFORE INSERT ON model_settings
WHEN EXISTS (SELECT 1 FROM json_each(NEW.agent_models) WHERE type != 'text' OR length(value) NOT BETWEEN 1 AND 256)
  OR (SELECT count(*) FROM json_each(NEW.agent_models)) != (SELECT count(DISTINCT value) FROM json_each(NEW.agent_models))
BEGIN SELECT RAISE(ABORT, 'invalid agent models'); END;
CREATE TRIGGER model_settings_models_update BEFORE UPDATE OF agent_models ON model_settings
WHEN EXISTS (SELECT 1 FROM json_each(NEW.agent_models) WHERE type != 'text' OR length(value) NOT BETWEEN 1 AND 256)
  OR (SELECT count(*) FROM json_each(NEW.agent_models)) != (SELECT count(DISTINCT value) FROM json_each(NEW.agent_models))
BEGIN SELECT RAISE(ABORT, 'invalid agent models'); END;
