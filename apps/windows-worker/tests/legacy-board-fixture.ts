import type Database from "better-sqlite3";

/** Remove only UX-02 schema from a disposable test DB before testing older migrations. */
export function stripWorkSchema(db: Database.Database) {
  db.exec(`DROP TABLE question_sets; DROP TABLE chat_requests; DROP TABLE work_comments; DROP TABLE work_attempts; DROP TABLE work_submissions;
    DROP TABLE work_revisions; DROP TABLE work_counters; DROP INDEX work_item_number;
    ALTER TABLE board_items DROP COLUMN criteria;
    ALTER TABLE board_items DROP COLUMN number;
    ALTER TABLE board_items DROP COLUMN revision;
    ALTER TABLE board_items DROP COLUMN conversation_id;`);
}
