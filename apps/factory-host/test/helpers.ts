import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openStorage, type Storage } from "../src/storage/database.js";

/** dist-test/test/helpers.js -> <package>/migrations */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

/** A fresh, fully migrated in-memory database. Close it with `storage.close()`. */
export function migratedStorage(): Storage {
  const storage = openStorage(":memory:");
  storage.migrate({ migrationsDir: MIGRATIONS_DIR, backupDir: null });
  return storage;
}

/** A temporary directory removed by the returned cleanup function. */
export function tempDir(prefix = "factory-test-"): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Deterministic ids for tests: UUIDv7-shaped, lowercase, increasing. */
export function idFactory(seed = 1): () => string {
  let n = seed;
  return () => {
    const hex = (n++).toString(16).padStart(12, "0");
    return `0193a3b2-1c2d-7e3f-8a9b-${hex}`;
  };
}

export const fixedClock = (iso = "2026-11-19T10:00:00.000Z") => () => new Date(iso);
