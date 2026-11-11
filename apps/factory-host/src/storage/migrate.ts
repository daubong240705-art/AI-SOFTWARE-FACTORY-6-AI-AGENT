import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database as Sqlite } from "better-sqlite3";

export type MigrationErrorCode =
  | "checksum-mismatch" // an applied migration file was edited
  | "missing-file" // the database knows a migration the code does not have
  | "gap" // versions are not 1..N
  | "db-ahead" // database is newer than this build
  | "bad-name" // file name does not match NNNN_name.sql
  | "failed" // the migration SQL itself failed (rolled back)
  | "foreign-key-violation" // the migration left dangling references (rolled back)
  | "backup-failed";

export class MigrationError extends Error {
  constructor(
    readonly code: MigrationErrorCode,
    message: string,
    readonly version?: number,
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

export interface MigrationFile {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface MigrateOptions {
  /** Directory with NNNN_name.sql files. */
  readonly migrationsDir: string;
  /** Where pre-migration backups go. When null, migrating a non-empty database is refused. */
  readonly backupDir: string | null;
  readonly now?: () => Date;
}

export interface MigrateResult {
  readonly applied: readonly number[];
  readonly backup: string | null;
}

/** Normalised so a CRLF checkout (git autocrlf on Windows) has the same checksum as an LF one. */
export function checksumOf(sql: string): string {
  const normal = sql.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  return createHash("sha256").update(normal, "utf8").digest("hex");
}

export function loadMigrations(dir: string): MigrationFile[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const migrations = files.map((file) => {
    const match = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(file);
    if (!match) throw new MigrationError("bad-name", `migration file name must be NNNN_name.sql: ${file}`);
    const sql = readFileSync(join(dir, file), "utf8");
    return { version: Number(match[1]), name: match[2] as string, sql, checksum: checksumOf(sql) };
  });
  migrations.forEach((m, index) => {
    if (m.version !== index + 1)
      throw new MigrationError("gap", `migration versions must be 1..N without gaps; found ${m.version} at position ${index + 1}`, m.version);
  });
  return migrations;
}

interface LedgerRow {
  version: number;
  name: string;
  checksum: string;
}

const LEDGER = `CREATE TABLE IF NOT EXISTS migration_ledger (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL,
  checksum TEXT NOT NULL CHECK (length(checksum) = 64),
  applied_at TEXT NOT NULL
) STRICT`;

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/**
 * Brings the database to the latest migration. Safe to run on every start:
 * - nothing pending: does nothing;
 * - an applied file was edited, or is missing, or the DB is ahead of the code: stops, changes nothing;
 * - pending on a non-empty database: backs up first (VACUUM INTO), then applies each migration in its own
 *   transaction together with its ledger row, so a failed migration leaves no trace.
 */
export function migrate(db: Sqlite, options: MigrateOptions): MigrateResult {
  const now = options.now ?? (() => new Date());
  const migrations = loadMigrations(options.migrationsDir);
  db.exec(LEDGER);
  const applied = db
    .prepare("SELECT version, name, checksum FROM migration_ledger ORDER BY version")
    .all() as LedgerRow[];

  applied.forEach((row, index) => {
    if (row.version !== index + 1)
      throw new MigrationError("gap", `ledger has a gap before version ${row.version}`, row.version);
    const file = migrations[index];
    if (!file)
      throw new MigrationError("db-ahead", `database has migration ${row.version} (${row.name}) that this build does not know`, row.version);
    if (file.checksum !== row.checksum)
      throw new MigrationError("checksum-mismatch", `migration ${row.version} (${row.name}) was edited after it was applied`, row.version);
  });

  const pending = migrations.slice(applied.length);
  if (pending.length === 0) return { applied: [], backup: null };

  let backup: string | null = null;
  if (applied.length > 0) {
    if (!options.backupDir)
      throw new MigrationError("backup-failed", "refusing to migrate a database that has data without a backup directory");
    backup = backupBeforeMigration(db, options.backupDir, (pending[0] as MigrationFile).version, now());
  }

  const done: number[] = [];
  for (const m of pending) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(m.sql);
      db.prepare("INSERT INTO migration_ledger (version, name, checksum, applied_at) VALUES (?,?,?,?)").run(
        m.version,
        m.name,
        m.checksum,
        now().toISOString(),
      );
      const dangling = db.prepare("PRAGMA foreign_key_check").all();
      if (dangling.length > 0)
        throw new MigrationError("foreign-key-violation", `migration ${m.version} left ${dangling.length} dangling reference(s)`, m.version);
      db.exec("COMMIT");
    } catch (error) {
      if (db.inTransaction) db.exec("ROLLBACK");
      if (error instanceof MigrationError) throw error;
      throw new MigrationError("failed", `migration ${m.version} (${m.name}) failed: ${(error as Error).message}`, m.version);
    }
    done.push(m.version);
  }
  return { applied: done, backup };
}

/** A consistent copy taken without stopping the Host. Verified before it is trusted. */
export function backupBeforeMigration(db: Sqlite, backupDir: string, nextVersion: number, at: Date): string {
  try {
    mkdirSync(backupDir, { recursive: true });
    let target = join(backupDir, `pre-migration-${String(nextVersion).padStart(4, "0")}-${stamp(at)}.db`);
    for (let n = 1; existsSync(target); n += 1)
      target = join(backupDir, `pre-migration-${String(nextVersion).padStart(4, "0")}-${stamp(at)}-${n}.db`);
    db.prepare("VACUUM INTO ?").run(target);
    return target;
  } catch (error) {
    throw new MigrationError("backup-failed", `could not back up before migrating: ${(error as Error).message}`);
  }
}
