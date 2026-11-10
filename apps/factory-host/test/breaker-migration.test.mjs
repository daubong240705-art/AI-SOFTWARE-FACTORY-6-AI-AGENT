import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fixture, migrationsDir, temp } from "./org-fixture.mjs";
import { openStorage } from "../dist/storage/database.js";

const insert = (f, patch = {}) => {
  const row = { projectId: f.projectId, teamId: f.teamId, state: "open", openedAt: f.clock().toISOString(), closedAt: null, failures: 5, reason: "5 tasks failed within 60 minutes", ...patch };
  f.raw.prepare("INSERT INTO team_breakers VALUES (?,?,?,?,?,?,?)").run(row.projectId, row.teamId, row.state, row.openedAt, row.closedAt, row.failures, row.reason);
};
test("migration reaches 0021 and team breakers are STRICT", t => { const f = fixture(t); assert.equal(f.raw.prepare("SELECT max(version) AS n FROM migration_ledger").get().n, 21); assert.equal(f.raw.prepare("SELECT strict FROM pragma_table_list WHERE name='team_breakers'").get().strict, 1); });
for (const patch of [{ state: "half-open" }, { state: "closed" }, { openedAt: null }, { failures: -1 }, { failures: 1.5 }, { projectId: "missing" }, { teamId: "missing" }])
  test(`team breaker rejects invalid ${JSON.stringify(patch)}`, t => { const f = fixture(t); assert.throws(() => insert(f, patch)); });
test("closed breaker requires null opened_at and accepts closed timestamp", t => { const f = fixture(t); assert.doesNotThrow(() => insert(f, { state: "closed", openedAt: null, closedAt: f.clock().toISOString(), failures: 0, reason: null })); });
test("primary key rejects duplicate project and team", t => { const f = fixture(t); insert(f); assert.throws(() => insert(f), /UNIQUE/); });
test("same team can have breakers in two projects", t => { const f = fixture(t), other = f.project(); insert(f); insert(f, { projectId: other }); assert.equal(f.raw.prepare("SELECT count(*) AS n FROM team_breakers").get().n, 2); });
test("migration from 0016 preserves all existing schema and rows", t => {
  const root = temp(t), old = join(root, "old"); mkdirSync(old);
  for (const name of readdirSync(migrationsDir).filter(name => name.endsWith(".sql") && Number(name.slice(0, 4)) <= 16)) copyFileSync(join(migrationsDir, name), join(old, name));
  const storage = openStorage(":memory:"); t.after(() => storage.close()); storage.migrate({ migrationsDir: old, backupDir: null }); const raw = storage.raw;
  raw.exec("INSERT INTO projects VALUES ('p',1,'Preserved','artifact','synthetic','active')");
  const before = raw.prepare("SELECT * FROM projects").all(), ledger = raw.prepare("SELECT * FROM migration_ledger ORDER BY version").all();
  const schema = () => raw.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT IN ('team_breakers','notifications','notification_deliveries','notifications_inbox','standing_approvals','standing_approval_uses','standing_approval_uses_day','integration_merges','integration_merges_pending') ORDER BY type,name").all(); const previousSchema = schema();
  assert.deepEqual(storage.migrate({ migrationsDir, backupDir: join(root, "backups") }).applied, [17,18,19,20,21]);
  const before0020 = sql => sql.replace(/,\s*extra_loops INTEGER NOT NULL DEFAULT 0 CHECK \(extra_loops BETWEEN 0 AND 10\)/, "").replace(/,\s*run_failures INTEGER NOT NULL DEFAULT 0 CHECK \(run_failures BETWEEN 0 AND 10\)/, "").replace(/,\s*reconciled_at TEXT/, "");
  assert.deepEqual(schema().map(row => ({ ...row, sql: before0020(row.sql) })), previousSchema); assert.deepEqual(raw.prepare("SELECT * FROM projects").all(), before);
  assert.deepEqual(raw.prepare("SELECT * FROM migration_ledger WHERE version<=16 ORDER BY version").all(), ledger); assert.deepEqual(raw.pragma("foreign_key_check"), []);
  assert.deepEqual(storage.migrate({ migrationsDir, backupDir: null }).applied, []);
});
