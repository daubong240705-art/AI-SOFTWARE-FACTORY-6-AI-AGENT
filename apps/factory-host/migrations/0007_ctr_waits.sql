-- Blocking cross-team requests: a durable record of who waits for which request.
-- task_holds keeps its one-hold-per-kind primary key: a waiter has ONE 'cross-team' hold (ref = its
-- earliest unresolved wait) and ctr_waits lists every wait; the hold goes when the last wait is resolved.
CREATE TABLE ctr_waits (
  project_id TEXT NOT NULL,
  waiter_task_id TEXT NOT NULL,
  ctr_task_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  since TEXT NOT NULL,
  resolved_at TEXT,
  outcome TEXT CHECK (outcome IN ('delivered','declined','cancelled','expired','timed-out')),
  PRIMARY KEY (project_id, waiter_task_id, ctr_task_id),
  FOREIGN KEY (project_id, waiter_task_id) REFERENCES tasks(project_id, id),
  FOREIGN KEY (project_id, ctr_task_id) REFERENCES tasks(project_id, id),
  FOREIGN KEY (project_id, attempt_id) REFERENCES attempts(project_id, id),
  CHECK ((resolved_at IS NULL) = (outcome IS NULL))
) STRICT;
CREATE INDEX ctr_waits_by_request ON ctr_waits(project_id, ctr_task_id);
