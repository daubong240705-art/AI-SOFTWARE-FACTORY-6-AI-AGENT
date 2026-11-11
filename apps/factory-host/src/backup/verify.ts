import Database, { type Database as Sqlite } from "better-sqlite3";
import fs from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { loadMigrations } from "../storage/migrate.js";

export interface SnapshotCounts { version: number; projects: number }
export class SnapshotMismatch extends Error {}

export function snapshotCounts(raw: Sqlite): SnapshotCounts {
  if (!raw.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?").get("table", "migration_ledger"))
    throw new Error("Backup migration ledger is missing");
  const ledger = raw.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM migration_ledger").get() as { version: number };
  const projects = raw.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
  return { version: ledger.version, projects: projects.count };
}

/** All checks share one read transaction. No verification opens a file for writing. */
export function verifyBackup(file: string, options: { expected?: SnapshotCounts; migrationsDir?: string } = {}): SnapshotCounts {
  const raw = new Database(file, { readonly: true, fileMustExist: true, timeout: 100 });
  try {
    raw.pragma("trusted_schema = OFF");
    return raw.transaction(() => {
      const integrity = raw.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
      if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") throw new Error("Backup integrity verification failed");
      if (raw.prepare("PRAGMA foreign_key_check").all().length !== 0) throw new Error("Backup foreign key verification failed");
      const counts = snapshotCounts(raw);
      if (options.migrationsDir !== undefined) {
        const files = loadMigrations(options.migrationsDir);
        const ledger = raw.prepare("SELECT version, checksum FROM migration_ledger ORDER BY version").all() as { version: number; checksum: string }[];
        for (const [index, row] of ledger.entries()) {
          if (row.version !== index + 1 || files[index]?.checksum !== row.checksum)
            throw new Error("Backup migration checksum verification failed");
        }
      }
      if (options.expected && (counts.version !== options.expected.version || counts.projects !== options.expected.projects))
        throw new SnapshotMismatch("Backup snapshot verification failed");
      return counts;
    })();
  } finally { raw.close(); }
}

export const stamp = (date: Date): string => date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");

/** Resolve existing ancestors too, so directory aliases cannot bypass containment checks. */
export function canonicalPath(path: string): string {
  const absolute = resolve(path);
  if (fs.existsSync(absolute)) return fs.realpathSync(absolute);
  const parent = dirname(absolute);
  return parent === absolute ? absolute : join(canonicalPath(parent), basename(absolute));
}

export function syncFile(file: string): void {
  const fd = fs.openSync(file, "r+");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
