import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { listAttempts } from "../dist/dispatch/index.js";
import { buildHandoff } from "../dist/dispatch/handoff.js";
import { getApprovalView } from "../dist/approvals/service.js";
import { createRequestHandlers } from "../dist/requests/commands.js";
import { fixture, refused, until } from "./requests-fixture.mjs";

test("accept produce creates an engagement with the operator defaults and waits for Go", (t) => {
  const f = fixture(t); const { requestId } = f.create(); f.triage(requestId);
  const task = f.getTask(requestId); assert.equal(task.state, "awaiting-go"); assert.ok(task.ownerSeatId);
  const engagement = f.raw.prepare("SELECT * FROM engagements WHERE id = ?").get(task.engagementId);
  assert.equal(engagement.priority, 50); assert.equal(engagement.max_concurrent, 2); assert.equal(f.meta(requestId).triage_state, "accepted");
});
for (const kind of ["review", "decision"]) test(`accept ${kind} waits for Go`, (t) => {
  const f = fixture(t); f.engage(f.team); const { requestId } = f.create({ kind }); f.triage(requestId);
  assert.equal(f.getTask(requestId).state, "awaiting-go");
});
test("accept notify runs without Go when engaged", async (t) => {
  const f = fixture(t); f.engage(f.team); const { requestId } = f.create({ kind: "notify" }); f.triage(requestId);
  await until(() => f.getTask(requestId).state === "in-review");
});
test("accept honors a target team worker seat", (t) => {
  const f = fixture(t); const seat = f.raw.prepare("SELECT id FROM seats WHERE team_id = ? AND is_lead = 0 LIMIT 1").get(f.team).id;
  const { requestId } = f.create(); f.triage(requestId, "accept", { ownerSeatId: seat }); assert.equal(f.getTask(requestId).ownerSeatId, seat);
});
for (const seat of ["wrong", "unknown"]) test(`accept refuses ${seat} owner without writes`, (t) => {
  const f = fixture(t); const { requestId } = f.create(); refused(f,
    () => f.triage(requestId, "accept", { ownerSeatId: seat === "wrong" ? f.seat.id : randomUUID() }), "owner seat must belong to the target team");
});
for (const kind of ["decision", "notify"]) test(`accept ${kind} without engagement is refused atomically`, (t) => {
  const f = fixture(t); const { requestId } = f.create({ kind }); refused(f, () => f.triage(requestId), "needs an engagement: operator triage required");
});
for (const state of ["paused", "archived"]) test(`accept refuses ${state} teams atomically`, (t) => {
  const f = fixture(t); const { requestId } = f.create(); f.lifecycle(state, f.team); refused(f, () => f.triage(requestId), "team is not active");
});
test("need-info appends both target question and operator reason", (t) => {
  const f = fixture(t); const { requestId } = f.create(); f.triage(requestId, "need-info", { reason: "Which constraints apply?" });
  const view = f.view(requestId); assert.equal(view.triageState, "need-info"); assert.equal(view.state, "proposed");
  assert.deepEqual(view.thread.slice(-2).map((m) => [m.author,m.text]), [["target","Which constraints apply?"],["operator","Which constraints apply?"]]);
  f.reply(requestId); assert.equal(f.meta(requestId).triage_state, "submitted"); assert.equal(f.view(requestId).thread.at(-1).author, "requester");
});
test("decline assigns an owner to preserve the core task invariant", (t) => {
  const f = fixture(t); const { requestId } = f.create(); f.triage(requestId, "decline");
  assert.equal(f.getTask(requestId).state, "declined"); assert.equal(f.meta(requestId).triage_state, "declined");
  assert.ok(f.meta(requestId).closed_at); assert.equal(f.view(requestId).thread.at(-1).author, "operator");
});
test("redirect creates a new task preserving hop, root, content and followers", (t) => {
  const f = fixture(t); const { requestId } = f.create({ neededBy: "2026-11-09T00:00:00.000Z", excerpt: "Small context" });
  const follower = f.seed(); f.create({}, follower); const target = f.secondTeam();
  f.triage(requestId, "redirect", { redirectTeamId: target }); const meta = f.meta(requestId); const redirected = f.getTask(meta.redirected_to_task_id);
  assert.equal(meta.triage_state, "redirected"); assert.equal(f.getTask(requestId).state, "declined");
  assert.equal(redirected.origin.hop, 1); assert.equal(f.meta(redirected.id).root_task_id, f.grant.taskId);
  assert.equal(redirected.brief, f.getTask(requestId).brief); assert.equal(f.meta(redirected.id).target_team_id, target);
  assert.equal(f.meta(redirected.id).needed_by, "2026-11-09T00:00:00.000Z"); assert.equal(f.meta(redirected.id).excerpt, "Small context");
  assert.equal(f.view(redirected.id, follower).followers, 1);
});
test("merge attaches the original requester and followers to another open CTR", (t) => {
  const f = fixture(t); const a = f.create(); const b = f.create({ ask: "Another question" }); const follower = f.seed(); f.create({}, follower);
  f.triage(a.requestId, "merge", { mergeIntoTaskId: b.requestId });
  assert.equal(f.meta(a.requestId).triage_state, "merged"); assert.equal(f.meta(a.requestId).merged_into_task_id, b.requestId);
  assert.equal(f.getTask(a.requestId).state, "declined"); assert.equal(f.view(b.requestId, follower).followers, 2);
});
for (const [label, decision, patch, message] of [
  ["missing redirect", "redirect", {}, "redirect team is required"],
  ["unknown redirect", "redirect", { redirectTeamId: randomUUID() }, "team not found"],
  ["missing merge", "merge", {}, "merge target is required"],
  ["unknown merge", "merge", { mergeIntoTaskId: randomUUID() }, "not found"],
  ["blank reason", "accept", { reason: " " }, "invalid command input"],
]) test(`triage ${label} is refused without writes`, (t) => {
  const f = fixture(t); const { requestId } = f.create(); refused(f, () => f.triage(requestId, decision, patch), message);
});
test("redirect to the same team is refused atomically", (t) => { const f = fixture(t); const a = f.create();
  refused(f, () => f.triage(a.requestId, "redirect", { redirectTeamId: f.team }), "ask another team"); });
test("merge into self is refused atomically", (t) => { const f = fixture(t); const a = f.create();
  refused(f, () => f.triage(a.requestId, "merge", { mergeIntoTaskId: a.requestId }), "merge target is not open"); });
test("merge into a closed request is refused atomically", (t) => {
  const f = fixture(t); const a = f.create(); const b = f.create({ ask: "Another" }); f.triage(b.requestId, "decline");
  refused(f, () => f.triage(a.requestId, "merge", { mergeIntoTaskId: b.requestId }), "merge target is not open");
});
for (const decision of ["accept", "need-info", "decline", "redirect", "merge"]) test(`triage ${decision} is refused after acceptance`, (t) => {
  const f = fixture(t); const a = f.create(); f.triage(a.requestId); refused(f, () => f.triage(a.requestId, decision), "request cannot be triaged");
});
test("triage unknown request is refused atomically", (t) => { const f = fixture(t); refused(f, () => f.triage(randomUUID()), "not found"); });
test("triage a normal task is refused atomically", (t) => { const f = fixture(t); refused(f, () => f.triage(f.grant.taskId), "not found"); });
test("requester message may be sent while open", (t) => {
  const f = fixture(t); const a = f.create(); f.reply(a.requestId); assert.equal(f.view(a.requestId).thread.at(-1).text, "Please clarify");
});
test("an unrelated task cannot reply or view the thread", (t) => {
  const f = fixture(t); const a = f.create(); const stranger = f.seed();
  refused(f, () => f.reply(a.requestId, "message", "Hello", stranger), "not found"); refused(f, () => f.view(a.requestId, stranger), "not found");
});
test("followers can message and acknowledge a delivery", async (t) => {
  const f = fixture(t); const id = await f.delivered(); const follower = f.seed(); f.create({ kind: "clarify" }, follower);
  f.reply(id, "message", "Follower note", follower); f.reply(id, "accept", undefined, follower);
  assert.equal(f.getTask(id).state, "done"); assert.ok(f.meta(id).closed_at);
  assert.equal(f.view(id).thread.at(-1).text, "request accepted; followers notified");
});
for (const action of ["accept", "request-changes"]) test(`${action} before delivery is refused atomically`, (t) => {
  const f = fixture(t); const a = f.create(); refused(f, () => f.reply(a.requestId, action), "request is not delivered");
});
for (const action of ["message", "accept", "request-changes"]) test(`${action} on closed requests is refused atomically`, (t) => {
  const f = fixture(t); const a = f.create(); f.triage(a.requestId, "decline"); refused(f, () => f.reply(a.requestId, action), "request is closed");
});
for (const action of ["message", "request-changes"]) test(`${action} requires message text`, (t) => {
  const f = fixture(t); const a = f.create(); refused(f, () => f.reply(a.requestId, action, ""), "invalid tool input");
});
test("rounds one through three create new attempts with requester feedback in real handoffs", async (t) => {
  const f = fixture(t); const id = await f.delivered();
  for (let round = 1; round <= 3; round++) {
    const reply = f.reply(id, "request-changes", `Fix round ${round}`); assert.equal(reply.rounds, round); assert.equal(reply.state, "active");
    await until(() => f.getTask(id).state === "in-review");
    const attempts = listAttempts(f.raw, f.projectId, id); assert.equal(attempts.length, round + 1);
    assert.equal(attempts.at(-1).seatId, attempts[0].seatId);
    assert.match(buildHandoff(f.raw, f.projectId, id), new RegExp(`Requester feedback:\\nFix round ${round}`));
    assert.match(f.runtime.started.filter((entry) => entry.task.id === id).at(-1).handoff, /Requester feedback:/);
  }
});
test("the fourth round escalates with one question approval and a decision hold", async (t) => {
  const f = fixture(t); const id = await f.escalate(); assert.equal(f.meta(id).rounds, 4); assert.equal(f.getTask(id).state, "in-review");
  assert.equal(listAttempts(f.raw, f.projectId, id).length, 4);
  const approval = f.raw.prepare("SELECT * FROM approvals WHERE task_id = ?").get(id);
  assert.equal(approval.kind, "question"); assert.match(approval.subject, /^Request needs a decision:/);
  assert.deepEqual(JSON.parse(approval.options_json).map((o) => o.id), ["accept-as-is","cancel-request","continue"]);
  assert.equal(f.getTask(id).holds.find((h) => h.kind === "decision").needsAction, true);
  assert.equal(f.view(id).thread.at(-1).text, "escalated after 3 rounds");
  refused(f, () => f.reply(id, "request-changes", "Again"), "request needs an operator decision");
});
for (const option of ["accept-as-is", "cancel-request", "continue"]) test(`operator ${option} applies the fourth-round question exactly once`, async (t) => {
  const f = fixture(t); const id = await f.escalate(); const row = f.raw.prepare("SELECT id FROM approvals WHERE task_id = ?").get(id);
  const approval = getApprovalView(f.raw, f.projectId, row.id); const commandId = randomUUID();
  const payload = { approvalId: row.id, expectedRevision: approval.revision, contextDigest: approval.context.digest, optionId: option, comment: "Decision" };
  const result = f.executeCtr("approvals.decide", payload, commandId); assert.equal(result.status, 200, JSON.stringify(result.body));
  const repeat = f.executeCtr("approvals.decide", payload, commandId); assert.equal(repeat.replayed, true); assert.deepEqual(repeat.body, result.body);
  assert.equal(f.getTask(id).holds.length, 0); assert.equal(getApprovalView(f.raw, f.projectId, row.id).appliedByCommandId, commandId);
  if (option === "continue") { await until(() => f.getTask(id).state === "in-review"); assert.equal(listAttempts(f.raw, f.projectId, id).length, 5); }
  else { assert.equal(f.getTask(id).state, option === "accept-as-is" ? "done" : "cancelled"); assert.ok(f.meta(id).closed_at); }
});
for (const type of ["requests.triage", "requests.message"]) test(`${type} is refused while multi-team is disabled`, (t) => {
  const f = fixture(t); const handler = createRequestHandlers({ multiTeam: false, dispatcher: f.dispatcher })[type];
  refused(f, () => handler({ raw: f.raw }, { projectId: f.projectId, payload: {} }), "multi-team is disabled");
});
test("operator message is idempotent under command replay", (t) => {
  const f = fixture(t); const a = f.create(); const commandId = randomUUID(); const payload = { requestTaskId: a.requestId, text: "Operator note" };
  const first = f.executeCtr("requests.message", payload, commandId); const next = f.executeCtr("requests.message", payload, commandId);
  assert.equal(first.status, 200); assert.equal(next.replayed, true); assert.deepEqual(first.body, next.body);
  assert.equal(f.view(a.requestId).thread.filter((m) => m.text === "Operator note").length, 1);
});
test("operator triage is idempotent under command replay", (t) => {
  const f = fixture(t); const a = f.create(); const commandId = randomUUID(); const payload = { requestTaskId: a.requestId, decision: "accept", reason: "Ready" };
  const first = f.executeCtr("requests.triage", payload, commandId); const second = f.executeCtr("requests.triage", payload, commandId);
  assert.equal(first.status, 200); assert.equal(second.replayed, true); assert.deepEqual(first.body, second.body);
});
for (const type of ["requests.triage", "requests.message"]) test(`${type} requires a project`, (t) => {
  const f = fixture(t); const payload = type === "requests.message" ? { requestTaskId: randomUUID(), text: "Note" }
    : { requestTaskId: randomUUID(), decision: "accept", reason: "Reason" };
  const result = f.executeCtr(type, payload, randomUUID(), randomUUID()); assert.equal(result.status, 404); assert.equal(result.body.error.message, "project not found");
});
