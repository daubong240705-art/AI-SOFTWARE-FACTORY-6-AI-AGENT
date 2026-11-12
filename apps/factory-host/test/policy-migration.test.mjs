import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { policyFixture } from "./policy-fixture.mjs";
import { migrationsDir, temp } from "./org-fixture.mjs";
import { openStorage } from "../dist/storage/database.js";

test("fresh policy migration reaches 0025", t => {
  const f = policyFixture(t); assert.deepEqual(f.raw.prepare("SELECT version FROM migration_ledger ORDER BY version").all().map(r => r.version),
    Array.from({ length:25 }, (_, i) => i + 1));
});
for (const table of ["budgets", "autonomy_settings"]) test(`${table} is STRICT`, t => {
  const f = policyFixture(t); assert.equal(f.raw.prepare("SELECT strict FROM pragma_table_list WHERE name=?").get(table).strict, 1);
});
for (const scope of ["task", "day", "project", "engagement"]) test(`budget SQL accepts ${scope}`, t => {
  const f = policyFixture(t); assert.doesNotThrow(() => f.raw.prepare("INSERT INTO budgets VALUES (?, ?, 1, ?, ?, 100, 80)")
    .run(f.projectId, scope, scope, scope === "day" ? "2026-11-10" : "ref"));
});
for (const scope of ["team", "chain", "month", "organization", "unknown"]) test(`budget SQL rejects ${scope}`, t => {
  const f = policyFixture(t); assert.throws(() => f.raw.prepare("INSERT INTO budgets VALUES (?, ?, 1, ?, ?, 100, 80)")
    .run(f.projectId, scope, scope, "ref"), /CHECK/);
});
for (const ref of ["today", "2026-1-01", "2026-11-1", "2026/11/10"]) test(`day CHECK retains format for ${ref}`, t => {
  const f = policyFixture(t); assert.throws(() => f.raw.prepare("INSERT INTO budgets VALUES (?,'day',1,'day',?,100,80)").run(f.projectId, ref), /CHECK/);
});
for (const [column, value] of [["revision", 0], ["revision", 1.5], ["limit_tokens", 0], ["warn_at_percent", 0], ["warn_at_percent", 100]])
  test(`rebuilt budget preserves ${column} CHECK for ${value}`, t => {
    const f = policyFixture(t); f.mustBudget("project", f.projectId);
    assert.throws(() => f.raw.prepare(`UPDATE budgets SET ${column}=?`).run(value));
  });
test("budget scope uniqueness and primary key survive rebuild", t => {
  const f = policyFixture(t); f.mustBudget("project", f.projectId);
  assert.throws(() => f.raw.exec("INSERT INTO budgets SELECT * FROM budgets"), /UNIQUE/);
  assert.throws(() => f.raw.prepare("INSERT INTO budgets VALUES (?,'other',1,'project',?,200,90)").run(f.projectId, f.projectId), /UNIQUE/);
});
for (const [column, value] of [["subject", "seat"], ["subject_ref", "other"], ["level", -1], ["level", 5], ["level", 1.5],
  ["revision", 0], ["revision", 1.5], ["project_id", "missing"]]) test(`autonomy SQL constraint ${column} ${value}`, t => {
  const f = policyFixture(t); f.set("project", f.projectId, 3);
  assert.throws(() => f.raw.prepare(`UPDATE autonomy_settings SET ${column}=?`).run(value));
});
test("autonomy primary key rejects duplicate subject setting", t => {
  const f = policyFixture(t); f.set("project", f.projectId, 2);
  assert.throws(() => f.raw.exec("INSERT INTO autonomy_settings SELECT * FROM autonomy_settings"), /UNIQUE/);
});
test("no table references budgets and foreign keys stay enabled", t => {
  const f = policyFixture(t);
  for (const { name } of f.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
    const refs = f.raw.prepare("SELECT * FROM pragma_foreign_key_list(?)").all(name);
    assert.equal(refs.some(r => r.table === "budgets"), false, name);
  }
  assert.equal(f.raw.pragma("foreign_keys", { simple: true }), 1);
  assert.deepEqual(f.raw.pragma("foreign_key_check"), []);
});
test("upgrade from 0015 preserves every budget row unchanged and other schema", t => {
  const root = temp(t), old = join(root, "old"); mkdirSync(old);
  for (const name of readdirSync(migrationsDir).filter(n => n.endsWith(".sql") && Number(n.slice(0, 4)) <= 15))
    copyFileSync(join(migrationsDir, name), join(old, name));
  const storage = openStorage(":memory:"); t.after(() => storage.close());
  storage.migrate({ migrationsDir: old, backupDir: null }); const raw = storage.raw;
  raw.prepare("INSERT INTO projects VALUES ('p',1,'Preserved','artifact','synthetic','active')").run();
  raw.prepare("INSERT INTO projects VALUES ('q',1,'Other','artifact','synthetic','active')").run();
  raw.prepare("INSERT INTO budgets VALUES ('p','task-budget',7,'task','task-ref',54321,75)").run();
  raw.prepare("INSERT INTO budgets VALUES ('p','day-budget',2,'day','2026-11-10',12345,90)").run();
  raw.prepare("INSERT INTO budgets VALUES ('q','task-budget',1,'task','task-ref',999,50)").run();
  const before = raw.prepare("SELECT * FROM budgets ORDER BY project_id,id").all();
  const schema = () => raw.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT IN ('budgets','autonomy_settings','team_breakers','notifications','notification_deliveries','notifications_inbox','standing_approvals','standing_approval_uses','standing_approval_uses_day','integration_merges','integration_merges_pending','document_extractions','seat_runtime_config','model_settings','model_settings_models_insert','model_settings_models_update') ORDER BY type,name").all();
  const otherSchema = schema(), ledger = raw.prepare("SELECT * FROM migration_ledger ORDER BY version").all();
  const result = storage.migrate({ migrationsDir, backupDir: join(root, "backups"), now: () => new Date("2026-11-10T00:00:00Z") });
  assert.deepEqual(result.applied, [16, 17,18,19,20,21,22,23,24,25]); assert.ok(result.backup);
  assert.deepEqual(raw.prepare("SELECT * FROM budgets ORDER BY project_id,id").all(), before);
  const before0020 = sql => sql.replace(/,\s*extra_loops INTEGER NOT NULL DEFAULT 0 CHECK \(extra_loops BETWEEN 0 AND 10\)/, "").replace(/,\s*run_failures INTEGER NOT NULL DEFAULT 0 CHECK \(run_failures BETWEEN 0 AND 10\)/, "").replace(/,\s*reconciled_at TEXT/, "");
  // 0022 appends only these document columns to artifact_versions; all older definitions must match.
  const withoutDocuments = (name, sql) => name === "artifact_versions" ? sql
    .replace(/,\s*origin TEXT NOT NULL DEFAULT 'agent'\s+CHECK \(origin IN \('agent','upload'\)\), file_name TEXT CHECK \(file_name IS NULL OR length\(file_name\) <= 200\)/, "") : sql;
  assert.deepEqual(schema().map(row => ({ ...row, sql: withoutDocuments(row.name, before0020(row.sql)) })), otherSchema);
  assert.deepEqual(raw.prepare("SELECT * FROM migration_ledger WHERE version<=15 ORDER BY version").all(), ledger);
  assert.deepEqual(raw.pragma("foreign_key_check"), []);
  assert.deepEqual(storage.migrate({ migrationsDir, backupDir: null }).applied, []);
});
