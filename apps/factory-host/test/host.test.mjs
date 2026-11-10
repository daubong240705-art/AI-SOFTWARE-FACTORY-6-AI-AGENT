import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test as nodeTest } from "node:test";
import Database from "better-sqlite3";
import { openStorage } from "../dist/storage/database.js";
import { API_VERSION } from "@factory/contracts";
import { parseEnv, startHost } from "../dist/host.js";
import { createFakeGateway } from "../dist/models/index.js";
import { loadPack, findLeadSeat, getActiveEngagement } from "../dist/org/index.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { tasksCreateHandler, getTask } from "../dist/work/service.js";
import { createAttempt, createFakeRuntime, getAttempt, ensureLocalNode, LOCAL_NODE_ID, transitionAttempt, moveTask } from "../dist/dispatch/index.js";
import { DEFAULT_BUDGET_CONFIG } from "../dist/policy/index.js";
import { SANDBOX_RELAY_PORT } from "../dist/sandbox/index.js";
import { runGit, cloneProject, checkpoint } from "../dist/workspace/index.js";

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

test("host exposes a content store under its state directory by default", async (t) => {
  const host = await launch(t); const { hash } = host.artifacts.store.put("host result");
  assert.equal(existsSync(join(host.stateDir, "content", hash.slice(0, 2), hash)), true);
  assert.equal(host.artifacts.store.get(hash).toString(), "host result");
});

test("host content directory override supplies the exposed store", async (t) => {
  const root = tempDir(t); const contentDir = join(root, "custom-content");
  const host = await launch(t, join(root, "state"), { contentDir }); const { hash } = host.artifacts.store.put("override");
  assert.equal(existsSync(join(contentDir, hash.slice(0, 2), hash)), true);
  assert.equal(existsSync(join(host.stateDir, "content")), false);
});

test("host backfills existing artifact versions when upgrading from schema three", async (t) => {
  const root = tempDir(t); const stateDir = join(root, "state"); const oldMigrations = join(root, "old-migrations");
  mkdirSync(oldMigrations);
  for (const name of readdirSync(migrationsDir).filter((name) => /^000[1-3]_.*\.sql$/.test(name)))
    cpSync(join(migrationsDir, name), join(oldMigrations, name));
  const storage = openStorage(join(stateDir, "host.db"));
  const { createContentStore } = await import("../dist/artifacts/content-store.js");
  const store = createContentStore({ dir: join(stateDir, "content") });
  const projectId = randomUUID(); const artifactId = randomUUID();
  try {
    storage.migrate({ migrationsDir: oldMigrations, backupDir: null });
    storage.raw.prepare("INSERT INTO projects VALUES (?,1,'Knowledge','artifact','unused','active')").run(projectId);
    const content = store.put("Existing searchablebodymarker");
    storage.raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,
      status,abstract_l0,visibility,created_at) VALUES (?,?,1,'requirements','Thiết kế','text/markdown',?,?,'draft','Existing abstract','project',?)`)
      .run(projectId,artifactId,content.hash,content.size,new Date().toISOString());
  } finally { storage.close(); }
  const host = await launch(t, stateDir);
  const deadline = Date.now() + 5000;
  while (host.knowledge.stats().missing && Date.now() < deadline) await new Promise((done) => setImmediate(done));
  assert.equal(host.storage.raw.prepare("SELECT MAX(version) AS version FROM migration_ledger").get().version, 21);
  assert.equal(host.knowledge.stats().missing, 0);
  for (const query of ["thiet ke", "searchablebodymarker"]) {
    const rows = host.knowledge.search({ projectId, teamId: null, viewer: "operator" }, query);
    assert.deepEqual(rows.map((row) => row.artifactId), [artifactId]);
  }
});

test("host without workspace produces no results from runtime-only evidence", async (t) => {
  const host = await launch(t, undefined, { dispatch: {} }); const session = await bootstrap(host); const c = command();
  assert.equal((await postCommand(host, session, c)).status, 200);
  const taskId = randomUUID();
  const task = { apiVersion: 1, commandId: randomUUID(), projectId: c.projectId, type: "tasks.create", payload: {
    taskId, code: "RES-001", title: "Results", goal: "Deliver", brief: "Brief", parentTaskId: null,
    engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [],
  } };
  assert.equal((await postCommand(host, session, task)).status, 200);
  const accept = { apiVersion: 1, commandId: randomUUID(), projectId: c.projectId, type: "tasks.transition",
    payload: { taskId, expectedRevision: 1, to: "accepted" } };
  assert.equal((await postCommand(host, session, accept)).status, 200);
  assert.equal((await postCommand(host, session, { apiVersion: 1, commandId: randomUUID(), projectId: c.projectId,
    type: "tasks.release", payload: { taskId, expectedRevision: getTask(host.storage.raw, c.projectId, taskId).revision } })).status, 200);
  await host.dispatch.idle();
  assert.equal(getTask(host.storage.raw, c.projectId, taskId).state, "in-review");
  assert.equal(host.storage.raw.prepare("SELECT count(*) AS n FROM artifact_versions").get().n, 0);
});

nodeTest("host wires real workspace results and publishes version events with outcomes", {
  skip: process.platform !== "linux" && "Requires Linux and real git", timeout: 60_000,
}, async (t) => {
  const root = tempDir(t); const source = join(root, "source"); mkdirSync(source);
  await runGit(source, ["init", "--initial-branch=main", "--template="]);
  await runGit(source, ["config", "user.name", "Fixture"]); await runGit(source, ["config", "user.email", "fixture@localhost"]);
  writeFileSync(join(source, "README.md"), "base\n"); await checkpoint(source, "base");
  const workspace = { projectsRoot: join(root, "projects"), worktreesRoot: join(root, "worktrees") };
  const project = await cloneProject(workspace, { source, name: "Results" });
  const host = await launch(t, join(root, "state"), { dispatch: { stepMs: 0 }, workspace });
  const session = await bootstrap(host); const c = command(); c.payload.workspace.root = project.root;
  assert.equal((await postCommand(host, session, c)).status, 200);
  const taskId = randomUUID();
  const task = { apiVersion: 1, commandId: randomUUID(), projectId: c.projectId, type: "tasks.create", payload: {
    taskId, code: "RES-001", title: "Results", goal: "[fake:edit]", brief: "Brief", parentTaskId: null,
    engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [],
  } };
  assert.equal((await postCommand(host, session, task)).status, 200);
  const observations = [];
  const unsubscribe = host.hub.subscribe(c.projectId, () => {
    const current = getTask(host.storage.raw, c.projectId, taskId);
    if (current.state === "in-review") observations.push(host.storage.raw.prepare("SELECT count(*) AS n FROM artifact_versions").get().n);
  });
  t.after(unsubscribe);
  const transition = async (to) => postCommand(host, session, { apiVersion: 1, commandId: randomUUID(), projectId: c.projectId,
    type: "tasks.transition", payload: { taskId, expectedRevision: getTask(host.storage.raw, c.projectId, taskId).revision, to } });
  assert.equal((await transition("accepted")).status, 200);
  assert.equal((await postCommand(host, session, { apiVersion: 1, commandId: randomUUID(), projectId: c.projectId,
    type: "tasks.release", payload: { taskId, expectedRevision: getTask(host.storage.raw, c.projectId, taskId).revision } })).status, 200);
  await host.dispatch.idle();
  const read = (url) => host.app.inject({ method: "GET", url, headers: { host: `127.0.0.1:${host.port}`, cookie: session.cookie } });
  const url = `/projects/${c.projectId}/tasks/${taskId}/artifacts`;
  const listing = await read(url); assert.equal(listing.statusCode, 200); const before = listing.json().items;
  assert.equal(before.length, 2); assert.ok(observations.includes(2));
  assert.equal(host.knowledge.stats().indexed, 2); assert.equal(host.knowledge.stats().missing, 0);
  for (const artifact of before) {
    const version = artifact.versions[0]; const response = await read(`/projects/${c.projectId}/artifacts/${artifact.artifactId}/versions/1/content`);
    assert.equal(response.statusCode, 200); assert.equal(response.json().text, host.artifacts.store.get(version.contentHash).toString("utf8"));
    assert.equal(response.body.includes(root), false);
  }
  assert.equal((await transition("active")).status, 200); await host.dispatch.idle();
  const after = (await read(url)).json().items;
  assert.deepEqual(after.map((a) => a.artifactId), before.map((a) => a.artifactId));
  for (const artifact of after) assert.deepEqual(artifact.versions.map((v) => v.status), ["in-review", "superseded"]);
  const events = host.storage.raw.prepare("SELECT body_json FROM event_log WHERE project_id=?").all(c.projectId).map((r) => JSON.parse(r.body_json));
  // 2 registrations in epoch 1 + 2 in epoch 2, plus one event for each epoch-1 version that epoch 2 superseded:
  // a status change must be visible to clients (K1b publishes it; before K1b it was silent).
  const versionEvents = events.filter((e) => e.payload.type === "entity.changed" && e.payload.entity.kind === "artifact-version").map((e) => e.payload.entity);
  assert.equal(versionEvents.length, 6);
  for (const artifact of before) assert.deepEqual(versionEvents.filter((e) => e.id === artifact.artifactId).map((e) => e.revision).sort(), [1, 1, 2]);
  assert.equal(JSON.stringify(events).includes(root), false);
});

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
    project: { used: 0, limit: null, verdict: "ok", source: "default" }, engagements: [],
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
  writeFileSync(join(customMigrations, "0022_marker.sql"), "CREATE TABLE migration_marker (id INTEGER PRIMARY KEY) STRICT;\n");
  const backupDir = join(dir, "saved-backups");
  const second = await launch(t, stateDir, { migrationsDir: customMigrations, backupDir });
  assert.deepEqual(second.storage.raw.prepare("SELECT version FROM migration_ledger ORDER BY version").all(), [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }, { version: 9 }, { version: 10 }, { version: 11 }, { version: 12 }, { version: 13 }, { version: 14 }, { version: 15 }, { version: 16 }, { version: 17 }, { version: 18 }, { version: 19 }, { version: 20 }, { version: 21 }, { version: 22 }]);
  const backups = readdirSync(backupDir);
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^pre-migration-0022-.*\.db$/);
  const backup = new Database(join(backupDir, backups[0]), { readonly: true });
  try {
    assert.equal(backup.prepare("SELECT id FROM projects WHERE id = ?").get(c.projectId).id, c.projectId);
    assert.deepEqual(backup.prepare("SELECT version FROM migration_ledger").all(), [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }, { version: 9 }, { version: 10 }, { version: 11 }, { version: 12 }, { version: 13 }, { version: 14 }, { version: 15 }, { version: 16 }, { version: 17 }, { version: 18 }, { version: 19 }, { version: 20 }, { version: 21 }]);
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
  writeFileSync(join(customMigrations, "0022_broken.sql"), "invalid SQL;");
  let calls = 0;
  await assert.rejects(startHost({ stateDir, port: 0, migrationsDir: customMigrations,
    onBootstrapToken() { calls++; } }), /migration 22 .* failed/);
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
  assert.deepEqual(parseEnv({}), { stateDir, port: 8787, multiTeam: false, pushRemotes: null, dispatch: { nodeSlots: 2 }, workspace: {
    projectsRoot: existsSync('/srv/factory/workspaces') ? resolve('/srv/factory/workspaces') : join(homedir(), 'factory-v2', 'workspaces'),
    worktreesRoot: join(homedir(), 'factory-v2', 'worktrees'),
  }, periodicBackup: {
    dir: existsSync("/mnt/d") ? "/mnt/d/factory-backup" : join(stateDir, "backups", "periodic"), intervalMs: 3_600_000,
  } });
});

test("parseEnv accepts state, backup, and integer port overrides", () => {
  assert.deepEqual(parseEnv({ FACTORY_STATE_DIR: "/state", FACTORY_PORT: "12345", FACTORY_BACKUP_DIR: "/backup",
    FACTORY_MIGRATION_BACKUP_DIR: "/migration", FACTORY_BACKUP_INTERVAL_MINUTES: "30" }),
    { stateDir: "/state", port: 12345, multiTeam: false, pushRemotes: null, dispatch: { nodeSlots: 2 }, workspace: parseEnv({}).workspace,
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

test("host model proxy is disabled by default and when null", async (t) => {
  assert.equal((await launch(t)).proxy, null);
  assert.equal((await launch(t, undefined, { modelProxy: null })).proxy, null);
});

async function proxyUpstream(t, handler) {
  const server = createHttpServer(handler); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}/v1`;
}
const proxyKey = "host-upstream-private-marker";
test("host exposes a separate local proxy with authentication and approved model discovery", async (t) => {
  const baseUrl = await proxyUpstream(t, (_req, res) => res.end("{}"));
  const host = await launch(t, undefined, { modelProxy: { port: 0, upstream: { baseUrl, apiKey: proxyKey }, approvedModels: ["approved"] } });
  assert.ok(host.proxy.port > 0); assert.notEqual(host.port, host.proxy.port);
  const url = `http://127.0.0.1:${host.proxy.port}/v1/models`;
  const denied = await fetch(url); assert.equal(denied.status, 401);
  const token = host.proxy.tokens.issue({ attemptId: randomUUID(), taskId: randomUUID(), projectId: randomUUID(), epoch: 1, allowedModels: ["approved"] }).token;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  assert.deepEqual((await response.json()).data.map((m) => m.id), ["approved"]);
  const control = await host.app.inject({ method: "GET", url: "/v1/models", headers: { host: `127.0.0.1:${host.port}` } });
  assert.equal(control.statusCode, 404);
  await assert.rejects(fetch(`http://[::1]:${host.proxy.port}/v1/models`));
});
test("host fake model marker runs through the proxy and fails cleanly after budget exhaustion", async (t) => {
  const calls = []; const logs = [];
  for (const method of ["log", "error", "warn"]) t.mock.method(console, method, (...args) => logs.push(args));
  const baseUrl = await proxyUpstream(t, async (req, res) => {
    let text = ""; for await (const chunk of req) text += chunk;
    calls.push({ body: JSON.parse(text), auth: req.headers.authorization });
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content: "Proceed with implementation." } }],
      usage: { prompt_tokens: 32, completion_tokens: 32 } }));
  });
  const runtime = createFakeRuntime({ stepMs: 0 });
  const host = await launch(t, undefined, { dispatch: { adapters: [runtime] }, budgetConfig: { ...DEFAULT_BUDGET_CONFIG, defaultDayTokens: 64 },
    modelProxy: { port: 0, upstream: { baseUrl, apiKey: proxyKey }, approvedModels: ["approved"] } });
  const input = hostDispatchTask(host, "[fake:model]"); const a = host.dispatch.enqueue(input); await host.dispatch.idle();
  assert.equal(getAttempt(host.storage.raw, a.projectId, a.id).state, "succeeded");
  const token = runtime.started[0].model.token; assert.equal(host.proxy.tokens.resolve(token), null);
  assert.equal(calls.length, 1); assert.equal(calls[0].auth, `Bearer ${proxyKey}`); assert.equal(calls[0].body.model, "approved"); assert.equal(calls[0].body.max_tokens, 16);
  const usage = host.storage.raw.prepare("SELECT * FROM usage_records").all(); assert.equal(usage.length, 1); assert.equal(usage[0].attempt_id, a.id);
  const session = await bootstrap(host);
  for (const path of [`/projects/${a.projectId}/tasks/${a.taskId}/attempts`, `/projects/${a.projectId}/attempts/${a.id}/events`]) {
    const response = await host.app.inject({ method: "GET", url: path, headers: { host: `127.0.0.1:${host.port}`, cookie: session.cookie } });
    assert.equal(response.statusCode, 200); assert.equal(response.body.includes(token), false); assert.equal(response.body.includes(proxyKey), false);
  }
  const events = host.hub.readAfter(a.projectId, { epoch: host.hub.currentCursor(a.projectId).epoch, sequence: "0" }).events;
  assert.ok(events.length > 0); assert.equal(JSON.stringify(events).includes(token), false);
  assert.equal(host.storage.raw.serialize().includes(Buffer.from(token)), false); assert.equal(host.storage.raw.serialize().includes(Buffer.from(proxyKey)), false);
  assert.equal(JSON.stringify(logs).includes(token), false); assert.equal(JSON.stringify(logs).includes(proxyKey), false);
  host.storage.raw.prepare("UPDATE tasks SET state = 'active' WHERE project_id = ? AND id = ?").run(input.projectId, input.taskId);
  const second = host.dispatch.enqueue(input); await host.dispatch.idle();
  assert.equal(getAttempt(host.storage.raw, second.projectId, second.id).state, "failed"); assert.equal(calls.length, 1);
  assert.equal(host.storage.raw.prepare("SELECT COUNT(*) AS n FROM usage_records").get().n, 1);
  assert.equal(host.proxy.tokens.resolve(runtime.started[1].model.token), null);
});
test("host closes the proxy and revokes credentials before dispatcher shutdown", async (t) => {
  const baseUrl = await proxyUpstream(t, (_req, res) => res.end("{}"));
  const runtime = createFakeRuntime({ stepMs: 0 }); const host = await launch(t, undefined, { dispatch: { adapters: [runtime] },
    modelProxy: { port: 0, upstream: { baseUrl, apiKey: proxyKey }, approvedModels: ["approved"] } });
  host.dispatch.enqueue(hostDispatchTask(host)); await new Promise(setImmediate); for (let i = 0; i < 20; i++) await Promise.resolve();
  const token = runtime.started[0].model.token; const stop = host.dispatch.stop.bind(host.dispatch); let checked = false;
  host.dispatch.stop = async () => {
    checked = true; assert.equal(host.storage.raw.open, true); assert.equal(host.proxy.tokens.resolve(token), null);
    await assert.rejects(fetch(`http://127.0.0.1:${host.proxy.port}/v1/models`)); await stop();
  };
  await host.close(); assert.equal(checked, true);
});
test("host ignores the fake model marker when model access is disabled", async (t) => {
  const host = await launch(t, undefined, { dispatch: { stepMs: 0 } }); const a = host.dispatch.enqueue(hostDispatchTask(host, "[fake:model]"));
  await host.dispatch.idle(); assert.equal(getAttempt(host.storage.raw, a.projectId, a.id).state, "succeeded");
  assert.equal(host.storage.raw.prepare("SELECT COUNT(*) AS n FROM usage_records").get().n, 0);
});
test("parseEnv exposes proxy settings without carrying credentials", () => {
  const parsed = parseEnv({ FACTORY_AGENT_MODELS: "approved,provider/other", NINE_ROUTER_API_KEY: proxyKey, FACTORY_GATEWAY_URL: "http://127.0.0.1:9000/v1" });
  assert.deepEqual(parsed.agentProxy, { port: 8788, approvedModels: ["approved", "provider/other"] });
  assert.equal(JSON.stringify(parsed).includes(proxyKey), false);
  assert.equal(parseEnv({ FACTORY_AGENT_MODELS: "approved", FACTORY_PROXY_PORT: "9000" }).agentProxy.port, 9000);
});
for (const [label, value] of [["empty", ""], ["leading empty", ",approved"], ["trailing empty", "approved,"],
  ["middle empty", "a,,b"], ["space", "a, b"], ["leading space", " a"], ["trailing space", "a "], ["duplicate", "a,a"]])
  test(`parseEnv refuses ${label} approved model entries generically`, () => {
    assert.throws(() => parseEnv({ FACTORY_AGENT_MODELS: value, NINE_ROUTER_API_KEY: proxyKey }), (error) => {
      assert.match(error.message, /^FACTORY_AGENT_MODELS/); assert.equal(error.message.includes(proxyKey), false); return true;
    });
  });
for (const [label, value] of [["empty", ""], ["zero", "0"], ["negative", "-1"], ["overflow", "65536"],
  ["fractional", "1.5"], ["space", " 9000"], ["nonnumeric", "abc"]])
  test(`parseEnv refuses ${label} proxy port`, () => {
    assert.throws(() => parseEnv({ FACTORY_PROXY_PORT: value }), /FACTORY_PROXY_PORT must be an integer from 1 to 65535/);
  });
test("parseEnv rejects overflowing implicit proxy ports", () => {
  assert.throws(() => parseEnv({ FACTORY_PORT: "65535", FACTORY_AGENT_MODELS: "approved" }), /FACTORY_PROXY_PORT/);
});

const socketTest = (name, fn) => nodeTest(name, { timeout: 15_000, skip: process.platform === "win32" ? "Unix sockets require POSIX" : false }, fn);
function socketRequest(socketPath, host, token) {
  return new Promise((done, reject) => {
    const request = httpRequest({ socketPath, path: "/v1/models", headers: { host, authorization: `Bearer ${token}` } }, (response) => {
      let body = ""; response.on("data", (chunk) => { body += chunk; });
      response.once("end", () => done({ status: response.statusCode, body }));
    });
    request.once("error", reject); request.end();
  });
}
function socketOptions(socketPath, port = 0) {
  return { port, socketPath, approvedModels: ["approved"], upstream: { baseUrl: "http://127.0.0.1:9000/v1", apiKey: proxyKey } };
}
socketTest("host socket proxy uses only its Unix listener with private permissions and removes it on close", async (t) => {
  const root = tempDir(t); const directory = join(root, "proxy"); mkdirSync(directory, { mode: 0o700 });
  const socketPath = join(directory, "model.sock");
  const reserved = await bind(); const port = reserved.address().port; await closeServer(reserved);
  const host = await launch(t, join(root, "state"), { modelProxy: socketOptions(socketPath, port) });
  assert.equal(host.proxy.port, 0); assert.equal(host.proxy.socketPath, socketPath); assert.equal(statSync(socketPath).mode & 0o777, 0o600);
  const tcp = await bind(port); await closeServer(tcp);
  const token = host.proxy.tokens.issue({ attemptId: randomUUID(), taskId: randomUUID(), projectId: randomUUID(), epoch: 1, allowedModels: ["approved"] }).token;
  for (const name of ["127.0.0.1", "localhost"]) {
    const response = await socketRequest(socketPath, `${name}:${SANDBOX_RELAY_PORT}`, token);
    assert.equal(response.status, 200); assert.equal(JSON.parse(response.body).data[0].id, "approved");
  }
  assert.equal((await socketRequest(socketPath, "unapproved.test", token)).status, 403);
  await host.close(); assert.equal(existsSync(socketPath), false); await host.close();
});
socketTest("host socket proxy replaces a stale socket file", async (t) => {
  const root = tempDir(t); const directory = join(root, "proxy"); mkdirSync(directory, { mode: 0o700 });
  const socketPath = join(directory, "model.sock"); writeFileSync(socketPath, "stale");
  const host = await launch(t, join(root, "state"), { modelProxy: socketOptions(socketPath) });
  assert.equal(statSync(socketPath).isSocket(), true); assert.equal(statSync(socketPath).mode & 0o777, 0o600); await host.close();
});
socketTest("host socket mode supplies relay model access to runtime attempts", async (t) => {
  const root = tempDir(t); const directory = join(root, "proxy"); mkdirSync(directory, { mode: 0o700 });
  const socketPath = join(directory, "model.sock"); const runtime = createFakeRuntime({ stepMs: 0 });
  const host = await launch(t, join(root, "state"), { modelProxy: socketOptions(socketPath), dispatch: { adapters: [runtime] } });
  const attempt = host.dispatch.enqueue(hostDispatchTask(host, "Complete quickly")); await host.dispatch.idle();
  assert.equal(getAttempt(host.storage.raw, attempt.projectId, attempt.id).state, "succeeded");
  assert.equal(runtime.started[0].model.baseUrl, `http://127.0.0.1:${SANDBOX_RELAY_PORT}/v1`);
  assert.equal(runtime.started[0].model.socketPath, socketPath);
});
socketTest("host socket mode honors a configured host allow-list", async (t) => {
  const root = tempDir(t); const directory = join(root, "proxy"); mkdirSync(directory, { mode: 0o700 }); const socketPath = join(directory, "model.sock");
  const host = await launch(t, join(root, "state"), { modelProxy: { ...socketOptions(socketPath), allowedHosts: ["custom.test"] } });
  const token = host.proxy.tokens.issue({ attemptId: randomUUID(), taskId: randomUUID(), projectId: randomUUID(), epoch: 1, allowedModels: ["approved"] }).token;
  assert.equal((await socketRequest(socketPath, "custom.test", token)).status, 200);
  assert.equal((await socketRequest(socketPath, `127.0.0.1:${SANDBOX_RELAY_PORT}`, token)).status, 403);
});
for (const [label, mode] of [["group accessible", 0o750], ["world accessible", 0o755], ["overly restricted", 0o600]])
  socketTest(`host socket mode refuses a ${label} parent`, async (t) => {
    const root = tempDir(t); const directory = join(root, "proxy"); mkdirSync(directory, { mode: 0o700 }); chmodSync(directory, mode);
    t.after(() => { try { chmodSync(directory, 0o700); } catch { /* Temporary root may already be removed. */ } });
    await assert.rejects(startHost({ stateDir: join(root, "state"), port: 0, onBootstrapToken() {}, modelProxy: socketOptions(join(directory, "model.sock")) }),
      { message: "Invalid proxy socket configuration" });
  });
socketTest("host socket mode refuses a missing parent", async (t) => {
  const root = tempDir(t);
  await assert.rejects(startHost({ stateDir: join(root, "state"), port: 0, onBootstrapToken() {}, modelProxy: socketOptions(join(root, "missing", "model.sock")) }),
    { message: "Invalid proxy socket configuration" });
});
for (const [label, value] of [["relative", "relative.sock"], ["drive mount", "/mnt/private/model.sock"], ["zero byte", `${resolve("model.sock")}\0`],
  ["parent traversal", `${resolve("proxy")}/../model.sock`], ["empty", ""]]) {
  test(`parseEnv refuses ${label} proxy socket configuration`, () => {
    assert.throws(() => parseEnv({ FACTORY_PROXY_SOCKET: value }), { message: "Invalid proxy socket configuration" });
  });
  test(`host refuses ${label} proxy socket configuration`, async (t) => {
    await assert.rejects(startHost({ stateDir: tempDir(t), port: 0, onBootstrapToken() {}, modelProxy: socketOptions(value) }),
      { message: "Invalid proxy socket configuration" });
  });
}
test("parseEnv carries the optional proxy socket without changing TCP defaults", (t) => {
  const socketPath = join(tempDir(t), "proxy.sock");
  const options = parseEnv({ FACTORY_AGENT_MODELS: "approved", FACTORY_PROXY_SOCKET: socketPath });
  assert.deepEqual(options.agentProxy, { port: 8788, approvedModels: ["approved"], socketPath });
  assert.deepEqual(parseEnv({ FACTORY_AGENT_MODELS: "approved" }).agentProxy, { port: 8788, approvedModels: ["approved"] });
});

function opencodeEnv(t) {
  const root = tempDir(t); const dir = join(root, "opencode"); mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "bin", "opencode"), "synthetic executable fixture");
  return { FACTORY_RUNTIME: "opencode", FACTORY_OPENCODE_DIR: dir, FACTORY_PROXY_SOCKET: join(root, "proxy", "model.sock"),
    FACTORY_AGENT_MODELS: "approved,provider/other", NINE_ROUTER_API_KEY: "synthetic-startup-private-value",
    FACTORY_GATEWAY_URL: "http://127.0.0.1:9000/v1", FACTORY_PROJECTS_ROOT: join(root, "projects"), FACTORY_WORKTREES_ROOT: join(root, "worktrees") };
}
for (const name of ["FACTORY_OPENCODE_DIR", "FACTORY_PROXY_SOCKET", "FACTORY_AGENT_MODELS", "NINE_ROUTER_API_KEY", "FACTORY_GATEWAY_URL"])
  for (const [label, value] of [["missing", undefined], ["empty", ""], ["blank", " "]])
    test(`opencode startup names ${label} ${name} without printing values`, (t) => {
      const env = opencodeEnv(t); env[name] = value;
      assert.throws(() => parseEnv(env), { message: `${name} is required for FACTORY_RUNTIME=opencode` });
    });
test("parseEnv selects opencode with socket proxy and never returns the upstream credential", (t) => {
  const env = opencodeEnv(t); const parsed = parseEnv(env);
  assert.deepEqual(parsed.opencode, { dir: env.FACTORY_OPENCODE_DIR });
  assert.deepEqual(parsed.agentProxy, { port: 8788, approvedModels: ["approved", "provider/other"], socketPath: env.FACTORY_PROXY_SOCKET });
  assert.equal(JSON.stringify(parsed).includes(env.NINE_ROUTER_API_KEY), false);
});
for (const label of ["relative", "nonexistent", "missing executable", "executable directory"])
  test(`opencode startup rejects ${label} installation`, (t) => {
    const env = opencodeEnv(t);
    if (label === "relative") env.FACTORY_OPENCODE_DIR = "relative";
    else if (label === "nonexistent") env.FACTORY_OPENCODE_DIR = join(env.FACTORY_OPENCODE_DIR, "missing");
    else {
      const dir = join(tempDir(t), "installation"); mkdirSync(join(dir, "bin"), { recursive: true }); env.FACTORY_OPENCODE_DIR = dir;
      if (label === "executable directory") mkdirSync(join(dir, "bin", "opencode"));
    }
    assert.throws(() => parseEnv(env), { message: "FACTORY_OPENCODE_DIR must be an absolute directory containing bin/opencode" });
  });
for (const [label, value] of [["invalid", "private-invalid-value"], ["credentials", "http://private:private@localhost/v1"], ["non HTTP", "file:///private"]])
  test(`opencode startup rejects ${label} gateway without printing its value`, (t) => {
    const env = opencodeEnv(t); env.FACTORY_GATEWAY_URL = value;
    assert.throws(() => parseEnv(env), { message: "FACTORY_GATEWAY_URL must be an HTTP or HTTPS URL without credentials" });
  });
test("opencode startup names an invalid proxy socket setting", (t) => {
  const env = opencodeEnv(t); env.FACTORY_PROXY_SOCKET = "relative-private-value";
  assert.throws(() => parseEnv(env), { message: "FACTORY_PROXY_SOCKET must be a canonical absolute socket path outside /mnt" });
});
test("opencode startup names invalid workspace settings", (t) => {
  const env = opencodeEnv(t); env.FACTORY_PROJECTS_ROOT = "relative-private-value";
  assert.throws(() => parseEnv(env), { message: "FACTORY_PROJECTS_ROOT and FACTORY_WORKTREES_ROOT must be absolute, separate directories outside /mnt" });
});
for (const name of ["FACTORY_PROJECTS_ROOT", "FACTORY_WORKTREES_ROOT"])
  test(`opencode startup rejects a file for ${name}`, (t) => {
    const env = opencodeEnv(t); writeFileSync(env[name], "synthetic fixture");
    assert.throws(() => parseEnv(env), { message: `${name} must be a directory separate from FACTORY_STATE_DIR` });
  });
for (const name of ["FACTORY_PROJECTS_ROOT", "FACTORY_WORKTREES_ROOT"])
  test(`opencode startup rejects ${name} overlapping host state`, (t) => {
    const env = opencodeEnv(t); env.FACTORY_STATE_DIR = join(env[name], "state");
    assert.throws(() => parseEnv(env), { message: `${name} must be a directory separate from FACTORY_STATE_DIR` });
  });
test("fake runtime remains the default without opencode prerequisites", () => {
  assert.deepEqual(parseEnv({ FACTORY_RUNTIME: "fake" }), parseEnv({})); assert.equal(parseEnv({}).opencode, undefined);
});
test("host runtimes option registers an adapter next to the default fake runtime", async (t) => {
  const delegate = createFakeRuntime({ stepMs: 0 }); const runtime = { kind: "native-opencode", start: delegate.start };
  const host = await launch(t, undefined, { dispatch: { stepMs: 0 }, runtimes: [runtime] });
  const input = hostDispatchTask(host, "Deliver");
  host.storage.raw.prepare("UPDATE seats SET runtime = ? WHERE id = ?").run(runtime.kind, input.seatId);
  const attempt = host.dispatch.enqueue(input); await host.dispatch.idle();
  assert.equal(attempt.runtime, "native-opencode"); assert.equal(delegate.started.length, 1);
  assert.equal(getAttempt(host.storage.raw, attempt.projectId, attempt.id).state, "succeeded");
  const other = hostDispatchTask(host, "Deliver"); host.storage.raw.prepare("UPDATE seats SET runtime = 'fake' WHERE id = ?").run(other.seatId);
  const fallback = host.dispatch.enqueue(other); await host.dispatch.idle();
  assert.equal(fallback.runtime, "fake"); assert.equal(getAttempt(host.storage.raw, fallback.projectId, fallback.id).state, "succeeded");
  assert.equal(delegate.started.length, 1);
});
test("host keeps fake fallback for unregistered runtime seats", async (t) => {
  const host = await launch(t, undefined, { dispatch: { stepMs: 0 }, runtimes: [] }); const input = hostDispatchTask(host, "Deliver");
  host.storage.raw.prepare("UPDATE seats SET runtime = 'native-opencode' WHERE id = ?").run(input.seatId);
  const attempt = host.dispatch.enqueue(input); await host.dispatch.idle(); assert.equal(attempt.runtime, "fake");
  assert.equal(getAttempt(host.storage.raw, attempt.projectId, attempt.id).state, "succeeded");
});

test("host pushes are disabled unless remotes are explicitly configured", async (t) => {
  const host = await launch(t); const session = await bootstrap(host);
  assert.equal(host.effects, null);
  const headers = { host: `127.0.0.1:${host.port}`, cookie: session.cookie, origin: host.origin,
    "x-csrf-token": session.csrf, "content-type": "application/json" };
  const names = await host.app.inject({ url: "/effects/remotes", headers });
  assert.deepEqual(names.json().remotes, []);
  const push = await host.app.inject({ method: "POST", url: `/projects/${randomUUID()}/attempts/${randomUUID()}/push`,
    payload: { remote: "operator" }, headers });
  assert.equal(push.statusCode, 404); assert.equal(push.json().error.message, "not-available");
});

test("host wires named remotes without requiring a dispatcher", async (t) => {
  const url = "https://example.invalid/operator/repo.git"; const command = "ssh -i /synthetic/private-key";
  const host = await launch(t, undefined, { pushRemotes: [{ name: "operator", url }], pushSshCommand: command });
  assert.equal(host.dispatch, null); assert.ok(host.effects); const session = await bootstrap(host);
  const response = await host.app.inject({ url: "/effects/remotes", headers: { host: `127.0.0.1:${host.port}`, cookie: session.cookie } });
  assert.deepEqual(response.json(), { apiVersion: 1, ok: true, remotes: ["operator"] });
  assert.equal(response.body.includes(url), false); assert.equal(response.body.includes(command), false);
  assert.equal(host.storage.raw.serialize().includes(Buffer.from(url)), false);
});

test("host waits for effects before closing storage", async (t) => {
  const host = await launch(t, undefined, { pushRemotes: [{ name: "operator", url: "file:///srv/synthetic-mirror" }] });
  const closeEffects = host.effects.close.bind(host.effects); let release; let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  host.effects.close = async () => {
    await closeEffects(); assert.equal(host.storage.raw.open, true); entered(); await gate;
  };
  const closing = host.close(); await started; assert.equal(host.storage.raw.open, true);
  release(); await closing; assert.equal(host.storage.raw.open, false);
});

test("host startup recovers pending effects without running git", async (t) => {
  const stateDir = tempDir(t); const config = { pushRemotes: [{ name: "operator", url: "file:///srv/synthetic-mirror" }] };
  const first = await launch(t, stateDir, config); const input = hostDispatchTask(first);
  const attempt = createAttempt(first.storage.raw, { ...input, id: randomUUID(), runtime: "fake", provider: "fake",
    model: "fake", effort: "low", now: new Date().toISOString() });
  const id = randomUUID(); const now = new Date().toISOString();
  first.storage.raw.prepare("INSERT INTO effects VALUES (?, ?, ?, 'git.push-branch', ?, ?, 'pending', NULL, ?, NULL)")
    .run(input.projectId, id, attempt.id, "a".repeat(64), JSON.stringify({ remote: "operator", branch: "factory/recovery-e1" }), now);
  await first.close(); const second = await launch(t, stateDir, config);
  const recovered = second.effects.getEffect(input.projectId, id);
  assert.equal(recovered.state, "unknown"); assert.equal(recovered.completedAt, null);
  assert.equal(second.hub.readAfter(input.projectId, { epoch: second.hub.currentCursor(input.projectId).epoch, sequence: "0" }).events
    .filter((event) => event.payload.type === "entity.changed" && event.payload.entity.kind === "effect").length, 1);
});

for (const [label, command] of [["line break", "ssh\nsynthetic"], ["zero byte", "ssh\0synthetic"]])
  test(`host refuses ssh command ${label} with a fixed startup error`, async (t) => {
    await assert.rejects(startHost({ stateDir: tempDir(t), port: 0, onBootstrapToken() {}, pushSshCommand: command }),
      { message: "FACTORY_PUSH_SSH_COMMAND must not contain line breaks or NUL" });
  });
nodeTest("opencode entrypoint refuses an unavailable sandbox before opening host state", { skip: process.platform === "linux" ? "Non-Linux preflight" : false }, (t) => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../dist/main.js", import.meta.url))], {
    env: opencodeEnv(t), encoding: "utf8", timeout: 5000,
  });
  assert.ifError(result.error); assert.equal(result.status, 1); assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim(), "FACTORY_RUNTIME=opencode requires working bubblewrap on Linux");
});


test("host advertises and executes all document lifecycle commands",async(t)=>{
  const host=await launch(t,undefined,{dispatch:null}); const session=await bootstrap(host); const project=command();
  assert.equal((await postCommand(host,session,project)).status,200);
  const response=await fetch(`${host.origin}/system/capabilities`,{headers:{cookie:session.cookie}}); const capabilities=await response.json();
  for(const type of ["artifacts.transition","artifacts.share","artifacts.clear-stale"]) assert.ok(capabilities.commands.includes(type));
  const artifactId=randomUUID(); const raw=host.storage.raw;
  raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,
    abstract_l0,visibility,created_at) VALUES (?,?,1,'other','Document','text/plain',?,1,'reviewed','Abstract','team-draft',?)`)
    .run(project.projectId,artifactId,"a".repeat(64),new Date().toISOString());
  const execute=(type,payload)=>postCommand(host,session,{apiVersion:1,commandId:randomUUID(),projectId:project.projectId,type,payload});
  assert.equal((await execute("artifacts.transition",{artifactId,version:1,to:"approved",comment:"Accepted"})).status,200);
  assert.equal((await execute("artifacts.share",{artifactId,version:1,visibility:"shared"})).status,200);
  raw.prepare("INSERT INTO knowledge_stale VALUES (?,?,1,?,1,?)").run(project.projectId,artifactId,artifactId,new Date().toISOString());
  assert.equal((await execute("artifacts.clear-stale",{artifactId,version:1,becauseArtifactId:artifactId,becauseVersion:1})).status,200);
  assert.equal(raw.prepare("SELECT count(*) AS n FROM knowledge_stale").get().n,0);
});
