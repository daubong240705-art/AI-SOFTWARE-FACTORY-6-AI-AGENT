import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { standingFixture } from "./standing-fixture.mjs";
import { temp, migrationsDir } from "./org-fixture.mjs";
import { openStorage } from "../dist/storage/database.js";

test("standing migration reaches exactly 0021 with STRICT tables and foreign keys", t => { const f = standingFixture(t); assert.equal(f.raw.prepare("SELECT max(version) AS n FROM migration_ledger").get().n, 21); for (const name of ["standing_approvals", "standing_approval_uses"]) assert.equal(f.raw.prepare("SELECT strict FROM pragma_table_list WHERE name=?").get(name).strict, 1); assert.deepEqual(f.raw.pragma("foreign_key_check"), []); });
for (const [field, value] of [["revision", 0], ["revision", 1.5], ["action_kind", "deploy.production"], ["action_kind", "spend-money"], ["action_kind", "publish-external"], ["action_kind", "delete-data"], ["scope_kind", "other"], ["scope_ref", null], ["scope_ref", "other"], ["limit_per_day", 0], ["limit_per_day", 51], ["limit_per_day", 1.5], ["max_tokens_per_use", 0], ["max_tokens_per_use", -1], ["max_tokens_per_use", 1.5], ["state", "other"], ["state", "revoked"], ["revoked_at", "2026-11-10T01:00:00.000Z"], ["expires_at", "2026-11-10T00:00:00.000Z"], ["project_id", "missing"]]) test(`DB rejects standing ${field}=${value}`, t => { const f = standingFixture(t), id = f.create(); assert.throws(() => f.raw.prepare(`UPDATE standing_approvals SET ${field}=? WHERE id=?`).run(value, id)); });
test("DB accepts revoked state and timestamp together", t => { const f = standingFixture(t), id = f.create(); f.raw.prepare("UPDATE standing_approvals SET state='revoked',revoked_at=? WHERE id=?").run(f.clock().toISOString(), id); assert.equal(f.row(id).state, "revoked"); });
test("DB accepts null token cap", t => { const f = standingFixture(t), id = f.create(); assert.equal(f.row(id).max_tokens_per_use, null); });
test("DB refuses duplicate approval composite key", t => { const f = standingFixture(t), id = f.create(); assert.throws(() => f.raw.prepare("INSERT INTO standing_approvals SELECT * FROM standing_approvals WHERE id=?").run(id)); });
test("use FK is project scoped", t => { const f = standingFixture(t), id = f.create(), other = f.project(); assert.throws(() => f.raw.prepare("INSERT INTO standing_approval_uses VALUES (?,?,?,?,?,NULL)").run(other, randomUUID(), id, f.clock().toISOString(), "2026-11-10")); });
for (const day of ["2026-1-10", "2026-11-1", "today", "2026-11-10-extra", "202x-11-10"]) test(`DB rejects malformed local day ${day}`, t => { const f = standingFixture(t), id = f.create(); assert.throws(() => f.raw.prepare("INSERT INTO standing_approval_uses VALUES (?,?,?,?,?,NULL)").run(f.projectId, randomUUID(), id, f.clock().toISOString(), day)); });
test("use composite primary key prevents duplicate records", t => { const f = standingFixture(t); f.level(); f.create(); const useId = randomUUID(); f.use({ useId }); assert.throws(() => f.raw.prepare("INSERT INTO standing_approval_uses SELECT * FROM standing_approval_uses WHERE id=?").run(useId)); });
test("daily use index covers project standing and day", t => { const f = standingFixture(t); assert.deepEqual(f.raw.pragma("index_info(standing_approval_uses_day)").map(x => x.name), ["project_id", "standing_id", "local_day"]); });
test("migration 0019 adds tables without rebuilding or changing 0001-0018 data", t => {
  const root = temp(t), old = join(root, "old"); mkdirSync(old);
  for (const name of readdirSync(migrationsDir).filter(n => n.endsWith(".sql") && Number(n.slice(0, 4)) <= 18)) copyFileSync(join(migrationsDir, name), join(old, name));
  const storage = openStorage(":memory:"); t.after(() => storage.close()); storage.migrate({ migrationsDir: old, backupDir: null }); const raw = storage.raw;
  raw.exec("INSERT INTO projects VALUES ('preserved',1,'Preserved','artifact','synthetic','active')");
  raw.exec("INSERT INTO notifications VALUES ('preserved','notification','dedup','important','normal','Title','Body',NULL,NULL,'unread','2026-11-10T00:00:00.000Z',NULL)");
  const schema = raw.prepare("SELECT type,name,rootpage,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();
  const ledger = raw.prepare("SELECT * FROM migration_ledger ORDER BY version").all(), notifications = raw.prepare("SELECT * FROM notifications").all();
  assert.deepEqual(storage.migrate({ migrationsDir, backupDir: join(root, "backups") }).applied, [19,20,21]);
  // 0020 only appends these columns; every previous definition and rootpage must still match.
  const before0020 = sql => sql
    .replace(/,\s*extra_loops INTEGER NOT NULL DEFAULT 0 CHECK \(extra_loops BETWEEN 0 AND 10\)/, "")
    .replace(/,\s*run_failures INTEGER NOT NULL DEFAULT 0 CHECK \(run_failures BETWEEN 0 AND 10\)/, "")
    .replace(/,\s*reconciled_at TEXT/, "");
  for (const row of schema) {
    const current = raw.prepare("SELECT type,name,rootpage,sql FROM sqlite_master WHERE name=?").get(row.name);
    assert.deepEqual({ ...current, sql: before0020(current.sql) }, row);
  }
  assert.deepEqual(raw.prepare("SELECT * FROM migration_ledger WHERE version<=18 ORDER BY version").all(), ledger);
  assert.deepEqual(raw.prepare("SELECT * FROM notifications").all(), notifications); assert.equal(raw.prepare("SELECT name FROM projects").get().name, "Preserved");
  assert.deepEqual(storage.migrate({ migrationsDir, backupDir: null }).applied, []);
});
