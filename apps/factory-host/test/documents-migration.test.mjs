import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { openStorage, loadMigrations } from "../dist/storage/index.js";
import { migrationsDir } from "./documents-fixture.mjs";
import { documentsFixture } from "./documents-fixture.mjs";

test("0022 and 0023 upgrade 0021 and preserve document data", t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "factory-doc-migration-"))); const old = join(root, "old"); mkdirSync(old);
  const storage = openStorage(":memory:");
  t.after(() => { storage.close(); assert.ok(resolve(root).startsWith(realpathSync(tmpdir()) + sep + "factory-doc-migration-")); rmSync(root, { recursive: true, force: true }); });
  for (const name of readdirSync(migrationsDir).filter(n => n.endsWith(".sql") && Number(n.slice(0, 4)) <= 21)) copyFileSync(join(migrationsDir, name), join(old, name));
  storage.migrate({ migrationsDir: old, backupDir: null }); const raw = storage.raw;
  raw.exec("INSERT INTO projects VALUES ('preserved',1,'Preserved','artifact','unused','active')");
  raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,abstract_l0,visibility,created_at)
    VALUES ('preserved','document',1,'other','Old','text/plain',?,3,'draft','Old abstract','project','2026-11-12')`).run("a".repeat(64));
  const ledger = raw.prepare("SELECT * FROM migration_ledger ORDER BY version").all();
  assert.deepEqual(storage.migrate({ migrationsDir, backupDir: join(root, "backups") }).applied, [22,23,24]);
  assert.deepEqual(raw.prepare("SELECT origin,file_name FROM artifact_versions").get(), { origin: "agent", file_name: null });
  assert.deepEqual(raw.prepare("SELECT * FROM migration_ledger WHERE version<=21 ORDER BY version").all(), ledger);
  const latest = loadMigrations(migrationsDir).find(m => m.version === 23); assert.equal(latest.version, 23); assert.equal(latest.name, "document_extractions");
  assert.equal(raw.prepare("SELECT checksum FROM migration_ledger WHERE version=23").get().checksum, latest.checksum);
  assert.throws(() => raw.prepare("UPDATE artifact_versions SET origin='external'").run(), /CHECK/);
  assert.throws(() => raw.prepare("UPDATE artifact_versions SET file_name=?").run("a".repeat(201)), /CHECK/);
  for (const [field, value] of [["content_hash", "b".repeat(64)], ["size_bytes", 9], ["abstract_l0", "Mutated"]])
    assert.throws(() => raw.prepare(`UPDATE artifact_versions SET ${field}=?`).run(value), /immutable/);
  raw.exec("UPDATE artifact_versions SET status='in-review'");
  assert.deepEqual(storage.migrate({ migrationsDir, backupDir: null }).applied, []); assert.deepEqual(raw.pragma("foreign_key_check"), []);
});

test("0023 applies immediately after 0022 and keeps its ledger and original version unchanged", t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "factory-doc-migration-")));
  const storage = openStorage(":memory:");
  t.after(() => { storage.close(); assert.ok(resolve(root).startsWith(realpathSync(tmpdir()) + sep + "factory-doc-migration-")); rmSync(root, { recursive: true, force: true }); });
  for (const name of readdirSync(migrationsDir).filter(n => n.endsWith(".sql") && Number(n.slice(0, 4)) <= 22)) copyFileSync(join(migrationsDir, name), join(root, name));
  storage.migrate({ migrationsDir: root, backupDir: null }); const raw = storage.raw;
  raw.exec("INSERT INTO projects VALUES ('p',1,'Preserved','artifact','unused','active')");
  raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,abstract_l0,visibility,created_at)
    VALUES ('p','doc',1,'other','PDF','application/pdf',?,10,'draft','Abstract','project','2026-11-12')`).run("a".repeat(64));
  const version = raw.prepare("SELECT * FROM artifact_versions").get(), ledger = raw.prepare("SELECT * FROM migration_ledger ORDER BY version").all();
  assert.deepEqual(storage.migrate({ migrationsDir, backupDir: join(root, "backups") }).applied, [23,24]);
  assert.deepEqual(raw.prepare("SELECT * FROM artifact_versions").get(), version);
  assert.deepEqual(raw.prepare("SELECT * FROM migration_ledger WHERE version<=22 ORDER BY version").all(), ledger);
  assert.equal(raw.prepare("SELECT strict FROM pragma_table_list WHERE name='document_extractions'").get().strict, 1);
  assert.deepEqual(raw.prepare("SELECT * FROM document_extractions").all(), []);
});

test("0023 derived extraction rows enforce status, primary key, source ownership and strict types", t => {
  const f = documentsFixture(t), row = f.add();
  const insert = f.raw.prepare(`INSERT INTO document_extractions(project_id,artifact_id,version,status,converter,converter_version,created_at,updated_at)
    VALUES (?,?,?,'pending','utf8','1','2026-11-12','2026-11-12')`);
  insert.run(row.projectId, row.artifactId, row.version);
  const derived = f.raw.prepare("SELECT * FROM document_extractions").get();
  assert.equal(derived.attempts, 0); assert.equal(derived.outline_json, "[]"); assert.equal(derived.text_hash, null);
  assert.throws(() => insert.run(row.projectId, row.artifactId, row.version), /UNIQUE/);
  assert.throws(() => insert.run(f.otherProject, row.artifactId, row.version), /FOREIGN KEY/);
  assert.throws(() => f.raw.exec("UPDATE document_extractions SET status='invalid'"), /CHECK/);
  assert.throws(() => f.raw.exec("UPDATE document_extractions SET pages='invalid'"), /INTEGER/);
  // Derived rows are rebuildable; immutable source data survives their removal.
  f.raw.exec("DELETE FROM document_extractions"); assert.equal(f.raw.prepare("SELECT count(*) AS n FROM artifact_versions").get().n, 1);
});
