import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { systemClock, type Clock } from "../ids.js";
import type { Storage } from "../storage/database.js";
import { canonicalPath, snapshotCounts, SnapshotMismatch, stamp, syncFile, verifyBackup } from "./verify.js";

export type BackupReason = "hourly" | "shutdown" | "manual";
export interface BackupInfo { file: string; at: Date; reason: BackupReason; sizeBytes: number }
export type BackupResult = { ok: true; backup: BackupInfo } | { ok: false; error: string };
export interface BackupStatus {
  lastSuccessAt: string | null; lastError: string | null; lastErrorAt: string | null; count: number; lastFile: string | null;
}
export interface BackupKeep { hourlyHours?: number; dailyDays?: number; minNewest?: number }
export interface BackupService {
  run(reason: BackupReason): BackupResult;
  list(): BackupInfo[];
  status(): BackupStatus;
}

const pattern = /^factory-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-(hourly|shutdown|manual)(?:-([1-9]\d*))?\.db$/;
const collision = (file: string): number => Number(pattern.exec(file)?.[8] ?? 0);

export function listBackups(dir: string): BackupInfo[] {
  return fs.readdirSync(dir).flatMap((file): BackupInfo[] => {
    const m = pattern.exec(file);
    if (!m) return [];
    const at = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
    if (!Number.isFinite(at.getTime()) || stamp(at) !== `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6]}Z`) return [];
    const stat = fs.lstatSync(join(dir, file));
    return stat.isFile() ? [{ file, at, reason: m[7] as BackupReason, sizeBytes: stat.size }] : [];
  }).sort((a, b) => b.at.getTime() - a.at.getTime() || collision(b.file) - collision(a.file) || b.file.localeCompare(a.file));
}

export function createBackupService(options: { storage: Storage; dir: string; clock?: Clock; keep?: BackupKeep }): BackupService {
  if (!isAbsolute(options.dir)) throw new Error("Backup directory must be an absolute path");
  const dir = canonicalPath(options.dir);
  const live = canonicalPath(options.storage.file);
  const state = dirname(live);
  const component = relative(state, dir).split(sep)[0] ?? "";
  const compare = (value: string): string => process.platform === "win32" ? value.toLowerCase() : value;
  if (compare(dir) === compare(state) || compare(component).startsWith(compare(basename(live))) ||
      ["host.db", "host.db-wal", "host.db-shm"].some((name) => fs.existsSync(join(dir, name))))
    throw new Error("Backup directory must be separate from the live database directory and file namespace");
  const keep = { hourlyHours: 48, dailyDays: 14, minNewest: 3, ...options.keep };
  for (const value of Object.values(keep)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Backup retention values must be nonnegative integers");
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const clock = options.clock ?? systemClock;
  let running = false;
  let lastSuccessAt: string | null = null;
  let lastError: string | null = null;
  let lastErrorAt: string | null = null;
  let lastFile: string | null = null;
  const recordError = (message: string): void => {
    lastError = message;
    try { lastErrorAt = clock().toISOString(); } catch { lastErrorAt = new Date().toISOString(); }
  };
  const list = (): BackupInfo[] => listBackups(dir);
  const prune = (at: Date): void => {
    const backups = list();
    const newestByDay = new Set<string>();
    const hourlyCutoff = at.getTime() - keep.hourlyHours * 3_600_000;
    const dailyCutoff = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) - (keep.dailyDays - 1) * 86_400_000;
    for (const [index, backup] of backups.entries()) {
      const day = backup.at.toISOString().slice(0, 10);
      const newestOfDay = !newestByDay.has(day);
      newestByDay.add(day);
      if (index < keep.minNewest || backup.at.getTime() > hourlyCutoff ||
          (keep.dailyDays > 0 && backup.at.getTime() >= dailyCutoff && newestOfDay)) continue;
      try { fs.unlinkSync(join(dir, backup.file)); } catch { recordError("backup retention deletion failed"); }
    }
  };
  return {
    list,
    status() {
      let count = 0;
      try { count = list().length; } catch { recordError("backup listing failed"); }
      return { lastSuccessAt, lastError, lastErrorAt, count, lastFile };
    },
    run(reason) {
      if (running) return { ok: false, error: "backup already running" };
      running = true;
      let temp: string | undefined;
      try {
        const at = clock();
        for (let attempt = 0; ; attempt++) {
          temp = join(dir, `.tmp-${randomUUID()}.db`);
          // VACUUM cannot run in a transaction. Pin verification counts on a separate reader instead.
          const reader = options.storage.file === ":memory:" ? null : new Database(options.storage.file, { readonly: true, fileMustExist: true });
          try {
            if (reader) reader.exec("BEGIN");
            const expected = reader ? snapshotCounts(reader) : options.storage.raw.transaction(() => snapshotCounts(options.storage.raw))();
            options.storage.raw.prepare("VACUUM INTO ?").run(temp);
            verifyBackup(temp, { expected });
            break;
          } catch (error) {
            if (!(error instanceof SnapshotMismatch) || attempt >= 1) throw error;
            fs.unlinkSync(temp);
            temp = undefined;
          } finally { reader?.close(); }
        }
        const base = `factory-${stamp(at)}-${reason}`;
        let file = `${base}.db`;
        for (let n = 1; fs.existsSync(join(dir, file)); n++) file = `${base}-${n}.db`;
        syncFile(temp);
        const sizeBytes = fs.statSync(temp).size;
        fs.renameSync(temp, join(dir, file));
        temp = undefined;
        lastSuccessAt = at.toISOString();
        lastFile = file;
        lastError = null;
        lastErrorAt = null;
        try { prune(at); } catch { recordError("backup retention failed"); }
        return { ok: true, backup: { file, at, reason, sizeBytes } };
      } catch {
        recordError("backup failed");
        return { ok: false, error: "backup failed" };
      } finally {
        if (temp) { try { fs.unlinkSync(temp); } catch { /* A missing temp file needs no cleanup. */ } }
        running = false;
      }
    },
  };
}
