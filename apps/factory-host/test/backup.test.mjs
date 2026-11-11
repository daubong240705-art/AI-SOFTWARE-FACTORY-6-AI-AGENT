import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import Database from "better-sqlite3";
import { API_VERSION } from "@factory/contracts";
import { createBackupService } from "../dist/backup/service.js";
import { startBackupScheduler } from "../dist/backup/scheduler.js";
import { restoreBackup } from "../dist/backup/restore.js";
import { openStorage } from "../dist/storage/database.js";
import { parseEnv, startHost } from "../dist/host.js";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const cli = fileURLToPath(new URL("../dist/backup/cli.js", import.meta.url));
const now = "2026-11-07T10:11:12.000Z";
const clock = () => new Date(now);
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const cleanup = new Map();
const rows = (raw, table) => {
  const queries = {
    projects: "SELECT * FROM projects ORDER BY id", tasks: "SELECT * FROM tasks ORDER BY id",
    messages: "SELECT * FROM messages ORDER BY id", teams: "SELECT * FROM teams ORDER BY id",
    events: "SELECT * FROM event_log ORDER BY sequence", cursor: "SELECT * FROM project_streams ORDER BY project_id",
  };
  return raw.prepare(queries[table]).all();
};
function temp(t) {
  const root = fs.mkdtempSync(join(tmpdir(), "factory-backup-"));
  cleanup.set(root, []);
  t.after(async () => {
    for (const close of cleanup.get(root).reverse()) await close();
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + "factory-backup-"));
    fs.rmSync(root, { recursive: true, force: true });
    cleanup.delete(root);
  });
  return root;
}
function insertProject(raw, id = "project") {
  raw.prepare("INSERT INTO projects VALUES (?,1,?,'directory',?,'active')").run(id, `Project ${id}`, `/workspace/${id}`);
}
function fixture(t, options = {}) {
  const root = temp(t);
  const storage = openStorage(join(root, "state", "host.db"));
  storage.migrate({ migrationsDir, backupDir: null, now: clock });
  cleanup.get(root).push(() => storage.close());
  const dir = join(root, "backup");
  const service = createBackupService({ storage, dir, clock, ...options });
  return { root, storage, dir, service };
}
function backup(f, reason = "manual") {
  const result = f.service.run(reason);
  assert.equal(result.ok, true, JSON.stringify(result));
  return join(f.dir, result.backup.file);
}
function inspect(file, fn) {
  const raw = new Database(file, { readonly: true, fileMustExist: true });
  try { return fn(raw); } finally { raw.close(); }
}
function wrapped(storage, mutate) {
  return { ...storage, raw: new Proxy(storage.raw, { get(target, key) {
    if (key === "prepare") return (sql) => {
      const statement = target.prepare(sql);
      return sql === "VACUUM INTO ?" ? { run(file) { const result = statement.run(file); mutate(file); return result; } } : statement;
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } }) };
}
const name = (at, reason = "hourly", suffix = "") => `factory-${new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${reason}${suffix}.db`;
const seed = (dir, at, reason = "hourly", suffix = "") => { const file = name(at, reason, suffix); fs.writeFileSync(join(dir, file), "retention fixture"); return file; };

test("backup uses UTC filename, creates private directory, and reports success", (t) => {
  const f = fixture(t);
  const file = backup(f);
  assert.equal(file, join(f.dir, "factory-20261107T101112Z-manual.db"));
  if (process.platform !== "win32") assert.equal(fs.statSync(f.dir).mode & 0o777, 0o700);
  assert.deepEqual(f.service.status(), { lastSuccessAt: now, lastError: null, lastErrorAt: null,
    count: 1, lastFile: "factory-20261107T101112Z-manual.db" });
});
for (const reason of ["hourly", "shutdown", "manual"])
  test(`backup filename encodes ${reason}`, (t) => { const f = fixture(t); assert.ok(backup(f, reason).endsWith(`-${reason}.db`)); });
test("same-second collisions add increasing suffixes and preserve older bytes", (t) => {
  const f = fixture(t);
  const first = backup(f); const digest = hash(first);
  assert.ok(backup(f).endsWith("-manual-1.db"));
  assert.ok(backup(f).endsWith("-manual-2.db"));
  assert.equal(hash(first), digest);
  assert.ok(f.service.list()[0].file.endsWith("-2.db"));
});
test("verified snapshot contains committed projects and tasks and live WAL keeps working", (t) => {
  const f = fixture(t);
  insertProject(f.storage.raw);
  f.storage.raw.prepare("INSERT INTO tasks (project_id,id,revision,code,title,goal,brief,origin_kind,state,required_capabilities_json,acceptance_json,inputs_json) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("project", "task", "DEV-001", "Backup", "Preserve tasks", "Test", "operator", "draft", "[]", "[]", "[]");
  const file = backup(f);
  inspect(file, (raw) => {
    assert.equal(raw.pragma("integrity_check", { simple: true }), "ok");
    assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
    assert.deepEqual(rows(raw, "projects"), rows(f.storage.raw, "projects"));
    assert.deepEqual(rows(raw, "tasks"), rows(f.storage.raw, "tasks"));
  });
  insertProject(f.storage.raw, "after");
  assert.equal(f.storage.raw.prepare("SELECT COUNT(*) AS n FROM projects").get().n, 2);
  assert.equal(inspect(file, (raw) => raw.prepare("SELECT COUNT(*) AS n FROM projects").get().n), 1);
  assert.equal(f.storage.raw.pragma("journal_mode", { simple: true }), "wal");
});
test("another connection can read and commit during VACUUM workflow", (t) => {
  const f = fixture(t); const writer = new Database(f.storage.file);
  cleanup.get(f.root).push(() => writer.close());
  let writes = 0;
  const storage = wrapped(f.storage, () => {
    assert.equal(writer.prepare("SELECT COUNT(*) AS n FROM projects").get().n, writes);
    if (writes++ === 0) insertProject(writer, "concurrent");
  });
  const service = createBackupService({ storage, dir: f.dir, clock });
  assert.equal(service.run("manual").ok, true);
  assert.equal(writer.prepare("SELECT COUNT(*) AS n FROM projects").get().n, 1);
});
for (const [label, mutate] of [
  ["corrupt bytes", (file) => fs.writeFileSync(file, "not sqlite")],
  ["truncated file", (file) => fs.truncateSync(file, 128)],
  ["ledger version mismatch", (file) => { const db = new Database(file); try { db.prepare("UPDATE migration_ledger SET version = ?").run(2); } finally { db.close(); } }],
  ["project count mismatch", (file) => { const db = new Database(file); try { insertProject(db, "extra"); } finally { db.close(); } }],
  ["missing migration ledger", (file) => { const db = new Database(file); try { db.exec("DROP TABLE migration_ledger"); } finally { db.close(); } }],
  ["foreign key violation", (file) => { const db = new Database(file); try { db.pragma("foreign_keys = OFF"); db.prepare("INSERT INTO project_streams VALUES (?, ?, ?)").run("missing", "epoch", 0); } finally { db.close(); } }],
]) test(`rejects ${label}; cleans temporary file and preserves old backups`, (t) => {
  const f = fixture(t); const old = backup(f); const digest = hash(old);
  const service = createBackupService({ storage: wrapped(f.storage, mutate), dir: f.dir, clock });
  assert.deepEqual(service.run("hourly"), { ok: false, error: "backup failed" });
  assert.deepEqual(fs.readdirSync(f.dir), [old.slice(f.dir.length + 1)]);
  assert.equal(hash(old), digest);
  assert.equal(service.status().lastError, "backup failed");
  assert.equal(service.status().lastErrorAt, now);
  assert.ok(!JSON.stringify(service.status()).includes(f.root));
});
test("snapshot mismatch caused by a concurrent commit retries once", (t) => {
  const f = fixture(t); let attempts = 0;
  const raw = new Proxy(f.storage.raw, { get(target, key) {
    if (key === "prepare") return (sql) => {
      if (sql === "VACUUM INTO ?" && attempts++ === 0) insertProject(target, "racing");
      return target.prepare(sql);
    };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  const service = createBackupService({ storage: { ...f.storage, raw }, dir: f.dir, clock });
  assert.equal(service.run("manual").ok, true);
  assert.equal(attempts, 2);
  assert.equal(service.list().length, 1);
});
test("permanent mismatch retries exactly once", (t) => {
  const f = fixture(t); let attempts = 0;
  const service = createBackupService({ storage: wrapped(f.storage, (file) => {
    attempts++; const db = new Database(file); insertProject(db, "mismatch"); db.close();
  }), dir: f.dir, clock });
  assert.equal(service.run("manual").ok, false);
  assert.equal(attempts, 2);
  assert.deepEqual(fs.readdirSync(f.dir), []);
});
test("reentrant concurrent run is refused without disturbing the outer backup", (t) => {
  const f = fixture(t); let second; let service;
  service = createBackupService({ storage: wrapped(f.storage, () => { second = service.run("hourly"); }), dir: f.dir, clock });
  assert.equal(service.run("manual").ok, true);
  assert.deepEqual(second, { ok: false, error: "backup already running" });
  assert.equal(service.status().count, 1);
});
test("failed VACUUM resets the running guard and a subsequent run succeeds", (t) => {
  const f = fixture(t); let fails = true;
  const service = createBackupService({ storage: wrapped(f.storage, () => { if (fails) throw new Error("SQL secret path"); }), dir: f.dir, clock });
  assert.equal(service.run("manual").ok, false); fails = false;
  assert.equal(service.run("manual").ok, true);
  assert.equal(service.status().lastError, null);
});
test("publish failure leaves no temp file and preserves older backups", (t) => {
  const f = fixture(t); const old = backup(f); const digest = hash(old);
  t.mock.method(fs, "renameSync", () => { throw new Error("injected publish failure"); });
  assert.equal(f.service.run("hourly").ok, false);
  assert.deepEqual(fs.readdirSync(f.dir), [old.slice(f.dir.length + 1)]);
  assert.equal(hash(old), digest);
});
for (const [label, getDir] of [
  ["live state directory", (f) => join(f.root, "state")],
  ["relative directory", () => "backup/relative"],
  ["live file namespace", (f) => `${f.storage.file}/child`],
  ["WAL namespace", (f) => `${f.storage.file}-wal/child`],
  ["SHM namespace", (f) => `${f.storage.file}-shm/child`],
  ["directory containing host.db", (f) => { const dir = join(f.root, "unsafe"); fs.mkdirSync(dir); fs.writeFileSync(join(dir, "host.db"), "keep"); return dir; }],
]) test(`construction refuses ${label}`, (t) => {
  const f = fixture(t);
  assert.throws(() => createBackupService({ storage: f.storage, dir: getDir(f) }), /Backup directory/);
});
test("directory junction alias to live state is refused", (t) => {
  const f = fixture(t); const alias = join(f.root, "alias");
  fs.symlinkSync(join(f.root, "state"), alias, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => createBackupService({ storage: f.storage, dir: alias }), /Backup directory/);
});
test("list uses filename timestamps, ignores junk, invalid dates, directories, and sorts newest first", (t) => {
  const f = fixture(t);
  const older = seed(f.dir, "2026-11-04T12:00:00Z"); const newer = seed(f.dir, "2026-11-06T13:00:00Z", "shutdown");
  fs.utimesSync(join(f.dir, older), new Date("2030-01-01"), new Date("2030-01-01"));
  for (const junk of ["README", ".tmp-test.db", "host.db", "factory-20260230T000000Z-hourly.db", "factory-20261107T000000Z-unknown.db", "factory-20261107T000000Z-hourly-0.db"])
    fs.writeFileSync(join(f.dir, junk), "untouched");
  fs.mkdirSync(join(f.dir, name(now)));
  assert.deepEqual(f.service.list().map((b) => b.file), [newer, older]);
  assert.equal(f.service.list()[0].at.toISOString(), "2026-11-06T13:00:00.000Z");
  assert.equal(f.service.list()[0].sizeBytes, Buffer.byteLength("retention fixture"));
});
for (const scenario of [
  { label: "all hourly backups within 48 hours", keep: { minNewest: 0 },
    dates: ["2026-11-07T09:00:00Z", "2026-11-07T08:00:00Z", "2026-11-06T01:00:00Z"], retained: [0, 1, 2] },
  { label: "only newest UTC backup per older day", keep: { minNewest: 0 },
    dates: ["2026-11-03T23:00:00Z", "2026-11-03T02:00:00Z", "2026-11-02T23:00:00Z", "2026-11-02T22:00:00Z"], retained: [0, 2] },
  { label: "UTC 14 calendar day cap", keep: { minNewest: 0 },
    dates: ["2026-10-25T00:00:00Z", "2026-10-24T23:59:59Z", "2026-10-20T00:00:00Z"], retained: [0] },
  { label: "newest three protected even when every existing backup is old", keep: {},
    dates: ["2025-01-01T01:00:00Z", "2025-01-02T01:00:00Z", "2025-01-03T01:00:00Z", "2025-01-04T01:00:00Z"], retained: [2, 3] },
  { label: "all old backups protected with larger minNewest", keep: { minNewest: 5 },
    dates: ["2020-01-01T00:00:00Z", "2020-01-02T00:00:00Z", "2020-01-03T00:00:00Z"], retained: [0, 1, 2] },
  { label: "disabled daily tier", keep: { hourlyHours: 1, dailyDays: 0, minNewest: 0 },
    dates: ["2026-11-06T23:00:00Z", "2026-11-05T00:00:00Z"], retained: [] },
  { label: "UTC day boundary chooses latest despite mtime", keep: { minNewest: 0 },
    dates: ["2026-11-01T23:59:59Z", "2026-11-02T00:00:00Z", "2026-11-01T00:00:00Z"], retained: [0, 1] },
]) test(`retention: ${scenario.label}`, (t) => {
  const f = fixture(t, { keep: scenario.keep }); const files = scenario.dates.map((at) => seed(f.dir, at));
  backup(f);
  for (const [index, file] of files.entries()) assert.equal(fs.existsSync(join(f.dir, file)), scenario.retained.includes(index), file);
});
test("retention preserves unrelated and malformed filenames", (t) => {
  const f = fixture(t, { keep: { hourlyHours: 0, dailyDays: 0, minNewest: 0 } });
  const junk = ["host.db", "notes.txt", ".tmp-123.db", "factory-20200101T000000Z-other.db", "factory-20201301T000000Z-hourly.db"];
  for (const file of junk) fs.writeFileSync(join(f.dir, file), "keep this");
  backup(f);
  for (const file of junk) assert.equal(fs.readFileSync(join(f.dir, file), "utf8"), "keep this");
});
test("retention deletion failure records a generic error without failing the backup", (t) => {
  const f = fixture(t, { keep: { minNewest: 0 } }); const old = seed(f.dir, "2020-01-01T00:00:00Z");
  const unlink = fs.unlinkSync;
  t.mock.method(fs, "unlinkSync", (path) => { if (path === join(f.dir, old)) throw new Error("private error"); return unlink(path); });
  backup(f);
  assert.equal(f.service.status().lastSuccessAt, now);
  assert.equal(f.service.status().lastError, "backup retention deletion failed");
  assert.equal(fs.existsSync(join(f.dir, old)), true);
});
test("invalid retention is refused", (t) => {
  const f = fixture(t);
  for (const keep of [{ minNewest: -1 }, { dailyDays: 1.5 }, { hourlyHours: NaN }])
    assert.throws(() => createBackupService({ storage: f.storage, dir: f.dir, keep }), /retention/);
});

function fakeTimers() {
  let milliseconds = Date.parse(now); let id = 0; const pending = new Map(); let unrefs = 0;
  const timers = {
    setTimeout(callback, delay) { const handle = { id: ++id, unref() { unrefs++; } }; pending.set(handle, { callback, due: milliseconds + delay }); return handle; },
    clearTimeout(handle) { pending.delete(handle); },
  };
  return { timers, clock: () => new Date(milliseconds), pending, get unrefs() { return unrefs; },
    async tick(ms) { milliseconds += ms; const ready = [...pending.entries()].filter(([, item]) => item.due <= milliseconds);
      for (const [handle, item] of ready) { pending.delete(handle); item.callback(); }
      for (let i = 0; i < 8; i++) await Promise.resolve();
    },
  };
}
test("scheduler defaults to first run after 5s then hourly and unrefs its timers", async () => {
  const f = fakeTimers(); const calls = [];
  const scheduler = startBackupScheduler({ ...f, service: { run(reason) { calls.push(reason); return { ok: false, error: "test" }; } } });
  await f.tick(4999); assert.deepEqual(calls, []);
  await f.tick(1); assert.deepEqual(calls, ["hourly"]);
  await f.tick(3_599_999); assert.equal(calls.length, 1);
  await f.tick(1); assert.equal(calls.length, 2); assert.equal(f.unrefs, 3);
  await scheduler.stop(); assert.equal(f.pending.size, 0);
});
test("scheduler custom delays and interval use injected timers", async () => {
  const f = fakeTimers(); let calls = 0;
  const s = startBackupScheduler({ ...f, firstRunDelayMs: 10, intervalMs: 100, service: { run() { calls++; return { ok: true }; } } });
  await f.tick(9); assert.equal(calls, 0); await f.tick(1); assert.equal(calls, 1);
  await f.tick(100); assert.equal(calls, 2); await s.stop();
});
test("scheduler never overlaps a pending backup and skips missed intervals", async () => {
  const f = fakeTimers(); let resolveRun; let calls = 0;
  const s = startBackupScheduler({ ...f, firstRunDelayMs: 0, intervalMs: 100, service: { run() { calls++; return new Promise((r) => { resolveRun = r; }); } } });
  await f.tick(0); await f.tick(450); assert.equal(calls, 1); assert.equal(f.pending.size, 0);
  resolveRun({ ok: true }); await f.tick(0); assert.equal(f.pending.size, 1);
  await f.tick(49); assert.equal(calls, 1); await f.tick(1); assert.equal(calls, 2);
  resolveRun({ ok: true }); await s.stop();
});
test("scheduler catches thrown and rejected failures and continues", async () => {
  const f = fakeTimers(); let calls = 0;
  const s = startBackupScheduler({ ...f, firstRunDelayMs: 0, intervalMs: 100, service: { run() {
    if (++calls === 1) throw new Error("failed"); return Promise.reject(new Error("failed again"));
  } } });
  await f.tick(0); await f.tick(100); await f.tick(100); assert.equal(calls, 3); await s.stop();
});
test("scheduler stop waits for running backup and is idempotent", async () => {
  const f = fakeTimers(); let resolveRun; let stopped = false;
  const s = startBackupScheduler({ ...f, firstRunDelayMs: 0, service: { run() { return new Promise((r) => { resolveRun = r; }); } } });
  await f.tick(0); const stopping = s.stop().then(() => { stopped = true; });
  await f.tick(10_000); assert.equal(stopped, false);
  resolveRun({ ok: true }); await stopping; await s.stop(); assert.equal(f.pending.size, 0);
});
test("scheduler stop before first run clears timer and never runs", async () => {
  const f = fakeTimers(); let calls = 0;
  const s = startBackupScheduler({ ...f, service: { run() { calls++; return { ok: true }; } } });
  await s.stop(); await f.tick(500_000); assert.equal(calls, 0);
});

async function hostFixture(t, periodicBackup) {
  const root = temp(t); let token;
  const host = await startHost({ stateDir: join(root, "state"), port: 0, clock, onBootstrapToken(value) { token = value; },
    periodicBackup: periodicBackup === undefined ? { dir: join(root, "backups"), firstRunDelayMs: 60_000 } : periodicBackup,
  });
  cleanup.get(root).push(() => host.close());
  const authority = `127.0.0.1:${host.port}`; const origin = `http://${authority}`;
  const auth = await host.app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host: authority, origin, "content-type": "application/json" }, payload: { token } });
  assert.equal(auth.statusCode, 200);
  const cookie = auth.headers["set-cookie"].split(";")[0];
  const headers = { host: authority, origin, cookie, "x-csrf-token": auth.json().csrfToken, "content-type": "application/json" };
  return { root, host, authority, headers,
    get: (url, authorized = true) => host.app.inject({ method: "GET", url, headers: authorized ? { host: authority, cookie } : { host: authority } }),
    async command(type, projectId, payload) {
      const response = await host.app.inject({ method: "POST", url: "/commands", headers, payload: { apiVersion: API_VERSION, commandId: randomUUID(), projectId, type, payload } });
      assert.equal(response.statusCode, 200, response.body); return response.json();
    },
  };
}
test("Host scheduled backup appears shortly after start", async (t) => {
  const root = temp(t); const f = await hostFixture(t, { dir: join(root, "backups"), firstRunDelayMs: 1, intervalMs: 3_600_000 });
  for (let i = 0; i < 100 && f.host.backup.status().count === 0; i++) await new Promise((r) => setTimeout(r, 2));
  assert.equal(f.host.backup.status().count, 1);
  assert.equal(f.host.backup.service.list()[0].reason, "hourly");
});
test("Host shutdown backup includes last committed data and close is idempotent", async (t) => {
  const f = await hostFixture(t); insertProject(f.host.storage.raw, "last");
  const closing = f.host.close(); assert.equal(f.host.close(), closing); await closing;
  assert.equal(f.host.storage.raw.open, false);
  const info = f.host.backup.service.list()[0]; assert.equal(info.reason, "shutdown");
  inspect(join(f.root, "backups", info.file), (raw) => assert.equal(raw.prepare("SELECT id FROM projects").get().id, "last"));
});
test("failed shutdown backup to unavailable directory still closes Host", async (t) => {
  const f = await hostFixture(t); const dir = join(f.root, "backups");
  fs.rmdirSync(dir); fs.writeFileSync(dir, "unwritable directory");
  await f.host.close(); assert.equal(f.host.storage.raw.open, false); assert.equal(f.host.app.server.listening, false);
  assert.equal(f.host.backup.status().lastError, "backup listing failed");
});
test("GET /system/backups requires a session and returns backup status", async (t) => {
  const f = await hostFixture(t);
  assert.equal((await f.get("/system/backups", false)).statusCode, 401);
  assert.deepEqual((await f.get("/system/backups")).json(), { apiVersion: API_VERSION, ok: true, backup: f.host.backup.status() });
  f.host.backup.service.run("manual");
  assert.equal((await f.get("/system/backups")).json().backup.count, 1);
});
test("disabled Host backups return null", async (t) => {
  const f = await hostFixture(t, null); assert.equal(f.host.backup, null);
  assert.deepEqual((await f.get("/system/backups")).json(), { apiVersion: API_VERSION, ok: true, backup: null });
  await f.host.close(); assert.equal(fs.existsSync(join(f.root, "backups")), false);
});

for (const target of ["fresh", "same"]) test(`RESTORE DRILL: destroy live DB and restore ${target} state with projects/team/tasks/messages/events/cursor`, async (t) => {
  const f = await hostFixture(t); const projectId = randomUUID(); const taskId = randomUUID(); const conversationId = randomUUID();
  await f.command("projects.create", projectId, { name: "Restore drill", workspace: { kind: "directory", root: `/workspace/${projectId}` } });
  const team = (await f.get(`/projects/${projectId}/team`)).json(); assert.ok(team.team.id);
  await f.command("tasks.create", projectId, { taskId, code: "BK-001", title: "Protect data", goal: "Prove restore", brief: "Drill", parentTaskId: null,
    engagementId: team.engagement.id, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] });
  await f.command("conversations.create", projectId, { conversationId, agentId: team.seats.find((seat) => seat.isLead).id, title: "Drill", workItemId: taskId });
  await f.command("chat.send", projectId, { conversationId, expectedRevision: 1, messageId: randomUUID(), text: "Keep this message",
    attachmentIds: [], intent: "discuss", context: [], draftRevision: null });
  await f.host.lead.idle();
  const expected = Object.fromEntries(["projects", "teams", "tasks", "messages", "events", "cursor"].map((table) => [table, rows(f.host.storage.raw, table)]));
  assert.ok(expected.tasks.length && expected.messages.length && expected.events.length);
  const result = f.host.backup.service.run("manual"); assert.equal(result.ok, true);
  const file = join(f.root, "backups", result.backup.file); const digest = hash(file);
  await f.host.close();
  const live = join(f.root, "state", "host.db"); fs.writeFileSync(live, "destroyed original database");
  const stateDir = join(f.root, target === "same" ? "state" : "fresh");
  const restored = restoreBackup({ backupFile: file, stateDir, migrationsDir, clock });
  if (target === "same") assert.equal(fs.readFileSync(restored.previousDatabase, "utf8"), "destroyed original database");
  else assert.equal(restored.previousDatabase, null);
  assert.equal(hash(file), digest);
  const storage = openStorage(join(stateDir, "host.db"));
  try {
    assert.deepEqual(storage.migrate({ migrationsDir, backupDir: null }).applied, []);
    for (const [table, value] of Object.entries(expected)) assert.deepEqual(rows(storage.raw, table), value, table);
  } finally { storage.close(); }
  let token; const restarted = await startHost({ stateDir, port: 0, onBootstrapToken(value) { token = value; } });
  cleanup.get(f.root).push(() => restarted.close());
  const authority = `127.0.0.1:${restarted.port}`;
  const auth = await restarted.app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host: authority, origin: `http://${authority}`, "content-type": "application/json" }, payload: { token } });
  const response = await restarted.app.inject({ method: "GET", url: `/projects/${projectId}/tasks`, headers: { host: authority, cookie: auth.headers["set-cookie"].split(";")[0] } });
  assert.equal(response.statusCode, 200); assert.equal(response.json().items[0].id, taskId);
  assert.deepEqual(restarted.hub.currentCursor(projectId), { epoch: expected.cursor[0].epoch, sequence: String(expected.cursor[0].last_sequence) });
  await restarted.close();
});
test("restore preserves previous database under stamped archive and leaves backup hash unchanged", (t) => {
  const f = fixture(t); insertProject(f.storage.raw, "original"); const file = backup(f); const digest = hash(file);
  insertProject(f.storage.raw, "later"); f.storage.close();
  const result = restoreBackup({ backupFile: file, stateDir: join(f.root, "state"), clock });
  assert.equal(result.previousDatabase, join(f.root, "state", "pre-restore-20261107T101112Z", "host.db"));
  assert.equal(inspect(result.previousDatabase, (raw) => rows(raw, "projects").length), 2);
  assert.equal(inspect(join(f.root, "state", "host.db"), (raw) => rows(raw, "projects").length), 1);
  assert.equal(hash(file), digest);
  const second = restoreBackup({ backupFile: file, stateDir: join(f.root, "state"), clock });
  assert.ok(second.previousDatabase.includes("pre-restore-20261107T101112Z-1"));
});
for (const kind of ["corrupt", "missing", "truncated"]) test(`restore refuses ${kind} backup without changing live data`, (t) => {
  const f = fixture(t); insertProject(f.storage.raw); const file = backup(f);
  if (kind === "corrupt") fs.writeFileSync(file, "broken");
  else if (kind === "missing") fs.unlinkSync(file); else fs.truncateSync(file, 100);
  assert.throws(() => restoreBackup({ backupFile: file, stateDir: join(f.root, "state") }), /Backup verification failed/);
  assert.equal(rows(f.storage.raw, "projects").length, 1);
  assert.equal(fs.existsSync(join(f.root, "state", "host.db.restoring")), false);
});
for (const stateDir of ["relative", "/mnt/d/state", "/mnt", "/mnt/e/../d/state", "\\mnt\\d\\state"])
  test(`restore refuses unsafe target ${stateDir}`, (t) => {
    const f = fixture(t); const file = backup(f);
    assert.throws(() => restoreBackup({ backupFile: file, stateDir }), /state directory must/);
  });
test("restore refuses locked live database", (t) => {
  const f = fixture(t); insertProject(f.storage.raw); const file = backup(f); f.storage.raw.exec("BEGIN EXCLUSIVE");
  try { assert.throws(() => restoreBackup({ backupFile: file, stateDir: join(f.root, "state") }), /locked.*stop the Host/); }
  finally { f.storage.raw.exec("ROLLBACK"); }
  assert.equal(rows(f.storage.raw, "projects").length, 1);
});
test("restore refuses an idle running Host even without a SQLite write transaction", async (t) => {
  const f = await hostFixture(t);
  const result = f.host.backup.service.run("manual"); assert.equal(result.ok, true);
  const file = join(f.root, "backups", result.backup.file);
  assert.throws(() => restoreBackup({ backupFile: file, stateDir: join(f.root, "state") }), /in use.*stop the Host/);
  assert.equal(f.host.storage.raw.open, true);
  assert.equal((await f.get("/projects")).statusCode, 200);
});
test("restore preserves old WAL and SHM files after an interrupted writer exits", (t) => {
  const f = fixture(t); const file = backup(f); f.storage.close();
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import Database from 'better-sqlite3';
    const db = new Database(process.argv[1]);
    db.prepare("INSERT INTO projects VALUES (?,1,?,'directory',?,'active')").run('wal-project','In WAL','/workspace/wal');
    process.exit(0);
  `, f.storage.file], { encoding: "utf8", timeout: 5000 });
  assert.ifError(r.error); assert.equal(r.status, 0, r.stderr);
  const wal = `${f.storage.file}-wal`; const shm = `${f.storage.file}-shm`;
  assert.ok(fs.existsSync(wal)); assert.ok(fs.existsSync(shm)); const digest = hash(wal);
  const result = restoreBackup({ backupFile: file, stateDir: join(f.root, "state"), clock });
  assert.ok(fs.existsSync(`${result.previousDatabase}-wal`)); assert.ok(fs.existsSync(`${result.previousDatabase}-shm`));
  assert.equal(hash(`${result.previousDatabase}-wal`), digest);
  assert.equal(fs.existsSync(wal), false); assert.equal(fs.existsSync(shm), false);
  assert.equal(inspect(result.previousDatabase, (raw) => rows(raw, "projects").length), 1);
});
test("restore rolls back all previously moved files when a sidecar move fails", (t) => {
  const f = fixture(t); const file = backup(f); f.storage.close();
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import Database from 'better-sqlite3';
    const db = new Database(process.argv[1]);
    db.prepare("INSERT INTO projects VALUES (?,1,?,'directory',?,'active')").run('wal-project','In WAL','/workspace/wal');
    process.exit(0);
  `, f.storage.file], { encoding: "utf8", timeout: 5000 });
  assert.ifError(r.error); assert.equal(r.status, 0, r.stderr);
  const digest = hash(f.storage.file); const wal = `${f.storage.file}-wal`; const walHash = hash(wal);
  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => { if (from === wal) throw new Error("sidecar move failure"); return rename(from, to); });
  assert.throws(() => restoreBackup({ backupFile: file, stateDir: join(f.root, "state"), clock }), /previous database preserved/);
  assert.equal(hash(f.storage.file), digest); assert.equal(hash(wal), walHash);
  assert.equal(inspect(f.storage.file, (raw) => rows(raw, "projects").length), 1);
});
test("Host state ownership lock prevents a second Host and is released on close", async (t) => {
  const f = await hostFixture(t);
  await assert.rejects(startHost({ stateDir: join(f.root, "state"), port: 0, onBootstrapToken() {} }), /State directory is in use/);
  assert.equal((await f.get("/projects")).statusCode, 200);
  await f.host.close(); assert.equal(fs.existsSync(join(f.root, "state", ".host-running")), false);
});
test("restore reclaims an owner lock left by an exited process", (t) => {
  const f = fixture(t); const file = backup(f); f.storage.close();
  const r = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8", timeout: 5000 });
  assert.ifError(r.error); assert.equal(r.status, 0);
  const marker = join(f.root, "state", ".host-running");
  fs.writeFileSync(marker, JSON.stringify({ pid: Number(r.stdout), token: "exited-owner" }));
  restoreBackup({ backupFile: file, stateDir: join(f.root, "state"), clock });
  assert.equal(fs.existsSync(marker), false);
});
test("restore failed copy leaves previous database intact", (t) => {
  const f = fixture(t); insertProject(f.storage.raw); const file = backup(f); f.storage.close(); const live = join(f.root, "state", "host.db"); const digest = hash(live);
  t.mock.method(fs, "copyFileSync", () => { throw new Error("injected copy failure"); });
  assert.throws(() => restoreBackup({ backupFile: file, stateDir: join(f.root, "state") }), /previous database preserved/);
  assert.equal(hash(live), digest); assert.equal(fs.existsSync(`${live}.restoring`), false);
});
test("restore failed final rename moves previous database back", (t) => {
  const f = fixture(t); insertProject(f.storage.raw); const file = backup(f); f.storage.close(); const live = join(f.root, "state", "host.db"); const digest = hash(live);
  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => { if (from === `${live}.restoring`) throw new Error("injected rename failure"); return rename(from, to); });
  assert.throws(() => restoreBackup({ backupFile: file, stateDir: join(f.root, "state") }), /previous database preserved/);
  assert.equal(hash(live), digest); assert.equal(fs.existsSync(`${live}.restoring`), false);
});
test("restore re-verifies copied file before moving previous database", (t) => {
  const f = fixture(t); const file = backup(f); f.storage.close(); const live = join(f.root, "state", "host.db"); const digest = hash(live);
  const copy = fs.copyFileSync;
  t.mock.method(fs, "copyFileSync", (from, to, flags) => { copy(from, to, flags); fs.truncateSync(to, 100); });
  assert.throws(() => restoreBackup({ backupFile: file, stateDir: join(f.root, "state") }), /previous database preserved/);
  assert.equal(hash(live), digest); assert.equal(fs.existsSync(`${live}.restoring`), false);
});
test("restore rejects a copied database whose project count differs from the verified source", (t) => {
  const f = fixture(t); const file = backup(f); f.storage.close(); const digest = hash(f.storage.file);
  const copy = fs.copyFileSync;
  t.mock.method(fs, "copyFileSync", (from, to, flags) => {
    copy(from, to, flags); const db = new Database(to);
    try { insertProject(db, "changed-during-copy"); } finally { db.close(); }
  });
  assert.throws(() => restoreBackup({ backupFile: file, stateDir: join(f.root, "state") }), /previous database preserved/);
  assert.equal(hash(f.storage.file), digest);
});
test("invalid backup clock returns a generic failure and resets the running guard", (t) => {
  const f = fixture(t); let invalid = true;
  const service = createBackupService({ storage: f.storage, dir: f.dir, clock: () => invalid ? new Date(NaN) : clock() });
  assert.deepEqual(service.run("manual"), { ok: false, error: "backup failed" });
  assert.deepEqual(fs.readdirSync(f.dir), []);
  invalid = false; assert.equal(service.run("manual").ok, true);
});
test("restore checksum comparison is optional but validates shipped migrations when supplied", (t) => {
  const f = fixture(t); const file = backup(f); const db = new Database(file); db.prepare("UPDATE migration_ledger SET checksum = ?").run("a".repeat(64)); db.close();
  assert.throws(() => restoreBackup({ backupFile: file, stateDir: join(f.root, "checked"), migrationsDir }), /verification failed/);
  assert.equal(fs.existsSync(join(f.root, "checked")), false);
  restoreBackup({ backupFile: file, stateDir: join(f.root, "unchecked") });
  assert.ok(fs.existsSync(join(f.root, "unchecked", "host.db")));
});
test("restore source cannot be the target database", (t) => {
  const f = fixture(t);
  assert.throws(() => restoreBackup({ backupFile: f.storage.file, stateDir: join(f.root, "state") }), /separate/);
});
test("restore does not overwrite a prior interrupted staging file", (t) => {
  const f = fixture(t); const file = backup(f); const stage = `${f.storage.file}.restoring`; fs.writeFileSync(stage, "preserve");
  assert.throws(() => restoreBackup({ backupFile: file, stateDir: join(f.root, "state") }), /staging file already exists/);
  assert.equal(fs.readFileSync(stage, "utf8"), "preserve");
});
test("CLI list returns JSON and exit 0", (t) => {
  const f = fixture(t); backup(f);
  const r = spawnSync(process.execPath, [cli, "list", f.dir], { encoding: "utf8", timeout: 5000 });
  assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, "");
  assert.equal(JSON.parse(r.stdout)[0].file, f.service.list()[0].file);
});
test("CLI restore with migrations succeeds and keeps the backup", (t) => {
  const f = fixture(t); insertProject(f.storage.raw); const file = backup(f); const digest = hash(file); const stateDir = join(f.root, "restored");
  const r = spawnSync(process.execPath, [cli, "restore", file, stateDir, "--migrations", migrationsDir], { encoding: "utf8", timeout: 5000 });
  assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, "");
  assert.equal(JSON.parse(r.stdout).previousDatabase, null); assert.equal(hash(file), digest);
  assert.equal(inspect(join(stateDir, "host.db"), (raw) => rows(raw, "projects").length), 1);
});
for (const [label, args] of [["usage", []], ["missing list directory", ["list", "missing-directory"]], ["missing backup", ["restore", "missing.db", "/state"]]])
  test(`CLI ${label} exits 1 with one line`, () => {
    const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 5000 });
    assert.ifError(r.error); assert.equal(r.status, 1); assert.equal(r.stdout, "");
    assert.equal(r.stderr.trim().split("\n").length, 1); assert.ok(r.stderr.trim().length > 0);
  });
test("parseEnv separates periodic and pre-migration backup directories", () => {
  const result = parseEnv({ FACTORY_STATE_DIR: "/state", FACTORY_BACKUP_DIR: "/periodic" });
  assert.equal(result.backupDir, undefined); assert.equal(result.periodicBackup.dir, "/periodic");
  assert.equal(result.periodicBackup.intervalMs, 3_600_000);
});
test("parseEnv accepts interval endpoints", () => {
  assert.equal(parseEnv({ FACTORY_BACKUP_INTERVAL_MINUTES: "1" }).periodicBackup.intervalMs, 60_000);
  assert.equal(parseEnv({ FACTORY_BACKUP_INTERVAL_MINUTES: "1440" }).periodicBackup.intervalMs, 86_400_000);
});
test("parseEnv rejects invalid backup intervals", () => {
  for (const value of ["", "0", "1441", "-1", "1.5", "1e2", " 60", "60 ", "NaN", "9007199254740993"])
    assert.throws(() => parseEnv({ FACTORY_BACKUP_INTERVAL_MINUTES: value }), /FACTORY_BACKUP_INTERVAL_MINUTES must be an integer from 1 to 1440/);
});
test("main rejects invalid backup interval before listening", () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("../dist/main.js", import.meta.url))], {
    env: { FACTORY_BACKUP_INTERVAL_MINUTES: "1441" }, encoding: "utf8", timeout: 5000,
  });
  assert.ifError(r.error); assert.equal(r.status, 1); assert.equal(r.stdout, "");
  assert.equal(r.stderr.trim(), "FACTORY_BACKUP_INTERVAL_MINUTES must be an integer from 1 to 1440");
});
