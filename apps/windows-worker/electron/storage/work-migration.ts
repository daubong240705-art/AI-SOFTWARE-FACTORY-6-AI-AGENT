import type Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export function migrateWorkItems(
  db: Database.Database,
  directory: string,
  original: number,
) {
  if ((db.pragma("user_version", { simple: true }) as number) >= 8) return;
  const backup = join(directory, "worker.schema7.pre-work-items.backup.sqlite");
  if (original === 7 && !existsSync(backup))
    db.prepare("VACUUM INTO ?").run(backup);
  db.transaction(() => {
    db.exec(`ALTER TABLE board_items ADD COLUMN criteria TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE board_items ADD COLUMN number INTEGER;
      ALTER TABLE board_items ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE board_items ADD COLUMN conversation_id TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS work_item_number ON board_items(project_id,number);
      CREATE TABLE IF NOT EXISTS work_counters(project_id TEXT PRIMARY KEY REFERENCES projects(id),next_number INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS work_revisions(item_id TEXT NOT NULL REFERENCES board_items(id),revision INTEGER NOT NULL,
        title TEXT NOT NULL,body TEXT NOT NULL,criteria TEXT NOT NULL,created_at TEXT NOT NULL,origin TEXT NOT NULL,
        PRIMARY KEY(item_id,revision));
      CREATE TABLE IF NOT EXISTS work_submissions(id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES board_items(id),
        revision INTEGER NOT NULL,request_key TEXT NOT NULL UNIQUE,request_version INTEGER NOT NULL,
        run_id TEXT REFERENCES runs(id),current_run_id TEXT REFERENCES runs(id),follow_up_id TEXT UNIQUE,
        original_follow_up_id TEXT,conversation_id TEXT NOT NULL REFERENCES conversations(id),state TEXT NOT NULL,created_at TEXT NOT NULL,
        FOREIGN KEY(item_id,revision) REFERENCES work_revisions(item_id,revision));
      CREATE TABLE IF NOT EXISTS work_attempts(run_id TEXT PRIMARY KEY REFERENCES runs(id),submission_id TEXT NOT NULL REFERENCES work_submissions(id));
      CREATE TABLE IF NOT EXISTS work_comments(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,
        item_id TEXT NOT NULL REFERENCES board_items(id),body TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS work_comments_item ON work_comments(item_id,sequence);
      CREATE INDEX IF NOT EXISTS work_submissions_item ON work_submissions(item_id,created_at);
    `);
    const items = db
      .prepare("SELECT * FROM board_items ORDER BY created_at,rowid")
      .all() as {
      id: string;
      project_id: string;
      title: string;
      body: string;
      created_at: string;
      version: number;
    }[];
    const counters = new Map<string, number>();
    for (const item of items) {
      const number = (counters.get(item.project_id) ?? 0) + 1;
      counters.set(item.project_id, number);
      db.prepare("UPDATE board_items SET number=? WHERE id=?").run(
        number,
        item.id,
      );
      db.prepare(
        "INSERT OR IGNORE INTO work_revisions VALUES (?,1,?,?, '[]',?,'legacy')",
      ).run(item.id, item.title, item.body, item.created_at);
      const link = db
        .prepare("SELECT * FROM board_links WHERE item_id=?")
        .get(item.id) as
        | {
            run_id: string | null;
            follow_up_id: string | null;
            created_at: string;
          }
        | undefined;
      if (!link) continue;
      const run = link.run_id
        ? (db.prepare("SELECT value FROM runs WHERE id=?").get(link.run_id) as
            | { value: string }
            | undefined)
        : undefined;
      const queued = link.follow_up_id
        ? (db
            .prepare("SELECT conversation_id FROM follow_ups WHERE id=?")
            .get(link.follow_up_id) as { conversation_id: string } | undefined)
        : undefined;
      const value = run ? JSON.parse(run.value) : null;
      let conversation = value?.conversationId ?? queued?.conversation_id;
      if (
        !conversation ||
        !db
          .prepare("SELECT id FROM conversations WHERE id=? AND project_id=?")
          .get(conversation, item.project_id)
      ) {
        // Older run-only links may predate conversations. Attach a new empty
        // discussion without rewriting any historical run or its prompt.
        conversation = randomUUID();
        db.prepare(
          "INSERT INTO conversations (id,project_id,title,created_at,updated_at,draft) VALUES (?,?,?,?,?,'')",
        ).run(
          conversation,
          item.project_id,
          item.title.slice(0, 100),
          item.created_at,
          item.created_at,
        );
      }
      db.prepare("UPDATE board_items SET conversation_id=? WHERE id=?").run(
        conversation,
        item.id,
      );
      const submission = randomUUID();
      db.prepare(
        "INSERT INTO work_submissions VALUES (?,?,1,?,?,?,?,?,?,?,?,?)",
      ).run(
        submission,
        item.id,
        `legacy:${item.id}`,
        item.version,
        link.run_id,
        link.run_id,
        link.follow_up_id,
        link.follow_up_id,
        conversation,
        link.follow_up_id ? "queued" : "running",
        link.created_at,
      );
      if (value) {
        const root = value.attemptRoot ?? value.id;
        const attempts = db
          .prepare(
            "SELECT id FROM runs WHERE project_id=? AND COALESCE(json_extract(value,'$.attemptRoot'),id)=?",
          )
          .all(item.project_id, root) as { id: string }[];
        for (const attempt of attempts)
          db.prepare("INSERT OR IGNORE INTO work_attempts VALUES (?,?)").run(
            attempt.id,
            submission,
          );
      }
    }
    for (const [project, n] of counters)
      db.prepare("INSERT OR REPLACE INTO work_counters VALUES (?,?)").run(
        project,
        n + 1,
      );
    db.pragma("user_version=8");
  })();
}
