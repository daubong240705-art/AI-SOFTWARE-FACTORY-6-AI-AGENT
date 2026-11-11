import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { openStorage, loadMigrations } from "../dist/storage/index.js";
import { migrationsDir } from "./documents-fixture.mjs";

test("0022 upgrades 0021, preserves existing data and content immutability, and records its checksum", t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "factory-doc-migration-"))); const old = join(root, "old"); mkdirSync(old);
  const storage = openStorage(":memory:");
  t.after(() => { storage.close(); assert.ok(resolve(root).startsWith(realpathSync(tmpdir()) + sep + "factory-doc-migration-")); rmSync(root, { recursive: true, force: true }); });
  for (const name of readdirSync(migrationsDir).filter(n => n.endsWith(".sql") && Number(n.slice(0, 4)) <= 21)) copyFileSync(join(migrationsDir, name), join(old, name));
  storage.migrate({ migrationsDir: old, backupDir: null }); const raw = storage.raw;
  raw.exec("INSERT INTO projects VALUES ('preserved',1,'Preserved','artifact','unused','active')");
  raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,abstract_l0,visibility,created_at)
    VALUES ('preserved','document',1,'other','Old','text/plain',?,3,'draft','Old abstract','project','2026-11-12')`).run("a".repeat(64));
  const ledger = raw.prepare("SELECT * FROM migration_ledger ORDER BY version").all();
  assert.deepEqual(storage.migrate({ migrationsDir, backupDir: join(root, "backups") }).applied, [22]);
  assert.deepEqual(raw.prepare("SELECT origin,file_name FROM artifact_versions").get(), { origin: "agent", file_name: null });
  assert.deepEqual(raw.prepare("SELECT * FROM migration_ledger WHERE version<=21 ORDER BY version").all(), ledger);
  const latest = loadMigrations(migrationsDir).at(-1); assert.equal(latest.version, 22); assert.equal(latest.name, "documents");
  assert.equal(raw.prepare("SELECT checksum FROM migration_ledger WHERE version=22").get().checksum, latest.checksum);
  assert.throws(() => raw.prepare("UPDATE artifact_versions SET origin='external'").run(), /CHECK/);
  assert.throws(() => raw.prepare("UPDATE artifact_versions SET file_name=?").run("a".repeat(201)), /CHECK/);
  for (const [field, value] of [["content_hash", "b".repeat(64)], ["size_bytes", 9], ["abstract_l0", "Mutated"]])
    assert.throws(() => raw.prepare(`UPDATE artifact_versions SET ${field}=?`).run(value), /immutable/);
  raw.exec("UPDATE artifact_versions SET status='in-review'");
  assert.deepEqual(storage.migrate({ migrationsDir, backupDir: null }).applied, []); assert.deepEqual(raw.pragma("foreign_key_check"), []);
});
