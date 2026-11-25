ALTER TABLE projects ADD COLUMN lead_chat_mode TEXT NOT NULL DEFAULT 'auto' CHECK (lead_chat_mode IN ('auto','classic'));

CREATE TABLE lead_summaries (
  project_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  through_ordinal INTEGER NOT NULL CHECK (through_ordinal > 0),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 6000),
  PRIMARY KEY (project_id, conversation_id),
  FOREIGN KEY (project_id, conversation_id) REFERENCES conversations(project_id, id)
) STRICT;

CREATE TABLE lead_briefs (
  project_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  PRIMARY KEY (project_id, conversation_id, topic),
  FOREIGN KEY (project_id, conversation_id) REFERENCES conversations(project_id, id)
) STRICT;
