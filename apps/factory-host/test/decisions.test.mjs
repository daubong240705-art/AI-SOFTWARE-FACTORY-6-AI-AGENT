import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test as nodeTest } from "node:test";
import { approvalSchema, decisionRequestInputSchema } from "@factory/contracts";
import { openStorage } from "../dist/storage/database.js";
import { EventHub } from "../dist/events/hub.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { loadPack, listSeats, getActiveEngagement } from "../dist/org/index.js";
import { tasksCreateHandler, getTask } from "../dist/work/service.js";
import { createDispatcher, createDispatchHandlers, createFakeRuntime, RuntimeRegistry, createAttempt,
  transitionAttempt, getAttempt, listAttempts, listAttemptEvents, appendAttemptEvent, advanceTasks, LOCAL_NODE_ID } from "../dist/dispatch/index.js";
import { buildHandoff } from "../dist/dispatch/handoff.js";
import { requestAgentDecision, createApprovalsDecideHandler, getApprovalView, listApprovals, expirePendingApprovals } from "../dist/approvals/service.js";
import { createMcpHandler } from "../dist/mcp/rpc.js";
import { cleanDecisionRequest, createMcpTools } from "../dist/mcp/tools.js";
import { createModelProxy, createTokenRegistry } from "../dist/proxy/index.js";
import { DEFAULT_BUDGET_CONFIG } from "../dist/policy/index.js";
import { createContentStore } from "../dist/artifacts/content-store.js";
import { registerAttemptResults, listTaskArtifacts } from "../dist/artifacts/service.js";
import { startHost } from "../dist/host.js";

const test = (name, fn) => nodeTest(name, { timeout: 15000 }, fn);
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const pack = loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const delay = (ms = 0) => new Promise((done) => setTimeout(done, ms));
const until = async (predicate) => {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await delay(5); }
  assert.fail("Expected lifecycle state was not reached");
};
const request = (extra = {}) => ({ subject: "Choose scope", summary: "Which scope should we deliver?",
  options: [{ id: "small", label: "Small scope", consequence: "Deliver essentials." },
    { id: "full", label: "Full scope", consequence: "Deliver everything." }],
  recommendation: "small", impactIfWaiting: "Work waits for a decision.", ...extra });
const command = (projectId, type, payload) => ({ apiVersion: 1, projectId, type, payload, commandId: randomUUID() });
const ok = (result) => { assert.equal(result.status, 200, JSON.stringify(result.body)); return result; };
const rpc = (name, args) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
const refOf = (attempt) => ({ projectId: attempt.projectId, attemptId: attempt.id, epoch: attempt.epoch });

function fixture(t, options = {}) {
  const storage = openStorage(":memory:"); storage.migrate({ migrationsDir, backupDir: null });
  const raw = storage.raw; let time = Date.parse("2026-11-07T10:00:00.000Z"); const clock = () => new Date(time);
  const hub = new EventHub(raw, { clock }); const runtime = options.runtime ?? createFakeRuntime({ stepMs: 0 });
  const errors = []; const tokens = createTokenRegistry({ clock }); const issued = []; let port = 0; let proxy;
  const dispatcher = createDispatcher({ storage, hub, clock, registry: new RuntimeRegistry([runtime]),
    config: { nodeSlots: 1, stopTimeoutMs: 40, ...options.config }, onError: (e) => errors.push(e.message),
    modelAccess: { issue(input) { const { token } = tokens.issue({ ...input, allowedModels: ["approved"] }); issued.push(token);
      return { baseUrl: `http://127.0.0.1:${port}/v1`, token, models: ["approved"] }; }, revoke(id) { tokens.revoke(id); } },
    ...options.dispatch });
  dispatcher.start();
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
    "projects.create": createProjectsCreateHandler({ pack }), "tasks.create": tasksCreateHandler,
    ...createDispatchHandlers({ dispatcher }), "approvals.decide": createApprovalsDecideHandler({ dispatcher }),
  } });
  const actorId = randomUUID(); const executeCommand = pipeline.execute.bind(pipeline);
  pipeline.execute = (body) => executeCommand(body, actorId);
  const projectId = randomUUID();
  ok(pipeline.execute(command(projectId, "projects.create", { name: "Decisions", workspace: { kind: "directory", root: "/workspace/decision" } })));
  const seatId = listSeats(raw, getActiveEngagement(raw, projectId).teamId).find((seat) => seat.name === "BE").id;
  let code = 0;
  const task = (goal = "Deliver", state = "active") => {
    const taskId = randomUUID();
    ok(pipeline.execute(command(projectId, "tasks.create", { taskId, code: `DEC-${String(++code).padStart(3, "0")}`, title: "Decide scope", goal,
      brief: "Brief", parentTaskId: null, engagementId: null, ownerSeatId: seatId, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] })));
    raw.prepare("UPDATE tasks SET state = ? WHERE id = ?").run(state, taskId); return taskId;
  };
  const seed = (taskId = task()) => {
    const a = createAttempt(raw, { projectId, taskId, seatId, id: randomUUID(), runtime: "fake", provider: "fake", model: "fake", effort: "medium", now: clock().toISOString() });
    raw.prepare("UPDATE attempts SET state = 'running',node_id = ?,lease_id = ?,lease_expires_at = ?,started_at = ? WHERE id = ?")
      .run(LOCAL_NODE_ID, randomUUID(), new Date(time + 60000).toISOString(), clock().toISOString(), a.id);
    return getAttempt(raw, projectId, a.id);
  };
  const ask = (a, data = request(), deps = {}) => requestAgentDecision({ raw, hub, now: clock, newId: randomUUID, ...deps },
    { grant: { ...refOf(a), taskId: a.taskId }, request: data }).approvalId;
  const view = (id) => getApprovalView(raw, projectId, id);
  const prepare = (data = request()) => {
    const a = seed(); time += 1; const approvalId = ask(a, data);
    transitionAttempt(raw, a, "waiting-input", { now: clock().toISOString() });
    transitionAttempt(raw, a, "parked", { now: clock().toISOString() }); time += 1;
    return { a, taskId: a.taskId, approvalId };
  };
  const decideCommand = (id, extra = {}) => command(projectId, "approvals.decide", {
    approvalId: id, expectedRevision: view(id).revision, contextDigest: view(id).context.digest,
    optionId: "full", comment: "Please include all features.", ...extra,
  });
  const decide = (id, extra = {}) => pipeline.execute(decideCommand(id, extra));
  const snapshot = () => Object.fromEntries(["approvals", "approval_comments", "tasks", "task_holds", "attempts", "attempt_seats", "attempt_events", "artifact_versions"]
    .map((table) => [table, raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const mcp = createMcpHandler({ progress() {}, registerOutput() { throw new Error(); }, requestDecision(grant, input) {
    const result = requestAgentDecision({ raw, hub, now: clock, newId: randomUUID }, { grant, request: input });
    setTimeout(() => { void dispatcher.parkAttempt(grant).catch(() => errors.push("Decision parking failed")); }, 50).unref();
    return result;
  } });
  const listen = async () => {
    const allowedHosts = [];
    proxy = createModelProxy({ raw, tokens, clock, newId: randomUUID, budget: DEFAULT_BUDGET_CONFIG, allowedHosts, mcp,
      upstream: { providerId: "fixture", async chatCompletions() { throw new Error("Unexpected model call"); } } });
    await proxy.app.listen({ port: 0, host: "127.0.0.1" }); port = proxy.app.server.address().port;
    allowedHosts.push(`127.0.0.1:${port}`);
    return port;
  };
  t.after(async () => { tokens.revokeAll(); await proxy?.close(); await dispatcher.stop(); storage.close(); });
  return { storage, raw, hub, clock, runtime, dispatcher, pipeline, projectId, seatId, errors, tokens, issued,
    task, seed, ask, prepare, view, decide, decideCommand, snapshot, mcp, listen, advance(ms = 1) { time += ms; } };
}

function tools() {
  const calls = []; const grant = { projectId: randomUUID(), taskId: randomUUID(), attemptId: randomUUID(), epoch: 1 };
  const deps = { progress() {}, registerOutput() { throw new Error(); },
    requestDecision(g, input) { calls.push({ grant: g, input }); return { approvalId: randomUUID() }; } };
  const handler = createMcpHandler(deps); const tools = createMcpTools(deps);
  return { calls, handler, call: (input) => tools.call(grant, "decision.request", input) };
}

// Boundary and shape cases use the unchanged contract, plus uniqueness of the sanitized ids.
for (const count of [0, 1, 2, 3, 4, 5, 6, 7]) test(`tool option count ${count}`, () => {
  const f = tools(); const input = request({ options: Array.from({ length: count }, (_, i) => ({ id: `choice-${i}`, label: `Choice ${i}`, consequence: "Effect" })), recommendation: undefined });
  const valid = count >= 2 && count <= 6; assert.equal(f.call(input).isError, !valid); assert.equal(f.calls.length, Number(valid));
  assert.equal(decisionRequestInputSchema.safeParse(input).success, valid);
});
for (const field of ["subject", "summary", "options", "impactIfWaiting"]) test(`tool requires ${field}`, () => {
  const f = tools(); const input = request(); delete input[field]; assert.equal(f.call(input).content[0].text, "invalid tool input"); assert.equal(f.calls.length, 0);
});
for (const field of ["subject", "summary", "options", "recommendation", "impactIfWaiting"]) for (const [label, value] of [["null", null], ["number", 12]])
  test(`tool refuses ${label} ${field}`, () => { const f = tools(); assert.equal(f.call(request({ [field]: value })).isError, true); assert.equal(f.calls.length, 0); });
for (const [field, limit] of [["subject", 160], ["summary", 4000], ["impactIfWaiting", 1000]]) for (const offset of [0, 1])
  test(`tool ${field} length ${limit + offset}`, () => { const f = tools(); assert.equal(f.call(request({ [field]: "x".repeat(limit + offset) })).isError, Boolean(offset)); });
for (const [field, limit] of [["id", 160], ["label", 160], ["consequence", 1000]]) for (const offset of [0, 1])
  test(`tool option ${field} length ${limit + offset}`, () => {
    const f = tools(); const input = request({ recommendation: undefined }); input.options[0][field] = "x".repeat(limit + offset);
    assert.equal(f.call(input).isError, Boolean(offset));
  });
for (const field of ["id", "label", "consequence"]) test(`tool option requires ${field}`, () => {
  const f = tools(); const input = request(); delete input.options[0][field]; assert.equal(f.call(input).isError, true);
});
for (const [label, mutate] of [
  ["duplicate ids", (r) => { r.options[1].id = r.options[0].id; }],
  ["trimmed duplicate ids", (r) => { r.options[1].id = " small "; }],
  ["sanitized duplicate ids", (r) => { r.options[0].id = "/private/first"; r.options[1].id = "/private/second"; delete r.recommendation; }],
  ["missing recommendation option", (r) => { r.recommendation = "unknown"; }],
  ["blank subject", (r) => { r.subject = "  "; }], ["blank id", (r) => { r.options[0].id = "  "; }],
  ["blank label", (r) => { r.options[0].label = "  "; }], ["empty summary", (r) => { r.summary = ""; }],
  ["extra field", (r) => { r.taskId = randomUUID(); }], ["extra option field", (r) => { r.options[0].extra = true; }],
  ["too long recommendation", (r) => { r.recommendation = "a".repeat(161); }],
]) test(`tool refuses ${label}`, () => { const f = tools(); const r = request(); mutate(r); assert.equal(f.call(r).isError, true); assert.equal(f.calls.length, 0); });
for (const [label, value] of [["null", null], ["array", []], ["scalar", "question"], ["empty", {}]])
  test(`tool refuses ${label} input`, () => { const f = tools(); assert.equal(f.call(value).isError, true); assert.equal(f.calls.length, 0); });
test("tool accepts a missing recommendation and empty impact", () => { const r = request({ impactIfWaiting: "" }); delete r.recommendation; assert.equal(tools().call(r).isError, false); });
test("tool success has the exact stop instruction", () => {
  assert.deepEqual(tools().call(request()), { isError: false, content: [{ type: "text", text: "Decision requested. Stop working now and finish without further tool calls." }] });
});
test("tool list describes strict business questions and nested options", () => {
  const list = tools().handler.handle({}, { jsonrpc: "2.0", id: 1, method: "tools/list" }).body.result.tools;
  assert.deepEqual(list.map((item) => item.name), ["task.progress", "output.register", "decision.request"]);
  const tool = list.find((item) => item.name === "decision.request"); assert.ok(tool); assert.equal(tool.inputSchema.additionalProperties, false);
  assert.equal(tool.inputSchema.properties.options.items.additionalProperties, false); assert.match(tool.description, /ONLY.*business decisions.*stop/);
  assert.equal(tool.inputSchema.properties.options.minItems, 2); assert.equal(tool.inputSchema.properties.options.maxItems, 6);
  assert.equal(tool.inputSchema.properties.summary.maxLength, 4000);
});
for (const field of ["subject", "summary", "impactIfWaiting", "option-id", "option-label", "option-consequence", "recommendation"])
  test(`tool sanitizes ${field} text before the dependency`, () => {
    const f = tools(); const r = request(); const text = "Choice fpx_synthetic_value sk-synthetic-value /private/fixture C:\\private\\fixture\u0000\u202e";
    if (field === "option-id" || field === "recommendation") { r.options[0].id = text; r.recommendation = text; }
    else if (field === "option-label") r.options[0].label = text;
    else if (field === "option-consequence") r.options[0].consequence = text;
    else r[field] = text;
    assert.equal(f.call(r).isError, false); const stored = JSON.stringify(f.calls[0].input);
    assert.doesNotMatch(stored, /fpx_|sk-synthetic|private|\\u0000|\u202e/);
  });

test("service creates a contract-valid pending question with seven day expiry", (t) => {
  const f = fixture(t); const a = f.seed(); const id = f.ask(a); const approval = approvalSchema.parse(f.view(id));
  assert.equal(approval.kind, "question"); assert.equal(approval.state, "pending"); assert.equal(approval.revision, 1);
  assert.equal(approval.approver, "operator"); assert.equal(approval.taskId, a.taskId); assert.equal(approval.subject, request().subject);
  assert.deepEqual(approval.options, request().options); assert.equal(approval.summary, request().summary);
  assert.equal(approval.impactIfWaiting, request().impactIfWaiting); assert.equal(approval.recommendation, "small");
  assert.equal(Date.parse(approval.expiresAt) - Date.parse(approval.requestedAt), 7 * 86400000); assert.equal(approval.outcome, null);
});
test("service digest uses canonical keys including option objects", (t) => {
  const f = fixture(t); const a = f.seed(); const id = f.ask(a); const r = request();
  assert.equal(f.view(id).context.digest, hash(JSON.stringify({ attemptId: a.id,
    options: r.options.map((o) => ({ consequence: o.consequence, id: o.id, label: o.label })), subject: r.subject, summary: r.summary, taskId: a.taskId })));
});
test("service creates the decision hold and bumps task revision", (t) => {
  const f = fixture(t); const a = f.seed(); const before = getTask(f.raw, f.projectId, a.taskId); const id = f.ask(a);
  const after = getTask(f.raw, f.projectId, a.taskId); assert.equal(after.revision, before.revision + 1); assert.equal(after.state, "active");
  assert.deepEqual(after.holds, [{ kind: "decision", reason: "Waiting for your decision: Choose scope",
    ref: { kind: "approval", id, revision: 1 }, since: f.clock().toISOString(), needsAction: true }]);
});
test("service publishes approval and task changes after commit", (t) => {
  const f = fixture(t); const a = f.seed(); let notified = 0;
  f.hub.subscribe(f.projectId, () => { assert.equal(f.raw.inTransaction, false); notified++; }); const cursor = f.hub.currentCursor(f.projectId);
  const id = f.ask(a); const events = f.hub.readAfter(f.projectId, cursor).events;
  assert.equal(notified, 1); assert.deepEqual(events.map((e) => [e.payload.entity.kind, e.payload.entity.id]), [["approval", id], ["task", a.taskId]]);
});
test("service refuses a second pending question atomically", (t) => {
  const f = fixture(t); const a = f.seed(); f.ask(a); const before = f.raw.serialize();
  assert.throws(() => f.ask(a), { message: "a decision is already pending" }); assert.deepEqual(f.raw.serialize(), before);
});
test("service refuses a decision hold even after the question expires", (t) => {
  const f = fixture(t); const a = f.seed(); const id = f.ask(a); f.raw.prepare("UPDATE approvals SET state='expired' WHERE id=?").run(id);
  const before = f.raw.serialize(); assert.throws(() => f.ask(a), { message: "a decision is already pending" }); assert.deepEqual(f.raw.serialize(), before);
});
for (const state of ["queued", "leased", "preparing", "waiting-input", "stopping", "submitting", "parked", "stopped", "succeeded", "failed", "unknown", "lease-expired", "requeued", "reconciling"])
  test(`service fences ${state} attempts without writing`, (t) => {
    const f = fixture(t); const a = f.seed(); f.raw.prepare("UPDATE attempts SET state=?,outcome=?,ended_at=?,node_id=?,lease_id=?,lease_expires_at=? WHERE id=?")
      .run(state, state === "unknown" ? "unknown" : "known", f.clock().toISOString(), state === "queued" ? null : a.nodeId,
        state === "queued" ? null : a.leaseId, state === "queued" ? null : a.leaseExpiresAt, a.id);
    const before = f.raw.serialize(); assert.throws(() => f.ask(a), { message: "attempt is not active" }); assert.deepEqual(f.raw.serialize(), before);
  });
for (const field of ["projectId", "taskId", "id", "epoch"]) test(`service fences a foreign ${field}`, (t) => {
  const f = fixture(t); const a = f.seed(); const before = f.raw.serialize(); const wrong = { ...a, [field]: field === "epoch" ? 2 : randomUUID() };
  assert.throws(() => f.ask(wrong), { message: "attempt is not active" }); assert.deepEqual(f.raw.serialize(), before);
});
test("service fences an expired lease", (t) => { const f = fixture(t); const a = f.seed(); f.advance(60000); const before = f.raw.serialize(); assert.throws(() => f.ask(a), { message: "attempt is not active" }); assert.deepEqual(f.raw.serialize(), before); });
test("service also validates direct callers", (t) => { const f = fixture(t); const a = f.seed(); const before = f.raw.serialize(); assert.throws(() => f.ask(a, request({ options: [] })), { message: "invalid tool input" }); assert.deepEqual(f.raw.serialize(), before); });
test("service transaction rolls back the approval and hold on event failure", (t) => {
  const f = fixture(t); const a = f.seed(); const before = f.raw.serialize();
  assert.throws(() => f.ask(a, request(), { hub: { transaction: (fn) => f.raw.transaction(fn)(), append() { throw new Error("event unavailable"); } } }));
  assert.deepEqual(f.raw.serialize(), before);
});
test("service supports raw-only callers", (t) => { const f = fixture(t); const a = f.seed(); const id = f.ask(a, request(), { hub: undefined }); assert.equal(f.view(id).state, "pending"); });
test("service stores sanitized text and hashes the sanitized context", (t) => {
  const f = fixture(t); const a = f.seed(); const r = request({ subject: "Scope /private/fixture", summary: "Need fpx_synthetic_value sk-synthetic-value\u0000" });
  const id = f.ask(a, r); assert.doesNotMatch(JSON.stringify(f.view(id)), /private|fpx_|sk-synthetic|\\u0000/);
  assert.equal(f.view(id).summary, cleanDecisionRequest(r).summary);
});

for (const optionId of ["small", "full", "reject", "request-changes"]) test(`answer ${optionId} applies and queues the next epoch on the same seat`, (t) => {
  const f = fixture(t); const r = request(); r.options[1].id = optionId === "small" ? "full" : optionId;
  const p = f.prepare(r); const cmd = f.decideCommand(p.approvalId, { optionId }); ok(f.pipeline.execute(cmd));
  const approval = approvalSchema.parse(f.view(p.approvalId)); assert.equal(approval.state, "applied"); assert.equal(approval.revision, 3);
  assert.equal(approval.appliedByCommandId, cmd.commandId); assert.equal(approval.outcome.optionId, optionId);
  const next = listAttempts(f.raw, f.projectId, p.taskId).at(-1); assert.equal(next.epoch, 2); assert.equal(next.seatId, f.seatId); assert.equal(next.state, "queued");
  assert.deepEqual(getTask(f.raw, f.projectId, p.taskId).holds, []); assert.equal(getTask(f.raw, f.projectId, p.taskId).state, "active");
});
const answerFailures = [
  ["wrong digest", (f, c) => { c.payload.contextDigest = "0".repeat(64); }, 409],
  ["wrong revision", (f, c) => { c.payload.expectedRevision = 9; }, 409],
  ["unknown option", (f, c) => { c.payload.optionId = "absent"; }, 400],
  ["expired", (f) => { f.advance(7 * 86400000); }, 409],
  ["unknown approval", (f, c) => { c.payload.approvalId = randomUUID(); }, 404],
  ["withdrawn", (f, c) => { f.raw.prepare("UPDATE approvals SET state='withdrawn' WHERE id=?").run(c.payload.approvalId); }, 409],
  ["swept expiry", (f) => { f.advance(7 * 86400000); expirePendingApprovals({ raw: f.raw, hub: f.hub, now: f.clock }); }, 409],
  ["oversized comment", (f, c) => { c.payload.comment = "x".repeat(32001); }, 400],
  ["missing comment", (f, c) => { delete c.payload.comment; }, 400],
  ["missing digest", (f, c) => { delete c.payload.contextDigest; }, 400],
  ["malformed digest", (f, c) => { c.payload.contextDigest = "bad"; }, 400],
  ["missing revision", (f, c) => { delete c.payload.expectedRevision; }, 400],
  ["zero revision", (f, c) => { c.payload.expectedRevision = 0; }, 400],
  ["missing option", (f, c) => { delete c.payload.optionId; }, 400],
  ["actor injection", (f, c) => { c.payload.actorId = randomUUID(); }, 400],
];
for (const [label, mutate, status] of answerFailures) test(`answer refuses ${label} without domain changes`, (t) => {
  const f = fixture(t); const p = f.prepare(); const cmd = f.decideCommand(p.approvalId); mutate(f, cmd); const before = f.snapshot();
  assert.equal(f.pipeline.execute(cmd).status, status); assert.deepEqual(f.snapshot(), before);
});
test("answer replays the same receipt and a second command conflicts", (t) => {
  const f = fixture(t); const p = f.prepare(); const cmd = f.decideCommand(p.approvalId); const first = ok(f.pipeline.execute(cmd)); const before = f.raw.serialize();
  const replay = f.pipeline.execute(cmd); assert.equal(replay.replayed, true); assert.deepEqual(replay.body, first.body); assert.deepEqual(f.raw.serialize(), before);
  const domain = f.snapshot(); assert.equal(f.decide(p.approvalId).status, 409); assert.deepEqual(f.snapshot(), domain);
});
test("answer publishes approved and applied revisions with its command id", (t) => {
  const f = fixture(t); const p = f.prepare(); const cursor = f.hub.currentCursor(f.projectId); const cmd = f.decideCommand(p.approvalId); ok(f.pipeline.execute(cmd));
  const changes = f.hub.readAfter(f.projectId, cursor).events.filter((e) => e.payload.type === "entity.changed" && e.payload.entity.id === p.approvalId);
  assert.deepEqual(changes.map((e) => e.payload.entity.revision), [2, 3]); assert.ok(changes.every((e) => e.causationId === cmd.commandId));
});
test("question digest stays fresh when artifacts and evidence change", (t) => {
  const f = fixture(t); const p = f.prepare(); appendAttemptEvent(f.raw, { projectId: f.projectId, attemptId: p.a.id, kind: "evidence", body: { detail: "Later evidence" }, at: f.clock().toISOString() });
  ok(f.decide(p.approvalId));
});
test("answer before the verified park conflicts without losing the hold", (t) => {
  const f = fixture(t); const a = f.seed(); const id = f.ask(a); const before = f.snapshot(); assert.equal(f.decide(id).status, 409); assert.deepEqual(f.snapshot(), before);
});
for (const state of ["cancelled", "done", "failed", "in-review", "superseded", "declined"]) test(`answer for a ${state} task only releases its hold`, (t) => {
  const f = fixture(t); const p = f.prepare(); f.raw.prepare("UPDATE tasks SET state=? WHERE id=?").run(state, p.taskId); ok(f.decide(p.approvalId));
  assert.equal(f.view(p.approvalId).state, "applied"); assert.equal(listAttempts(f.raw, f.projectId, p.taskId).length, 1);
  assert.equal(getTask(f.raw, f.projectId, p.taskId).holds.length, 0); assert.equal(getTask(f.raw, f.projectId, p.taskId).state, state);
});
test("cancelling a parked task withdraws its question and clears the hold", (t) => {
  const f = fixture(t); const p = f.prepare(); ok(f.pipeline.execute(command(f.projectId, "tasks.transition", { taskId: p.taskId,
    expectedRevision: getTask(f.raw, f.projectId, p.taskId).revision, to: "cancelled" })));
  assert.equal(f.view(p.approvalId).state, "withdrawn"); assert.deepEqual(getTask(f.raw, f.projectId, p.taskId).holds, []);
  assert.equal(f.decide(p.approvalId).status, 409); assert.equal(listAttempts(f.raw, f.projectId, p.taskId).length, 1);
});
test("expiry never answers a question or releases its needs-action hold", async (t) => {
  const f = fixture(t); const p = f.prepare(); f.advance(7 * 86400000); assert.equal(expirePendingApprovals({ raw: f.raw, hub: f.hub, now: f.clock }), 1);
  assert.equal(f.view(p.approvalId).state, "expired"); assert.equal(f.view(p.approvalId).outcome, null);
  assert.equal(getTask(f.raw, f.projectId, p.taskId).holds[0].needsAction, true); f.dispatcher.kick(); await f.dispatcher.idle();
  assert.equal(listAttempts(f.raw, f.projectId, p.taskId).length, 1); assert.equal(f.runtime.started.length, 0);
});
test("pending questions appear in the approval inbox list", (t) => {
  const f = fixture(t); const p = f.prepare(); assert.deepEqual(listApprovals(f.raw, f.projectId, { states: ["pending"] }).map((a) => a.id), [p.approvalId]);
});
test("handoff contains the question option label and sanitized comment before its closing", (t) => {
  const f = fixture(t); const p = f.prepare(); ok(f.decide(p.approvalId, { comment: "Include all features. /private/fixture fpx_synthetic_value sk-synthetic-value\u0000" }));
  const text = buildHandoff(f.raw, f.projectId, p.taskId); assert.match(text, /Decision from the operator:\nQuestion: Choose scope\nAnswer: Full scope\nInclude all features/);
  assert.doesNotMatch(text, /private|fpx_|sk-synthetic|\u0000/); assert.ok(text.endsWith("Do not repeat work that is already done; check the workspace first."));
});
test("handoff reserves decision space and limits the comment to 1000", (t) => {
  const f = fixture(t); const p = f.prepare(); for (let i = 0; i < 20; i++) appendAttemptEvent(f.raw, { projectId: f.projectId, attemptId: p.a.id,
    kind: "progress", body: { message: "Long work detail ".repeat(50) }, at: f.clock().toISOString() });
  ok(f.decide(p.approvalId, { comment: "x".repeat(32000) })); const text = buildHandoff(f.raw, f.projectId, p.taskId);
  assert.ok(text.length <= 4000); assert.equal(text.split("Answer: Full scope\n")[1].split("\n")[0].length, 1000);
});
for (const state of ["pending", "expired", "withdrawn"]) test(`handoff excludes a ${state} question`, (t) => {
  const f = fixture(t); const p = f.prepare(); if (state !== "pending") f.raw.prepare("UPDATE approvals SET state=? WHERE id=?").run(state, p.approvalId);
  assert.equal(buildHandoff(f.raw, f.projectId, p.taskId).includes("Decision from the operator:"), false);
});
test("handoff decision is present only until the next terminal attempt has started", (t) => {
  const f = fixture(t); const p = f.prepare(); ok(f.decide(p.approvalId)); assert.match(buildHandoff(f.raw, f.projectId, p.taskId), /Decision from the operator:/);
  f.advance(); const next = listAttempts(f.raw, f.projectId, p.taskId).at(-1);
  f.raw.prepare("UPDATE attempts SET state='failed',started_at=?,ended_at=? WHERE id=?").run(f.clock().toISOString(), f.clock().toISOString(), next.id);
  assert.equal(buildHandoff(f.raw, f.projectId, p.taskId).includes("Decision from the operator:"), false);
});
test("handoff has no decision without a terminal attempt", (t) => { const f = fixture(t); const a = f.seed(); f.ask(a); assert.equal(buildHandoff(f.raw, f.projectId, a.taskId), null); });
test("recovery and task advancement leave a parked task with a hold untouched", async (t) => {
  const f = fixture(t); const p = f.prepare(); const before = f.snapshot(); assert.deepEqual(f.dispatcher.recover(), { leaseExpired: 0, unknown: 0, requeued: 0, untouched: 0 });
  assert.deepEqual(advanceTasks(f.raw, f.projectId, { dispatcher: f.dispatcher }), []); f.dispatcher.kick(); await f.dispatcher.idle();
  assert.deepEqual(f.snapshot(), before); assert.equal(f.runtime.started.length, 0); assert.equal(f.view(p.approvalId).state, "pending");
});

test("real loopback proxy and fake ask park the attempt and resume with the decision", async (t) => {
  const f = fixture(t); const port = await f.listen(); const taskId = f.task("[fake:ask]");
  const a = f.dispatcher.enqueue({ projectId: f.projectId, taskId, seatId: f.seatId });
  await until(() => getAttempt(f.raw, f.projectId, a.id)?.state === "parked"); await f.dispatcher.idle();
  const approval = listApprovals(f.raw, f.projectId)[0]; assert.equal(approval.kind, "question"); assert.equal(approval.state, "pending");
  assert.deepEqual(approval.options.map((o) => o.id), ["small", "full"]); assert.equal(getTask(f.raw, f.projectId, taskId).state, "active");
  assert.equal(getTask(f.raw, f.projectId, taskId).holds[0].ref.id, approval.id); assert.equal(f.tokens.resolve(f.issued[0]), null);
  assert.equal(f.runtime.ended.length, 1); assert.equal(f.runtime.stopped.length, 1); assert.equal(f.dispatcher.status().nodeUsed, 0);
  const states = listAttemptEvents(f.raw, f.projectId, a.id).filter((e) => e.kind === "state").map((e) => e.body);
  assert.ok(states.some((body) => body.to === "waiting-input" && body.reason === "decision")); assert.equal(states.at(-1).to, "parked");
  f.dispatcher.kick(); await delay(70); await f.dispatcher.idle(); assert.equal(listAttempts(f.raw, f.projectId, taskId).length, 1);
  f.raw.prepare("UPDATE tasks SET goal='[fake:hang]' WHERE id=?").run(taskId); f.advance(); ok(f.decide(approval.id));
  await until(() => f.runtime.started.length === 2); const context = f.runtime.started[1]; assert.equal(context.ref.epoch, 2); assert.equal(context.seat.id, f.seatId);
  assert.match(context.handoff, /Question: Choose the scope/); assert.match(context.handoff, /Answer: Full scope/); assert.match(context.handoff, /Please include all features/);
  const old = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { authorization: `Bearer ${f.issued[0]}`, "content-type": "application/json" }, body: JSON.stringify(rpc("decision.request", request())) });
  assert.equal(old.status, 401); const publicText = JSON.stringify([f.view(approval.id), context.handoff, f.raw.prepare("SELECT body_json FROM event_log").all(), listAttemptEvents(f.raw, f.projectId, a.id)]);
  for (const token of f.issued) assert.equal(publicText.includes(token), false); assert.deepEqual(f.errors, []);
});

test("host wires deferred decision parking through its real proxy", async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "factory-decisions-host-"))); let host;
  t.after(async () => { await host?.close(); assert.ok(resolve(root).startsWith(fs.realpathSync(tmpdir()) + sep)); fs.rmSync(root, { recursive: true, force: true }); });
  host = await startHost({ stateDir: join(root, "state"), port: 0, dispatch: {}, onBootstrapToken() {}, modelProxy: {
    port: 0, approvedModels: ["approved"], upstream: { baseUrl: "http://127.0.0.1:1/v1", apiKey: "synthetic-decision-fixture" },
  } });
  const projectId = randomUUID(); const taskId = randomUUID(); const raw = host.storage.raw;
  const pipeline = createCommandPipeline({ storage: host.storage, hub: host.hub, handlers: { "projects.create": createProjectsCreateHandler({ pack }), "tasks.create": tasksCreateHandler } });
  ok(pipeline.execute(command(projectId, "projects.create", { name: "Host questions", workspace: { kind: "directory", root: "/workspace/decision" } })));
  const seatId = listSeats(raw, getActiveEngagement(raw, projectId).teamId).find((s) => s.name === "BE").id;
  ok(pipeline.execute(command(projectId, "tasks.create", { taskId, code: "DEC-001", title: "Scope", goal: "[fake:ask]", brief: "Brief", parentTaskId: null,
    engagementId: null, ownerSeatId: seatId, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] })));
  raw.prepare("UPDATE tasks SET state='active' WHERE id=?").run(taskId); const a = host.dispatch.enqueue({ projectId, taskId, seatId });
  await until(() => getAttempt(raw, projectId, a.id)?.state === "parked"); await host.dispatch.idle();
  assert.equal(getTask(raw, projectId, taskId).state, "active"); assert.equal(listApprovals(raw, projectId, { states: ["pending"] })[0].kind, "question");
});

test("parking keeps partial evidence and a draft patch and continues its branch", async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "factory-decisions-evidence-")));
  const evidenceDir = join(root, "evidence"); fs.mkdirSync(evidenceDir); const store = createContentStore({ dir: join(root, "content") });
  const prepared = []; const finished = []; let f;
  const workspace = { async prepare(input) { prepared.push(input); const path = join(root, `epoch-${input.epoch}`); fs.mkdirSync(path); return { path, branch: `factory/dec-e${input.epoch}`, baseSha: "a".repeat(40) }; },
    async finish(input) { finished.push(input); assert.ok(fs.existsSync(join(input.path, "FAKE-DEC-001.md")));
      const patch = "diff --git a/partial.md b/partial.md\nnew file mode 100644\n--- /dev/null\n+++ b/partial.md\n@@ -0,0 +1 @@\n+Partial work\n";
      fs.writeFileSync(join(evidenceDir, `${input.attemptId}.patch`), patch);
      return { baseSha: input.baseSha, headSha: "b".repeat(40), files: [{ path: "partial.md", status: "added", additions: 1, deletions: 0, binary: false }],
        totals: { files: 1, additions: 1, deletions: 0 }, flags: [], patchBytes: Buffer.byteLength(patch), patchTruncated: false,
        branch: input.branch, patchFile: `${input.attemptId}.patch`, patchSha256: hash(patch), patchSafe: true, unsafeReasons: [] }; }, async discard() {} };
  f = fixture(t, { dispatch: { workspace, projectRootFor: () => root, results: { register(input) {
    registerAttemptResults({ raw: f.raw, store, now: f.clock, newId: randomUUID }, { ...input, evidenceDir });
  } } } });
  t.after(() => { assert.ok(resolve(root).startsWith(fs.realpathSync(tmpdir()) + sep)); fs.rmSync(root, { recursive: true, force: true }); });
  // Exact host headers are supplied by fetch when the actual loopback port is known.
  await f.listen(); const taskId = f.task("[fake:edit] [fake:ask]"); const a = f.dispatcher.enqueue({ projectId: f.projectId, taskId, seatId: f.seatId });
  await until(() => getAttempt(f.raw, f.projectId, a.id)?.state === "parked"); await f.dispatcher.idle();
  assert.equal(finished.length, 1); const artifacts = listTaskArtifacts(f.raw, f.projectId, taskId); assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].versions[0].status, "draft"); assert.equal(artifacts[0].kind, "code-ref");
  assert.match(store.get(artifacts[0].versions[0].contentHash).toString(), /Partial work/);
  assert.equal(listAttemptEvents(f.raw, f.projectId, a.id).filter((e) => e.kind === "evidence").length, 1);
  assert.equal(listApprovals(f.raw, f.projectId).some((approval) => approval.kind === "review"), false);
  f.raw.prepare("UPDATE tasks SET goal='[fake:hang]' WHERE id=?").run(taskId); f.advance(); ok(f.decide(listApprovals(f.raw, f.projectId)[0].id));
  await until(() => prepared.length === 2); assert.equal(prepared[1].startFromBranch, "factory/dec-e1"); assert.equal(f.runtime.started[1].ref.epoch, 2);
});

test("fake ask without model access performs no MCP call and completes", async () => {
  const runtime = createFakeRuntime({ stepMs: 0 }); const session = await runtime.start({ ref: { projectId: randomUUID(), attemptId: randomUUID(), epoch: 1, leaseId: randomUUID() },
    task: { code: "DEC-001", goal: "[fake:ask]" }, seat: {}, handoff: null, signal: new AbortController().signal });
  const events = []; for await (const event of session.events()) events.push(event); assert.equal(events.at(-1).type, "completed");
});
