import Database, { type Database as Sqlite } from "better-sqlite3";
import fs from "node:fs";
import { isAbsolute, join, posix, resolve } from "node:path";
import { systemClock, type Clock } from "../ids.js";
import { canonicalPath, stamp, syncFile, verifyBackup, type SnapshotCounts } from "./verify.js";
import { lockStateDirectory } from "./lock.js";

function safeStateDir(dir: string): void {
  const normalized = posix.normalize(dir.replaceAll("\\", "/"));
  if (normalized === "/mnt" || normalized.startsWith("/mnt/"))
    throw new Error("Restore state directory must not be under /mnt/");
  if (!isAbsolute(dir)) throw new Error("Restore state directory must be an absolute path");
}

/** Offline restore: stop the Host first. Preserve every displaced database file for recovery. */
export function restoreBackup(options: { backupFile: string; stateDir: string; clock?: Clock; migrationsDir?: string }): {
  restoredFrom: string; previousDatabase: string | null;
} {
  safeStateDir(options.stateDir);
  const stateDir = canonicalPath(options.stateDir);
  safeStateDir(stateDir);
  const source = resolve(options.backupFile);
  const database = join(stateDir, "host.db");
  const staging = join(stateDir, "host.db.restoring");
  if ([database, `${database}-wal`, `${database}-shm`, staging].some((file) => canonicalPath(file) === canonicalPath(source)))
    throw new Error("Restore source must be separate from the target database");
  let expected: SnapshotCounts;
  try { expected = verifyBackup(source, options.migrationsDir === undefined ? {} : { migrationsDir: options.migrationsDir }); }
  catch { throw new Error("Backup verification failed (missing, corrupt, or incompatible backup)"); }
  const moved: { from: string; to: string }[] = [];
  let guard: Sqlite | undefined;
  let keeper: Sqlite | undefined;
  let staged = false;
  let previousDatabase: string | null = null;
  let unlockState: (() => void) | undefined;
  try {
    unlockState = lockStateDirectory(stateDir);
    if (fs.existsSync(staging)) throw new Error("Restore staging file already exists");
    for (const file of [database, `${database}-wal`, `${database}-shm`]) {
      if (fs.existsSync(file) && !fs.lstatSync(file).isFile()) throw new Error("Restore target must contain regular database files");
    }
    if (fs.existsSync(database)) {
      try {
        // Keep a read-only WAL handle alive when the probe closes: the last writable connection
        // otherwise checkpoints and removes sidecars before we can preserve them.
        keeper = new Database(database, { readonly: true, fileMustExist: true, timeout: 100 });
        keeper.pragma("schema_version");
        guard = new Database(database, { fileMustExist: true, timeout: 100 });
        guard.exec("BEGIN EXCLUSIVE");
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== "SQLITE_NOTADB" && code !== "SQLITE_CORRUPT")
          throw new Error("Target database is locked or unavailable; stop the Host before restoring");
        guard?.close();
        guard = undefined;
        keeper?.close();
        keeper = undefined;
      }
    }
    // Reserve staging exclusively, then copy and verify before touching the old database.
    const fd = fs.openSync(staging, "wx", 0o600);
    staged = true;
    fs.closeSync(fd);
    fs.copyFileSync(source, staging);
    verifyBackup(staging, { expected, ...(options.migrationsDir === undefined ? {} : { migrationsDir: options.migrationsDir }) });
    syncFile(staging);
    if (guard) { guard.exec("ROLLBACK"); guard.close(); guard = undefined; }
    keeper?.close();
    keeper = undefined;
    const existing = [database, `${database}-wal`, `${database}-shm`].filter((file) => fs.existsSync(file));
    if (existing.length > 0) {
      const base = join(stateDir, `pre-restore-${stamp((options.clock ?? systemClock)())}`);
      let archive = base;
      for (let n = 1; fs.existsSync(archive); n++) archive = `${base}-${n}`;
      fs.mkdirSync(archive, { mode: 0o700 });
      for (const from of existing) {
        const to = join(archive, from.slice(stateDir.length + 1));
        fs.renameSync(from, to);
        moved.push({ from, to });
        if (from === database) previousDatabase = to;
      }
    }
    fs.renameSync(staging, database);
    staged = false;
    return { restoredFrom: source, previousDatabase };
  } catch (error) {
    guard?.close();
    guard = undefined;
    keeper?.close();
    keeper = undefined;
    for (const entry of moved.reverse()) fs.renameSync(entry.to, entry.from);
    throw new Error(error instanceof Error && /^(Restore |Target database |State directory )/.test(error.message)
      ? error.message : "Restore failed; previous database preserved");
  } finally {
    guard?.close();
    keeper?.close();
    if (staged) { try { fs.unlinkSync(staging); } catch { /* Copy may have failed before creating staging. */ } }
    unlockState?.();
  }
}
