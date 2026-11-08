// Tests that close mutation survivors of the C1a review: dedup scope, auto-route kinds, list/thread caps,
// multiple context grants, handoff feedback and the escalation decision guards.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { buildHandoff } from "../dist/dispatch/handoff.js";
import { getApprovalView, requestAgentDecision } from "../dist/approvals/service.js";
import { createKnowledgeMcp } from "../dist/knowledge/mcp.js";
import { listRequests } from "../dist/requests/service.js";
import { listAttempts } from "../dist/dispatch/index.js";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
import { fixture, until } from "./requests-fixture.mjs";

test("the same request in another project is not merged", (t) => {
  const f = fixture(t); const first = f.create({ kind: "produce" });
  const other = f.project(); const task = f.task({ scope: other, seatId: f.seat.id });
  const grant = f.seed(task, f.seat.id, other);
  const second = f.create({ kind: "produce" }, grant);
  assert.equal(second.merged, false); assert.notEqual(second.requestId, first.requestId);
  assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM ctr_followers").get().n, 0);
});
test("produce stays in triage even when the target team already has an engagement", (t) => {
  const f = fixture(t); f.engage(f.team);
  const a = f.create({ kind: "produce" }); assert.equal(a.state, "proposed"); assert.equal(f.meta(a.requestId).triage_state, "submitted");
  assert.equal(f.getTask(a.requestId).ownerSeatId, null);
});
test("clarify is routed automatically by the system", async (t) => {
  const f = fixture(t); const id = await f.delivered(); assert.equal(f.meta(id).triage_state, "accepted"); assert.equal(f.meta(id).triage_by, "system");
});
test("the first attempt handoff carries no requester feedback section", async (t) => {
  const f = fixture(t); const id = await f.delivered();
  assert.doesNotMatch(buildHandoff(f.raw, f.projectId, id), /Requester feedback:/);
});
test("handoff feedback is the latest requester message, never an operator note", async (t) => {
  const f = fixture(t); const id = await f.delivered();
  f.reply(id, "request-changes", "Requester wants the second form");
  f.executeCtr("requests.message", { requestTaskId: id, text: "Operator side note" });
  const text = buildHandoff(f.raw, f.projectId, id);
  assert.match(text, /Requester feedback:\nRequester wants the second form/); assert.doesNotMatch(text, /Operator side note/);
});
test("the thread view returns the newest 200 messages in order", (t) => {
  const f = fixture(t); const a = f.create(); const at = f.clock().toISOString();
  const first = f.raw.prepare("SELECT MAX(seq) AS n FROM ctr_messages WHERE task_id = ?").get(a.requestId).n + 1;
  for (let n = 0; n < 205; n++) f.raw.prepare("INSERT INTO ctr_messages (project_id,task_id,seq,author,text,at) VALUES (?,?,?,'system',?,?)")
    .run(f.projectId, a.requestId, first + n, `note ${n}`, at);
  const thread = f.view(a.requestId).thread; assert.equal(thread.length, 200);
  assert.equal(thread.at(-1).seq, first + 204); assert.equal(thread[0].seq, first + 5);
  assert.deepEqual(thread.map((m) => m.seq), [...thread.map((m) => m.seq)].sort((x, y) => x - y));
});
test("listing is capped at 100 items however many exist", (t) => {
  const f = fixture(t); let grant = f.grant;
  for (let n = 0; n < 105; n++) {
    if (n % 5 === 0) grant = f.seed();
    f.create({ kind: "notify", ask: `Unique request number ${n} for listing` }, grant);
  }
  assert.equal(listRequests(f.raw, f.projectId).length, 100);
  assert.equal(listRequests(f.raw, f.projectId, { limit: 500 }).length, 100);
  assert.equal(listRequests(f.raw, f.projectId, { limit: 3 }).length, 3);
});
test("a CTR with several context refs grants every one of them and nothing else", (t) => {
  const f = fixture(t); const refs = [f.artifact(), f.artifact()]; const stranger = f.artifact();
  const { requestId } = f.create({ contextRefs: refs }); f.triage(requestId);
  f.raw.prepare("UPDATE tasks SET state = 'active' WHERE id = ?").run(requestId);
  const target = f.seed(requestId, f.getTask(requestId).ownerSeatId);
  const knowledge = createKnowledgeMcp({ raw: f.raw, knowledge: f.knowledge, now: f.clock });
  for (const ref of refs) assert.equal(knowledge.call(target, "knowledge.get", { ...ref, level: "l1" }).isError, false);
  assert.equal(knowledge.call(target, "knowledge.get", { ...stranger, level: "l1" }).isError, true);
});
test("an agent decision on a CTR task is answered as a normal question and does not move the task", async (t) => {
  const f = fixture(t); const id = await f.delivered();
  f.raw.prepare("UPDATE tasks SET state = 'active' WHERE id = ?").run(id);
  const grant = f.seed(id, f.getTask(id).ownerSeatId);
  const { approvalId } = requestAgentDecision({ raw: f.raw, hub: f.hub, now: f.clock, newId: randomUUID }, { grant,
    request: { subject: "Which format", summary: "Pick one", options: [{ id: "md", label: "Markdown", consequence: "md" }, { id: "txt", label: "Text", consequence: "txt" }],
      impactIfWaiting: "Blocked" } });
  f.raw.prepare("UPDATE attempts SET state = 'parked' WHERE id = ?").run(grant.attemptId);
  const view = getApprovalView(f.raw, f.projectId, approvalId);
  const result = f.executeCtr("approvals.decide", { approvalId, expectedRevision: view.revision, contextDigest: view.context.digest, optionId: "md", comment: "ok" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.notEqual(f.getTask(id).state, "done"); assert.notEqual(f.getTask(id).state, "cancelled");
  assert.equal(f.meta(id).closed_at, null);
});
test("a decision after continue escalates again at the fourth round without exceeding the limit", async (t) => {
  const f = fixture(t); const id = await f.escalate(); const row = f.raw.prepare("SELECT id FROM approvals WHERE task_id = ?").get(id);
  const view = getApprovalView(f.raw, f.projectId, row.id);
  assert.equal(f.executeCtr("approvals.decide", { approvalId: row.id, expectedRevision: view.revision, contextDigest: view.context.digest, optionId: "continue", comment: "go" }).status, 200);
  assert.equal(f.meta(id).rounds, 3);
  await until(() => f.getTask(id).state === "in-review" && listAttempts(f.raw, f.projectId, id).length === 5);
  f.reply(id, "request-changes", "Still wrong");
  assert.equal(f.meta(id).rounds, 4); assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM approvals WHERE task_id = ?").get(id).n, 2);
  assert.equal(f.getTask(id).holds.some((h) => h.kind === "decision"), true);
});
test("the escalation decision is refused when the task is no longer in review", async (t) => {
  const f = fixture(t); const id = await f.escalate(); const row = f.raw.prepare("SELECT id FROM approvals WHERE task_id = ?").get(id);
  const view = getApprovalView(f.raw, f.projectId, row.id);
  f.raw.prepare("UPDATE tasks SET state = 'cancelled' WHERE id = ?").run(id);
  const result = f.executeCtr("approvals.decide", { approvalId: row.id, expectedRevision: view.revision, contextDigest: view.context.digest, optionId: "accept-as-is", comment: "x" });
  assert.equal(result.status, 409); assert.equal(f.getTask(id).state, "cancelled");
  assert.equal(getApprovalView(f.raw, f.projectId, row.id).state, "pending");
});
test("the inbox lists only requests that still await triage", async (t) => {
  const f = fixture(t); const origin = "http://127.0.0.1:8787";
  const gate = createBootstrapGate({ clock: f.clock }); const sessions = createSessionStore({ clock: f.clock });
  const app = createApiServer({ origins: [origin], gate, sessions, clock: f.clock, register: createRoutes({ storage: f.storage, hub: f.hub, pipeline: f.pipeline, dispatch: f.dispatcher }) });
  t.after(() => app.close());
  const boot = await app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host: "127.0.0.1:8787", origin }, payload: { token: gate.token } });
  const headers = { host: "127.0.0.1:8787", origin, cookie: boot.headers["set-cookie"].split(";", 1)[0] };
  const ids = () => app.inject({ method: "GET", url: "/inbox", headers }).then((r) => r.json().requests.map((x) => x.taskId));
  const a = f.create({ kind: "produce" }); const b = f.create({ kind: "decision", ask: "Another question" }); const c = f.create({ kind: "review", ask: "Review it please" });
  assert.deepEqual(new Set(await ids()), new Set([a.requestId, b.requestId, c.requestId]));
  f.raw.prepare("UPDATE tasks SET state = 'cancelled', owner_seat_id = ? WHERE id = ?").run(f.seat.id, a.requestId);
  f.raw.prepare("UPDATE ctr_meta SET triage_state = 'accepted' WHERE task_id = ?").run(b.requestId);
  assert.deepEqual(await ids(), [c.requestId]);
  f.raw.prepare("UPDATE ctr_meta SET triage_state = 'need-info' WHERE task_id = ?").run(c.requestId);
  assert.deepEqual(await ids(), [c.requestId]);
});
