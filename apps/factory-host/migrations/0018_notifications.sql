CREATE TABLE notifications (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('action','important','digest')),
  urgency TEXT NOT NULL CHECK (urgency IN ('normal','urgent')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (length(body) <= 1000),
  entity_kind TEXT,
  entity_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('unread','read','dismissed')),
  created_at TEXT NOT NULL,
  read_at TEXT,
  PRIMARY KEY (project_id,id),
  UNIQUE (project_id,dedup_key),
  CHECK ((state='unread') = (read_at IS NULL))
) STRICT;
CREATE TABLE notification_deliveries (
  project_id TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','sent','held-quiet','failed')),
  attempts INTEGER NOT NULL CHECK (attempts >= 0),
  last_attempt_at TEXT,
  deliver_after TEXT,
  error_kind TEXT,
  PRIMARY KEY (project_id,notification_id,channel),
  FOREIGN KEY (project_id,notification_id) REFERENCES notifications(project_id,id)
) STRICT;
CREATE INDEX notifications_inbox ON notifications(project_id,state,created_at DESC);
