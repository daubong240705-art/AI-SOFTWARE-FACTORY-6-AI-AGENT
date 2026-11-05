import type Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function migrateInboxDismissals(
  db: Database.Database,
  directory: string,
  original: number,
) {
  if ((db.pragma("user_version", { simple: true }) as number) >= 15) return;
  const backup = join(directory, "worker.schema14.pre-attention.backup.sqlite");
  if (original === 14 && !existsSync(backup))
    db.prepare("VACUUM INTO ?").run(backup);
  db.transaction(() =>
    db.exec(`
    CREATE TABLE IF NOT EXISTS inbox_dismissals(key TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,token TEXT NOT NULL,closed_at TEXT NOT NULL);
    PRAGMA user_version=15;
  `),
  )();
}
