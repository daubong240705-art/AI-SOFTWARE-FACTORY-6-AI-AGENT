import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { approvalSchema, eventSchema, idSchema } from "@factory/contracts";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { EventHub } from "../dist/events/hub.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
import { loadPack, listSeats, getActiveEngagement } from "../dist/org/index.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { openStorage } from "../dist/storage/database.js";
import { tasksCreateHandler, getTask } from "../dist/work/service.js";
import { createDispatcher, createDispatchHandlers, createFakeRuntime, RuntimeRegistry, listAttempts, appendAttemptEvent } from "../dist/dispatch/index.js";
import { buildHandoff } from "../dist/dispatch/handoff.js";
import { createApprovalsDecideHandler, requestTaskReview, computeReviewDigest, getApprovalView, listApprovals,
  expirePendingApprovals, withdrawPendingReviews, publicApprovalText } from "../dist/approvals/service.js";
import { listTaskArtifacts } from "../dist/artifacts/service.js";
import { startHost } from "../dist/host.js";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const pack = loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const command = (type, projectId, payload) => ({ apiVersion: 1, commandId: randomUUID(), projectId, type, payload });
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.receipt; };

function fixture(t, config = {}) {
  const storage = openStorage(":memory:"); storage.migrate({ migrationsDir, backupDir: null });
  const raw = storage.raw;
  let time = Date.parse("2026-11-07T10:00:00.000Z");
  const clock = () => new Date(time);
  const hub = new EventHub(raw, { clock }); const errors = [];
  const runtime = createFakeRuntime({ stepMs: 0 });
  const dispatcher = createDispatcher({ storage, hub, clock, registry: new RuntimeRegistry([runtime]),
    onError: (e) => errors.push(e),
    ...(config.reviewHook === false ? {} : { onInReview(input) { requestTaskReview({ raw, hub, now: clock, newId: randomUUID }, input); } }),
    ...config.dispatch });
  dispatcher.start();
  const actorId = randomUUID();
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
    "projects.create": createProjectsCreateHandler({ pack }), "tasks.create": tasksCreateHandler,
    ...createDispatchHandlers({ dispatcher }), "approvals.decide": createApprovalsDecideHandler({ dispatcher }),
  } });
  const execute = (type, projectId, payload) => pipeline.execute(command(type, projectId, payload), actorId);
  const project = (name = "Review project") => {
    const id = randomUUID(); ok(execute("projects.create", id, { name, workspace: { kind: "directory", root: `/workspace/review/${id}` } })); return id;
  };
  const projectId = project();
  const seatId = listSeats(raw, getActiveEngagement(raw, projectId).teamId).find((seat) => seat.name === "BE").id;
  let code = 0;
  const task = (state = "in-review", options = {}, scope = projectId) => {
    const id = randomUUID();
    ok(execute("tasks.create", scope, { taskId: id, code: `REV-${String(++code).padStart(3, "0")}`, title: "Build result", goal: "Deliver result",
      brief: "Brief", parentTaskId: null, engagementId: null, ownerSeatId: seatId,
      requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [], ...options }));
    raw.prepare("UPDATE tasks SET state = ? WHERE project_id = ? AND id = ?").run(state, scope, id); return id;
  };
  const attempt = (taskId, epoch = 1, scope = projectId, summary = "Completed the work.") => {
    const id = randomUUID(); raw.prepare(`INSERT INTO attempts
      (project_id,id,task_id,revision,epoch,state,outcome,runtime,provider,model,effort,ended_at)
      VALUES (?,?,?,1,?,'succeeded','known','fake','fake','fake','medium',?)`).run(scope, id, taskId, epoch, clock().toISOString());
    raw.prepare("INSERT INTO attempt_seats VALUES (?,?,?)").run(scope, id, seatId);
    appendAttemptEvent(raw, { projectId: scope, attemptId: id, kind: "state", body: { to: "submitting", summary }, at: clock().toISOString() });
    return id;
  };
  const review = (taskId, attemptId, scope = projectId) => hub.transaction(() => requestTaskReview({ raw, hub, now: clock, newId: randomUUID },
    { projectId: scope, taskId, attemptId: attemptId ?? attempt(taskId, 1, scope) }));
  const artifact = (attemptId, { artifactId = randomUUID(), version = 1, contentHash = hash(`result-${version}`), status = "in-review" } = {}, scope = projectId) => {
    raw.prepare(`INSERT INTO artifact_versions
      (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,abstract_l0,produced_by_attempt_id,visibility,created_at)
      VALUES (?,?,?,'other','Result','text/markdown',?,10,?,'Result',?,'project',?)`)
      .run(scope, artifactId, version, contentHash, status, attemptId, clock().toISOString());
    return artifactId;
  };
  const view = (id, scope = projectId) => getApprovalView(raw, scope, id);
  const decideCommand = (id, optionId = "accept", comment = "Looks good.", overrides = {}) => command("approvals.decide", projectId,
    { approvalId: id, expectedRevision: view(id).revision, contextDigest: view(id).context.digest, optionId, comment, ...overrides });
  const decide = (id, optionId = "accept", comment = "Looks good.", overrides = {}) => pipeline.execute(decideCommand(id, optionId, comment, overrides), actorId);
  const transition = (id, to) => execute("tasks.transition", projectId, { taskId: id, expectedRevision: getTask(raw, projectId, id).revision, to });
  const snapshot = () => Object.fromEntries(["approvals", "approval_comments", "tasks", "attempts", "attempt_seats", "attempt_events", "artifact_versions"]
    .map((name) => [name, raw.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
  const events = () => raw.prepare("SELECT body_json FROM event_log ORDER BY project_id,sequence").all().map((r) => eventSchema.parse(JSON.parse(r.body_json)));
  const approvalEvents = (id) => events().filter((e) => e.payload.type === "entity.changed" && e.payload.entity.kind === "approval" && e.payload.entity.id === id);
  t.after(async () => { await dispatcher.stop(); storage.close(); });
  return { raw, storage, hub, clock, actorId, pipeline, dispatcher, runtime, errors, projectId, seatId, project, task, attempt, review, artifact, view,
    decideCommand, decide, transition, snapshot, events, approvalEvents, advance: (ms) => { time += ms; } };
}
async function api(t, f) {
  const origin = "http://127.0.0.1:8787";
  const gate = createBootstrapGate({ clock: f.clock }); const sessions = createSessionStore({ clock: f.clock });
  const routes = createRoutes({ storage: f.storage, hub: f.hub, pipeline: f.pipeline, dispatch: f.dispatcher });
  const app = createApiServer({ origins: [origin], gate, sessions, clock: f.clock, register: routes });
  t.after(() => app.close());
  const boot = await app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host: "127.0.0.1:8787", origin }, payload: { token: gate.token } });
  assert.equal(boot.statusCode, 200);
  const cookie = boot.headers["set-cookie"].split(";", 1)[0];
  const headers = { host: "127.0.0.1:8787", origin, cookie, "x-csrf-token": boot.json().csrfToken };
  return { read: (url, authenticated = true) => app.inject({ method: "GET", url, headers: authenticated ? headers : { host: headers.host } }),
    post: (body) => app.inject({ method: "POST", url: "/commands", headers, payload: body }), cookie };
}
const prepared = (f) => { const taskId = f.task(); const attemptId = f.attempt(taskId); const approvalId = f.review(taskId, attemptId); return { taskId, attemptId, approvalId }; };

for (const policy of ["human-final", "automatic", "hybrid"]) for (const state of ["draft", "active", "in-review", "failed", "done"])
  test(`request review: ${policy}, ${state}`, (t) => {
    const f = fixture(t); const taskId = f.task(state); const attemptId = f.attempt(taskId);
    f.raw.prepare("UPDATE tasks SET review_policy = ? WHERE id = ?").run(policy, taskId);
    const id = f.review(taskId, attemptId);
    assert.equal(id !== null, policy === "human-final" && state === "in-review");
    if (id) { approvalSchema.parse(f.view(id)); assert.equal(f.view(id).state, "pending"); }
  });

test("review has expected labels, options, summary, expiry and revision", (t) => {
  const f = fixture(t); const { approvalId } = prepared(f); const a = approvalSchema.parse(f.view(approvalId));
  assert.equal(a.subject, "Review REV-001: Build result"); assert.equal(a.summary, "Completed the work."); assert.equal(a.revision, 1);
  assert.deepEqual(a.options.map((o) => o.id), ["accept", "request-changes"]); assert.equal(a.recommendation, null);
  assert.equal(a.approver, "operator"); assert.equal(Date.parse(a.expiresAt) - Date.parse(a.requestedAt), 7 * 86400000);
  assert.equal(a.outcome, null); assert.deepEqual(a.context.refs, []); assert.equal(a.appliedByCommandId, null);
});
test("re-review supersedes the previous pending review and emits both revisions", (t) => {
  const f = fixture(t); const { taskId, approvalId } = prepared(f); const next = f.review(taskId, f.attempt(taskId, 2));
  assert.equal(f.view(approvalId).state, "superseded"); assert.equal(f.view(approvalId).revision, 2);
  assert.equal(f.view(next).state, "pending"); assert.equal(listApprovals(f.raw, f.projectId, { states: ["pending"] }).length, 1);
  assert.deepEqual(f.approvalEvents(approvalId).map((e) => e.payload.entity.revision), [1, 2]);
});
test("re-review preserves previously decided reviews", (t) => {
  const f = fixture(t); const { taskId, approvalId } = prepared(f); ok(f.decide(approvalId, "request-changes"));
  f.raw.prepare("UPDATE tasks SET state = 'in-review' WHERE id = ?").run(taskId);
  // The new queued attempt already supplies epoch 2; complete it before asking again.
  const queued = listAttempts(f.raw, f.projectId, taskId).at(-1);
  f.raw.prepare("UPDATE attempts SET state = 'failed', ended_at = ? WHERE id = ?").run(f.clock().toISOString(), queued.id);
  const next = f.review(taskId, f.attempt(taskId, 3)); assert.equal(f.view(approvalId).state, "changes-requested"); assert.equal(f.view(next).state, "pending");
});
test("unknown task and wrong-project attempts do not request reviews", (t) => {
  const f = fixture(t); const { taskId, attemptId } = prepared(f); const before = f.snapshot();
  assert.equal(f.review(randomUUID(), attemptId), null); assert.equal(f.review(taskId, randomUUID()), null);
  assert.equal(f.review(taskId, attemptId, randomUUID()), null); assert.deepEqual(f.snapshot(), before);
});
test("summary takes latest state with a summary and only evidence totals", (t) => {
  const f = fixture(t); const taskId = f.task(); const attemptId = f.attempt(taskId);
  for (const [kind, body] of [["state", { summary: "Latest result" }], ["state", { to: "succeeded" }],
    ["evidence", { files: [{ path: "/private/file" }], totals: { files: 3, additions: 8, deletions: 2 } }]])
    appendAttemptEvent(f.raw, { projectId: f.projectId, attemptId, kind, body, at: f.clock().toISOString() });
  assert.equal(f.view(f.review(taskId, attemptId)).summary, "Latest result\nEvidence: 3 files changed, +8 -2.");
});
test("review label and completion summary stay within contract limits", (t) => {
  const f = fixture(t); const taskId = f.task(); f.raw.prepare("UPDATE tasks SET title = ? WHERE id = ?").run("x".repeat(500), taskId);
  const id = f.review(taskId, f.attempt(taskId, 1, f.projectId, "s".repeat(5000)));
  const a = approvalSchema.parse(f.view(id)); assert.equal(a.subject.length, 160); assert.equal(a.summary.length, 3500);
});
test("blank summary falls back to useful review text", (t) => {
  const f = fixture(t); const taskId = f.task(); const id = f.review(taskId, f.attempt(taskId, 1, f.projectId, "  "));
  assert.equal(f.view(id).summary, "Task completed.");
});
test("no-artifact digest is canonical task and attempt JSON", (t) => {
  const f = fixture(t); const { taskId, attemptId, approvalId } = prepared(f);
  assert.equal(f.view(approvalId).context.digest, hash(JSON.stringify({ attemptId, taskId })));
  assert.equal(computeReviewDigest(f.raw, f.projectId, taskId), computeReviewDigest(f.raw, f.projectId, taskId));
});
test("artifact digest uses canonical sorted keys and artifact identities", (t) => {
  const f = fixture(t); const taskId = f.task(); const a = f.attempt(taskId);
  const ids = [randomUUID(), randomUUID()].sort(); f.artifact(a, { artifactId: ids[1], contentHash: hash("b") }); f.artifact(a, { artifactId: ids[0], contentHash: hash("a") });
  assert.equal(computeReviewDigest(f.raw, f.projectId, taskId), hash(JSON.stringify([
    { artifactId: ids[0], contentHash: hash("a"), version: 1 }, { artifactId: ids[1], contentHash: hash("b"), version: 1 },
  ])));
});
test("new artifact version changes the digest", (t) => {
  const f = fixture(t); const { taskId, attemptId } = prepared(f); const id = f.artifact(attemptId); const before = computeReviewDigest(f.raw, f.projectId, taskId);
  f.artifact(attemptId, { artifactId: id, version: 2 }); assert.notEqual(computeReviewDigest(f.raw, f.projectId, taskId), before);
});
test("review status changes leave artifact digest stable", (t) => {
  const f = fixture(t); const { taskId, attemptId } = prepared(f); f.artifact(attemptId); const before = computeReviewDigest(f.raw, f.projectId, taskId);
  f.raw.prepare("UPDATE artifact_versions SET status = 'reviewed'").run(); assert.equal(computeReviewDigest(f.raw, f.projectId, taskId), before);
});
test("a new attempt changes an empty-artifact context", (t) => {
  const f = fixture(t); const { taskId, approvalId } = prepared(f); f.attempt(taskId, 2);
  assert.notEqual(computeReviewDigest(f.raw, f.projectId, taskId), f.view(approvalId).context.digest);
});
test("another task's artifact does not affect review context", (t) => {
  const f = fixture(t); const { taskId, approvalId } = prepared(f); f.artifact(f.attempt(f.task()));
  assert.equal(computeReviewDigest(f.raw, f.projectId, taskId), f.view(approvalId).context.digest);
});

const failures = [
  ["unknown approval", (f, c) => { c.payload.approvalId = randomUUID(); }, 404],
  ["wrong project", (f, c) => { c.projectId = f.project(); }, 404],
  ["wrong digest", (f, c) => { c.payload.contextDigest = "0".repeat(64); }, 409],
  ["stale artifact context", (f, c, p) => { f.artifact(p.attemptId); }, 409],
  ["expired", (f) => { f.advance(7 * 86400000); }, 409],
  ["wrong revision", (f, c) => { c.payload.expectedRevision = 99; }, 409],
  ["unknown option", (f, c) => { c.payload.optionId = "unknown"; }, 400],
  ["oversized comment", (f, c) => { c.payload.comment = "x".repeat(32001); }, 400],
  ["missing comment", (f, c) => { delete c.payload.comment; }, 400],
  ["non-string comment", (f, c) => { c.payload.comment = 12; }, 400],
  ["missing digest", (f, c) => { delete c.payload.contextDigest; }, 400],
  ["malformed digest", (f, c) => { c.payload.contextDigest = "ABC"; }, 400],
  ["missing revision", (f, c) => { delete c.payload.expectedRevision; }, 400],
  ["zero revision", (f, c) => { c.payload.expectedRevision = 0; }, 400],
  ["missing option", (f, c) => { delete c.payload.optionId; }, 400],
  ["payload actor injection", (f, c) => { c.payload.actorId = randomUUID(); }, 400],
  ["task already active", (f, c, p) => { f.raw.prepare("UPDATE tasks SET state = 'active' WHERE id = ?").run(p.taskId); }, 409],
  ["approval already applied", (f, c, p) => { ok(f.decide(p.approvalId)); }, 409],
  ["approval already changes-requested", (f, c, p) => { ok(f.decide(p.approvalId, "request-changes")); }, 409],
  ["approval withdrawn", (f, c, p) => { withdrawPendingReviews(f.raw, f.projectId, p.taskId, f.clock()); }, 409],
  ["approval superseded", (f, c, p) => { f.review(p.taskId, p.attemptId); }, 409],
  ["approval expired by sweeper", (f) => { f.advance(7 * 86400000); expirePendingApprovals({ raw: f.raw, hub: f.hub, now: f.clock }); }, 409],
];
for (const [label, mutate, status] of failures) test(`decide rejects ${label} without domain changes`, (t) => {
  const f = fixture(t); const p = prepared(f); const c = f.decideCommand(p.approvalId); mutate(f, c, p); const before = f.snapshot();
  const eventCount = f.approvalEvents(p.approvalId).length; const result = f.pipeline.execute(c, f.actorId);
  assert.equal(result.status, status, JSON.stringify(result.body)); assert.deepEqual(f.snapshot(), before);
  assert.equal(f.approvalEvents(p.approvalId).length, eventCount);
  if (label === "wrong revision") assert.equal(result.body.error.currentRevision, 1);
  if (label === "expired") { assert.equal(f.view(p.approvalId).state, "pending"); assert.equal(result.body.error.message, "approval expired"); }
});
for (const [label, payload] of [["null", null], ["array", []], ["string", "bad"], ["empty", {}]])
  test(`malformed ${label} payload leaves database unchanged`, (t) => {
    const f = fixture(t); prepared(f); const before = f.raw.serialize();
    assert.equal(f.pipeline.execute(command("approvals.decide", f.projectId, payload), f.actorId).status, 400); assert.deepEqual(f.raw.serialize(), before);
  });

test("accept through HTTP applies once, approves versions and dispatches a dependent", async (t) => {
  const f = fixture(t); const taskId = f.task(); const attemptId = f.attempt(taskId); f.artifact(attemptId);
  const approvalId = f.review(taskId, attemptId); const dependent = f.task("accepted", { dependsOn: [taskId] });
  f.raw.prepare("UPDATE tasks SET requires_go = 0 WHERE id = ?").run(dependent);
  const http = await api(t, f); const c = f.decideCommand(approvalId); const response = await http.post(c);
  assert.equal(response.statusCode, 200, response.body); assert.equal(getTask(f.raw, f.projectId, taskId).state, "done");
  const a = approvalSchema.parse(f.view(approvalId)); assert.equal(a.state, "applied"); assert.equal(a.appliedByCommandId, c.commandId); assert.equal(a.revision, 3);
  assert.equal(listTaskArtifacts(f.raw, f.projectId, taskId)[0].versions[0].status, "approved");
  assert.equal(getTask(f.raw, f.projectId, dependent).state, "active"); assert.equal(listAttempts(f.raw, f.projectId, dependent).length, 1);
  await f.dispatcher.idle();
  const before = f.snapshot(); const eventCount = f.events().length; const replay = await http.post(c);
  assert.equal(replay.statusCode, 200); assert.deepEqual(replay.json(), response.json()); assert.deepEqual(f.snapshot(), before); assert.equal(f.events().length, eventCount);
  const second = await http.post({ ...c, commandId: randomUUID() }); assert.equal(second.statusCode, 409); assert.deepEqual(f.snapshot(), before);
  assert.deepEqual(f.approvalEvents(approvalId).map((e) => e.payload.entity.revision), [1, 2, 3]);
  assert.ok(response.json().receipt.effects.some((e) => e.kind === "attempt"));
  await f.dispatcher.idle(); assert.equal(f.runtime.started.length, 1);
});
test("request-changes through HTTP persists comment once and passes feedback to epoch 2", async (t) => {
  const f = fixture(t); const taskId = f.task(); const attemptId = f.attempt(taskId); f.artifact(attemptId); const approvalId = f.review(taskId, attemptId);
  const http = await api(t, f); const c = f.decideCommand(approvalId, "request-changes", "Please add the missing boundary checks.");
  const r = await http.post(c); assert.equal(r.statusCode, 200, r.body);
  assert.equal(f.view(approvalId).state, "changes-requested"); assert.equal(f.view(approvalId).appliedByCommandId, null);
  assert.equal(getTask(f.raw, f.projectId, taskId).state, "active");
  const next = listAttempts(f.raw, f.projectId, taskId).at(-1); assert.equal(next.epoch, 2); assert.equal(next.seatId, f.seatId);
  assert.equal(listTaskArtifacts(f.raw, f.projectId, taskId)[0].versions[0].status, "rejected");
  assert.equal((await http.post(c)).statusCode, 200); assert.equal(f.raw.prepare("SELECT count(*) AS n FROM approval_comments").get().n, 1);
  assert.equal(f.view(approvalId).outcome.comment, c.payload.comment); approvalSchema.parse(f.view(approvalId));
  await f.dispatcher.idle(); assert.equal(f.runtime.started.length, 1); assert.match(f.runtime.started[0].handoff, /Reviewer feedback:\nPlease add the missing boundary checks\./);
  assert.equal(listApprovals(f.raw, f.projectId, { states: ["pending"] }).length, 1);
});
test("request-changes uses the previous branch with an injected workspace, without git", async (t) => {
  const starts = [];
  const workspace = { async prepare(input) { starts.push(input); return { path: "/synthetic/workspace", branch: `factory/REV-001/${input.epoch}`, baseSha: "a".repeat(40) }; },
    async finish(input) { return { branch: input.branch, files: [], totals: { files: 0, additions: 0, deletions: 0 }, patchFile: null, patchSha256: null, patchSafe: true, patchTruncated: false, unsafeReasons: [] }; },
    async discard() {} };
  const f = fixture(t, { dispatch: { workspace, projectRootFor: () => "/synthetic/project" } });
  const taskId = f.task("active"); f.dispatcher.enqueue({ projectId: f.projectId, taskId, seatId: f.seatId }); await f.dispatcher.idle();
  const a = listApprovals(f.raw, f.projectId, { states: ["pending"] })[0]; ok(f.decide(a.id, "request-changes", "Fix validation")); await f.dispatcher.idle();
  assert.equal(starts[0].startFromBranch, null); assert.equal(starts[1].startFromBranch, "factory/REV-001/1");
  assert.match(f.runtime.started[1].handoff, /Reviewer feedback:\nFix validation/);
});
test("accept keeps a dependent start gate awaiting operator go", (t) => {
  const f = fixture(t); const p = prepared(f); const dependent = f.task("accepted", { dependsOn: [p.taskId] }); ok(f.decide(p.approvalId));
  assert.equal(getTask(f.raw, f.projectId, dependent).state, "awaiting-go"); assert.equal(listAttempts(f.raw, f.projectId, dependent).length, 0);
});
test("accept without artifacts still applies exactly once", (t) => {
  const f = fixture(t); const p = prepared(f); ok(f.decide(p.approvalId)); assert.equal(f.view(p.approvalId).state, "applied"); assert.equal(f.decide(p.approvalId).status, 409);
});
test("session-derived actor is valid and is never the bearer credential", async (t) => {
  const f = fixture(t); const p = prepared(f); const http = await api(t, f); assert.equal((await http.post(f.decideCommand(p.approvalId))).statusCode, 200);
  const actor = f.view(p.approvalId).outcome.actorId; idSchema.parse(actor); assert.notEqual(actor, f.actorId);
  assert.equal(f.raw.serialize().includes(Buffer.from(http.cookie.split("=")[1])), false);
});
test("direct pipeline uses the caller's actor", (t) => {
  const f = fixture(t); const p = prepared(f); ok(f.decide(p.approvalId)); assert.equal(f.view(p.approvalId).outcome.actorId, f.actorId);
});
test("an apply failure rolls back task, decision, comment and artifact status", (t) => {
  const f = fixture(t); const taskId = f.task(); const attemptId = f.attempt(taskId); f.artifact(attemptId); const id = f.review(taskId, attemptId);
  f.raw.exec("CREATE TEMP TRIGGER force_artifact_failure BEFORE UPDATE OF status ON artifact_versions BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;");
  const before = f.snapshot(); assert.throws(() => f.decide(id), /Artifact transition/); assert.deepEqual(f.snapshot(), before);
});

for (const to of ["done", "active", "cancelled"]) test(`manual move to ${to} withdraws pending review`, (t) => {
  const f = fixture(t); const p = prepared(f); ok(f.transition(p.taskId, to)); const a = approvalSchema.parse(f.view(p.approvalId));
  assert.equal(a.state, "withdrawn"); assert.equal(a.revision, 2); assert.equal(a.outcome, null);
  assert.deepEqual(f.approvalEvents(a.id).map((e) => e.payload.entity.revision), [1, 2]);
});
test("failed manual transition preserves pending review", (t) => {
  const f = fixture(t); const p = prepared(f); const before = f.snapshot(); assert.equal(f.transition(p.taskId, "accepted").status, 409); assert.deepEqual(f.snapshot(), before);
});
for (const offset of [-1, 0, 1]) test(`expiry boundary offset ${offset}ms never approves`, (t) => {
  const f = fixture(t); const p = prepared(f); f.advance(7 * 86400000 + offset);
  const n = expirePendingApprovals({ raw: f.raw, hub: f.hub, now: f.clock }); assert.equal(n, offset >= 0 ? 1 : 0);
  const a = approvalSchema.parse(f.view(p.approvalId)); assert.equal(a.state, offset >= 0 ? "expired" : "pending");
  assert.equal(a.outcome, null); assert.equal(a.appliedByCommandId, null); assert.equal(getTask(f.raw, f.projectId, p.taskId).state, "in-review");
  assert.equal(expirePendingApprovals({ raw: f.raw, hub: f.hub, now: f.clock }), 0);
});
test("sweeper publishes an expiry revision", (t) => {
  const f = fixture(t); const p = prepared(f); f.advance(8 * 86400000); expirePendingApprovals({ raw: f.raw, hub: f.hub, now: f.clock });
  assert.deepEqual(f.approvalEvents(p.approvalId).map((e) => e.payload.entity.revision), [1, 2]);
});
test("sweeper leaves applied and changes-requested decisions unchanged", (t) => {
  const f = fixture(t); const first = prepared(f); ok(f.decide(first.approvalId)); const second = prepared(f); ok(f.decide(second.approvalId, "request-changes"));
  const before = f.snapshot(); f.advance(8 * 86400000); assert.equal(expirePendingApprovals({ raw: f.raw, hub: f.hub, now: f.clock }), 0); assert.deepEqual(f.snapshot(), before);
});
test("sweeper supports raw-only maintenance", (t) => {
  const f = fixture(t); const p = prepared(f); f.advance(8 * 86400000); assert.equal(expirePendingApprovals({ raw: f.raw, now: f.clock }), 1); assert.equal(f.view(p.approvalId).state, "expired");
});

for (const state of ["rejected", "changes-requested", "superseded", "expired", "withdrawn", "applied"])
  test(`database makes ${state} final`, (t) => {
    const f = fixture(t); const p = prepared(f);
    if (["applied", "changes-requested"].includes(state)) ok(f.decide(p.approvalId, state === "applied" ? "accept" : "request-changes"));
    else if (state === "rejected") f.raw.prepare("UPDATE approvals SET state='rejected',outcome_option_id='request-changes',outcome_actor_id=?,decided_at=? WHERE id=?").run(f.actorId, f.clock().toISOString(), p.approvalId);
    else f.raw.prepare("UPDATE approvals SET state=? WHERE id=?").run(state, p.approvalId);
    assert.throws(() => f.raw.prepare("UPDATE approvals SET state='pending',outcome_option_id=NULL,outcome_actor_id=NULL,decided_at=NULL,applied_by_command_id=NULL WHERE id=?").run(p.approvalId), /approval is final|decision is immutable/);
    approvalSchema.parse(f.view(p.approvalId));
  });
test("database forbids pending directly to applied", (t) => {
  const f = fixture(t); const p = prepared(f);
  assert.throws(() => f.raw.prepare("UPDATE approvals SET state='applied',outcome_option_id='accept',outcome_actor_id=?,decided_at=?,applied_by_command_id=? WHERE id=?")
    .run(f.actorId, f.clock().toISOString(), randomUUID(), p.approvalId), /only an approved approval/);
});
test("database forbids rewriting an outcome option", (t) => {
  const f = fixture(t); const p = prepared(f); ok(f.decide(p.approvalId));
  assert.throws(() => f.raw.prepare("UPDATE approvals SET outcome_option_id='request-changes' WHERE id=?").run(p.approvalId), /decision is immutable/);
});
for (const operation of ["update", "delete", "replace"]) test(`stored comment resists ${operation}`, (t) => {
  const f = fixture(t); const p = prepared(f); ok(f.decide(p.approvalId));
  const sql = operation === "update" ? "UPDATE approval_comments SET comment='changed' WHERE approval_id=?" : operation === "delete"
    ? "DELETE FROM approval_comments WHERE approval_id=?" : "INSERT OR REPLACE INTO approval_comments SELECT project_id,approval_id,'changed' FROM approval_comments WHERE approval_id=?";
  assert.throws(() => f.raw.prepare(sql).run(p.approvalId), /comment is immutable/); assert.equal(f.view(p.approvalId).outcome.comment, "Looks good.");
});

test("project Inbox has pending views, start gates and exact counts", async (t) => {
  const f = fixture(t); const p = prepared(f); const gate = f.task("awaiting-go"); const http = await api(t, f); const r = await http.read(`/projects/${f.projectId}/inbox`);
  assert.equal(r.statusCode, 200); const body = r.json(); assert.deepEqual(body.counts, { quarantinedRules: 0, monitors: 0, stalledWorkflows: 0, patches: 0, approvals: 1, startGates: 1, requests: 0, total: 2 });
  assert.equal(body.approvals[0].id, p.approvalId); approvalSchema.parse(body.approvals[0]); assert.deepEqual(body.startGates, [{ taskId: gate, code: "REV-002", title: "Build result" }]);
});
test("Inbox approval ordering is oldest first and history is newest first", async (t) => {
  const f = fixture(t); const p = prepared(f); f.advance(1000); const next = f.review(p.taskId, f.attempt(p.taskId, 2));
  f.advance(1000); const other = prepared(f); const http = await api(t, f);
  assert.deepEqual((await http.read(`/projects/${f.projectId}/inbox`)).json().approvals.map((a) => a.id), [next, other.approvalId]);
  const history = (await http.read(`/projects/${f.projectId}/tasks/${p.taskId}/approvals`)).json().approvals;
  assert.deepEqual(history.map((a) => a.id), [next, p.approvalId]); history.forEach((a) => approvalSchema.parse(a));
});
test("global Inbox aggregates projects and carries project names on every item", async (t) => {
  const f = fixture(t); prepared(f); f.task("awaiting-go"); const other = f.project("Other project"); const id = f.task("in-review", {}, other); f.review(id, f.attempt(id, 1, other), other); f.task("awaiting-go", {}, other);
  const http = await api(t, f); const b = (await http.read("/inbox")).json(); assert.deepEqual(b.counts, { quarantinedRules: 0, monitors: 0, stalledWorkflows: 0, patches: 0, approvals: 2, startGates: 2, requests: 0, total: 4 });
  for (const item of [...b.approvals, ...b.startGates]) { assert.ok([f.projectId, other].includes(item.projectId)); assert.ok(["Review project", "Other project"].includes(item.projectName)); }
  const scoped = (await http.read(`/projects/${other}/inbox`)).json(); assert.equal(scoped.approvals.length, 1); assert.equal(scoped.approvals[0].projectId, other);
});
test("empty Inbox counts are zero", async (t) => {
  const f = fixture(t); const http = await api(t, f); const r = (await http.read("/inbox")).json(); assert.deepEqual(r.counts, { quarantinedRules: 0, monitors: 0, stalledWorkflows: 0, patches: 0, approvals: 0, startGates: 0, requests: 0, total: 0 });
});
for (const route of ["/inbox", "/projects/:project/inbox", "/projects/:project/approvals/:approval", "/projects/:project/tasks/:task/approvals"])
  test(`Inbox session guard: ${route}`, async (t) => {
    const f = fixture(t); const p = prepared(f); const http = await api(t, f); const url = route.replace(":project", f.projectId).replace(":approval", p.approvalId).replace(":task", p.taskId);
    assert.equal((await http.read(url, false)).statusCode, 401);
  });
for (const route of ["/projects/:project/inbox", "/projects/:project/approvals/:approval", "/projects/:project/tasks/:task/approvals"])
  test(`missing Inbox resource returns 404: ${route}`, async (t) => {
    const f = fixture(t); const http = await api(t, f); const url = route.replace(":project", randomUUID()).replace(":approval", randomUUID()).replace(":task", randomUUID()); assert.equal((await http.read(url)).statusCode, 404);
  });
test("approval detail validates and rejects a different project scope", async (t) => {
  const f = fixture(t); const p = prepared(f); const http = await api(t, f);
  approvalSchema.parse((await http.read(`/projects/${f.projectId}/approvals/${p.approvalId}`)).json().approval);
  assert.equal((await http.read(`/projects/${f.project()}/approvals/${p.approvalId}`)).statusCode, 404);
});
test("approval views map team-lead to project-lead", (t) => {
  const f = fixture(t); const p = prepared(f); f.raw.prepare("UPDATE approvals SET approver='team-lead' WHERE id=?").run(p.approvalId);
  assert.equal(approvalSchema.parse(f.view(p.approvalId)).approver, "project-lead");
});
test("list filters by state and task, including an empty states filter", (t) => {
  const f = fixture(t); const p = prepared(f); const other = prepared(f); ok(f.decide(p.approvalId));
  assert.deepEqual(listApprovals(f.raw, f.projectId, { states: ["pending"] }).map((a) => a.id), [other.approvalId]);
  assert.deepEqual(listApprovals(f.raw, f.projectId, { taskId: p.taskId }).map((a) => a.id), [p.approvalId]); assert.deepEqual(listApprovals(f.raw, f.projectId, { states: [] }), []);
});
test("public Inbox and approval responses and events contain no workspace paths", async (t) => {
  const f = fixture(t); const taskId = f.task(); const a = f.attempt(taskId, 1, f.projectId, "Wrote /private/work/result and C:\\private\\result"); const id = f.review(taskId, a);
  const http = await api(t, f);
  for (const url of ["/inbox", `/projects/${f.projectId}/inbox`, `/projects/${f.projectId}/approvals/${id}`, `/projects/${f.projectId}/tasks/${taskId}/approvals`]) {
    const r = await http.read(url); assert.equal(r.statusCode, 200); assert.equal(r.body.includes("/private/"), false); assert.equal(r.body.includes("private\\\\"), false);
  }
  assert.equal(JSON.stringify(f.events()).includes("/workspace/"), false); assert.equal(JSON.stringify(f.events()).includes("/private/"), false);
});
test("handoff reserves space for reviewer feedback before its closing line", (t) => {
  const f = fixture(t); const p = prepared(f); ok(f.decide(p.approvalId, "request-changes", "Please fix. ".repeat(200)));
  const handoff = buildHandoff(f.raw, f.projectId, p.taskId); assert.ok(handoff.length <= 4000); assert.match(handoff, /Reviewer feedback:/);
  assert.ok(handoff.endsWith("Do not repeat work that is already done; check the workspace first."));
  assert.ok(handoff.split("Reviewer feedback:\n")[1].split("\n")[0].length <= 1000);
});
test("handoff ignores comments when the latest review was withdrawn", (t) => {
  const f = fixture(t); const p = prepared(f); ok(f.decide(p.approvalId, "request-changes", "Earlier feedback"));
  const queued = listAttempts(f.raw, f.projectId, p.taskId).at(-1); f.raw.prepare("UPDATE attempts SET state='failed',ended_at=? WHERE id=?").run(f.clock().toISOString(), queued.id);
  f.raw.prepare("UPDATE tasks SET state='in-review' WHERE id=?").run(p.taskId); const next = f.review(p.taskId, queued.id); withdrawPendingReviews(f.raw, f.projectId, p.taskId, f.clock());
  assert.equal(f.view(next).state, "withdrawn"); assert.equal(buildHandoff(f.raw, f.projectId, p.taskId).includes("Earlier feedback"), false);
});
test("dispatcher without review callback preserves the old successful outcome", async (t) => {
  const f = fixture(t, { reviewHook: false }); const id = f.task("active"); f.dispatcher.enqueue({ projectId: f.projectId, taskId: id, seatId: f.seatId }); await f.dispatcher.idle();
  assert.equal(getTask(f.raw, f.projectId, id).state, "in-review"); assert.equal(listApprovals(f.raw, f.projectId).length, 0); assert.equal(f.errors.length, 0);
});
test("dispatcher callback failure rolls back callback changes and reports only a generic error", async (t) => {
  let f; f = fixture(t, { dispatch: { onInReview(input) {
    requestTaskReview({ raw: f.raw, now: f.clock, newId: randomUUID }, input); throw new Error("/private/sensitive");
  } } });
  const id = f.task("active"); f.dispatcher.enqueue({ projectId: f.projectId, taskId: id, seatId: f.seatId }); await f.dispatcher.idle();
  assert.equal(getTask(f.raw, f.projectId, id).state, "in-review"); assert.equal(listApprovals(f.raw, f.projectId).length, 0);
  assert.equal(f.errors.length, 1); assert.equal(f.errors[0].message, "Review request failed");
});
test("dispatcher registers results before requesting review within the outcome transaction", async (t) => {
  let f; let registered = false; let requested = false;
  f = fixture(t, { dispatch: { results: { register(input) { assert.equal(f.raw.inTransaction, true); f.artifact(input.attemptId); registered = true; } },
    onInReview(input) { assert.equal(registered, true); assert.equal(f.raw.inTransaction, true); requested = true; requestTaskReview({ raw: f.raw, hub: f.hub, now: f.clock, newId: randomUUID }, input); } } });
  const id = f.task("active"); f.dispatcher.enqueue({ projectId: f.projectId, taskId: id, seatId: f.seatId }); await f.dispatcher.idle(); assert.equal(requested, true);
  assert.equal(listApprovals(f.raw, f.projectId)[0].context.digest, computeReviewDigest(f.raw, f.projectId, id));
});

for (const kind of ["question", "start-gate"]) test(`decide supports ${kind} without review application`, (t) => {
  const f = fixture(t); const p = prepared(f); f.raw.prepare("UPDATE approvals SET kind=? WHERE id=?").run(kind, p.approvalId);
  ok(f.decide(p.approvalId)); const a = approvalSchema.parse(f.view(p.approvalId)); assert.equal(a.state, kind === "question" ? "applied" : "approved");
  assert.equal(a.appliedByCommandId !== null, kind === "question");
  assert.equal(getTask(f.raw, f.projectId, p.taskId).state, "in-review");
});

function scratch() { return fs.mkdtempSync(join(tmpdir(), "factory-approvals-")); }
function cleanupScratch(root) {
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + "factory-approvals-")); fs.rmSync(root, { recursive: true, force: true });
}
test("fresh migration ledger reaches exactly 0018", (t) => {
  const f = fixture(t); assert.deepEqual(f.raw.prepare("SELECT version FROM migration_ledger ORDER BY version").all(), [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }, { version: 9 }, { version: 10 }, { version: 11 }, { version: 12 }, { version: 13 }, { version: 14 }, { version: 15 }, { version: 16 }, { version: 17 }, { version: 18 }]);
});
test("0002 database upgrades additively to 0010 with backup and existing review preserved", (t) => {
  const root = scratch(t); const dir = join(root, "migrations"); fs.mkdirSync(dir);
  for (const name of ["0001_core.sql", "0002_dispatch.sql"]) fs.copyFileSync(join(migrationsDir, name), join(dir, name));
  const s = openStorage(join(root, "host.db")); t.after(() => s.close()); t.after(() => cleanupScratch(root)); s.migrate({ migrationsDir: dir, backupDir: null });
  s.raw.prepare("INSERT INTO projects VALUES (?,1,'Upgrade','directory','/private/workspace','active')").run(randomUUID());
  assert.deepEqual(s.migrate({ migrationsDir, backupDir: join(root, "backups") }).applied, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,18]);
  assert.deepEqual(s.raw.prepare("SELECT version FROM migration_ledger ORDER BY version").all(), [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }, { version: 9 }, { version: 10 }, { version: 11 }, { version: 12 }, { version: 13 }, { version: 14 }, { version: 15 }, { version: 16 }, { version: 17 }, { version: 18 }]);
  assert.equal(s.raw.prepare("SELECT count(*) AS n FROM projects").get().n, 1); assert.deepEqual(s.raw.prepare("PRAGMA foreign_key_check").all(), []);
});
test("host expires at startup, schedules an injectable 60s sweep and clears it on close", async (t) => {
  const root = scratch(t); const stateDir = join(root, "state"); let time = Date.parse("2026-11-07T10:00:00.000Z"); const clock = () => new Date(time);
  const intervals = new Map(); let token = 0; const timers = { setTimeout, clearTimeout, setInterval(fn, ms) { const id = ++token; intervals.set(id, { fn, ms }); return id; }, clearInterval(id) { intervals.delete(id); } };
  let host = await startHost({ stateDir, port: 0, dispatch: null, clock, timers, onBootstrapToken() {} }); t.after(() => host.close()); t.after(() => cleanupScratch(root));
  const c = command("projects.create", randomUUID(), { name: "Host expiry", workspace: { kind: "directory", root: "/workspace/expiry" } });
  const routes = createCommandPipeline({ storage: host.storage, hub: host.hub }); ok(routes.execute(c));
  const id = randomUUID(); const at = new Date(time).toISOString(); const expires = new Date(time + 1000).toISOString();
  host.storage.raw.prepare(`INSERT INTO approvals (project_id,id,revision,kind,subject,summary,options_json,impact_if_waiting,context_digest,approver,requested_at,expires_at,state)
    VALUES (?,?,1,'question','Question','Summary',?,'Waiting',?,'operator',?,?,'pending')`)
    .run(c.projectId, id, JSON.stringify([{ id: "yes", label: "Yes", consequence: "" }, { id: "no", label: "No", consequence: "" }]), "a".repeat(64), at, expires);
  assert.equal([...intervals.values()][0].ms, 60000); time += 1000; [...intervals.values()][0].fn(); assert.equal(getApprovalView(host.storage.raw, c.projectId, id).state, "expired");
  await host.close(); assert.equal(intervals.size, 0);
  // A separately pending approval is already overdue when this host restarts.
  const s = openStorage(join(stateDir, "host.db"));
  s.raw.prepare(`INSERT INTO approvals (project_id,id,revision,kind,subject,summary,options_json,impact_if_waiting,context_digest,approver,requested_at,expires_at,state)
    SELECT project_id,?,1,kind,subject,summary,options_json,impact_if_waiting,context_digest,approver,requested_at,expires_at,'pending' FROM approvals WHERE id=?`).run(randomUUID(), id); s.close();
  host = await startHost({ stateDir, port: 0, dispatch: null, clock, timers, onBootstrapToken() {} });
  assert.equal(listApprovals(host.storage.raw, c.projectId, { states: ["pending"] }).length, 0);
});
for (const [label, input, expected] of [
  ["slash inside a word is kept", "Use CI/CD and accept/reject flows", "Use CI/CD and accept/reject flows"],
  ["URL is kept", "see https://example.com/a/b for details", "see https://example.com/a/b for details"],
  ["relative path is kept", "edit src/app/main.ts please", "edit src/app/main.ts please"],
  ["posix absolute path is masked", "wrote /home/user/project/file.txt today", "wrote [path] today"],
  ["path at the start is masked", "/etc/passwd leaked", "[path] leaked"],
  ["path in parentheses is masked", "see (/var/log/app.log) now", "see ([path]) now"],
  ["windows drive path is masked", "saved to C:\\Users\\me\\x.txt ok", "saved to [path] ok"],
  ["unc path is masked", "share \\\\host\\share\\f ok", "share [path] ok"],
  ["control characters are replaced", "a\u0000b\u0007c\nd", "a b c\nd"],
]) test(`public approval text: ${label}`, () => assert.equal(publicApprovalText(input), expected));

for (const option of ["accept", "request-changes"]) test(`deciding an already decided approval (${option}) fails as "already decided", not by accident`, (t) => {
  const f = fixture(t); const { approvalId } = prepared(f); ok(f.decide(approvalId, option));
  const again = f.decide(approvalId, option);
  assert.equal(again.status, 409); assert.equal(again.body.error.code, "conflict"); assert.equal(again.body.error.message, "approval already decided");
});
test("a stored digest that no longer matches the artifacts is refused even when the caller sends the fresh digest", (t) => {
  const f = fixture(t); const taskId = f.task(); const attemptId = f.attempt(taskId); const artifactId = f.artifact(attemptId);
  const approvalId = f.review(taskId, attemptId); const before = f.view(approvalId);
  f.artifact(attemptId, { artifactId, version: 2, contentHash: hash("a newer version appeared") });
  const fresh = computeReviewDigest(f.raw, f.projectId, taskId); assert.notEqual(fresh, before.context.digest);
  const snapshot = f.snapshot();
  const r = f.decide(approvalId, "accept", "", { contextDigest: fresh });
  assert.equal(r.status, 409); assert.equal(r.body.error.message, "context changed"); assert.deepEqual(f.snapshot(), snapshot);
});
test("the recorded approval actor is derived from the session credential, never constant or payload supplied", async (t) => {
  const f = fixture(t); const { approvalId } = prepared(f); const a = await api(t, f);
  const sessionId = decodeURIComponent(a.cookie.split("=")[1]); const h = hash(sessionId);
  const expected = `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  const r = await a.post(f.decideCommand(approvalId)); assert.equal(r.statusCode, 200, r.body);
  assert.equal(f.view(approvalId).outcome.actorId, expected); assert.notEqual(f.view(approvalId).outcome.actorId, f.actorId);
  assert.equal(JSON.stringify(f.events()).includes(sessionId), false); assert.equal(JSON.stringify(f.snapshot()).includes(sessionId), false);
});
test("summary and reviewer comment never expose absolute paths in the public view", (t) => {
  const f = fixture(t); const { approvalId } = prepared(f);
  f.raw.prepare("UPDATE approvals SET summary = ? WHERE id = ?").run("Report in /home/agent/work/report.md and C:\\temp\\x.log done", approvalId);
  assert.equal(f.view(approvalId).summary, "Report in [path] and [path] done");
  ok(f.decide(approvalId, "request-changes", "please fix /home/me/project/file.ts first"));
  assert.equal(f.view(approvalId).outcome.comment, "please fix [path] first");
});

