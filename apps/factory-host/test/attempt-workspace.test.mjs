import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import Fastify from "fastify";
import { API_VERSION } from "@factory/contracts";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { EventHub } from "../dist/events/hub.js";
import { loadPack, findLeadSeat, getActiveEngagement } from "../dist/org/index.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { openStorage } from "../dist/storage/database.js";
import { tasksCreateHandler, getTask } from "../dist/work/service.js";
import { createDispatcher, createFakeRuntime, RuntimeRegistry, getAttempt, listAttempts, listAttemptEvents,
  moveTask, createAttempt, transitionAttempt, ensureLocalNode, LOCAL_NODE_ID, appendAttemptEvent } from "../dist/dispatch/index.js";
import { createWorkspaceProvider } from "../dist/dispatch/workspace-provider.js";
import { assertInside, cloneProject, runGit, checkpoint, WorkspaceError } from "../dist/workspace/index.js";
import { createRoutes } from "../dist/api/routes.js";
import { parseEnv, startHost } from "../dist/host.js";
import { createContentStore } from "../dist/artifacts/content-store.js";
import { registerAttemptResults, listTaskArtifacts } from "../dist/artifacts/service.js";

const integration = (name, fn) => test(name, { skip: process.platform !== "linux" && "Requires Linux and real git", timeout: 60_000 }, fn);
const pack = loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)));
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const sha = "1".repeat(40);
const cleanups = new WeakMap();
function cleanup(t, fn) {
  let result;
  const once = () => { result ??= Promise.resolve().then(fn); return result; };
  const entries = cleanups.get(t) ?? []; entries.push(once); cleanups.set(t, entries); t.after(once);
}
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { resolve, promise }; };
const tick = () => new Promise(setImmediate);
async function until(condition) {
  for (let i = 0; i < 5000; i++) { if (condition()) return; await new Promise((r) => setTimeout(r, 2)); }
  assert.fail("condition did not settle");
}
function temp(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "factory-attempt-workspace-")));
  t.after(async () => {
    for (const close of [...(cleanups.get(t) ?? [])].reverse()) await close();
    fs.rmSync(assertInside(fs.realpathSync(tmpdir()), root), { recursive: true, force: true });
  });
  return root;
}
function mockProvider(overrides = {}) {
  const prepared = []; const finished = []; const discarded = [];
  return { prepared, finished, discarded,
    async prepare(input) { prepared.push(input); return { path: join(tmpdir(), "mock-attempt"), branch: `factory/${input.taskCode.toLowerCase()}-e${input.epoch}`, baseSha: sha }; },
    async finish(input) { finished.push(input); return { baseSha: input.baseSha, headSha: sha, branch: input.branch,
      files: [], totals: { files: 0, additions: 0, deletions: 0 }, flags: [], patchBytes: 0, patchTruncated: false,
      patchFile: null, patchSha256: null, patchSafe: true, unsafeReasons: [] }; },
    async discard(input) { discarded.push(input); }, ...overrides };
}
function fixture(t, options = {}) {
  const storage = openStorage(":memory:"); storage.migrate({ migrationsDir, backupDir: null });
  const raw = storage.raw; const hub = new EventHub(raw); const errors = [];
  const pipeline = createCommandPipeline({ storage, hub, handlers: {
    "projects.create": createProjectsCreateHandler({ pack }), "tasks.create": tasksCreateHandler,
  } });
  const execute = (projectId, type, payload) => {
    const result = pipeline.execute({ apiVersion: API_VERSION, commandId: randomUUID(), projectId, type, payload });
    assert.equal(result.status, 200, JSON.stringify(result.body));
  };
  const project = (root = `/workspace/${randomUUID()}`) => {
    const id = randomUUID(); execute(id, "projects.create", { name: "Attempt project", workspace: { kind: "directory", root } });
    return id;
  };
  const projectId = project(options.projectRoot);
  let counter = 0;
  const task = (goal = "Deliver work", scope = projectId) => {
    const id = randomUUID(); execute(scope, "tasks.create", { taskId: id, code: `AWS-${String(++counter).padStart(3, "0")}`,
      title: "Attempt workspace", goal, brief: "Brief", parentTaskId: null, engagementId: null, ownerSeatId: null,
      requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] });
    for (const state of ["accepted", "ready", "active"]) moveTask(raw, scope, id, state);
    return id;
  };
  const runtime = options.runtime ?? createFakeRuntime({ stepMs: 0 });
  const dispatchers = [];
  const create = () => {
    const dispatcher = createDispatcher({ storage, hub, registry: new RuntimeRegistry([runtime]),
      ...(options.results ? { results: options.results({ raw, hub, errors }) } : {}),
      config: { stopTimeoutMs: 100, ...options.config }, onError: (error) => errors.push(error),
      ...(options.timers ? { timers: options.timers } : {}),
      ...(options.clock ? { clock: options.clock } : {}),
      ...(options.workspace ? { workspace: options.workspace, projectRootFor: options.projectRootFor ?? (() => options.projectRoot ?? join(tmpdir(), "project")) } : {}) });
    dispatchers.push(dispatcher); return dispatcher;
  };
  const dispatcher = create();
  cleanup(t, async () => { for (const d of dispatchers) await d.stop(); storage.close(); });
  dispatcher.start();
  const enqueue = (id = task(), scope = projectId, d = dispatcher) => d.enqueue({ projectId: scope, taskId: id,
    seatId: findLeadSeat(raw, getActiveEngagement(raw, scope).teamId).id });
  const events = (a) => listAttemptEvents(raw, a.projectId, a.id, { limit: 500 });
  const evidence = (a) => events(a).findLast((e) => e.kind === "evidence" && e.body.baseSha)?.body;
  const ready = (a) => events(a).find((e) => e.body.to === "workspace-ready")?.body;
  const read = (a) => getAttempt(raw, a.projectId, a.id);
  return { storage, raw, hub, pipeline, dispatcher, create, runtime, errors, projectId, project, task, enqueue, events, evidence, ready, read };
}
async function gitFixture(t, options = {}) {
  const root = temp(t); const source = assertInside(root, join(root, "source")); fs.mkdirSync(source);
  await runGit(source, ["init", "--initial-branch=main", "--template="]);
  await runGit(source, ["config", "user.name", "Fixture"]);
  await runGit(source, ["config", "user.email", "fixture@localhost"]);
  fs.writeFileSync(assertInside(source, join(source, "README.md")), "source readme\n");
  await checkpoint(source, "base");
  const roots = { projectsRoot: join(root, "projects"), worktreesRoot: join(root, "worktrees") };
  const project = await cloneProject(roots, { source, name: "Attempt project" });
  const evidenceDir = join(root, "evidence");
  const provider = createWorkspaceProvider({ roots, evidenceDir });
  const store = options.resultsStore ?? createContentStore({ dir: join(root, "content") });
  const f = fixture(t, { projectRoot: project.root, workspace: provider, config: { stopTimeoutMs: 10_000 },
    results: ({ raw, hub, errors }) => ({ register(input) {
      const refs = registerAttemptResults({ raw, store, now: () => new Date(), newId: randomUUID,
        onError: (error) => errors.push(error) }, { ...input, evidenceDir });
      for (const ref of refs) hub.append({ projectId: input.projectId, causationId: input.attemptId,
        payload: { type: "entity.changed", entity: { kind: "artifact-version", id: ref.artifactId, revision: ref.version } } });
    } }), ...options });
  return { ...f, root, source, roots, clone: project, provider, evidenceDir, store };
}
const digest = (value) => createHash("sha256").update(value).digest("hex");
function treeHash(root, includeGit = true) {
  const hash = createHash("sha256");
  const visit = (path) => {
    for (const name of fs.readdirSync(path).sort()) {
      if (!includeGit && name === ".git") continue;
      const child = assertInside(root, join(path, name)); hash.update(child.slice(root.length));
      if (fs.lstatSync(child).isDirectory()) visit(child); else hash.update(fs.readFileSync(child));
    }
  };
  visit(root); return hash.digest("hex");
}
async function api(t, f) {
  const app = Fastify(); cleanup(t, () => app.close());
  const session = async (request, reply) => { if (request.headers.cookie !== "test-session") return reply.code(401).send({ ok: false }); };
  createRoutes({ storage: f.storage, hub: f.hub, pipeline: f.pipeline, dispatch: f.dispatcher, evidenceDir: f.evidenceDir })(app,
    { session, write: session });
  return (a, cookie = "test-session") => app.inject({ method: "GET",
    url: `/projects/${a.projectId}/attempts/${a.id}/patch`, headers: { cookie } });
}

test("without a workspace provider the runtime context omits workspace", async (t) => {
  const f = fixture(t); const a = f.enqueue(); await f.dispatcher.idle();
  assert.equal(f.read(a).state, "succeeded"); assert.equal("workspace" in f.runtime.started[0], false);
  assert.equal(f.ready(a), undefined);
});
test("optional provider prepares before runtime start and passes the context", async (t) => {
  const provider = mockProvider(); const f = fixture(t, { workspace: provider }); const a = f.enqueue();
  await f.dispatcher.idle(); assert.equal(provider.prepared.length, 1);
  assert.equal(f.runtime.started[0].workspace.branch, "factory/aws-001-e1");
  assert.equal(provider.prepared[0].startFromBranch, null);
  assert.equal(provider.prepared[0].projectId, a.projectId);
});
test("workspace-ready event contains branch and base SHA only", async (t) => {
  const f = fixture(t, { workspace: mockProvider() }); const a = f.enqueue(); await f.dispatcher.idle();
  assert.deepEqual(f.ready(a), { to: "workspace-ready", branch: "factory/aws-001-e1", baseSha: sha });
  assert.equal(JSON.stringify(f.events(a)).includes(tmpdir()), false);
});
for (const goal of ["normal", "[fake:fail]", "[fake:crash]"])
  test(`workspace evidence is collected for ${goal}`, async (t) => {
    const provider = mockProvider(); const f = fixture(t, { workspace: provider }); const a = f.enqueue(f.task(goal));
    await f.dispatcher.idle(); assert.equal(provider.finished.length, 1); assert.equal(provider.finished[0].attemptId, a.id);
    assert.ok(f.evidence(a)); assert.equal(f.read(a).state, goal === "normal" ? "succeeded" : "failed");
    assert.equal(provider.discarded.length, 0);
  });
test("runtime ending without a result still collects evidence", async (t) => {
  const runtime = { kind: "fake", async start() { return { async *events() {}, async stop() {} }; } };
  const f = fixture(t, { workspace: mockProvider(), runtime }); const a = f.enqueue(); await f.dispatcher.idle();
  assert.ok(f.evidence(a)); assert.equal(f.read(a).state, "failed");
  assert.equal(f.events(a).at(-1).body.message, "runtime ended without a result");
});
for (const goal of ["normal", "[fake:fail]"])
  test(`finish error preserves ${goal} outcome and records a generic failure`, async (t) => {
    const f = fixture(t, { workspace: mockProvider({ async finish() { throw new Error("private absolute /secret/root"); } }) });
    const a = f.enqueue(f.task(goal)); await f.dispatcher.idle();
    assert.equal(f.read(a).state, goal === "normal" ? "succeeded" : "failed");
    assert.ok(f.events(a).some((e) => e.body.to === "evidence-failed"));
    assert.equal(JSON.stringify(f.events(a)).includes("/secret/root"), false);
    assert.equal(f.errors[0].message, "workspace evidence failed");
  });
test("finish timeout preserves success and reports evidence-failed", async (t) => {
  const gate = deferred(); const f = fixture(t, { workspace: mockProvider({ finish: () => gate.promise }), config: { stopTimeoutMs: 10, evidenceTimeoutMs: 10 } });
  const keepAlive = setInterval(() => {}, 10); t.after(() => clearInterval(keepAlive));
  const a = f.enqueue(); await f.dispatcher.idle(); assert.equal(f.read(a).state, "succeeded");
  assert.ok(f.events(a).some((e) => e.body.to === "evidence-failed"));
  const before = f.events(a); gate.resolve({ baseSha: sha }); await tick(); assert.deepEqual(f.events(a), before);
});
for (const projectRootFor of [() => null, () => { throw new Error("private root"); }])
  test(`missing or failing project resolver fails cleanly ${projectRootFor.toString()}`, async (t) => {
    const provider = mockProvider(); const f = fixture(t, { workspace: provider, projectRootFor }); const a = f.enqueue();
    await f.dispatcher.idle(); assert.equal(f.read(a).state, "failed");
    assert.equal(getTask(f.raw, a.projectId, a.taskId).state, "failed");
    assert.deepEqual(f.events(a).at(-1).body, { to: "failed", kind: "config", message: "workspace unavailable" });
    assert.equal(provider.prepared.length, 0); assert.equal(f.runtime.started.length, 0);
  });
test("WorkspaceError in prepare fails cleanly with no raw error text", async (t) => {
  const f = fixture(t, { workspace: mockProvider({ async prepare() { throw new WorkspaceError("not-found", "/private/missing"); } }) });
  const a = f.enqueue(); await f.dispatcher.idle(); assert.equal(f.read(a).state, "failed");
  assert.equal(f.events(a).at(-1).body.message, "workspace unavailable"); assert.equal(f.runtime.started.length, 0);
});
test("operator stop collects partial evidence after execution ends", async (t) => {
  const provider = mockProvider(); const f = fixture(t, { workspace: provider }); const a = f.enqueue(f.task("[fake:hang]"));
  await until(() => f.read(a).state === "running");
  assert.equal((await f.dispatcher.stopAttempt(a.projectId, a.id)).state, "stopped");
  assert.ok(f.runtime.ended.some((r) => r.attemptId === a.id)); assert.ok(f.evidence(a));
  assert.equal(provider.finished.length, 1); assert.equal(provider.discarded.length, 0);
});
test("stopping a queued attempt never prepares a workspace", async (t) => {
  const provider = mockProvider(); const f = fixture(t, { workspace: provider }); const a = f.enqueue();
  await f.dispatcher.stopAttempt(a.projectId, a.id); await f.dispatcher.idle(); assert.equal(provider.prepared.length, 0);
});
test("shutdown fences hanging attempts without finish or discard", async (t) => {
  const provider = mockProvider(); const f = fixture(t, { workspace: provider }); const a = f.enqueue(f.task("[fake:hang]"));
  await until(() => f.read(a).state === "running"); await f.dispatcher.stop();
  assert.equal(provider.finished.length, 0); assert.equal(provider.discarded.length, 0); assert.equal(f.evidence(a), undefined);
});
test("fencing a pending prepare detaches it and ignores late resolution", async (t) => {
  const gate = deferred(); let entered = false;
  const provider = mockProvider({ prepare() { entered = true; return gate.promise; } });
  const f = fixture(t, { workspace: provider }); const a = f.enqueue(); await until(() => entered);
  await f.dispatcher.stop(); const before = f.events(a);
  gate.resolve({ path: join(tmpdir(), "late"), branch: "factory/late", baseSha: sha }); await tick();
  assert.deepEqual(f.events(a), before); assert.equal(f.runtime.started.length, 0); assert.equal(provider.finished.length, 0);
});
for (const first of ["normal", "[fake:fail]"])
  test(`continuation selects the earlier branch after ${first}`, async (t) => {
    const provider = mockProvider(); const f = fixture(t, { workspace: provider }); const taskId = f.task(first);
    const a = f.enqueue(taskId); await f.dispatcher.idle(); moveTask(f.raw, f.projectId, taskId, "active");
    const b = f.enqueue(taskId); await f.dispatcher.idle(); assert.equal(b.epoch, 2);
    assert.equal(provider.prepared[1].startFromBranch, f.ready(a).branch);
  });
test("continuation skips earlier attempts that did not produce a branch", async (t) => {
  let calls = 0; const provider = mockProvider(); const prepare = provider.prepare;
  provider.prepare = (input) => ++calls === 2 ? Promise.reject(new WorkspaceError("not-found")) : prepare(input);
  const f = fixture(t, { workspace: provider }); const taskId = f.task(); const a = f.enqueue(taskId); await f.dispatcher.idle();
  moveTask(f.raw, f.projectId, taskId, "active"); f.enqueue(taskId); await f.dispatcher.idle();
  moveTask(f.raw, f.projectId, taskId, "active"); f.enqueue(taskId); await f.dispatcher.idle();
  assert.equal(provider.prepared.at(-1).startFromBranch, f.ready(a).branch);
});
test("fake edit marker is inert without workspace context", async (t) => {
  const f = fixture(t); const a = f.enqueue(f.task("[fake:edit]")); await f.dispatcher.idle(); assert.equal(f.read(a).state, "succeeded");
});
test("fake edit rejects a task code escaping its workspace", async (t) => {
  const root = temp(t); const runtime = createFakeRuntime({ stepMs: 0 }); const controller = new AbortController();
  const session = await runtime.start({ ref: { attemptId: randomUUID(), epoch: 1 }, task: { code: "../../outside", goal: "[fake:edit]" },
    signal: controller.signal, workspace: { path: root, branch: "factory/test", baseSha: sha } });
  const events = []; for await (const event of session.events()) events.push(event);
  assert.equal(events.at(-1).type, "failed"); assert.deepEqual(fs.readdirSync(root), []);
});
test("fake edit writes only inside its supplied workspace", async (t) => {
  const root = temp(t); const runtime = createFakeRuntime({ stepMs: 0 });
  fs.writeFileSync(assertInside(root, join(root, "README.md")), "original\n");
  const session = await runtime.start({ ref: { attemptId: randomUUID(), epoch: 3 }, task: { code: "AWS-123", goal: "[fake:edit]" },
    signal: new AbortController().signal, workspace: { path: root, branch: "factory/test", baseSha: sha } });
  for await (const event of session.events()) assert.notEqual(event.type, "failed");
  assert.equal(fs.readFileSync(assertInside(root, join(root, "FAKE-AWS-123.md")), "utf8"), "edited by the fake runtime, epoch 3");
  assert.match(fs.readFileSync(assertInside(root, join(root, "README.md")), "utf8"), /epoch 3/);
});

for (const exists of [false, true]) test(`parseEnv selects workspace default with shared directory ${exists ? "present" : "absent"}`, (t) => {
  const original = fs.existsSync; t.mock.method(fs, "existsSync", (path) => path === "/srv/factory/workspaces" ? exists : original(path));
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const roots = parseEnv({}).workspace;
  assert.equal(roots.projectsRoot, exists ? resolve("/srv/factory/workspaces") : join(homedir(), "factory-v2", "workspaces"));
  assert.equal(roots.worktreesRoot, join(homedir(), "factory-v2", "worktrees"));
});
for (const roots of [
  { FACTORY_PROJECTS_ROOT: "/mnt/x/projects" }, { FACTORY_WORKTREES_ROOT: "/mnt/x/worktrees" },
  { FACTORY_PROJECTS_ROOT: "/mnt" }, { FACTORY_PROJECTS_ROOT: "relative" },
]) test(`parseEnv refuses invalid workspace roots ${JSON.stringify(roots)}`, () => {
  assert.throws(() => parseEnv(roots), /Workspace roots must be absolute, separate directories outside \/mnt/);
});
for (const nesting of ["equal", "projects-in-worktrees", "worktrees-in-projects"])
  test(`parseEnv rejects ${nesting}`, (t) => {
    const root = temp(t); const parent = join(root, "parent"); const child = join(parent, "child");
    assert.throws(() => parseEnv({ FACTORY_PROJECTS_ROOT: nesting === "projects-in-worktrees" ? child : parent,
      FACTORY_WORKTREES_ROOT: nesting === "worktrees-in-projects" ? child : parent }), /Workspace roots/);
  });
test("parseEnv accepts separate workspace root overrides", (t) => {
  const root = temp(t); const projectsRoot = join(root, "projects"); const worktreesRoot = join(root, "worktrees");
  assert.deepEqual(parseEnv({ FACTORY_PROJECTS_ROOT: projectsRoot, FACTORY_WORKTREES_ROOT: worktreesRoot }).workspace, { projectsRoot, worktreesRoot });
});
for (const workspace of [undefined, null]) test(`startHost workspace ${workspace} stays disabled on every platform`, async (t) => {
  const root = temp(t); const host = await startHost({ stateDir: root, port: 0, dispatch: {}, workspace, onBootstrapToken() {} });
  try { assert.equal(host.workspace, null); assert.ok(host.dispatch); } finally { await host.close(); }
});

integration("real attempt has its own factory branch and path-free workspace event", async (t) => {
  const f = await gitFixture(t); const a = f.enqueue(f.task("[fake:edit]")); await f.dispatcher.idle();
  const workspace = f.runtime.started[0].workspace;
  assert.equal(workspace.branch, "factory/aws-001-e1"); assert.equal(f.ready(a).baseSha, f.clone.headSha);
  assertInside(f.roots.worktreesRoot, workspace.path); assert.equal(f.read(a).state, "succeeded");
  assert.equal(getTask(f.raw, a.projectId, a.taskId).state, "in-review");
  assert.equal(JSON.stringify(f.events(a)).includes(f.root), false);
});

integration("real completed attempt registers verified patch and summary and artifact events", async (t) => {
  const f = await gitFixture(t); const taskId = f.task("[fake:edit]");
  const observed = [];
  const unsubscribe = f.hub.subscribe(f.projectId, () => {
    const a = listAttempts(f.raw, f.projectId, taskId).at(-1);
    if (a?.state === "succeeded") observed.push(listTaskArtifacts(f.raw, f.projectId, taskId).length);
  });
  cleanup(t, unsubscribe);
  const a = f.enqueue(taskId); await f.dispatcher.idle();
  const artifacts = listTaskArtifacts(f.raw, f.projectId, taskId); assert.equal(artifacts.length, 2);
  assert.ok(observed.includes(2));
  for (const artifact of artifacts) {
    const v = artifact.versions[0]; assert.equal(v.status, "in-review"); assert.equal(v.producedByAttemptId, a.id);
    assert.equal(digest(f.store.get(v.contentHash)), v.contentHash);
  }
  const patch = artifacts.find((artifact) => artifact.kind === "code-ref");
  assert.equal(patch.versions[0].contentHash, f.evidence(a).patchSha256);
  const events = f.raw.prepare("SELECT body_json FROM event_log WHERE project_id=?").all(f.projectId).map((r) => JSON.parse(r.body_json));
  const changed = events.filter((e) => e.payload.type === "entity.changed" && e.payload.entity.kind === "artifact-version");
  assert.equal(changed.length, 2); assert.equal(JSON.stringify(events).includes(f.root), false);
});

integration("real changes requested attempt increments versions and supersedes previous results", async (t) => {
  const f = await gitFixture(t); const taskId = f.task("[fake:edit]"); f.enqueue(taskId); await f.dispatcher.idle();
  const before = listTaskArtifacts(f.raw, f.projectId, taskId);
  moveTask(f.raw, f.projectId, taskId, "active"); f.enqueue(taskId); await f.dispatcher.idle();
  const after = listTaskArtifacts(f.raw, f.projectId, taskId);
  assert.deepEqual(after.map((a) => a.artifactId), before.map((a) => a.artifactId));
  for (const artifact of after) {
    assert.deepEqual(artifact.versions.map((v) => v.version), [2, 1]);
    assert.deepEqual(artifact.versions.map((v) => v.status), ["in-review", "superseded"]);
    assert.equal(artifact.versions[0].supersedesVersion, 1);
  }
});

for (const marker of ["[fake:fail]", "[fake:hang]"]) integration(`real results preserve partial draft for ${marker}`, async (t) => {
  const f = await gitFixture(t); const a = f.enqueue(f.task(`[fake:edit]${marker}`));
  if (marker === "[fake:hang]") {
    await until(() => f.runtime.started[0]?.workspace && fs.existsSync(join(f.runtime.started[0].workspace.path, "FAKE-AWS-001.md")));
    await f.dispatcher.stopAttempt(a.projectId, a.id);
  }
  await f.dispatcher.idle();
  const artifacts = listTaskArtifacts(f.raw, a.projectId, a.taskId); assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].kind, "code-ref"); assert.equal(artifacts[0].versions[0].status, "draft");
  assert.match(f.store.get(artifacts[0].versions[0].contentHash).toString("utf8"), /FAKE-AWS-001/);
});

integration("throwing results store preserves real attempt and task outcomes", async (t) => {
  const f = await gitFixture(t, { resultsStore: { put() { throw new Error("unavailable"); } } });
  const a = f.enqueue(f.task("[fake:edit]")); await f.dispatcher.idle();
  assert.equal(f.read(a).state, "succeeded"); assert.equal(getTask(f.raw, a.projectId, a.taskId).state, "in-review");
  assert.deepEqual(listTaskArtifacts(f.raw, a.projectId, a.taskId), []);
  assert.equal(f.errors.at(-1).message, "Artifact registration failed");
});

test("results callback sees workspace evidence and cannot change operator stop outcome", async (t) => {
  let called = 0;
  const f = fixture(t, { workspace: mockProvider(), results: ({ raw }) => ({ register(input) {
    called++; assert.equal(input.outcome, "failed"); assert.equal(input.summary, null); assert.equal(raw.inTransaction, true);
    assert.ok(listAttemptEvents(raw, input.projectId, input.attemptId).some((e) => e.kind === "evidence" && Array.isArray(e.body.files)));
    throw new Error("unavailable");
  } }) });
  const a = f.enqueue(f.task("[fake:hang]")); await until(() => f.read(a).state === "running");
  await f.dispatcher.stopAttempt(a.projectId, a.id); await f.dispatcher.idle();
  assert.equal(called, 1); assert.equal(f.read(a).state, "stopped"); assert.equal(f.errors.at(-1).message, "Artifact registration failed");
});
integration("real attempt evidence lists files, totals and committed head", async (t) => {
  const f = await gitFixture(t); const a = f.enqueue(f.task("[fake:edit]")); await f.dispatcher.idle(); const e = f.evidence(a);
  assert.deepEqual(e.files.map((file) => file.path).sort(), ["FAKE-AWS-001.md", "README.md"]);
  assert.equal(e.totals.files, 2); assert.ok(e.totals.additions >= 2); assert.equal(e.totals.deletions, 0);
  assert.notEqual(e.headSha, e.baseSha); assert.equal(e.patchSafe, true); assert.equal(e.patchTruncated, false);
});
integration("patch hash, byte count and private file/directory permissions match evidence", async (t) => {
  const f = await gitFixture(t); const a = f.enqueue(f.task("[fake:edit]")); await f.dispatcher.idle(); const e = f.evidence(a);
  assert.equal(e.patchFile, `${a.id}.patch`); const path = assertInside(f.evidenceDir, join(f.evidenceDir, e.patchFile));
  const patch = fs.readFileSync(path); assert.equal(digest(patch), e.patchSha256); assert.equal(patch.length, e.patchBytes);
  assert.equal(fs.statSync(path).mode & 0o777, 0o600); assert.equal(fs.statSync(f.evidenceDir).mode & 0o777, 0o700);
});
integration("attempt leaves original repository and clone working directory unchanged", async (t) => {
  const f = await gitFixture(t); const original = treeHash(f.source); const clone = treeHash(f.clone.root, false);
  f.enqueue(f.task("[fake:edit]")); await f.dispatcher.idle();
  assert.equal(treeHash(f.source), original); assert.equal(treeHash(f.clone.root, false), clone);
});
for (const marker of ["[fake:fail]", "[fake:hang]"])
  integration(`real ${marker} attempt preserves edits and patch`, async (t) => {
    const f = await gitFixture(t); const a = f.enqueue(f.task(`${marker}[fake:edit]`));
    if (marker.includes("hang")) { await until(() => f.read(a).state === "running"); await f.dispatcher.stopAttempt(a.projectId, a.id); }
    await f.dispatcher.idle(); assert.ok(f.evidence(a).patchFile);
    assert.equal(f.evidence(a).totals.files, 2); assert.equal(f.read(a).state, marker.includes("hang") ? "stopped" : "failed");
  });
for (const first of ["[fake:edit]", "[fake:edit][fake:fail]"])
  integration(`real epoch two continues from previous tip after ${first}`, async (t) => {
    const f = await gitFixture(t); const taskId = f.task(first); const a = f.enqueue(taskId); await f.dispatcher.idle();
    moveTask(f.raw, f.projectId, taskId, "active");
    f.raw.prepare("UPDATE tasks SET goal = ? WHERE project_id = ? AND id = ?").run("Review previous work", f.projectId, taskId);
    const b = f.enqueue(taskId); await f.dispatcher.idle(); assert.equal(b.epoch, 2);
    assert.equal(f.ready(b).baseSha, f.evidence(a).headSha);
    const context = f.runtime.started[1]; assert.equal(context.workspace.branch, "factory/aws-001-e2");
    assert.equal(fs.readFileSync(assertInside(context.workspace.path, join(context.workspace.path, "FAKE-AWS-001.md")), "utf8"), "edited by the fake runtime, epoch 1");
    assert.equal(f.evidence(b).totals.files, 0);
  });
integration("two tasks use separate worktrees without seeing each other's edits", async (t) => {
  const f = await gitFixture(t); f.enqueue(f.task("[fake:edit]")); f.enqueue(f.task("[fake:edit]")); await f.dispatcher.idle();
  const [one, two] = f.runtime.started.map((context) => context.workspace.path); assert.notEqual(one, two);
  assert.equal(fs.existsSync(assertInside(one, join(one, "FAKE-AWS-002.md"))), false);
  assert.equal(fs.existsSync(assertInside(two, join(two, "FAKE-AWS-001.md"))), false);
});
integration("two projects have isolated worktrees and edits", async (t) => {
  const f = await gitFixture(t); const clone = await cloneProject(f.roots, { source: f.source, name: "Second" });
  const second = f.project(clone.root); await f.dispatcher.stop();
  const runtime = createFakeRuntime({ stepMs: 0 }); const d = createDispatcher({ storage: f.storage, hub: f.hub,
    registry: new RuntimeRegistry([runtime]), workspace: f.provider,
    projectRootFor: (id) => id === second ? clone.root : f.clone.root }); cleanup(t, () => d.stop()); d.start();
  f.enqueue(f.task("[fake:edit]"), f.projectId, d); f.enqueue(f.task("[fake:edit]", second), second, d); await d.idle();
  assert.equal(runtime.started.length, 2); const [one, two] = runtime.started.map((c) => c.workspace.path);
  assert.notEqual(one, two); assert.equal(fs.existsSync(join(one, "FAKE-AWS-002.md")), false);
  assert.equal(fs.existsSync(join(two, "FAKE-AWS-001.md")), false);
});
integration("missing project clone fails prepare without leaving a live attempt", async (t) => {
  const f = await gitFixture(t, { projectRootFor: () => join(tmpdir(), randomUUID()) }); const a = f.enqueue(); await f.dispatcher.idle();
  assert.equal(f.read(a).state, "failed"); assert.equal(f.events(a).at(-1).body.message, "workspace unavailable");
});
integration("project outside projectsRoot fails with generic workspace unavailable", async (t) => {
  const f = await gitFixture(t, { projectRootFor: () => tmpdir() }); const a = f.enqueue(); await f.dispatcher.idle();
  assert.equal(f.read(a).state, "failed"); assert.equal(JSON.stringify(f.events(a)).includes(f.root), false);
});
integration("patch route returns only the matching patch with digest and bytes", async (t) => {
  const f = await gitFixture(t); const request = await api(t, f); const a = f.enqueue(f.task("[fake:edit]")); await f.dispatcher.idle();
  const result = await request(a); assert.equal(result.statusCode, 200); const body = result.json();
  assert.equal(body.apiVersion, API_VERSION); assert.equal(digest(body.patch), body.sha256); assert.equal(Buffer.byteLength(body.patch), body.bytes);
  assert.equal(JSON.stringify(body).includes(f.root), false);
  assert.equal(JSON.stringify(f.hub.readAfter(f.projectId, { epoch: f.hub.currentCursor(f.projectId).epoch, sequence: "0" })).includes(f.root), false);
});
integration("patch route refuses tampered bytes", async (t) => {
  const f = await gitFixture(t); const request = await api(t, f); const a = f.enqueue(f.task("[fake:edit]")); await f.dispatcher.idle();
  fs.appendFileSync(assertInside(f.evidenceDir, join(f.evidenceDir, `${a.id}.patch`)), "tampered"); assert.equal((await request(a)).statusCode, 404);
});
integration("patch route returns 404 for missing attempt, evidence or file", async (t) => {
  const f = await gitFixture(t); const request = await api(t, f);
  assert.equal((await request({ projectId: f.projectId, id: randomUUID() })).statusCode, 404);
  const a = f.enqueue(f.task("[fake:hang]")); await until(() => f.read(a).state === "running");
  assert.equal((await request(a)).statusCode, 404); await f.dispatcher.stopAttempt(a.projectId, a.id);
  fs.unlinkSync(assertInside(f.evidenceDir, join(f.evidenceDir, `${a.id}.patch`))); assert.equal((await request(a)).statusCode, 404);
});
integration("patch route requires session and scopes attempt to project", async (t) => {
  const f = await gitFixture(t); const request = await api(t, f); const a = f.enqueue(); await f.dispatcher.idle();
  assert.equal((await request(a, "invalid")).statusCode, 401);
  assert.equal((await request({ ...a, projectId: randomUUID() })).statusCode, 404);
});
integration("provider refuses non-UUID patch filenames with generic WorkspaceError", async (t) => {
  const f = await gitFixture(t); const workspace = await f.provider.prepare({ projectId: f.projectId, taskCode: "AWS-123", epoch: 1,
    projectRoot: f.clone.root, startFromBranch: null });
  for (const attemptId of ["../outside", "bad", `${randomUUID()}/extra`, `${randomUUID()}\n`]) await assert.rejects(f.provider.finish({ ...workspace, attemptId }),
    (error) => error instanceof WorkspaceError && error.message === "workspace unavailable");
});
integration("unsafe symlink patch is recorded but never saved", async (t) => {
  const f = await gitFixture(t); const workspace = await f.provider.prepare({ projectId: f.projectId, taskCode: "AWS-123", epoch: 1,
    projectRoot: f.clone.root, startFromBranch: null });
  fs.symlinkSync("/outside", assertInside(workspace.path, join(workspace.path, "escape")));
  const evidence = await f.provider.finish({ ...workspace, attemptId: randomUUID() });
  assert.equal(evidence.patchSafe, false); assert.equal(evidence.patchFile, null); assert.equal(evidence.patchSha256, null);
  assert.ok(evidence.unsafeReasons.includes("unsafe symlink target"));
});
integration("recovery retains old workspace and continues from its recorded branch", async (t) => {
  const f = await gitFixture(t); const taskId = f.task();
  f.raw.prepare("UPDATE tasks SET placement = 'repo-bound', side_effect = 'artifact' WHERE id = ?").run(taskId);
  await f.dispatcher.stop();
  const seatId = findLeadSeat(f.raw, getActiveEngagement(f.raw, f.projectId).teamId).id; const now = new Date().toISOString();
  ensureLocalNode(f.raw, { slots: 2, now });
  let a = createAttempt(f.raw, { projectId: f.projectId, taskId, seatId, id: randomUUID(), runtime: "fake", provider: "fake", model: "fake", effort: "medium", now });
  for (const state of ["leased", "preparing", "running"]) a = transitionAttempt(f.raw, a, state,
    { nodeId: LOCAL_NODE_ID, leaseId: randomUUID(), leaseExpiresAt: now, now });
  const workspace = await f.provider.prepare({ projectId: f.projectId, taskCode: "AWS-001", epoch: 1, projectRoot: f.clone.root, startFromBranch: null });
  fs.writeFileSync(assertInside(workspace.path, join(workspace.path, "recovered.md")), "retained"); await checkpoint(workspace.path, "before crash");
  const tip = (await runGit(workspace.path, ["rev-parse", "HEAD"])).stdout.trim();
  appendAttemptEvent(f.raw, { projectId: f.projectId, attemptId: a.id, kind: "state", at: now,
    body: { to: "workspace-ready", branch: workspace.branch, baseSha: workspace.baseSha } });
  const d = f.create(); d.start(); d.kick(); await d.idle();
  const next = listAttempts(f.raw, f.projectId, taskId).at(-1); assert.equal(next.epoch, 2); assert.equal(f.ready(next).baseSha, tip);
  assert.equal(fs.readFileSync(join(workspace.path, "recovered.md"), "utf8"), "retained");
  assert.equal(fs.readFileSync(join(f.runtime.started.at(-1).workspace.path, "recovered.md"), "utf8"), "retained");
  assert.equal(f.evidence(a), undefined);
});
for (const outside of [false, true]) integration(`enabled Host resolves ${outside ? "outside" : "valid"} database clone root`, async (t) => {
  const f = await gitFixture(t); let token; const host = await startHost({ stateDir: join(f.root, "state"), port: 0,
    dispatch: { stepMs: 0 }, workspace: f.roots, onBootstrapToken(value) { token = value; } }); cleanup(t, () => host.close());
  assert.equal(typeof host.workspace.prepare, "function");
  const result = await host.app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host: `127.0.0.1:${host.port}`, origin: `http://127.0.0.1:${host.port}` }, payload: { token } });
  assert.equal(result.statusCode, 200);
  const pipeline = createCommandPipeline({ storage: host.storage, hub: host.hub, handlers: {
    "projects.create": createProjectsCreateHandler({ pack }), "tasks.create": tasksCreateHandler,
  } });
  const projectId = randomUUID(); const taskId = randomUUID();
  const execute = (type, payload) => {
    const response = pipeline.execute({ apiVersion: API_VERSION, commandId: randomUUID(), projectId, type, payload });
    assert.equal(response.status, 200, JSON.stringify(response.body));
  };
  execute("projects.create", { name: "Host project", workspace: { kind: "directory", root: outside ? f.source : f.clone.root } });
  execute("tasks.create", { taskId, code: "AWS-123", title: "Host workspace", goal: "[fake:edit]", brief: "Brief",
    parentTaskId: null, engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] });
  for (const state of ["accepted", "ready", "active"]) moveTask(host.storage.raw, projectId, taskId, state);
  const seatId = findLeadSeat(host.storage.raw, getActiveEngagement(host.storage.raw, projectId).teamId).id;
  const a = host.dispatch.enqueue({ projectId, taskId, seatId }); await host.dispatch.idle();
  assert.equal(getAttempt(host.storage.raw, projectId, a.id).state, outside ? "failed" : "succeeded");
  const events = listAttemptEvents(host.storage.raw, projectId, a.id);
  assert.equal(JSON.stringify(events).includes(f.root), false);
  if (outside) assert.equal(events.at(-1).body.message, "workspace unavailable");
  const cookie = result.headers["set-cookie"].split(";")[0];
  const patch = await host.app.inject({ method: "GET", url: `/projects/${projectId}/attempts/${a.id}/patch`, headers: { host: `127.0.0.1:${host.port}`, cookie } });
  assert.equal(patch.statusCode, outside ? 404 : 200);
  if (!outside) {
    assert.equal(patch.json().sha256, digest(patch.json().patch));
    assert.equal(fs.existsSync(assertInside(join(f.root, "state", "evidence"), join(f.root, "state", "evidence", `${a.id}.patch`))), true);
  }
});

for (const scenario of ["valid", "tampered", "missing-file", "missing-evidence", "other-project", "no-session", "invalid-id"])
  test(`portable patch route verifies ${scenario}`, async (t) => {
    const root = temp(t); const evidenceDir = assertInside(root, join(root, "evidence")); fs.mkdirSync(evidenceDir);
    const provider = mockProvider(); const finish = provider.finish;
    provider.finish = async (input) => {
      const evidence = await finish(input); const patch = "diff --git a/file b/file\n+test\n";
      fs.writeFileSync(assertInside(evidenceDir, join(evidenceDir, `${input.attemptId}.patch`)), patch);
      return { ...evidence, patchFile: `${input.attemptId}.patch`, patchSha256: digest(patch), patchBytes: Buffer.byteLength(patch) };
    };
    const f = fixture(t, { workspace: provider }); f.evidenceDir = evidenceDir;
    const request = await api(t, f); const a = f.enqueue(); await f.dispatcher.idle();
    const patchPath = assertInside(evidenceDir, join(evidenceDir, `${a.id}.patch`)); let target = a;
    if (scenario === "tampered") fs.appendFileSync(patchPath, "changed");
    if (scenario === "missing-file") fs.unlinkSync(patchPath);
    if (scenario === "missing-evidence") f.raw.prepare("DELETE FROM attempt_events WHERE kind = 'evidence'").run();
    if (scenario === "other-project") target = { ...a, projectId: randomUUID() };
    if (scenario === "invalid-id") target = { ...a, id: "not-a-uuid" };
    const response = await request(target, scenario === "no-session" ? "bad" : "test-session");
    assert.equal(response.statusCode, scenario === "valid" ? 200 : scenario === "no-session" ? 401 : 404);
    assert.equal(response.body.includes(root), false);
    if (scenario === "valid") {
      const body = response.json(); assert.equal(body.sha256, digest(body.patch)); assert.equal(body.bytes, Buffer.byteLength(body.patch));
    }
  });

function manualTime() {
  let time = Date.now(); let id = 0; const intervals = new Map();
  const timers = {
    setInterval(callback, ms) { const key = ++id; intervals.set(key, { callback, ms }); return key; },
    clearInterval(key) { intervals.delete(key); },
    setTimeout(callback, ms) { return setTimeout(callback, ms); }, clearTimeout(handle) { clearTimeout(handle); },
  };
  return { timers, clock: () => new Date(time), expire() {
    time += 1000; for (const timer of [...intervals.values()]) if (timer.ms === 5) timer.callback();
  } };
}
test("lease expiry fences a workspace attempt and leaves it without evidence or discard", async (t) => {
  const time = manualTime(); const provider = mockProvider();
  const f = fixture(t, { workspace: provider, timers: time.timers, clock: time.clock, config: { leaseMs: 100, leaseCheckMs: 5 } });
  const a = f.enqueue(f.task("[fake:hang]")); await until(() => f.read(a).state === "running"); time.expire(); await f.dispatcher.idle();
  assert.equal(f.read(a).state, "unknown"); assert.equal(provider.finished.length, 0); assert.equal(provider.discarded.length, 0);
});
test("late runtime output after fencing cannot collect or publish workspace evidence", async (t) => {
  const gate = deferred(); const time = manualTime();
  const runtime = { kind: "fake", async start() { return { events: () => ({ [Symbol.asyncIterator]() { return this; }, next: () => gate.promise }), async stop() {} }; } };
  const provider = mockProvider(); const f = fixture(t, { workspace: provider, runtime, timers: time.timers, clock: time.clock,
    config: { leaseMs: 100, leaseCheckMs: 5 } });
  const a = f.enqueue(); await until(() => f.read(a).state === "running"); time.expire(); await f.dispatcher.idle();
  const before = f.events(a); gate.resolve({ done: false, value: { type: "completed", summary: "late" } }); await tick();
  assert.deepEqual(f.events(a), before); assert.equal(provider.finished.length, 0);
});
test("lease expiry during evidence collection suppresses late evidence and outcome", async (t) => {
  const gate = deferred(); let finishing = false; const time = manualTime();
  const provider = mockProvider({ finish() { finishing = true; return gate.promise; } });
  const f = fixture(t, { workspace: provider, timers: time.timers, clock: time.clock, config: { leaseMs: 100, leaseCheckMs: 5 } });
  const a = f.enqueue(); await until(() => finishing); time.expire(); await f.dispatcher.idle(); const before = f.events(a);
  gate.resolve({ baseSha: sha, patchFile: null }); await tick();
  assert.equal(f.read(a).state, "unknown"); assert.deepEqual(f.events(a), before);
});
test("stop during evidence collection shares one finish and retains the evidence", async (t) => {
  const gate = deferred(); const provider = mockProvider(); const finish = provider.finish;
  provider.finish = async (input) => { const evidence = await finish(input); await gate.promise; return evidence; };
  const f = fixture(t, { workspace: provider, config: { stopTimeoutMs: 2000 } }); const a = f.enqueue();
  await until(() => provider.finished.length === 1); const stopping = f.dispatcher.stopAttempt(a.projectId, a.id);
  await until(() => f.read(a).state === "stopping"); gate.resolve();
  assert.equal((await stopping).state, "stopped"); await f.dispatcher.idle();
  assert.equal(provider.finished.length, 1); assert.ok(f.evidence(a));
});
test("unconfirmed operator stop leaves workspace untouched and outcome unknown", async (t) => {
  const gate = deferred(); const provider = mockProvider();
  const runtime = { kind: "fake", async start() { return { events: () => ({ [Symbol.asyncIterator]() { return this; }, next: () => gate.promise }), stop: () => gate.promise }; } };
  const f = fixture(t, { workspace: provider, runtime, config: { stopTimeoutMs: 10 } });
  const keepAlive = setInterval(() => {}, 10); t.after(() => clearInterval(keepAlive));
  const a = f.enqueue(); await until(() => f.read(a).state === "running");
  assert.equal((await f.dispatcher.stopAttempt(a.projectId, a.id)).state, "unknown");
  assert.equal(provider.finished.length, 0); assert.equal(provider.discarded.length, 0); gate.resolve({ done: true });
});
test("shutdown detaches a pending workspace finish and rejects late publication", async (t) => {
  const gate = deferred(); let entered = false;
  const f = fixture(t, { workspace: mockProvider({ finish() { entered = true; return gate.promise; } }) });
  const a = f.enqueue(); await until(() => entered); await f.dispatcher.stop(); const before = f.events(a);
  gate.resolve({ baseSha: sha }); await tick(); assert.deepEqual(f.events(a), before);
});
integration("truncated patch is evidenced without writing a patch artifact", async (t) => {
  const f = await gitFixture(t); const workspace = await f.provider.prepare({ projectId: f.projectId, taskCode: "AWS-123", epoch: 1,
    projectRoot: f.clone.root, startFromBranch: null });
  fs.writeFileSync(assertInside(workspace.path, join(workspace.path, "large.txt")), "large line\n".repeat(600_000));
  const evidence = await f.provider.finish({ ...workspace, attemptId: randomUUID() });
  assert.equal(evidence.patchTruncated, true); assert.equal(evidence.patchFile, null); assert.equal(evidence.patchSafe, false);
  assert.equal(evidence.patchSha256, null); assert.ok(evidence.patchBytes > 5 * 1024 * 1024);
});
