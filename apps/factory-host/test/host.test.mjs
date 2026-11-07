import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test as nodeTest } from "node:test";
import Database from "better-sqlite3";
import { API_VERSION } from "@factory/contracts";
import { parseEnv, startHost } from "../dist/host.js";
import { createFakeGateway } from "../dist/models/index.js";
import { loadPack, findLeadSeat, getActiveEngagement } from "../dist/org/index.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { tasksCreateHandler, getTask } from "../dist/work/service.js";
import { createAttempt, createFakeRuntime, getAttempt, ensureLocalNode, LOCAL_NODE_ID, transitionAttempt, moveTask } from "../dist/dispatch/index.js";
import { DEFAULT_BUDGET_CONFIG } from "../dist/policy/index.js";

const test = (name, fn) => nodeTest(name, { timeout: 15_000 }, fn);
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const hostsByTest = new WeakMap();
const command = () => ({ apiVersion: API_VERSION, commandId: randomUUID(), projectId: randomUUID(), type: "projects.create",
  payload: { name: "Persistent project", workspace: { kind: "directory", root: `/workspace/${randomUUID()}` } } });

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "factory-host-"));
  t.after(async () => {
    for (const host of hostsByTest.get(t) ?? []) await host.close();
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep + "factory-host-"));
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

async function launch(t, stateDir = tempDir(t), options = {}) {
  const tokens = [];
  const host = await startHost({ stateDir, port: 0, onBootstrapToken: (token) => { tokens.push(token); }, ...options });
  const hosts = hostsByTest.get(t) ?? [];
  hosts.push(host);
  hostsByTest.set(t, hosts);
  t.after(() => host.close());
  return { ...host, tokens, stateDir, origin: `http://127.0.0.1:${host.port}` };
}

async function bootstrap(host, token = host.tokens[0]) {
  const response = await fetch(`${host.origin}/auth/bootstrap`, { method: "POST", headers: {
    origin: host.origin, "content-type": "application/json",
  }, body: JSON.stringify({ token }) });
  const body = await response.json();
  return { response, body, cookie: response.headers.get("set-cookie")?.split(";")[0], csrf: body.csrfToken };
}

async function postCommand(host, session, body) {
  const response = await fetch(`${host.origin}/commands`, { method: "POST", body: JSON.stringify(body), headers: {
    origin: host.origin, cookie: session.cookie, "x-csrf-token": session.csrf, "content-type": "application/json",
  } });
  return { status: response.status, body: await response.json() };
}

async function bind(port = 0) {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return server;
}
const closeServer = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

test("port zero resolves loopback origins and emits one usable, single-use bootstrap token", async (t) => {
  const host = await launch(t);
  assert.ok(Number.isInteger(host.port) && host.port > 0);
  assert.equal(host.app.server.address().address, "127.0.0.1");
  assert.deepEqual(host.origins, [host.origin, `http://localhost:${host.port}`]);
  assert.equal(host.tokens.length, 1);
  const first = await bootstrap(host);
  assert.equal(first.response.status, 200);
  assert.equal(first.body.ok, true);
  assert.ok(first.cookie.startsWith("factory_session="));
  const second = await bootstrap(host);
  assert.equal(second.response.status, 401);
  assert.equal(second.body.error.code, "needs-auth");
  assert.equal(host.tokens.length, 1);
});

test("host exposes a null model gateway by default and preserves an injected gateway", async (t) => {
  const defaultHost = await launch(t);
  assert.deepEqual(defaultHost.models, { gateway: null, budgetConfig: DEFAULT_BUDGET_CONFIG });
  const gateway = createFakeGateway([{ text: "hello" }]);
  const injectedHost = await launch(t, undefined, { modelGateway: gateway });
  assert.equal(injectedHost.models.gateway, gateway);
  const disabledHost = await launch(t, undefined, { modelGateway: null });
  assert.equal(disabledHost.models.gateway, null);
});

test("host exposes custom budget configuration and wires budgets.set and GET budget with its clock", async (t) => {
  const budgetConfig = { defaultTaskTokens: 123, defaultDayTokens: 456, warnAtPercent: 75, utcOffsetMinutes: -120 };
  const host = await launch(t, undefined, { budgetConfig, clock: () => new Date("2026-11-07T01:00:00.000Z") });
  assert.deepEqual(host.models, { gateway: null, budgetConfig });
  const session = await bootstrap(host);
  const project = command();
  assert.equal((await postCommand(host, session, project)).status, 200);
  const getBudget = () => host.app.inject({ method: "GET", url: `/projects/${project.projectId}/budget`,
    headers: { host: `127.0.0.1:${host.port}`, cookie: session.cookie } });
  assert.deepEqual((await getBudget()).json(), { apiVersion: API_VERSION, ok: true, budget: {
    day: { date: "2026-11-06", used: 0, limit: 456, verdict: "ok", source: "default" }, tasks: [],
  } });
  const budgetId = randomUUID();
  const set = { apiVersion: API_VERSION, commandId: randomUUID(), projectId: project.projectId, type: "budgets.set", payload: {
    budgetId, expectedRevision: null, scope: "day", scopeRef: "2026-11-06", limitTokens: 999, warnAtPercent: 90,
  } };
  const result = await postCommand(host, session, set);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.receipt.effects, [{ kind: "budget", id: budgetId, revision: 1 }]);
  assert.deepEqual((await getBudget()).json().budget.day, {
    date: "2026-11-06", used: 0, limit: 999, verdict: "ok", source: "explicit",
  });
});

test("bootstrap callback runs only after the server is listening", async (t) => {
  const dir = tempDir(t);
  const server = await bind();
  const port = server.address().port;
  await closeServer(server);
  let health;
  let calls = 0;
  const host = await launch(t, dir, { port, onBootstrapToken() {
    calls++;
    health = fetch(`http://127.0.0.1:${port}/health`).then(async (response) => {
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);
    });
  } });
  assert.equal(host.port, port);
  assert.equal(calls, 1);
  await health;
});

test("bootstrapped session creates a project with Origin and CSRF headers", async (t) => {
  const host = await launch(t);
  const session = await bootstrap(host);
  const c = command();
  const result = await postCommand(host, session, c);
  assert.equal(result.status, 200);
  assert.equal(result.body.receipt.projectId, c.projectId);
  const response = await fetch(`${host.origin}/projects`, { headers: { cookie: session.cookie } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).projects[0].id, c.projectId);
  // Pack-aware startup emits project, team and engagement changes, followed by the receipt.
  assert.equal(host.hub.currentCursor(c.projectId).sequence, "4");
});

test("packDir override supplies the team and host startup wires task creation and transitions", async (t) => {
  const dir = tempDir(t);
  const packDir = join(dir, "custom-pack");
  cpSync(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)), packDir, { recursive: true });
  const manifest = loadPack(packDir).manifest;
  manifest.key = "custom-team";
  manifest.name = "Custom Team";
  writeFileSync(join(packDir, "pack.json"), JSON.stringify(manifest));
  const host = await launch(t, join(dir, "state"), { packDir });
  const session = await bootstrap(host);
  const c = command();
  const created = await postCommand(host, session, c);
  assert.equal(created.status, 200);
  assert.deepEqual(created.body.receipt.effects.map((effect) => effect.kind), ["project", "team", "engagement"]);
  const team = await fetch(`${host.origin}/projects/${c.projectId}/team`, { headers: { cookie: session.cookie } });
  assert.equal(team.status, 200);
  assert.equal((await team.json()).team.pack.key, "custom-team");
  const taskId = randomUUID();
  const task = { apiVersion: API_VERSION, commandId: randomUUID(), projectId: c.projectId, type: "tasks.create", payload: {
    taskId, code: "WK-001", title: "Task", goal: "Complete task", brief: "Work to do", parentTaskId: null,
    engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [],
  } };
  assert.equal((await postCommand(host, session, task)).status, 200);
  assert.equal((await postCommand(host, session, { ...task, commandId: randomUUID(), type: "tasks.transition",
    payload: { taskId, expectedRevision: 1, to: "proposed" } })).status, 200);
  const tasks = await fetch(`${host.origin}/projects/${c.projectId}/tasks`, { headers: { cookie: session.cookie } });
  assert.equal(tasks.status, 200);
  const listed = (await tasks.json()).items;
  assert.equal(listed[0].state, "proposed");
  assert.equal(listed[0].revision, 2);
});

test("invalid pack override rejects startup before storage creation and token delivery", async (t) => {
  const dir = tempDir(t);
  const packDir = join(dir, "invalid-pack");
  cpSync(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)), packDir, { recursive: true });
  writeFileSync(join(packDir, "pack.json"), "{}");
  const stateDir = join(dir, "state");
  await assert.rejects(startHost({ stateDir, packDir, port: 0, onBootstrapToken() { assert.fail("must not emit token"); } }));
  assert.equal(existsSync(stateDir), false);
});

test("close is idempotent, closes storage, and releases the listening port", async (t) => {
  const host = await launch(t);
  const first = host.close();
  const second = host.close();
  assert.equal(first, second);
  await Promise.all([first, second]);
  await host.close();
  assert.equal(host.storage.raw.open, false);
  assert.equal(host.app.server.listening, false);
  const server = await bind(host.port);
  await closeServer(server);
});

test("uiDir serves the built UI and health on the same listening origin", async (t) => {
  const dir = tempDir(t);
  const uiDir = join(dir, "ui");
  mkdirSync(uiDir);
  const html = "<!doctype html><html><body>Factory Host UI</body></html>";
  writeFileSync(join(uiDir, "index.html"), html);
  const host = await launch(t, join(dir, "state"), { uiDir });
  const ui = await fetch(`${host.origin}/`);
  assert.equal(ui.status, 200);
  assert.equal(await ui.text(), html);
  assert.equal(ui.headers.get("cache-control"), "no-store");
  assert.equal(ui.headers.get("x-frame-options"), "DENY");
  const health = await fetch(`${host.origin}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, apiVersion: API_VERSION });
  const result = await postCommand(host, await bootstrap(host), command());
  assert.equal(result.status, 200);
});

test("invalid uiDir fails startup and releases the port and database for restart", async (t) => {
  const dir = tempDir(t);
  const stateDir = join(dir, "state");
  const noIndex = join(dir, "no-index");
  const badIndex = join(dir, "bad-index");
  const file = join(dir, "file");
  mkdirSync(noIndex);
  mkdirSync(join(badIndex, "index.html"), { recursive: true });
  writeFileSync(file, "not a directory");
  const reservation = await bind();
  const port = reservation.address().port;
  await closeServer(reservation);
  for (const uiDir of [join(dir, "missing"), noIndex, badIndex, file]) {
    await assert.rejects(startHost({ stateDir, uiDir, port,
      onBootstrapToken() { assert.fail("must not emit token"); } }), /UI directory.*index\.html/);
    const available = await bind(port);
    await closeServer(available);
    const next = await launch(t, stateDir, { port });
    assert.equal(next.storage.raw.open, true);
    await next.close();
    // Windows refuses deletion if a failed startup retained a database handle.
    rmSync(join(stateDir, "host.db"));
  }
});

test("relative uiDir is refused and an empty uiDir leaves static serving disabled", async (t) => {
  const dir = tempDir(t);
  const stateDir = join(dir, "state");
  await assert.rejects(startHost({ stateDir, uiDir: "relative-ui", port: 0,
    onBootstrapToken() { assert.fail("must not emit token"); } }), /UI directory must be an absolute path/);
  assert.equal(existsSync(stateDir), false);
  const host = await launch(t, stateDir, { uiDir: "" });
  const response = await fetch(`${host.origin}/`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "not-found");
});

test("restart retains projects and cursors, with no new migration or backup", async (t) => {
  const dir = tempDir(t);
  const first = await launch(t, dir);
  const session = await bootstrap(first);
  const c = command();
  assert.equal((await postCommand(first, session, c)).status, 200);
  const cursor = first.hub.currentCursor(c.projectId);
  const ledger = first.storage.raw.prepare("SELECT * FROM migration_ledger ORDER BY version").all();
  await first.close();
  const second = await launch(t, dir);
  const nextSession = await bootstrap(second);
  const response = await fetch(`${second.origin}/projects`, { headers: { cookie: nextSession.cookie } });
  assert.equal((await response.json()).projects[0].id, c.projectId);
  assert.deepEqual(second.hub.currentCursor(c.projectId), cursor);
  assert.deepEqual(second.storage.raw.prepare("SELECT * FROM migration_ledger ORDER BY version").all(), ledger);
  assert.equal(existsSync(join(dir, "backups")), false);
});

test("pending migration backs up the existing database before applying the new file", async (t) => {
  const dir = tempDir(t);
  const stateDir = join(dir, "state");
  const first = await launch(t, stateDir);
  const c = command();
  assert.equal((await postCommand(first, await bootstrap(first), c)).status, 200);
  await first.close();
  const customMigrations = join(dir, "migrations");
  cpSync(migrationsDir, customMigrations, { recursive: true });
  writeFileSync(join(customMigrations, "0003_marker.sql"), "CREATE TABLE migration_marker (id INTEGER PRIMARY KEY) STRICT;\n");
  const backupDir = join(dir, "saved-backups");
  const second = await launch(t, stateDir, { migrationsDir: customMigrations, backupDir });
  assert.deepEqual(second.storage.raw.prepare("SELECT version FROM migration_ledger ORDER BY version").all(), [{ version: 1 }, { version: 2 }, { version: 3 }]);
  const backups = readdirSync(backupDir);
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^pre-migration-0003-.*\.db$/);
  const backup = new Database(join(backupDir, backups[0]), { readonly: true });
  try {
    assert.equal(backup.prepare("SELECT id FROM projects WHERE id = ?").get(c.projectId).id, c.projectId);
    assert.deepEqual(backup.prepare("SELECT version FROM migration_ledger").all(), [{ version: 1 }, { version: 2 }]);
    assert.equal(backup.prepare("SELECT name FROM sqlite_master WHERE name = ?").get("migration_marker"), undefined);
  } finally { backup.close(); }
});

test("relative state directories are refused without creating a directory", async () => {
  const stateDir = `factory-host-refused-${randomUUID()}`;
  assert.equal(existsSync(stateDir), false);
  await assert.rejects(startHost({ stateDir, port: 0, onBootstrapToken() { assert.fail("must not emit a token"); } }), /absolute path/);
  assert.equal(existsSync(stateDir), false);
});

test("WSL Windows-drive mount paths are refused before creating anything", async () => {
  for (const stateDir of [`/mnt/c/factory-host-refused-${randomUUID()}`, `/mnt/c/../c/factory-host-refused-${randomUUID()}`]) {
    assert.equal(existsSync(stateDir), false);
    await assert.rejects(startHost({ stateDir, port: 0, onBootstrapToken() { assert.fail("must not emit a token"); } }), /\/mnt\/.*SQLite WAL/);
    assert.equal(existsSync(stateDir), false);
  }
});

test("occupied port rejects startup without token delivery or leaked database handles", async (t) => {
  const dir = tempDir(t);
  const occupied = await bind();
  t.after(async () => { if (occupied.listening) await closeServer(occupied); });
  const port = occupied.address().port;
  let calls = 0;
  await assert.rejects(startHost({ stateDir: dir, port, onBootstrapToken() { calls++; } }), { code: "EADDRINUSE" });
  assert.equal(calls, 0);
  // Deletion after restart on Windows checks for a SQLite handle leaked by the failed host.
  await closeServer(occupied);
  const next = await launch(t, dir, { port });
  assert.equal(next.port, port);
  await next.close();
  rmSync(join(dir, "host.db"));
  assert.equal(existsSync(join(dir, "host.db")), false);
});

test("migration failure closes storage and allows a corrected restart", async (t) => {
  const dir = tempDir(t);
  const stateDir = join(dir, "state");
  const customMigrations = join(dir, "migrations");
  cpSync(migrationsDir, customMigrations, { recursive: true });
  writeFileSync(join(customMigrations, "0003_broken.sql"), "invalid SQL;");
  let calls = 0;
  await assert.rejects(startHost({ stateDir, port: 0, migrationsDir: customMigrations,
    onBootstrapToken() { calls++; } }), /migration 3 .* failed/);
  assert.equal(calls, 0);
  const next = await launch(t, stateDir);
  assert.equal(next.storage.raw.open, true);
  await next.close();
});

test("bootstrap callback failure closes the listening app and storage", async (t) => {
  const dir = tempDir(t);
  const reservation = await bind();
  const port = reservation.address().port;
  await closeServer(reservation);
  let calls = 0;
  await assert.rejects(startHost({ stateDir: dir, port, onBootstrapToken() { calls++; throw new Error("callback failed"); } }), /callback failed/);
  assert.equal(calls, 1);
  const server = await bind(port);
  await closeServer(server);
  const next = await launch(t, dir, { port });
  await next.close();
  rmSync(join(dir, "host.db"));
});

test("host close ends open SSE replies before closing storage", async (t) => {
  const host = await launch(t, undefined, { keepAliveMs: 50 });
  const session = await bootstrap(host);
  const c = command();
  assert.equal((await postCommand(host, session, c)).status, 200);
  const cursor = host.hub.currentCursor(c.projectId);
  const response = await fetch(`${host.origin}/projects/${c.projectId}/events?after=${cursor.epoch}:${cursor.sequence}`, {
    headers: { cookie: session.cookie }, signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  await host.close();
  while (!(await reader.read()).done) { /* Consume any ping emitted before shutdown. */ }
  assert.equal(host.storage.raw.open, false);
});

test("injected clock is used by migrations and the command pipeline", async (t) => {
  const now = "2026-11-07T12:00:00.000Z";
  const host = await launch(t, undefined, { clock: () => new Date(now) });
  assert.equal(host.storage.raw.prepare("SELECT applied_at FROM migration_ledger").get().applied_at, now);
  const c = command();
  assert.equal((await postCommand(host, await bootstrap(host), c)).status, 200);
  const events = host.hub.readAfter(c.projectId, { epoch: host.hub.currentCursor(c.projectId).epoch, sequence: "0" });
  assert.ok(events.events.every((event) => event.occurredAt === now));
});

test("parseEnv defaults are an absolute home state directory and port 8787", () => {
  const stateDir = join(homedir(), "factory-v2", "state");
  assert.deepEqual(parseEnv({}), { stateDir, port: 8787, dispatch: { nodeSlots: 2 }, workspace: {
    projectsRoot: existsSync('/srv/factory/workspaces') ? resolve('/srv/factory/workspaces') : join(homedir(), 'factory-v2', 'workspaces'),
    worktreesRoot: join(homedir(), 'factory-v2', 'worktrees'),
  }, periodicBackup: {
    dir: existsSync("/mnt/d") ? "/mnt/d/factory-backup" : join(stateDir, "backups", "periodic"), intervalMs: 3_600_000,
  } });
});

test("parseEnv accepts state, backup, and integer port overrides", () => {
  assert.deepEqual(parseEnv({ FACTORY_STATE_DIR: "/state", FACTORY_PORT: "12345", FACTORY_BACKUP_DIR: "/backup",
    FACTORY_MIGRATION_BACKUP_DIR: "/migration", FACTORY_BACKUP_INTERVAL_MINUTES: "30" }),
    { stateDir: "/state", port: 12345, dispatch: { nodeSlots: 2 }, workspace: parseEnv({}).workspace,
      backupDir: "/migration", periodicBackup: { dir: "/backup", intervalMs: 1_800_000 } });
  assert.equal(parseEnv({ FACTORY_PORT: "1" }).port, 1);
  assert.equal(parseEnv({ FACTORY_PORT: "65535" }).port, 65535);
});

test("parseEnv rejects noninteger, empty, and out-of-range ports", () => {
  for (const port of ["", "0", "-1", "65536", "8787.5", "1e3", "abc", " 8787", "8787 ", "Infinity", "9007199254740993"])
    assert.throws(() => parseEnv({ FACTORY_PORT: port }), /FACTORY_PORT must be an integer from 1 to 65535/);
});

for (const name of ["FACTORY_BUDGET_TASK_TOKENS", "FACTORY_BUDGET_DAY_TOKENS"])
  test(`main rejects invalid ${name} before starting the host`, () => {
    for (const input of ["", "0", "-1", "1.5", "1e3", "abc", " 10", "10 ", "Infinity", "9007199254740992"]) {
      // A synthetic environment keeps this check independent of the operator's configuration.
      const result = spawnSync(process.execPath, [fileURLToPath(new URL("../dist/main.js", import.meta.url))], {
        env: { [name]: input }, encoding: "utf8", timeout: 5000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.trim(), `${name} must be a positive safe integer`);
    }
  });

test("parseEnv enables fake dispatch by default and accepts node slot boundaries", () => {
  assert.deepEqual(parseEnv({}).dispatch, { nodeSlots: 2 });
  for (const input of ["1", "2", "16"])
    assert.equal(parseEnv({ FACTORY_NODE_SLOTS: input, FACTORY_RUNTIME: "fake" }).dispatch.nodeSlots, Number(input));
});

for (const input of ["", "0", "-1", "17", "2.5", "1e1", " 2", "2 ", "Infinity", "abc", "9007199254740993"])
  test(`parseEnv rejects invalid node slots ${JSON.stringify(input)}`, () => {
    assert.throws(() => parseEnv({ FACTORY_NODE_SLOTS: input }), /FACTORY_NODE_SLOTS must be an integer from 1 to 16/);
  });

for (const input of ["", "native-opencode", "api-agent", "acp", "FAKE", "fake "])
  test(`parseEnv rejects unsupported runtime ${JSON.stringify(input)}`, () => {
    assert.throws(() => parseEnv({ FACTORY_RUNTIME: input }), /unsupported runtime/);
  });

test("main rejects unsupported dispatch configuration before host startup", () => {
  for (const [name, value, message] of [
    ["FACTORY_NODE_SLOTS", "17", "FACTORY_NODE_SLOTS must be an integer from 1 to 16"],
    ["FACTORY_RUNTIME", "acp", "unsupported runtime"],
  ]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../dist/main.js", import.meta.url))], {
      env: { [name]: value }, encoding: "utf8", timeout: 5000,
    });
    assert.ifError(result.error); assert.equal(result.status, 1); assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim(), message);
  }
});

function hostDispatchTask(host, goal = "[fake:hang]") {
  const pipeline = createCommandPipeline({ storage: host.storage, hub: host.hub, handlers: {
    "projects.create": createProjectsCreateHandler({ pack: loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url))) }),
    "tasks.create": tasksCreateHandler,
  } });
  const projectId = randomUUID(); const taskId = randomUUID();
  const execute = (type, payload) => {
    const result = pipeline.execute({ apiVersion: API_VERSION, commandId: randomUUID(), projectId, type, payload });
    assert.equal(result.status, 200, JSON.stringify(result.body));
  };
  execute("projects.create", { name: "Host dispatch project", workspace: { kind: "directory", root: `/workspace/${projectId}` } });
  execute("tasks.create", { taskId, code: "HOST-001", title: "Host dispatch", goal, brief: "Brief", parentTaskId: null,
    engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] });
  for (const state of ["accepted", "ready", "active"]) moveTask(host.storage.raw, projectId, taskId, state);
  const seatId = findLeadSeat(host.storage.raw, getActiveEngagement(host.storage.raw, projectId).teamId).id;
  return { projectId, taskId, seatId };
}

test("host dispatch is disabled by default and when explicitly null", async (t) => {
  assert.equal((await launch(t)).dispatch, null);
  assert.equal((await launch(t, undefined, { dispatch: null })).dispatch, null);
});

test("host exposes enabled dispatcher and stops it between Lead and app while storage is open", async (t) => {
  const runtime = createFakeRuntime({ stepMs: 0 });
  const host = await launch(t, undefined, { dispatch: { adapters: [runtime], nodeSlots: 3 } });
  assert.ok(host.dispatch); assert.equal(host.dispatch.status().nodeTotal, 3);
  const input = hostDispatchTask(host);
  const a = host.dispatch.enqueue(input);
  await new Promise(setImmediate); for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(getAttempt(host.storage.raw, a.projectId, a.id).state, "running");
  const order = [];
  const leadStop = host.lead.stop.bind(host.lead);
  host.lead.stop = async () => { order.push("lead"); await leadStop(); };
  const dispatchStop = host.dispatch.stop.bind(host.dispatch);
  host.dispatch.stop = async () => {
    order.push("dispatch"); assert.equal(host.storage.raw.open, true); await dispatchStop();
    assert.equal(getAttempt(host.storage.raw, a.projectId, a.id).state, "running");
  };
  const appClose = host.app.close.bind(host.app);
  host.app.close = async () => { order.push("app"); assert.equal(host.storage.raw.open, true); await appClose(); };
  await host.close();
  assert.deepEqual(order, ["lead", "dispatch", "app"]);
  assert.equal(runtime.stopped[0].attemptId, a.id);
  assert.equal(runtime.ended[0].attemptId, a.id);
  assert.equal(host.storage.raw.open, false);
});

test("host recovers a persisted running attempt before listening and does not replay it", async (t) => {
  const dir = tempDir(t); const initial = await launch(t, dir);
  const input = hostDispatchTask(initial);
  const raw = initial.storage.raw;
  const now = new Date().toISOString();
  ensureLocalNode(raw, { slots: 2, now });
  let a = createAttempt(raw, { ...input, id: randomUUID(), runtime: "fake", provider: "fake", model: "fake", effort: "medium", now });
  for (const state of ["leased", "preparing", "running"]) a = transitionAttempt(raw, a, state, {
    nodeId: LOCAL_NODE_ID, leaseId: a.leaseId ?? randomUUID(), leaseExpiresAt: "2099-01-01T00:00:00.000Z", now,
  });
  await initial.close();
  const runtime = createFakeRuntime({ stepMs: 0 });
  const next = await launch(t, dir, { dispatch: { adapters: [runtime] } });
  assert.equal(getAttempt(next.storage.raw, a.projectId, a.id).state, "unknown");
  assert.equal(getTask(next.storage.raw, a.projectId, a.taskId).state, "active");
  assert.equal(runtime.started.length, 0);
  assert.ok(next.hub.readAfter(a.projectId, { epoch: next.hub.currentCursor(a.projectId).epoch, sequence: "0" }).events
    .some((e) => e.payload.entity?.kind === "attempt"));
  await next.close();
});

test("a dispatcher shutdown failure still closes the application and storage", async (t) => {
  const host = await startHost({ stateDir: tempDir(t), port: 0, onBootstrapToken() {}, dispatch: { stepMs: 0 } });
  t.after(async () => { try { await host.close(); } catch { /* Intentional shutdown rejection. */ } });
  const stop = host.dispatch.stop.bind(host.dispatch);
  host.dispatch.stop = async () => { await stop(); throw new Error("injected dispatcher stop failure"); };
  let closed = false; const appClose = host.app.close.bind(host.app);
  host.app.close = async () => { closed = true; await appClose(); };
  await assert.rejects(host.close(), /injected dispatcher stop failure/);
  assert.equal(closed, true); assert.equal(host.storage.raw.open, false);
});
