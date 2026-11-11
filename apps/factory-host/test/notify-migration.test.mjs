import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { notifyFixture } from "./notify-fixture.mjs";
import { temp, migrationsDir } from "./org-fixture.mjs";
import { openStorage } from "../dist/storage/database.js";

test("migration ledger reaches 0023 and notifications tables are strict", t => { const f = notifyFixture(t); assert.equal(f.raw.prepare("SELECT max(version) AS n FROM migration_ledger").get().n, 23); for (const name of ["notifications", "notification_deliveries"]) assert.equal(f.raw.prepare("SELECT strict FROM pragma_table_list WHERE name=?").get(name).strict, 1); assert.deepEqual(f.raw.pragma("foreign_key_check"), []); });
for (const patch of [{ category: "bad" }, { urgency: "bad" }, { title: "x".repeat(201) }, { title: "" }, { body: "x".repeat(1001) }, { state: "bad" }, { state: "read" }, { read_at: "2026-11-10T00:00:00Z" }, { project_id: "missing" }]) test(`notification DB rejects ${Object.keys(patch).join()}:${JSON.stringify(patch).length}`, t => { const f = notifyFixture(t), id = f.notify(), key = Object.keys(patch)[0]; assert.throws(() => f.raw.prepare(`UPDATE notifications SET ${key}=? WHERE id=?`).run(patch[key], id)); });
test("delivery FK is project scoped", t => { const f = notifyFixture(t), id = f.notify(), other = f.project(); assert.throws(() => f.raw.prepare("INSERT INTO notification_deliveries (project_id,notification_id,channel,state,attempts) VALUES (?,?,'fake','queued',0)").run(other, id)); });
for (const [state, attempts] of [["bad", 0], ["queued", -1], ["queued", 1.5]]) test(`delivery DB rejects ${state}/${attempts}`, t => { const f = notifyFixture(t), id = f.notify(); assert.throws(() => f.raw.prepare("INSERT INTO notification_deliveries (project_id,notification_id,channel,state,attempts) VALUES (?,?,'fake',?,?)").run(f.projectId, id, state, attempts)); });
test("delivery composite primary key permits only one row per channel", t => { const f = notifyFixture(t), id = f.notify(), statement = f.raw.prepare("INSERT INTO notification_deliveries (project_id,notification_id,channel,state,attempts) VALUES (?,?,'fake','queued',0)"); statement.run(f.projectId, id); assert.throws(() => statement.run(f.projectId, id)); });
test("migration 18 preserves all preexisting schemas and rows without rebuilds", t => {
  const root = temp(t), old = join(root, "old"); mkdirSync(old);
  for (const name of readdirSync(migrationsDir).filter(n => n.endsWith(".sql") && Number(n.slice(0, 4)) <= 17)) copyFileSync(join(migrationsDir, name), join(old, name));
  const storage = openStorage(":memory:"); t.after(() => storage.close()); storage.migrate({ migrationsDir: old, backupDir: null });
  const raw = storage.raw; raw.exec("INSERT INTO projects VALUES ('preserved',1,'Preserved','artifact','synthetic','active')");
  const before = raw.prepare("SELECT type,name,rootpage,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();
  const ledger = raw.prepare("SELECT * FROM migration_ledger ORDER BY version").all();
  assert.deepEqual(storage.migrate({ migrationsDir, backupDir: join(root, "backups") }).applied, [18,19,20,21,22,23]);
  const before0020 = sql => sql.replace(/,\s*extra_loops INTEGER NOT NULL DEFAULT 0 CHECK \(extra_loops BETWEEN 0 AND 10\)/, "").replace(/,\s*run_failures INTEGER NOT NULL DEFAULT 0 CHECK \(run_failures BETWEEN 0 AND 10\)/, "").replace(/,\s*reconciled_at TEXT/, "");
  // 0022 appends only these document columns to artifact_versions; all older definitions must match.
  const withoutDocuments = (name, sql) => name === "artifact_versions" ? sql
    .replace(/,\s*origin TEXT NOT NULL DEFAULT 'agent'\s+CHECK \(origin IN \('agent','upload'\)\), file_name TEXT CHECK \(file_name IS NULL OR length\(file_name\) <= 200\)/, "") : sql;
  for (const row of before) {
    const current = raw.prepare("SELECT type,name,rootpage,sql FROM sqlite_master WHERE name=?").get(row.name);
    assert.deepEqual({ ...current, sql: withoutDocuments(row.name, before0020(current.sql)) }, row);
  }
  assert.equal(raw.prepare("SELECT name FROM projects").get().name, "Preserved");
  assert.deepEqual(raw.prepare("SELECT * FROM migration_ledger WHERE version<=17 ORDER BY version").all(), ledger);
  assert.deepEqual(storage.migrate({ migrationsDir, backupDir: null }).applied, []);
});
