import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import Fastify from "fastify";
import { createContentStore } from "../dist/artifacts/content-store.js";
import { registerAttemptResults, listTaskArtifacts, getArtifactVersion, setTaskArtifactStatus } from "../dist/artifacts/service.js";
import { createRoutes } from "../dist/api/routes.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { EventHub } from "../dist/events/hub.js";
import { loadPack, findLeadSeat, getActiveEngagement } from "../dist/org/index.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { openStorage } from "../dist/storage/database.js";
import { tasksCreateHandler, getTask } from "../dist/work/service.js";
import { createDispatcher, createFakeRuntime, RuntimeRegistry, moveTask, appendAttemptEvent, getAttempt } from "../dist/dispatch/index.js";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const pack = loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)));
const now = () => new Date("2026-11-07T10:00:00.000Z");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), "factory-artifacts-"));
  const storage = openStorage(":memory:"); storage.migrate({ migrationsDir, backupDir: null });
  const raw = storage.raw; const hub = new EventHub(raw); const errors = [];
  const store = createContentStore({ dir: join(root, "content") });
  const evidenceDir = join(root, "evidence"); fs.mkdirSync(evidenceDir);
  const dispatchers = [];
  t.after(async () => {
    for (const d of dispatchers) await d.stop(); storage.close();
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + "factory-artifacts-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const pipeline = createCommandPipeline({ storage, hub, handlers: {
    "projects.create": createProjectsCreateHandler({ pack }), "tasks.create": tasksCreateHandler,
  } });
  const projectId = randomUUID(); const taskId = randomUUID();
  const execute = (type, payload) => {
    const r = pipeline.execute({ apiVersion: 1, commandId: randomUUID(), projectId, type, payload });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  };
  execute("projects.create", { name: "Results", workspace: { kind: "directory", root: "/workspace/results" } });
  execute("tasks.create", { taskId, code: "RES-001", title: "Results", goal: "Deliver", brief: "Brief",
    parentTaskId: null, engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] });
  for (const state of ["accepted", "ready", "active"]) moveTask(raw, projectId, taskId, state);
  const seat = findLeadSeat(raw, getActiveEngagement(raw, projectId).teamId);
  const attempt = (epoch = 1, state = "succeeded") => {
    const id = randomUUID(); raw.prepare(`INSERT INTO attempts
      (project_id,id,task_id,revision,epoch,state,outcome,runtime,provider,model,effort,ended_at)
      VALUES (?,?,?,1,?,?,'known','fake','fake','fake','medium',?)`).run(projectId, id, taskId, epoch, state, now().toISOString());
    return { projectId, taskId, attemptId: id, epoch, outcome: state === "succeeded" ? "completed" : "failed", summary: "Summary line\n\nDetails", evidenceDir };
  };
  const evidence = (input, changes = {}, bytes = "diff --git a/file.txt b/file.txt\n+change\n") => {
    const body = { files: [{ path: "file.txt", status: "modified" }], totals: { files: 1, additions: 1, deletions: 0 },
      patchFile: `${input.attemptId}.patch`, patchSha256: digest(bytes), patchSafe: true, patchTruncated: false, ...changes };
    fs.writeFileSync(join(evidenceDir, `${input.attemptId}.patch`), bytes);
    appendAttemptEvent(raw, { projectId, attemptId: input.attemptId, kind: "evidence", body, at: now().toISOString() });
    return body;
  };
  const deps = { raw, store, now, newId: randomUUID, onError: (e) => errors.push(e) };
  const register = (input, overrides = {}) => registerAttemptResults({ ...deps, ...overrides }, input);
  const list = () => listTaskArtifacts(raw, projectId, taskId);
  const version = (ref) => getArtifactVersion(raw, projectId, ref.artifactId, ref.version);
  const dispatch = (options = {}) => {
    const runtime = options.runtime ?? createFakeRuntime({ stepMs: 0 });
    const d = createDispatcher({ storage, hub, registry: new RuntimeRegistry([runtime]),
      onError: (e) => errors.push(e), ...options });
    dispatchers.push(d); d.start(); return d;
  };
  const enqueue = (d) => d.enqueue({ projectId, taskId, seatId: seat.id });
  return { root, storage, raw, hub, store, errors, pipeline, projectId, taskId, evidenceDir, attempt, evidence, register, list, version, dispatch, enqueue };
}
async function api(t, f) {
  const app = Fastify(); t.after(() => app.close());
  const session = async (request, reply) => {
    if (request.headers.cookie !== "test-session") return reply.code(401).send({ ok: false });
  };
  createRoutes({ storage: f.storage, hub: f.hub, pipeline: f.pipeline, artifacts: { store: f.store } })(app, { session, write: session });
  return (url, cookie = "test-session") => app.inject({ method: "GET", url, headers: { cookie } });
}
const listUrl = (f) => `/projects/${f.projectId}/tasks/${f.taskId}/artifacts`;
const contentUrl = (f, ref) => `/projects/${f.projectId}/artifacts/${ref.artifactId}/versions/${ref.version}/content`;
function completed(f) { const input = f.attempt(); f.evidence(input); return { input, refs: f.register(input) }; }

test("completed results register patch and summary with project visibility", (t) => {
  const f = fixture(t); const { input, refs } = completed(f); assert.equal(refs.length, 2);
  assert.deepEqual(refs.map((r) => r.kind), ["code-ref", "other"]);
  for (const ref of refs) {
    const v = f.version(ref); assert.equal(v.status, "in-review"); assert.equal(v.producedByAttemptId, input.attemptId);
    assert.equal(v.contentHash, digest(f.store.get(ref.contentHash))); assert.equal(v.supersedesVersion, null);
  }
  assert.equal(f.version(refs[0]).title, "Changes RES-001 (epoch 1)");
  assert.equal(f.version(refs[0]).abstractL0, "1 files changed, +1 -0");
  assert.equal(f.version(refs[0]).abstractL1, "modified file.txt");
  assert.equal(f.version(refs[1]).mediaType, "text/markdown");
  assert.deepEqual(f.raw.prepare("SELECT DISTINCT visibility FROM artifact_versions").all(), [{ visibility: "project" }]);
});
test("second epoch reuses identities and supersedes previous versions", (t) => {
  const f = fixture(t); const first = completed(f).refs; const secondInput = f.attempt(2); f.evidence(secondInput);
  const second = f.register(secondInput);
  for (let i = 0; i < 2; i++) {
    assert.equal(second[i].artifactId, first[i].artifactId); assert.equal(second[i].version, 2);
    assert.equal(f.version(second[i]).supersedesVersion, 1); assert.equal(f.version(first[i]).status, "superseded");
  }
  assert.deepEqual(f.list().map((a) => a.versions.map((v) => v.version)), [[2, 1], [2, 1]]);
});
test("registration is idempotent per attempt", (t) => {
  const f = fixture(t); const { input } = completed(f); assert.deepEqual(f.register(input), []);
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM artifact_versions").get().n, 2);
});
for (const state of ["failed", "stopped"]) test(`${state} attempt retains draft patch without summary`, (t) => {
  const f = fixture(t); const input = f.attempt(1, state); f.evidence(input); const refs = f.register(input);
  assert.equal(refs.length, 1); assert.equal(refs[0].kind, "code-ref"); assert.equal(f.version(refs[0]).status, "draft");
});
for (const [name, changes] of [
  ["unsafe", { patchSafe: false }], ["truncated", { patchTruncated: true }],
  ["missing name", { patchFile: null }], ["traversal name", { patchFile: "../outside.patch" }],
  ["wrong attempt name", { patchFile: `${randomUUID()}.patch` }], ["invalid hash", { patchSha256: "A".repeat(64) }],
  ["wrong hash", { patchSha256: "0".repeat(64) }], ["newline name", { patchFile: `${randomUUID()}.patch\n` }],
]) test(`${name} evidence omits patch and retains completed summary`, (t) => {
  const f = fixture(t); const input = f.attempt(); f.evidence(input, changes); const refs = f.register(input);
  assert.deepEqual(refs.map((r) => r.kind), ["other"]); assert.equal(f.errors.length, 0);
});
test("tampered patch bytes omit patch but retain summary", (t) => {
  const f = fixture(t); const input = f.attempt(); const e = f.evidence(input);
  fs.writeFileSync(join(f.evidenceDir, e.patchFile), "tampered"); assert.deepEqual(f.register(input).map((r) => r.kind), ["other"]);
});
test("missing patch file omits patch but retains summary", (t) => {
  const f = fixture(t); const input = f.attempt(); const e = f.evidence(input); fs.unlinkSync(join(f.evidenceDir, e.patchFile));
  assert.deepEqual(f.register(input).map((r) => r.kind), ["other"]);
});
test("symlink patch is refused even if its target is inside evidence", { skip: process.platform === "win32" && "Symlink fixture requires POSIX" }, (t) => {
  const f = fixture(t); const input = f.attempt(); const e = f.evidence(input); const path = join(f.evidenceDir, e.patchFile);
  const target = join(f.evidenceDir, "target"); fs.renameSync(path, target); fs.symlinkSync(target, path);
  assert.deepEqual(f.register(input).map((r) => r.kind), ["other"]);
});
for (const runtimeEvidence of [false, true]) test(`attempt without workspace evidence yields no results ${runtimeEvidence}`, (t) => {
  const f = fixture(t); const input = f.attempt();
  if (runtimeEvidence) appendAttemptEvent(f.raw, { projectId: f.projectId, attemptId: input.attemptId,
    kind: "evidence", body: { type: "evidence", summary: "fake" }, at: now().toISOString() });
  assert.deepEqual(f.register(input), []); assert.deepEqual(f.list(), []);
});
for (const summary of [null, "", " \r\n "]) test(`empty summary is omitted ${summary === null ? "null" : summary.length}`, (t) => {
  const f = fixture(t); const input = { ...f.attempt(), summary }; f.evidence(input);
  assert.deepEqual(f.register(input).map((r) => r.kind), ["code-ref"]);
});
test("summary is trimmed and capped at a valid UTF-8 boundary", (t) => {
  const f = fixture(t); const input = { ...f.attempt(), summary: "  " + "🌏".repeat(20_000) + "  " }; f.evidence(input);
  const ref = f.register(input).find((r) => r.kind === "other"); const bytes = f.store.get(ref.contentHash);
  assert.ok(bytes.length <= 32 * 1024); assert.doesNotThrow(() => new TextDecoder("utf8", { fatal: true }).decode(bytes));
  assert.equal(f.version(ref).abstractL0.length, 400);
});
test("abstracts respect contract limits for many files and long first line", (t) => {
  const f = fixture(t); const input = { ...f.attempt(), summary: "x".repeat(1000) + "\nsecond" };
  f.evidence(input, { files: Array.from({ length: 200 }, (_, i) => ({ path: `${i}-${"x".repeat(100)}`, status: "modified" })) });
  const refs = f.register(input);
  for (const ref of refs) { const v = f.version(ref); assert.ok(v.abstractL0.length >= 1 && v.abstractL0.length <= 400); assert.ok((v.abstractL1?.length ?? 0) <= 6000); }
});
test("approved previous versions may only become superseded", (t) => {
  const f = fixture(t); const first = completed(f).refs;
  setTaskArtifactStatus(f.raw, { projectId: f.projectId, taskId: f.taskId, to: "approved" });
  assert.equal(f.version(first[0]).status, "approved");
  assert.throws(() => f.raw.prepare("UPDATE artifact_versions SET status='rejected' WHERE artifact_id=?").run(first[0].artifactId));
  const input = f.attempt(2); f.evidence(input); assert.equal(f.register(input).length, 2);
  for (const ref of first) assert.equal(f.version(ref).status, "superseded");
});
for (const status of ["rejected", "withdrawn"]) test(`final ${status} version remains final on next epoch`, (t) => {
  const f = fixture(t); const { refs } = completed(f);
  if (status === "withdrawn") f.raw.prepare("UPDATE artifact_versions SET status='draft'").run();
  setTaskArtifactStatus(f.raw, { projectId: f.projectId, taskId: f.taskId, to: status });
  const input = f.attempt(2); f.evidence(input); assert.equal(f.register(input).length, 2);
  for (const ref of refs) assert.equal(f.version(ref).status, status);
});
test("status helper refuses unreachable moves atomically", (t) => {
  const f = fixture(t); const { refs } = completed(f);
  assert.throws(() => setTaskArtifactStatus(f.raw, { projectId: f.projectId, taskId: f.taskId, to: "withdrawn" }), /^Error: Artifact transition not allowed$/);
  for (const ref of refs) assert.equal(f.version(ref).status, "in-review");
});
test("content metadata trigger remains immutable and artifact inputs remain untouched", (t) => {
  const f = fixture(t); const { refs } = completed(f);
  assert.throws(() => f.raw.prepare("UPDATE artifact_versions SET content_hash=? WHERE artifact_id=?").run("f".repeat(64), refs[0].artifactId));
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM artifact_inputs").get().n, 0);
});
test("throwing store rolls back metadata and reports a generic error", (t) => {
  const f = fixture(t); const input = f.attempt(); f.evidence(input); let calls = 0;
  const store = { ...f.store, put(bytes) { if (++calls === 2) throw new Error(f.root); return f.store.put(bytes); } };
  assert.deepEqual(f.register(input, { store }), []); assert.deepEqual(f.list(), []);
  assert.equal(f.errors[0].message, "Artifact registration failed"); assert.equal(JSON.stringify(f.errors).includes(f.root), false);
});
test("throwing error observer never escapes registration", (t) => {
  const f = fixture(t); const input = f.attempt(); f.evidence(input);
  assert.deepEqual(f.register(input, { store: { put() { throw new Error("fail"); } }, onError() { throw new Error("observer"); } }), []);
});
test("failed next registration restores previous statuses", (t) => {
  const f = fixture(t); const { refs } = completed(f); const input = f.attempt(2); f.evidence(input);
  let calls = 0;
  assert.deepEqual(f.register(input, { store: { ...f.store, put(bytes) { if (++calls === 2) throw new Error("fail"); return f.store.put(bytes); } } }), []);
  for (const ref of refs) assert.equal(f.version(ref).status, "in-review");
});
test("list and get are scoped to the project and task", (t) => {
  const f = fixture(t); const { refs } = completed(f);
  assert.deepEqual(listTaskArtifacts(f.raw, randomUUID(), f.taskId), []);
  assert.deepEqual(listTaskArtifacts(f.raw, f.projectId, randomUUID()), []);
  assert.equal(getArtifactVersion(f.raw, randomUUID(), refs[0].artifactId, 1), null);
});
test("list route returns grouped versions and content route returns verified text", async (t) => {
  const f = fixture(t); const { refs } = completed(f); const get = await api(t, f);
  const listing = await get(listUrl(f)); assert.equal(listing.statusCode, 200); assert.deepEqual(listing.json().items, f.list());
  for (const ref of refs) {
    const r = await get(contentUrl(f, ref)); assert.equal(r.statusCode, 200);
    assert.equal(r.json().text, f.store.get(ref.contentHash).toString("utf8"));
    assert.equal(r.json().contentHash, ref.contentHash); assert.equal(r.json().sizeBytes, Buffer.byteLength(r.json().text));
  }
});
test("read routes require a session", async (t) => {
  const f = fixture(t); const { refs } = completed(f); const get = await api(t, f);
  for (const url of [listUrl(f), contentUrl(f, refs[0])]) assert.equal((await get(url, "")).statusCode, 401);
});
test("unknown projects tasks artifacts and versions return 404", async (t) => {
  const f = fixture(t); const { refs } = completed(f); const get = await api(t, f);
  const urls = [listUrl({ ...f, projectId: randomUUID() }), listUrl({ ...f, taskId: randomUUID() }),
    contentUrl({ ...f, projectId: randomUUID() }, refs[0]), contentUrl(f, { artifactId: randomUUID(), version: 1 }),
    contentUrl(f, { ...refs[0], version: 2 }), contentUrl(f, { ...refs[0], version: "01" })];
  for (const url of urls) assert.equal((await get(url)).statusCode, 404);
});
test("corrupted store content returns 404", async (t) => {
  const f = fixture(t); const { refs } = completed(f); const ref = refs[0]; const get = await api(t, f);
  fs.writeFileSync(join(f.root, "content", ref.contentHash.slice(0, 2), ref.contentHash), "tampered");
  assert.equal((await get(contentUrl(f, ref))).statusCode, 404);
});
for (const [name, mediaType, bytes, expected] of [
  ["binary", "application/octet-stream", Buffer.from([0, 255]), 415],
  ["invalid UTF-8", "text/markdown", Buffer.from([0xc0, 0xaf]), 422],
]) test(`content route refuses ${name}`, async (t) => {
  const f = fixture(t); const { input } = completed(f); const content = f.store.put(bytes); const artifactId = randomUUID();
  f.raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,
    status,abstract_l0,produced_by_attempt_id,visibility,created_at) VALUES (?,?,1,'other','Fixture',?,?,?,'draft','Fixture',?,'project',?)`)
    .run(f.projectId, artifactId, mediaType, content.hash, content.size, input.attemptId, now().toISOString());
  const get = await api(t, f); assert.equal((await get(contentUrl(f, { artifactId, version: 1 }))).statusCode, expected);
});
test("responses and stored events contain no host directory", async (t) => {
  const f = fixture(t); const { refs } = completed(f); const get = await api(t, f);
  for (const url of [listUrl(f), ...refs.map((ref) => contentUrl(f, ref)), contentUrl(f, { artifactId: randomUUID(), version: 1 })]) {
    const response = await get(url); assert.equal(response.body.includes(f.root), false);
  }
  assert.equal(JSON.stringify(f.raw.prepare("SELECT body_json FROM event_log UNION ALL SELECT body_json FROM attempt_events").all()).includes(f.root), false);
});
test("dispatcher registration runs inside the outcome transaction and throwing hook preserves success", async (t) => {
  const f = fixture(t); let calls = 0;
  const d = f.dispatch({ results: { register(input) {
    calls++; assert.equal(f.raw.inTransaction, true); assert.equal(getAttempt(f.raw, input.projectId, input.attemptId).state, "succeeded");
    throw new Error(f.root);
  } } }); const a = f.enqueue(d); await d.idle();
  assert.equal(calls, 1); assert.equal(getAttempt(f.raw, f.projectId, a.id).state, "succeeded");
  assert.equal(getTask(f.raw, f.projectId, f.taskId).state, "in-review"); assert.equal(f.errors[0].message, "Artifact registration failed");
});
test("dispatcher without results preserves existing behavior", async (t) => {
  const f = fixture(t); const d = f.dispatch(); const a = f.enqueue(d); await d.idle();
  assert.equal(getAttempt(f.raw, f.projectId, a.id).state, "succeeded"); assert.deepEqual(f.list(), []);
});
test("dispatcher failure invokes results with failed outcome and null summary", async (t) => {
  const f = fixture(t); f.raw.prepare("UPDATE tasks SET goal='[fake:fail]' WHERE id=?").run(f.taskId); const calls = [];
  const d = f.dispatch({ results: { register(input) { assert.equal(f.raw.inTransaction, true); calls.push(input); } } });
  const a = f.enqueue(d); await d.idle(); assert.equal(calls.length, 1); assert.equal(calls[0].outcome, "failed");
  assert.equal(calls[0].summary, null); assert.equal(getAttempt(f.raw, f.projectId, a.id).state, "failed");
});

test("workspace result versions and entity events become visible with the committed outcome", async (t) => {
  const f = fixture(t); const observations = [];
  const unsubscribe = f.hub.subscribe(f.projectId, () => {
    if (getTask(f.raw, f.projectId, f.taskId).state === "in-review") observations.push(f.list().length);
  });
  t.after(unsubscribe);
  const workspace = {
    async prepare() { return { path: f.root, branch: "factory/results", baseSha: "1".repeat(40) }; },
    async finish({ attemptId }) {
      const bytes = Buffer.from("diff --git a/file.txt b/file.txt\n+change\n");
      fs.writeFileSync(join(f.evidenceDir, `${attemptId}.patch`), bytes);
      return { files: [{ path: "file.txt", status: "added", additions: 1, deletions: 0, binary: false }],
        totals: { files: 1, additions: 1, deletions: 0 }, baseSha: "1".repeat(40), headSha: "2".repeat(40),
        branch: "factory/results", flags: [], patchBytes: bytes.length, patchFile: `${attemptId}.patch`,
        patchSha256: digest(bytes), patchSafe: true, patchTruncated: false, unsafeReasons: [] };
    },
    async discard() {},
  };
  const d = f.dispatch({ workspace, projectRootFor: () => f.root, results: { register(input) {
    assert.equal(f.raw.inTransaction, true);
    const refs = f.register({ ...input, evidenceDir: f.evidenceDir });
    for (const ref of refs) f.hub.append({ projectId: input.projectId, causationId: input.attemptId,
      payload: { type: "entity.changed", entity: { kind: "artifact-version", id: ref.artifactId, revision: ref.version } } });
  } } });
  const a = f.enqueue(d); await d.idle(); assert.equal(getAttempt(f.raw, f.projectId, a.id).state, "succeeded");
  assert.deepEqual(observations, [2]); assert.equal(f.list().length, 2);
  const events = f.raw.prepare("SELECT body_json FROM event_log WHERE project_id=? ORDER BY sequence").all(f.projectId).map((r) => JSON.parse(r.body_json));
  assert.equal(events.filter((e) => e.payload.type === "entity.changed" && e.payload.entity.kind === "artifact-version").length, 2);
  assert.equal(JSON.stringify(events).includes(f.root), false);
});

test("throwing registration hook rolls back its partial writes without changing failure", async (t) => {
  const f = fixture(t); f.raw.prepare("UPDATE tasks SET goal='[fake:fail]' WHERE id=?").run(f.taskId);
  const d = f.dispatch({ results: { register(input) {
    f.raw.prepare("UPDATE tasks SET title='partial write' WHERE id=?").run(input.taskId);
    throw new Error(f.root);
  } } });
  const a = f.enqueue(d); await d.idle(); assert.equal(getAttempt(f.raw, f.projectId, a.id).state, "failed");
  const task = getTask(f.raw, f.projectId, f.taskId); assert.equal(task.state, "failed"); assert.equal(task.title, "Results");
  assert.equal(f.errors[0].message, "Artifact registration failed");
});
for (const [label, path] of [["posix absolute", "/etc/passwd"], ["backslash rooted", "\\windows\\system32"], ["drive letter", "C:\\secret\\file.txt"]])
  test(`file list in the abstract never includes a ${label} path`, (t) => {
    const f = fixture(t); const input = f.attempt();
    f.evidence(input, { files: [{ path: "kept.txt", status: "modified" }, { path, status: "added" }] });
    const l1 = f.version(f.register(input)[0]).abstractL1;
    assert.equal(l1, "modified kept.txt"); assert.equal(l1.includes(path), false);
  });
