-- 0002_dispatch (M2 S2): attempt ownership and the attempt event log. Appended after 0001 was applied
-- to real databases: never edit 0001 again, add a new numbered migration instead.
-- Which seat an attempt runs for (attempts has no seat column and 0001 must not change).
CREATE TABLE attempt_seats (
  project_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  seat_id TEXT NOT NULL REFERENCES seats(id),
  PRIMARY KEY (project_id, attempt_id),
  FOREIGN KEY (project_id, attempt_id) REFERENCES attempts(project_id, id)
) STRICT;
CREATE INDEX attempt_seats_by_seat ON attempt_seats(seat_id);

-- Progress, output, evidence and state changes of an attempt, in order.
CREATE TABLE attempt_events (
  project_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq > 0),
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('progress','output','evidence','question','usage','state')),
  body_json TEXT NOT NULL CHECK (json_valid(body_json)),
  PRIMARY KEY (project_id, attempt_id, seq),
  FOREIGN KEY (project_id, attempt_id) REFERENCES attempts(project_id, id)
) STRICT;
