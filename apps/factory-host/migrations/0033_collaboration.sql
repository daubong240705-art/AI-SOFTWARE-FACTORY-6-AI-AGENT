ALTER TABLE tasks ADD COLUMN created_by_agent_id TEXT REFERENCES seats(id);
ALTER TABLE tasks ADD COLUMN node_run_id TEXT;
CREATE INDEX tasks_collab_owner ON tasks(project_id, created_by_agent_id, state);
CREATE INDEX tasks_collab_node ON tasks(project_id, node_run_id);
CREATE INDEX task_dependencies_reverse ON task_dependencies(project_id, depends_on_task_id);

CREATE TABLE collab_orchestrators (
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  attempt_no INTEGER NOT NULL,
  goal TEXT NOT NULL,
  allowed_json TEXT NOT NULL CHECK (json_valid(allowed_json)),
  max_tasks INTEGER NOT NULL,
  max_depth INTEGER NOT NULL,
  budget_tokens INTEGER,
  failure_pending INTEGER NOT NULL DEFAULT 0 CHECK (failure_pending IN (0,1)),
  PRIMARY KEY (project_id, task_id),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id),
  FOREIGN KEY (project_id, run_id, node_id, iteration, attempt_no)
    REFERENCES flow_node_runs(project_id, run_id, node_id, iteration, attempt_no)
) STRICT;

CREATE TABLE collab_assignments (
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('delegation','review','decision')),
  depth INTEGER NOT NULL,
  estimate_tokens INTEGER NOT NULL,
  PRIMARY KEY (project_id, task_id),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id),
  FOREIGN KEY (project_id, source_task_id) REFERENCES tasks(project_id, id)
) STRICT;
CREATE INDEX collab_assignment_source ON collab_assignments(project_id, source_task_id, kind);

CREATE TABLE task_comments (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  author_agent_id TEXT NOT NULL REFERENCES seats(id),
  mention_agent_id TEXT REFERENCES seats(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id)
) STRICT;
CREATE INDEX task_comments_task ON task_comments(project_id, task_id, created_at);

CREATE TABLE agent_wakeups (
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES seats(id),
  task_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  due_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, task_id),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id)
) STRICT;
CREATE INDEX agent_wakeups_due ON agent_wakeups(due_at);

CREATE TABLE attempt_wakeups (
  project_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  context TEXT NOT NULL,
  last_comment_rowid INTEGER NOT NULL,
  PRIMARY KEY (project_id, attempt_id),
  FOREIGN KEY (project_id, attempt_id) REFERENCES attempts(project_id, id)
) STRICT;

CREATE TABLE collab_proposals (
  project_id TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES seats(id),
  PRIMARY KEY (project_id, approval_id),
  FOREIGN KEY (project_id, approval_id) REFERENCES approvals(project_id, id)
) STRICT;

CREATE TABLE collab_blocks (
  project_id TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  PRIMARY KEY (project_id, approval_id),
  FOREIGN KEY (project_id, approval_id) REFERENCES approvals(project_id, id),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id)
) STRICT;
CREATE INDEX collab_blocks_task ON collab_blocks(project_id, task_id);

CREATE TRIGGER collab_task_terminal AFTER UPDATE OF state ON tasks
WHEN NEW.state <> OLD.state AND NEW.state IN ('done','failed','cancelled','declined','superseded')
BEGIN
  DELETE FROM agent_wakeups WHERE project_id=NEW.project_id AND task_id=NEW.id;
  UPDATE collab_orchestrators SET failure_pending=1 WHERE project_id=NEW.project_id
    AND task_id=NEW.node_run_id AND task_id<>NEW.id AND NEW.state='failed';
  INSERT INTO agent_wakeups (project_id,agent_id,task_id,reason,due_at,created_at)
    SELECT task.project_id,task.owner_seat_id,task.id,'subtask-done','1970-01-01T00:00:00.000Z',strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM tasks task WHERE task.project_id=NEW.project_id AND task.owner_seat_id IS NOT NULL
      AND task.state IN ('ready','active','in-review') AND (task.id=NEW.node_run_id OR task.id=(
        SELECT source_task_id FROM collab_assignments WHERE project_id=NEW.project_id AND task_id=NEW.id))
    ON CONFLICT(agent_id,task_id) DO UPDATE SET due_at=min(agent_wakeups.due_at,excluded.due_at),
      reason=CASE WHEN instr(',' || agent_wakeups.reason || ',',',subtask-done,')=0 THEN agent_wakeups.reason || ',subtask-done' ELSE agent_wakeups.reason END;
  INSERT INTO agent_wakeups (project_id,agent_id,task_id,reason,due_at,created_at)
    SELECT task.project_id,task.owner_seat_id,task.id,'dependency-done','1970-01-01T00:00:00.000Z',strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM task_dependencies dependency JOIN tasks task ON task.project_id=dependency.project_id AND task.id=dependency.task_id
    WHERE dependency.project_id=NEW.project_id AND dependency.depends_on_task_id=NEW.id AND NEW.state='done'
      AND task.state IN ('accepted','ready','active') AND task.owner_seat_id IS NOT NULL AND task.created_by_agent_id IS NOT NULL
    ON CONFLICT(agent_id,task_id) DO UPDATE SET due_at=min(agent_wakeups.due_at,excluded.due_at),
      reason=CASE WHEN instr(',' || agent_wakeups.reason || ',',',dependency-done,')=0 THEN agent_wakeups.reason || ',dependency-done' ELSE agent_wakeups.reason END;
  INSERT INTO agent_wakeups (project_id,agent_id,task_id,reason,due_at,created_at)
    SELECT t.project_id,t.owner_seat_id,t.id,'approval-answered','1970-01-01T00:00:00.000Z',strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM task_holds h JOIN tasks t ON t.project_id=h.project_id AND t.id=h.task_id
    WHERE h.project_id=NEW.project_id AND h.kind='decision' AND h.ref_kind='task' AND h.ref_id=NEW.id AND t.owner_seat_id IS NOT NULL AND t.state='active'
    ON CONFLICT(agent_id,task_id) DO UPDATE SET due_at=min(agent_wakeups.due_at,excluded.due_at),
      reason=CASE WHEN instr(',' || agent_wakeups.reason || ',',',approval-answered,')=0 THEN agent_wakeups.reason || ',approval-answered' ELSE agent_wakeups.reason END;
END;

CREATE TRIGGER collab_approval_answered AFTER UPDATE OF outcome_option_id ON approvals
WHEN NEW.kind='question' AND OLD.outcome_option_id IS NULL AND NEW.outcome_option_id IS NOT NULL
BEGIN
  INSERT INTO agent_wakeups (project_id,agent_id,task_id,reason,due_at,created_at)
    SELECT project_id,owner_seat_id,id,'approval-answered',NEW.decided_at,NEW.decided_at FROM tasks
    WHERE project_id=NEW.project_id AND owner_seat_id IS NOT NULL AND state='active' AND (id=NEW.task_id OR id IN (
      SELECT task_id FROM collab_blocks WHERE project_id=NEW.project_id AND approval_id=NEW.id))
    ON CONFLICT(agent_id,task_id) DO UPDATE SET due_at=min(agent_wakeups.due_at,excluded.due_at),
      reason=CASE WHEN instr(',' || agent_wakeups.reason || ',',',approval-answered,')=0 THEN agent_wakeups.reason || ',approval-answered' ELSE agent_wakeups.reason END;
  UPDATE seats SET status='active', revision=revision+1 WHERE project_id=NEW.project_id AND status='pending-approval'
    AND NEW.outcome_option_id='approve' AND id=(SELECT agent_id FROM collab_proposals
      WHERE project_id=NEW.project_id AND approval_id=NEW.id);
  UPDATE seats SET status='archived', revision=revision+1 WHERE project_id=NEW.project_id AND status='pending-approval'
    AND NEW.outcome_option_id='reject' AND id=(SELECT agent_id FROM collab_proposals
      WHERE project_id=NEW.project_id AND approval_id=NEW.id);
END;

CREATE TRIGGER collab_release_block AFTER UPDATE OF state ON approvals
WHEN OLD.state='pending' AND NEW.state IN ('expired','withdrawn','superseded')
BEGIN
  INSERT INTO agent_wakeups (project_id,agent_id,task_id,reason,due_at,created_at)
    SELECT t.project_id,t.owner_seat_id,t.id,'approval-answered','1970-01-01T00:00:00.000Z',strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM collab_blocks b JOIN tasks t ON t.project_id=b.project_id AND t.id=b.task_id
    WHERE b.project_id=NEW.project_id AND b.approval_id=NEW.id AND t.state='active' AND t.owner_seat_id IS NOT NULL
    ON CONFLICT(agent_id,task_id) DO UPDATE SET due_at=min(agent_wakeups.due_at,excluded.due_at),
      reason=CASE WHEN instr(',' || agent_wakeups.reason || ',',',approval-answered,')=0 THEN agent_wakeups.reason || ',approval-answered' ELSE agent_wakeups.reason END;
END;
