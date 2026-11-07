// A backup that still OPENS but fails PRAGMA integrity_check (table and index disagree) must never be
// accepted, published or restored. Garbage files are already covered by backup.test.mjs; this covers
// the quiet corruption that only integrity_check can see.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { openStorage } from "../dist/storage/index.js";
import { verifyBackup } from "../dist/backup/verify.js";
import { restoreBackup } from "../dist/backup/restore.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, "..", "migrations");
const roots = [];
const scratch = () => { const d = mkdtempSync(join(tmpdir(), "backup-integrity-")); roots.push(d); return d; };
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const MARKER = "ZZZZZZZZ-integrity-marker-0001";

/** A migrated database in rollback-journal mode (everything in the main file) with one marked project. */
function quietlyCorruptBackup() {
  const dir = scratch();
  const file = join(dir, "backup.db");
  const s = openStorage(file);
  s.migrate({ migrationsDir: MIGRATIONS, backupDir: null });
  s.raw.prepare("INSERT INTO projects VALUES (?,1,'Corrupt me','git','/srv/x','active')").run(MARKER);
  s.raw.pragma("wal_checkpoint(TRUNCATE)");
  s.raw.pragma("journal_mode = DELETE");
  s.close();
  const bytes = readFileSync(file);
  const at = bytes.indexOf(Buffer.from(MARKER));
  assert.ok(at > 0, "marker must be in the main file");
  bytes[at] = "Y".charCodeAt(0); // first copy only: the table row and its index entry now disagree
  writeFileSync(file, bytes);
  return { dir, file };
}

test("precondition: the damaged file opens and integrity_check reports problems without throwing", () => {
  const { file } = quietlyCorruptBackup();
  const db = new Database(file, { readonly: true });
  try {
    const rows = db.prepare("PRAGMA integrity_check").all();
    assert.notDeepEqual(rows.map((r) => r.integrity_check), ["ok"]);
    assert.ok(db.prepare("SELECT count(*) c FROM projects").get().c >= 0); // still readable
  } finally { db.close(); }
});

test("verifyBackup rejects a database whose only fault is an integrity_check failure", () => {
  const { file } = quietlyCorruptBackup();
  assert.throws(() => verifyBackup(file), /integrity/i);
});

test("restore refuses it, leaves the existing database untouched and never moves it aside", () => {
  const { file } = quietlyCorruptBackup();
  const stateDir = join(scratch(), "state");
  mkdirSync(stateDir, { recursive: true });
  const live = openStorage(join(stateDir, "host.db"));
  live.migrate({ migrationsDir: MIGRATIONS, backupDir: null });
  live.raw.prepare("INSERT INTO projects VALUES ('live-project',1,'Live','git','/srv/live','active')").run();
  live.close();
  const before = readFileSync(join(stateDir, "host.db"));
  assert.throws(() => restoreBackup({ backupFile: file, stateDir }), /verification failed/i);
  assert.ok(existsSync(join(stateDir, "host.db")));
  assert.deepEqual(readFileSync(join(stateDir, "host.db")), before);
  assert.equal(existsSync(join(stateDir, "host.db.restoring")), false);
});
