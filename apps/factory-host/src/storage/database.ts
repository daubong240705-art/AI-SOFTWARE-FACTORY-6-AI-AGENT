import Database from "better-sqlite3";
import type { Database as Sqlite } from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { migrate, type MigrateOptions, type MigrateResult } from "./migrate.js";

/** Tables typed so far. Modules add their own as they arrive; unlisted tables are reached via sql``. */
export interface FactoryTables {
  projects: {
    id: string;
    revision: number;
    name: string;
    workspace_kind: "git" | "directory" | "artifact";
    workspace_root: string;
    disposition: "active" | "parked" | "archived";
  };
  command_receipts: {
    command_id: string;
    project_id: string;
    actor_id: string;
    fingerprint: string;
    state: "accepted" | "completed" | "rejected" | "outcome-unknown";
    response_json: string;
    created_at: string;
  };
}

export interface Storage {
  readonly raw: Sqlite;
  readonly db: Kysely<FactoryTables>;
  readonly file: string;
  migrate(options: MigrateOptions): MigrateResult;
  close(): void;
}

export class StorageError extends Error {
  constructor(
    readonly code: "wal-unavailable" | "open-failed",
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

/**
 * Opens (creating if needed) the Host database.
 * The file MUST live on a filesystem with working shared memory (WSL ext4, NTFS): WAL on a network or
 * 9p mount silently degrades, so a file database that cannot enter WAL mode is refused, not tolerated.
 */
export function openStorage(file: string): Storage {
  const inMemory = file === ":memory:";
  let raw: Sqlite;
  try {
    if (!inMemory) mkdirSync(dirname(file), { recursive: true });
    raw = new Database(file);
  } catch (error) {
    throw new StorageError("open-failed", `cannot open database ${file}: ${(error as Error).message}`);
  }
  try {
    raw.pragma("foreign_keys = ON");
    raw.pragma("busy_timeout = 5000");
    raw.pragma("trusted_schema = OFF");
    if (!inMemory) {
      const mode = String(raw.pragma("journal_mode = WAL", { simple: true })).toLowerCase();
      if (mode !== "wal") throw new StorageError("wal-unavailable", `journal_mode is ${mode}, WAL required (${file})`);
      raw.pragma("synchronous = FULL"); // low write rate; never trade durability for speed here
    }
  } catch (error) {
    raw.close();
    throw error;
  }
  const db = new Kysely<FactoryTables>({ dialect: new SqliteDialect({ database: raw }) });
  return {
    raw,
    db,
    file,
    migrate: (options) => migrate(raw, options),
    close: () => {
      void db.destroy();
      if (raw.open) raw.close();
    },
  };
}
