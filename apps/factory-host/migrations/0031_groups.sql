CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  parent_id TEXT REFERENCES groups(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  depth INTEGER NOT NULL CHECK (depth BETWEEN 1 AND 5),
  archived INTEGER NOT NULL CHECK (archived IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (parent_id, slug)
) STRICT;

CREATE TABLE group_settings (
  group_id TEXT PRIMARY KEY REFERENCES groups(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json))
) STRICT;

ALTER TABLE projects ADD COLUMN group_id TEXT REFERENCES groups(id);
ALTER TABLE skills ADD COLUMN group_id TEXT REFERENCES groups(id);
ALTER TABLE agent_templates ADD COLUMN group_id TEXT REFERENCES groups(id);
CREATE INDEX projects_group ON projects(group_id);
CREATE INDEX skills_group ON skills(group_id);
CREATE INDEX agent_templates_group ON agent_templates(group_id);
