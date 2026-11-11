import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { openStorage } from "../dist/storage/database.js";
import { integrationFixture } from "./integration-fixture.mjs";
import { temp, migrationsDir } from "./org-fixture.mjs";

test("integration migration ledger reaches exactly 0023", t => { const f = integrationFixture(t); assert.deepEqual(f.raw.prepare("SELECT version FROM migration_ledger ORDER BY version").all().map(x => x.version), Array.from({ length:23 }, (_, i) => i + 1)); });
test("integration table is STRICT", t => { const f = integrationFixture(t); assert.equal(f.raw.prepare("SELECT strict FROM pragma_table_list WHERE name='integration_merges'").get().strict, 1); });
test("integration queue lookup index has the specified columns", t => { const f = integrationFixture(t); assert.deepEqual(f.raw.pragma("index_info(integration_merges_pending)").map(x => x.name), ["project_id", "state", "created_at"]); });
test("integration defaults and null fields", t => { const f = integrationFixture(t), id = f.merge(), row = f.row(id); assert.equal(row.attempts, 0); assert.equal(row.merge_sha, null); assert.equal(row.resolved_at, null); assert.equal(row.error_kind, null); });
for (const state of ["pending", "merged", "conflict", "skipped"]) test(`integration SQL accepts state ${state}`, t => { const f = integrationFixture(t), id = f.merge(undefined, { state }); assert.equal(f.row(id).state, state); });
for (const [column, value] of [["state", "running"], ["state", null], ["error_kind", "unexpected"], ["attempts", -1], ["attempts", 1.5], ["attempts", "invalid"], ["branch", null], ["created_at", null], ["project_id", "missing"], ["task_id", "missing"]]) test(`integration SQL rejects ${column} ${value}`, t => {
  const f = integrationFixture(t), id = f.merge(); assert.throws(() => f.raw.prepare(`UPDATE integration_merges SET ${column}=? WHERE task_id=?`).run(value, id));
});
for (const error of ["conflict", "git-failed", null]) test(`integration SQL accepts error kind ${error}`, t => { const f = integrationFixture(t), id = f.merge(undefined, { errorKind: error }); assert.equal(f.row(id).error_kind, error); });
test("integration task FK is project scoped", t => { const f = integrationFixture(t), id = f.merge(), other = f.project(); assert.throws(() => f.raw.prepare("UPDATE integration_merges SET project_id=? WHERE task_id=?").run(other, id)); assert.deepEqual(f.raw.pragma("foreign_key_check"), []); });
test("integration primary key forbids duplicate task merge", t => { const f = integrationFixture(t), id = f.merge(); assert.throws(() => f.merge(id)); });
test("0021 adds only the integration table and index and preserves schema and data", t => {
  const root = temp(t), old = join(root, "old"); mkdirSync(old); for (const name of readdirSync(migrationsDir).filter(n => n.endsWith(".sql") && Number(n.slice(0, 4)) <= 20)) copyFileSync(join(migrationsDir, name), join(old, name));
  const storage = openStorage(":memory:"); t.after(() => storage.close()); storage.migrate({ migrationsDir: old, backupDir: null }); const raw = storage.raw;
  raw.exec("INSERT INTO projects VALUES ('preserved',1,'Preserved','artifact','synthetic','active')");
  const schema = raw.prepare("SELECT type,name,rootpage,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all(), ledger = raw.prepare("SELECT * FROM migration_ledger ORDER BY version").all(), projects = raw.prepare("SELECT * FROM projects").all();
  copyFileSync(join(migrationsDir, "0021_integration.sql"), join(old, "0021_integration.sql"));
  assert.deepEqual(storage.migrate({ migrationsDir: old, backupDir: join(root, "backups") }).applied, [21]);
  for (const row of schema) assert.deepEqual(raw.prepare("SELECT type,name,rootpage,sql FROM sqlite_master WHERE name=?").get(row.name), row);
  assert.deepEqual(raw.prepare("SELECT * FROM migration_ledger WHERE version<=20 ORDER BY version").all(), ledger); assert.deepEqual(raw.prepare("SELECT * FROM projects").all(), projects);
  assert.deepEqual(storage.migrate({ migrationsDir: old, backupDir: null }).applied, []);
});
