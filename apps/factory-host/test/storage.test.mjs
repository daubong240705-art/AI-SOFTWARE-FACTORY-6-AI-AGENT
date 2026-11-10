// M1 storage: migrations (ledger, checksum, backup, rollback), restart safety, schema parity with the references.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { MigrationError, checksumOf, loadMigrations, openStorage } from "../dist/storage/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, "..", "migrations");
const REPO = join(here, "..", "..", "..");
const roots = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-host-"));
  roots.push(dir);
  return dir;
};
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const NOW = () => new Date("2026-11-07T10:00:00.000Z");
const H = "a".repeat(64);
const T = "2026-11-07T00:00:00.000Z";
const lf = (s) => s.replace(/\r\n/g, "\n");

/** A private copy of the real migrations that a test may extend or damage. */
function migrationsCopy() {
  const dir = join(scratch(), "migrations");
  cpSync(MIGRATIONS, dir, { recursive: true });
  return dir;
}
const opts = (migrationsDir, backupDir = join(scratch(), "backup")) => ({ migrationsDir, backupDir, now: NOW });
const rejectsWith = (fn, code) =>
  assert.throws(fn, (e) => e instanceof MigrationError && e.code === code, `expected MigrationError ${code}`);
const tables = (raw) =>
  raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const ledger = (raw) => raw.prepare("SELECT version, name, checksum FROM migration_ledger ORDER BY version").all();

// ---- migration basics -------------------------------------------------------------------------------
test("migrates an empty database, and running again changes nothing", () => {
  const s = openStorage(":memory:");
  const first = s.migrate(opts(MIGRATIONS));
  assert.deepEqual(first.applied, [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]);
  assert.equal(first.backup, null); // nothing existed to protect
  const before = JSON.stringify(s.raw.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all());
  const second = s.migrate(opts(MIGRATIONS));
  assert.deepEqual(second, { applied: [], backup: null });
  assert.equal(JSON.stringify(s.raw.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all()), before);
  assert.equal(ledger(s.raw).length, 15);
  assert.equal(ledger(s.raw)[0].name, "core");
  s.close();
});

test("the migrated database is strict, consistent and free of the superseded V1-shaped tables", () => {
  const s = openStorage(":memory:");
  s.migrate(opts(MIGRATIONS));
  const all = s.raw.prepare("SELECT name, strict FROM pragma_table_list WHERE schema='main' AND name NOT LIKE 'sqlite_%'").all();
  for (const t of all.filter((table) => !table.name.startsWith("knowledge_index"))) assert.equal(t.strict, 1, t.name);
  for (const gone of ["work_items", "assignments", "run_attempts", "leases", "reservations", "callback_inbox", "agents", "workflow_revisions", "dependencies"])
    assert.equal(tables(s.raw).includes(gone), false, gone);
  for (const here_ of ["projects", "teams", "seats", "engagements", "tasks", "attempts", "conversations", "messages", "drafts", "command_receipts", "project_streams", "event_log", "outbox", "usage_records", "budgets", "approvals", "effects", "artifact_versions", "nodes"])
    assert.ok(tables(s.raw).includes(here_), here_);
  assert.deepEqual(s.raw.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(s.raw.pragma("foreign_keys", { simple: true }), 1);
  s.close();
});

test("the migration is the 002 reference plus the M1 additions: no drift", () => {
  const s = openStorage(":memory:");
  s.migrate(opts(MIGRATIONS));
  const ref = new Database(":memory:");
  ref.exec(readFileSync(join(REPO, "schema/factory-v2/002-multiteam.reference.sql"), "utf8"));
  const select = "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name";
  const migrated = new Map(s.raw.prepare(select).all().map((r) => [`${r.type}:${r.name}`, lf(r.sql)]));
  const reference = ref.prepare(select).all();
  assert.ok(reference.length >= 37, `only ${reference.length} schema objects in the reference`);
  // 0009 adds exactly one nullable column to teams (pack_digest); everything else must match the reference.
  const withoutM3Columns = (name, sql) => name === "teams" ? sql.replace(/,\s*pack_digest TEXT REFERENCES pack_snapshots\(digest\)/, "") : name === "workflow_instances" ? sql.replace(/,\s*last_progress_at TEXT NULL/, "") : name === "workflow_stages" ? sql.replace(/,\s*blocked_reason TEXT/, "").replace(/,\s*engagement_id TEXT/, "").replace(/,\s*extra_tasks INTEGER NOT NULL DEFAULT 0 CHECK \(extra_tasks BETWEEN 0 AND 20\)/, "").replace(/,\s*extra_titles TEXT NOT NULL DEFAULT '\[\]' CHECK \(json_valid\(extra_titles\)\)/, "") : sql;
  for (const r of reference) assert.equal(withoutM3Columns(r.name, migrated.get(`${r.type}:${r.name}`)), lf(r.sql), `${r.type} ${r.name} drifted from the 002 reference`);
  ref.close();
  s.close();
});

test("conversations are project-scoped: a conversation cannot point at another project's task", () => {
  const s = openStorage(":memory:");
  s.migrate(opts(MIGRATIONS));
  const r = s.raw;
  for (const p of ["p1", "p2"]) r.prepare("INSERT INTO projects VALUES (?,1,'Demo','git',?, 'active')").run(p, "/srv/" + p);
  r.prepare("INSERT INTO teams (id,revision,name,charter,pack_key,pack_version,lifecycle) VALUES ('team',1,'Software','c',NULL,NULL,'active')").run();
  r.prepare("INSERT INTO seats VALUES ('lead','team',1,'Lead','Lead','prof',1,'api-agent',1,'elastic',NULL,1)").run();
  r.prepare("INSERT INTO tasks (project_id,id,revision,code,title,goal,brief,origin_kind,state,required_capabilities_json,acceptance_json,inputs_json) VALUES ('p2','t',1,'DEV-001','T','G','B','operator','draft','[]','[]','[]')").run();
  r.prepare("INSERT INTO conversations VALUES ('p1','c1',1,'lead',NULL,'Lead chat')").run();
  assert.throws(() => r.prepare("INSERT INTO conversations VALUES ('p1','c2',1,'lead','t','x')").run(), /FOREIGN KEY/);
  r.prepare("INSERT INTO conversations VALUES ('p2','c3',1,'lead','t','x')").run();
  // Lead chat usage counts without an attempt
  r.prepare("INSERT INTO usage_records (project_id,id,conversation_id,provider,model,cost_kind,cost_unknown_reason,recorded_at) VALUES ('p1','u1','c1','9router','m','unknown','no price',?)").run(T);
  assert.throws(() => r.prepare("INSERT INTO usage_records (project_id,id,provider,model,cost_kind,cost_unknown_reason,recorded_at) VALUES ('p1','u2','9router','m','unknown','x',?)").run(T), /CHECK/);
  s.close();
});

// ---- ledger protection ----------------------------------------------------------------------------------
test("an edited migration that was already applied stops the Host and changes nothing", () => {
  const dir = migrationsCopy();
  const file = join(scratch(), "host.db");
  const s = openStorage(file);
  s.migrate(opts(dir));
  const before = s.raw.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all();
  writeFileSync(join(dir, "0001_core.sql"), readFileSync(join(dir, "0001_core.sql"), "utf8") + "\n-- sneaky edit\n");
  rejectsWith(() => s.migrate(opts(dir)), "checksum-mismatch");
  assert.deepEqual(s.raw.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all(), before);
  s.close();
});

test("line endings do not change the checksum (autocrlf checkouts)", () => {
  const sql = readFileSync(join(MIGRATIONS, "0001_core.sql"), "utf8");
  assert.equal(checksumOf(lf(sql)), checksumOf(lf(sql).replace(/\n/g, "\r\n")));
  assert.equal(checksumOf(lf(sql)), checksumOf("﻿" + lf(sql)));
  assert.notEqual(checksumOf(sql), checksumOf(sql + " "));
  const dir = migrationsCopy();
  const s = openStorage(":memory:");
  s.migrate(opts(dir));
  writeFileSync(join(dir, "0001_core.sql"), lf(readFileSync(join(dir, "0001_core.sql"), "utf8")).replace(/\n/g, "\r\n"));
  assert.deepEqual(s.migrate(opts(dir)).applied, []); // no mismatch
  s.close();
});

test("a database newer than the code, or a gap in the files, is refused", () => {
  const dir = migrationsCopy();
  writeFileSync(join(dir, "0016_more.sql"), "CREATE TABLE more (id TEXT PRIMARY KEY) STRICT;");
  const s = openStorage(":memory:");
  s.migrate(opts(dir));
  rmSync(join(dir, "0016_more.sql"));
  rejectsWith(() => s.migrate(opts(dir)), "db-ahead");
  s.close();

  const gapDir = migrationsCopy();
  writeFileSync(join(gapDir, "0017_skip.sql"), "SELECT 1;");
  rejectsWith(() => loadMigrations(gapDir), "gap");
  const badName = migrationsCopy();
  writeFileSync(join(badName, "next.sql"), "SELECT 1;");
  rejectsWith(() => loadMigrations(badName), "bad-name");
});

// ---- failure, backup, restore --------------------------------------------------------------------------
test("a failing migration rolls back completely and a backup was taken first", () => {
  const dir = migrationsCopy();
  const backupDir = join(scratch(), "backup");
  const s = openStorage(join(scratch(), "host.db"));
  s.migrate(opts(dir, backupDir));
  s.raw.prepare("INSERT INTO projects VALUES ('p1',1,'Demo','git','/srv/p1','active')").run();
  writeFileSync(join(dir, "0016_bad.sql"), "CREATE TABLE half_done (id TEXT PRIMARY KEY) STRICT;\nINSERT INTO half_done VALUES (1, 2, 3);");
  rejectsWith(() => s.migrate(opts(dir, backupDir)), "failed");
  assert.equal(tables(s.raw).includes("half_done"), false); // the CREATE was rolled back with the failure
  assert.equal(ledger(s.raw).length, 15);
  assert.equal(s.raw.inTransaction, false);
  assert.equal(s.raw.prepare("SELECT count(*) c FROM projects").get().c, 1);
  assert.equal(readdirSync(backupDir).length, 1); // taken before the attempt
  s.close();
});

test("a migration that leaves dangling references is rolled back", () => {
  const dir = migrationsCopy();
  const s = openStorage(":memory:");
  s.migrate(opts(dir));
  s.raw.prepare("INSERT INTO projects VALUES ('p1',1,'Demo','git','/srv/p1','active')").run();
  writeFileSync(
    join(dir, "0016_dangling.sql"),
    "PRAGMA defer_foreign_keys = ON;\nINSERT INTO engagements VALUES ('p1','e1','no-such-team',1,50,1,'active','2026-11-07T00:00:00.000Z');",
  );
  rejectsWith(() => s.migrate(opts(dir)), "foreign-key-violation");
  assert.equal(s.raw.prepare("SELECT count(*) c FROM engagements").get().c, 0);
  assert.equal(ledger(s.raw).length, 15);
  s.close();
});

test("the backup is a consistent copy that can be opened and restored", () => {
  const dir = migrationsCopy();
  const backupDir = join(scratch(), "backup");
  const file = join(scratch(), "host.db");
  const s = openStorage(file);
  s.migrate(opts(dir, backupDir));
  s.raw.prepare("INSERT INTO projects VALUES ('p1',1,'Before migration','git','/srv/p1','active')").run();
  writeFileSync(join(dir, "0016_more.sql"), "CREATE TABLE more (id TEXT PRIMARY KEY) STRICT;");
  const result = s.migrate(opts(dir, backupDir));
  assert.deepEqual(result.applied, [16]);
  assert.match(result.backup, /pre-migration-0016-20261107T100000Z\.db$/);
  s.close();

  const restored = new Database(result.backup, { readonly: true });
  assert.equal(restored.pragma("integrity_check", { simple: true }), "ok");
  assert.equal(restored.prepare("SELECT name FROM projects").get().name, "Before migration");
  assert.equal(restored.prepare("SELECT count(*) c FROM migration_ledger").get().c, 15); // state as of before
  assert.equal(restored.prepare("SELECT count(*) c FROM sqlite_master WHERE name='more'").get().c, 0);
  restored.close();

  // restoring = open the backup as the database and migrate forward again
  const again = openStorage(result.backup);
  assert.deepEqual(again.migrate(opts(dir, backupDir)).applied, [16]);
  assert.equal(again.raw.prepare("SELECT name FROM projects").get().name, "Before migration");
  again.close();
});

test("a database that has data is not migrated without a backup directory", () => {
  const dir = migrationsCopy();
  const s = openStorage(":memory:");
  s.migrate(opts(dir));
  writeFileSync(join(dir, "0016_more.sql"), "CREATE TABLE more (id TEXT PRIMARY KEY) STRICT;");
  rejectsWith(() => s.migrate({ migrationsDir: dir, backupDir: null, now: NOW }), "backup-failed");
  assert.equal(tables(s.raw).includes("more"), false);
  s.close();
});

// ---- restart ---------------------------------------------------------------------------------------------
test("data survives a restart, WAL is on, and the second start applies nothing", () => {
  const dir = join(scratch(), "state");
  const file = join(dir, "host.db");
  const first = openStorage(file);
  assert.equal(String(first.raw.pragma("journal_mode", { simple: true })).toLowerCase(), "wal");
  assert.equal(first.raw.pragma("synchronous", { simple: true }), 2); // FULL
  first.migrate(opts(MIGRATIONS));
  first.raw.prepare("INSERT INTO projects VALUES ('p1',1,'Persistent','git','/srv/p1','active')").run();
  first.close();

  const second = openStorage(file);
  assert.deepEqual(second.migrate(opts(MIGRATIONS)).applied, []);
  assert.equal(second.raw.prepare("SELECT name FROM projects WHERE id='p1'").get().name, "Persistent");
  second.close();
  assert.ok(existsSync(file));
});

test("a second connection sees committed data while the first holds a write transaction open elsewhere", () => {
  const file = join(scratch(), "host.db");
  const writer = openStorage(file);
  writer.migrate(opts(MIGRATIONS));
  writer.raw.prepare("INSERT INTO projects VALUES ('p1',1,'One','git','/srv/p1','active')").run();
  const reader = openStorage(file);
  writer.raw.exec("BEGIN IMMEDIATE");
  writer.raw.prepare("INSERT INTO projects VALUES ('p2',1,'Two','git','/srv/p2','active')").run();
  assert.equal(reader.raw.prepare("SELECT count(*) c FROM projects").get().c, 1); // WAL: no dirty read, no blocking
  writer.raw.exec("COMMIT");
  assert.equal(reader.raw.prepare("SELECT count(*) c FROM projects").get().c, 2);
  reader.close();
  writer.close();
});

// ---- Kysely ---------------------------------------------------------------------------------------------------
test("Kysely reads and writes through the same connection, and receipts dedupe by command id", async () => {
  const s = openStorage(":memory:");
  s.migrate(opts(MIGRATIONS));
  await s.db.insertInto("projects").values({ id: "p1", revision: 1, name: "Via Kysely", workspace_kind: "git", workspace_root: "/srv/p1", disposition: "active" }).execute();
  const row = await s.db.selectFrom("projects").selectAll().where("id", "=", "p1").executeTakeFirstOrThrow();
  assert.equal(row.name, "Via Kysely");
  const receipt = { command_id: "c1", project_id: "p1", actor_id: "operator", fingerprint: H, state: "completed", response_json: "{}", created_at: T };
  await s.db.insertInto("command_receipts").values(receipt).execute();
  await assert.rejects(s.db.insertInto("command_receipts").values(receipt).execute(), /UNIQUE|PRIMARY/);
  s.close();
});

test("opening a path whose parent is a file fails with a typed error", () => {
  const dir = scratch();
  const blocker = join(dir, "blocker");
  writeFileSync(blocker, "x");
  assert.throws(() => openStorage(join(blocker, "host.db")), (e) => e.name === "StorageError" && e.code === "open-failed");
  mkdirSync(join(dir, "ok"));
});
