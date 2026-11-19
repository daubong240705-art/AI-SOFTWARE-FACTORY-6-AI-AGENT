-- 0029_agents: U1 (docs/architecture/17 §5.6). Project-scoped agents configured in the database.
-- The physical table `seats` stays the agent identity, so the foreign keys from tasks, attempts and
-- conversations remain valid. A seat with project_id NULL is a legacy pack seat; a seat with
-- config_revision NULL still takes its profile/skills/tools from the pinned pack snapshot.
-- Each project gets one hidden team of kind 'roster' that holds all its agents (dispatch keeps working
-- through engagement -> team -> seats); teams the operator sees are kind 'group' with team_members.

-- ---- Library -------------------------------------------------------------------------------------
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64 AND name NOT GLOB '*[^a-z0-9-]*' AND name NOT GLOB '-*'),
  description TEXT NOT NULL CHECK (length(description) <= 1024),
  latest_version INTEGER NOT NULL CHECK (latest_version > 0),
  trust TEXT NOT NULL CHECK (trust IN ('instructions','assets','scripts')),
  source TEXT CHECK (source IS NULL OR length(source) <= 300),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX skills_name ON skills(name);

CREATE TABLE skill_versions (
  skill_id TEXT NOT NULL REFERENCES skills(id),
  version INTEGER NOT NULL CHECK (version > 0),
  name TEXT NOT NULL,
  description TEXT NOT NULL CHECK (length(description) <= 1024),
  content TEXT NOT NULL CHECK (length(content) <= 65536),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^a-f0-9]*'),
  created_at TEXT NOT NULL,
  PRIMARY KEY (skill_id, version)
) STRICT;
CREATE INDEX skill_versions_hash ON skill_versions(sha256);

CREATE TABLE agent_templates (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  role TEXT NOT NULL CHECK (length(role) BETWEEN 1 AND 160),
  description TEXT NOT NULL CHECK (length(description) <= 2000),
  latest_revision INTEGER NOT NULL CHECK (latest_revision > 0),
  -- Set when the template was imported from packs/<key> (one template per pack seat and version).
  source_pack_key TEXT,
  source_pack_version TEXT,
  source_seat_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((source_pack_key IS NULL) = (source_pack_version IS NULL) AND (source_pack_key IS NULL) = (source_seat_name IS NULL)),
  UNIQUE (source_pack_key, source_pack_version, source_seat_name)
) STRICT;

CREATE TABLE agent_template_revisions (
  template_id TEXT NOT NULL REFERENCES agent_templates(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  config_json TEXT NOT NULL CHECK (json_valid(config_json) AND length(config_json) <= 262144),
  created_at TEXT NOT NULL,
  PRIMARY KEY (template_id, revision)
) STRICT;

-- ---- Teams ---------------------------------------------------------------------------------------
ALTER TABLE teams ADD COLUMN kind TEXT NOT NULL DEFAULT 'pack' CHECK (kind IN ('pack','roster','group'));
ALTER TABLE teams ADD COLUMN project_id TEXT REFERENCES projects(id);
ALTER TABLE teams ADD COLUMN description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000);
-- Group teams only; the roster's lead is seats.is_lead (one per team, existing index one_lead_per_team).
ALTER TABLE teams ADD COLUMN lead_agent_id TEXT REFERENCES seats(id);
CREATE UNIQUE INDEX one_roster_per_project ON teams(project_id) WHERE kind = 'roster';
CREATE INDEX teams_project ON teams(project_id, kind);

CREATE TRIGGER teams_kind_scope_insert BEFORE INSERT ON teams
WHEN (NEW.kind = 'pack') <> (NEW.project_id IS NULL) OR (NEW.kind <> 'group' AND NEW.lead_agent_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'team kind and project scope disagree'); END;
CREATE TRIGGER teams_kind_scope_update BEFORE UPDATE OF kind, project_id, lead_agent_id ON teams
WHEN (NEW.kind = 'pack') <> (NEW.project_id IS NULL) OR (NEW.kind <> 'group' AND NEW.lead_agent_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'team kind and project scope disagree'); END;

-- ---- Agents (seats) ------------------------------------------------------------------------------
ALTER TABLE seats ADD COLUMN project_id TEXT REFERENCES projects(id);
ALTER TABLE seats ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active','paused','archived','pending-approval'));
ALTER TABLE seats ADD COLUMN config_revision INTEGER CHECK (config_revision IS NULL OR config_revision > 0);
ALTER TABLE seats ADD COLUMN template_id TEXT REFERENCES agent_templates(id);
ALTER TABLE seats ADD COLUMN template_revision INTEGER CHECK (template_revision IS NULL OR template_revision > 0);
ALTER TABLE seats ADD COLUMN template_link INTEGER NOT NULL DEFAULT 0 CHECK (template_link IN (0,1));
ALTER TABLE seats ADD COLUMN created_at TEXT;
CREATE INDEX seats_project ON seats(project_id, status);

CREATE TRIGGER seats_agent_scope_insert BEFORE INSERT ON seats
WHEN (NEW.config_revision IS NOT NULL AND NEW.project_id IS NULL)
  OR ((NEW.template_id IS NULL) <> (NEW.template_revision IS NULL))
  OR (NEW.template_link = 1 AND NEW.template_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'agent scope or template link is inconsistent'); END;
CREATE TRIGGER seats_agent_scope_update BEFORE UPDATE OF project_id, config_revision, template_id, template_revision, template_link ON seats
WHEN (NEW.config_revision IS NOT NULL AND NEW.project_id IS NULL)
  OR ((NEW.template_id IS NULL) <> (NEW.template_revision IS NULL))
  OR (NEW.template_link = 1 AND NEW.template_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'agent scope or template link is inconsistent'); END;

CREATE TABLE agent_revisions (
  agent_id TEXT NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  config_json TEXT NOT NULL CHECK (json_valid(config_json) AND length(config_json) <= 262144),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 200),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, revision)
) STRICT;

CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, agent_id)
) STRICT;
CREATE INDEX team_members_agent ON team_members(agent_id);

CREATE TABLE agent_relations (
  project_id TEXT NOT NULL REFERENCES projects(id),
  from_agent_id TEXT NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  to_agent_id TEXT NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('manages','reviews','collaborates','approves')),
  PRIMARY KEY (project_id, from_agent_id, to_agent_id, kind),
  CHECK (from_agent_id <> to_agent_id)
) STRICT;
CREATE INDEX agent_relations_to ON agent_relations(project_id, to_agent_id, kind);

-- Optimistic concurrency for relations.set (the whole set is replaced at once).
CREATE TABLE agent_relation_sets (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  revision INTEGER NOT NULL CHECK (revision > 0)
) STRICT;

-- ---- Attempts pin the agent config they ran with ---------------------------------------------------
ALTER TABLE attempt_instructions ADD COLUMN agent_revision INTEGER CHECK (agent_revision IS NULL OR agent_revision > 0);
-- JSON array of {"skillId","version"} resolved at attempt start ("latest" is never stored here).
ALTER TABLE attempt_instructions ADD COLUMN skill_versions_json TEXT CHECK (skill_versions_json IS NULL OR json_valid(skill_versions_json));
