import type Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";
export function migrateChatRequests(
  db: Database.Database,
  directory: string,
  original: number,
) {
  if ((db.pragma("user_version", { simple: true }) as number) >= 9) return;
  const backup = join(directory, "worker.schema8.pre-chat-host.backup.sqlite");
  if (original === 8 && !existsSync(backup))
    db.prepare("VACUUM INTO ?").run(backup);
  db.transaction(() =>
    db.exec(`CREATE TABLE IF NOT EXISTS chat_requests(
    request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),run_id TEXT REFERENCES runs(id),
    follow_up_id TEXT UNIQUE,state TEXT NOT NULL,created_at TEXT NOT NULL,
    work_item_id TEXT REFERENCES board_items(id));
    PRAGMA user_version=9;`),
  )();
}
