import type Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function migrateSchedules(
  db: Database.Database,
  directory: string,
  original: number,
) {
  if ((db.pragma("user_version", { simple: true }) as number) >= 14) return;
  const backup = join(directory, "worker.schema13.pre-schedules.backup.sqlite");
  if (original === 13 && !existsSync(backup))
    db.prepare("VACUUM INTO ?").run(backup);
  db.transaction(() =>
    db.exec(`
      CREATE TABLE schedules (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        value TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
        version INTEGER NOT NULL DEFAULT 1,
        next_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX schedules_due ON schedules(enabled,next_at);
      CREATE INDEX schedules_project ON schedules(project_id,updated_at);
      CREATE TABLE schedule_deliveries (
        occurrence_key TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL REFERENCES schedules(id),
        schedule_version INTEGER NOT NULL,
        due_at TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('created','missed','failed')),
        work_item_id TEXT REFERENCES board_items(id),
        reason TEXT NOT NULL DEFAULT '',
        config TEXT NOT NULL
      );
      CREATE INDEX schedule_deliveries_schedule ON schedule_deliveries(schedule_id,due_at DESC);
      CREATE TRIGGER schedule_deliveries_immutable BEFORE UPDATE ON schedule_deliveries BEGIN SELECT RAISE(ABORT,'Schedule delivery is immutable'); END;
      CREATE TABLE schedule_control (
        id INTEGER PRIMARY KEY CHECK(id=1),
        paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
        updated_at TEXT NOT NULL
      );
      INSERT INTO schedule_control VALUES (1,0,datetime('now'));
      PRAGMA user_version=14;
    `),
  )();
}
