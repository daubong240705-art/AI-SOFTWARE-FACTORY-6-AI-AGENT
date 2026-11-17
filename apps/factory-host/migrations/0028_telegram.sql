CREATE TABLE telegram_state (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE telegram_callbacks (
  short_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, approval_id TEXT NOT NULL,
  message_id INTEGER, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE telegram_prompts (
  message_id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, short_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;
