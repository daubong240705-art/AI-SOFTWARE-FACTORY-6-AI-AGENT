// Closes mutation survivors of the C1b review: park/resume guards, hold exclusivity in the dispatcher,
// merge into a delivered request, timed-out followers, expiry boundaries and the handoff section.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fixture, until, live, blocked, attempts, wait } from "./requests-blocking-fixture.mjs";
import { pumped } from "./org-fixture.mjs";
import { releaseWaiters, expireRequests } from "../dist/requests/service.js";
import { resumeWaiter } from "../dist/requests/waits.js";
import { buildHandoff } from "../dist/dispatch/handoff.js";
import { advanceTasks, startTask } from "../dist/dispatch/advance.js";
import { getApprovalView, requestAgentDecision } from "../dist/approvals/service.js";

const addHold = (f, taskId, refId) => f.raw.prepare(`INSERT INTO task_holds (project_id,task_id,kind,reason,ref_kind,ref_id,since,needs_action)
  VALUES (?,?,'cross-team','Waiting for a cross-team request','task',?,?,0)`).run(f.projectId, taskId, refId, f.clock().toISOString());

test("resume does nothing for a parked attempt that has no resolved wait", async (t) => {
  const f = fixture(t); const r = await blocked(f);
  f.raw.prepare("DELETE FROM ctr_waits WHERE ctr_task_id = ?").run(r.requestId);
  f.raw.prepare("DELETE FROM task_holds WHERE task_id = ?").run(r.grant.taskId);
  resumeWaiter(f.deps, f.projectId, r.grant.taskId); await pumped();
  assert.equal(attempts(f, r.grant.taskId).length, 1);
});
test("a waiter cancelled before the deferred park is never parked", async (t) => {
  const f = fixture(t); const grant = await live(f); f.create({ responseMode: "blocking" }, grant);
  f.raw.prepare("UPDATE tasks SET state = 'cancelled' WHERE project_id = ? AND id = ?").run(f.projectId, grant.taskId);
  await new Promise((done) => setTimeout(done, 250));
  assert.notEqual(attempts(f, grant.taskId)[0].state, "parked");
});
test("a timed-out waiter becomes a follower of the request that keeps running", async (t) => {
  const f = fixture(t); const r = await blocked(f);
  f.hub.transaction(() => releaseWaiters(f.deps, r.requestId, "timed-out"));
  assert.ok(f.raw.prepare("SELECT 1 FROM ctr_followers WHERE project_id = ? AND task_id = ? AND follower_task_id = ?").get(f.projectId, r.requestId, r.grant.taskId));
});
test("a delivered outcome does not subscribe the waiter as a follower", async (t) => {
  const f = fixture(t); const r = await blocked(f);
  f.hub.transaction(() => releaseWaiters(f.deps, r.requestId, "delivered"));
  assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM ctr_followers WHERE task_id = ?").get(r.requestId).n, 0);
});
test("merging a blocked request into a delivered one resumes the waiter immediately", async (t) => {
  const f = fixture(t); const r = await blocked(f, { kind: "produce", ask: "Write the plan" });
  const delivered = await f.delivered({ ask: "Which database should we use?" });
  f.triage(r.requestId, "merge", { mergeIntoTaskId: delivered });
  assert.equal(wait(f, r.grant, delivered).outcome, "delivered");
  await until(() => attempts(f, r.grant.taskId).length === 2);
});
test("a blocking request deduplicated onto a delivered one resumes the new waiter immediately", async (t) => {
  const f = fixture(t); const delivered = await f.delivered(); const grant = await live(f);
  const created = f.create({ kind: "clarify", responseMode: "blocking" }, grant);
  assert.equal(created.merged, true); assert.equal(created.requestId, delivered);
  assert.equal(wait(f, grant, delivered).outcome, "delivered");
});
test("the response mode is stored and survives a redirect", async (t) => {
  const f = fixture(t); const r = await blocked(f, { kind: "produce" });
  assert.equal(f.meta(r.requestId).response_mode, "blocking");
  f.triage(r.requestId, "redirect", { redirectTeamId: f.secondTeam() });
  assert.equal(f.meta(f.meta(r.requestId).redirected_to_task_id).response_mode, "blocking");
  assert.equal(f.create({ ask: "Plain async question" }).requestId.length > 0, true);
  assert.equal(f.meta(f.raw.prepare("SELECT task_id FROM ctr_meta WHERE response_mode = 'async' LIMIT 1").get().task_id).response_mode, "async");
});
test("an operator moving a request to declined releases its waiters", async (t) => {
  const f = fixture(t); const r = await blocked(f, { kind: "produce" });
  f.raw.prepare("UPDATE tasks SET owner_seat_id = ? WHERE project_id = ? AND id = ?").run(f.seat.id, f.projectId, r.requestId);
  const result = f.execute("tasks.transition", { taskId: r.requestId, to: "declined", expectedRevision: f.getTask(r.requestId).revision });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(wait(f, r.grant, r.requestId).outcome, "declined");
  await until(() => attempts(f, r.grant.taskId).length === 2);
});
test("expiry leaves a submitted request alone once its task is no longer proposed", (t) => {
  const f = fixture(t); const a = f.create({ kind: "produce" });
  f.raw.prepare("UPDATE tasks SET state = 'cancelled', owner_seat_id = ? WHERE id = ?").run(f.seat.id, a.requestId);
  expireRequests(f.deps, new Date(f.clock().getTime() + 30 * 86400000));
  assert.equal(f.meta(a.requestId).triage_state, "submitted"); assert.equal(f.getTask(a.requestId).state, "cancelled");
});
test("expiry never touches an accepted request", (t) => {
  const f = fixture(t); const a = f.create({ kind: "produce" }); f.triage(a.requestId);
  expireRequests(f.deps, new Date(f.clock().getTime() + 30 * 86400000));
  assert.equal(f.meta(a.requestId).triage_state, "accepted"); assert.equal(f.getTask(a.requestId).state, "awaiting-go");
});
test("a queued attempt of a task holding a cross-team wait does not start until the hold is gone", async (t) => {
  const f = fixture(t); f.slots(4); const other = f.create({ kind: "produce", ask: "Other" });
  const taskId = f.task({ seatId: f.seat.id }); addHold(f, taskId, other.requestId);
  const attempt = f.enqueue(taskId, f.projectId, f.seat.id); await pumped(); await new Promise((done) => setTimeout(done, 100));
  assert.equal(f.read(attempt).state, "queued");
  f.raw.prepare("DELETE FROM task_holds WHERE task_id = ?").run(taskId); f.dispatcher.kick();
  await until(() => f.read(attempt).state === "running");
});
test("advance skips a ready task that waits for a cross-team request and release refuses it", (t) => {
  const f = fixture(t); const other = f.create({ kind: "produce", ask: "Other" });
  const taskId = f.task({ seatId: f.seat.id, state: "ready", requiresGo: false }); addHold(f, taskId, other.requestId);
  f.hub.transaction(() => { advanceTasks(f.raw, f.projectId, { dispatcher: f.dispatcher }); });
  assert.equal(f.getTask(taskId).state, "ready"); assert.equal(attempts(f, taskId).length, 0);
  assert.throws(() => startTask(f.raw, f.projectId, taskId, { dispatcher: f.dispatcher }), (e) => e.message === "task is waiting");
});
test("answering a decision does not restart a task that still waits for a cross-team request", async (t) => {
  const f = fixture(t); const grant = await live(f); const other = f.create({ kind: "produce", ask: "Other" }, grant);
  f.raw.prepare("INSERT INTO ctr_waits (project_id,waiter_task_id,ctr_task_id,attempt_id,since) VALUES (?,?,?,?,?)")
    .run(f.projectId, grant.taskId, other.requestId, grant.attemptId, f.clock().toISOString());
  const { approvalId } = requestAgentDecision({ raw: f.raw, hub: f.hub, now: f.clock, newId: randomUUID }, { grant, request: {
    subject: "Pick a format", summary: "Which one", options: [{ id: "md", label: "Markdown", consequence: "md" }, { id: "txt", label: "Text", consequence: "txt" }],
    impactIfWaiting: "Blocked" } });
  addHold(f, grant.taskId, other.requestId);
  f.raw.prepare("UPDATE attempts SET state = 'parked' WHERE id = ?").run(grant.attemptId);
  const view = getApprovalView(f.raw, f.projectId, approvalId);
  const result = f.executeCtr("approvals.decide", { approvalId, expectedRevision: view.revision, contextDigest: view.context.digest, optionId: "md", comment: "ok" });
  assert.equal(result.status, 200, JSON.stringify(result.body)); await pumped();
  assert.equal(attempts(f, grant.taskId).length, 1);
  assert.equal(f.getTask(grant.taskId).holds.some((h) => h.kind === "cross-team"), true);
});
test("the handoff lists only resolved waits of the parked attempt", async (t) => {
  const f = fixture(t); const r = await blocked(f);
  assert.doesNotMatch(buildHandoff(f.raw, f.projectId, r.grant.taskId), /Request results:/);
});
test("the handoff shows at most three results", async (t) => {
  const f = fixture(t); const r = await blocked(f); const ids = [r.requestId];
  for (let i = 0; i < 3; i++) ids.push(f.create({ kind: "produce", ask: `Extra ${i}` }, f.seed()).requestId);
  for (const id of ids.slice(1)) f.raw.prepare("INSERT INTO ctr_waits (project_id,waiter_task_id,ctr_task_id,attempt_id,since) VALUES (?,?,?,?,?)")
    .run(f.projectId, r.grant.taskId, id, r.grant.attemptId, f.clock().toISOString());
  f.raw.prepare("UPDATE ctr_waits SET resolved_at = ?, outcome = 'declined' WHERE waiter_task_id = ?").run(f.clock().toISOString(), r.grant.taskId);
  const text = buildHandoff(f.raw, f.projectId, r.grant.taskId);
  assert.equal((text.match(/REQ-\d+ declined/g) ?? []).length, 3);
});
test("deliverables are listed for delivered waits only and only when readable", async (t) => {
  const f = fixture(t); const r = await blocked(f, { kind: "produce" });
  const seatId = f.raw.prepare("SELECT id FROM seats WHERE team_id = ? LIMIT 1").get(f.team).id; const engagementId = f.engage(f.team);
  f.raw.prepare("UPDATE tasks SET state = 'active', owner_seat_id = ?, engagement_id = ? WHERE id = ?").run(seatId, engagementId, r.requestId);
  const worker = f.seed(r.requestId, seatId);
  const shared = f.artifact({ producer: worker.attemptId, visibility: "project", status: "approved", title: "Shared plan" });
  const hidden = f.artifact({ producer: worker.attemptId, visibility: "team-draft", status: "draft", title: "Secret draft" });
  f.raw.prepare("UPDATE ctr_waits SET resolved_at = ?, outcome = 'declined' WHERE waiter_task_id = ?").run(f.clock().toISOString(), r.grant.taskId);
  let text = buildHandoff(f.raw, f.projectId, r.grant.taskId);
  assert.doesNotMatch(text, /Shared plan/);
  f.raw.prepare("UPDATE ctr_waits SET outcome = 'delivered' WHERE waiter_task_id = ?").run(r.grant.taskId);
  text = buildHandoff(f.raw, f.projectId, r.grant.taskId);
  assert.match(text, new RegExp(`Shared plan \\(${shared.artifactId}@1\\)`)); assert.doesNotMatch(text, /Secret draft/);
  void hidden;
});
