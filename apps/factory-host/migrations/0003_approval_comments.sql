-- 0003: decision comments belong to an immutable approval outcome.
CREATE TABLE approval_comments (
  project_id TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  comment TEXT NOT NULL CHECK (length(comment) <= 32000),
  PRIMARY KEY (project_id, approval_id),
  FOREIGN KEY (project_id, approval_id) REFERENCES approvals(project_id, id)
) STRICT;

CREATE TRIGGER approval_comment_immutable BEFORE UPDATE ON approval_comments
BEGIN SELECT RAISE(ABORT, 'approval comment is immutable'); END;
CREATE TRIGGER approval_comment_no_delete BEFORE DELETE ON approval_comments
BEGIN SELECT RAISE(ABORT, 'approval comment is immutable'); END;
CREATE TRIGGER approval_comment_no_replace BEFORE INSERT ON approval_comments
WHEN EXISTS (SELECT 1 FROM approval_comments WHERE project_id = NEW.project_id AND approval_id = NEW.approval_id)
BEGIN SELECT RAISE(ABORT, 'approval comment is immutable'); END;
