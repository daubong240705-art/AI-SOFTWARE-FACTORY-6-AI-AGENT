CREATE TABLE trace_spans (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  parent_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('request','flow-run','node-run','task','attempt','tool-call','effect','approval','artifact')),
  ref TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  tokens INTEGER CHECK (tokens >= 0),
  detail_json TEXT NOT NULL CHECK (json_valid(detail_json)),
  PRIMARY KEY (project_id,id),
  UNIQUE (project_id,kind,ref),
  CHECK (kind <> 'request' OR parent_id IS NULL),
  CHECK ((parent_id IS NULL) = (id = trace_id)),
  FOREIGN KEY (project_id,trace_id) REFERENCES trace_spans(project_id,id),
  FOREIGN KEY (project_id,parent_id) REFERENCES trace_spans(project_id,id)
) STRICT;
CREATE INDEX trace_spans_tree ON trace_spans(project_id,trace_id,started_at,id);
CREATE INDEX trace_spans_roots ON trace_spans(project_id,started_at DESC,id DESC) WHERE parent_id IS NULL;
CREATE INDEX trace_spans_parent ON trace_spans(project_id,parent_id);
CREATE INDEX trace_spans_recency ON trace_spans(project_id,ended_at DESC,started_at DESC);

CREATE TABLE tool_calls (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  agent_id TEXT REFERENCES seats(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','error','denied','ask-pending')),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  args_bytes INTEGER NOT NULL CHECK (args_bytes >= 0),
  result_bytes INTEGER NOT NULL CHECK (result_bytes >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id,id),
  FOREIGN KEY (project_id,attempt_id) REFERENCES attempts(project_id,id)
) STRICT;
CREATE INDEX tool_calls_recent ON tool_calls(project_id,created_at DESC,id DESC);
CREATE INDEX trace_usage_attempt ON usage_records(project_id,attempt_id) WHERE attempt_id IS NOT NULL;
CREATE INDEX trace_usage_day ON usage_records(project_id,recorded_at);
CREATE INDEX trace_chat_request ON trace_spans(project_id,json_extract(detail_json,'$.targetId')) WHERE kind='request';
CREATE INDEX trace_event_time ON event_log(json_extract(body_json,'$.occurredAt'));
