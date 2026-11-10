import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { appendAttemptEvent } from "../dist/dispatch/index.js";
import { enqueueIntegration } from "../dist/integration/service.js";
import { integrationFixture, success } from "./integration-fixture.mjs";
import { fixture as requestFixture } from "./requests-fixture.mjs";
import { getApprovalView } from "../dist/approvals/service.js";

test("enqueue records the done task's latest workspace branch", t => {
  const f = integrationFixture(t), id = f.task({ state: "done" }); f.attempt(id); f.enqueueMerge(id);
  assert.equal(f.row(id).state, "pending"); assert.equal(f.row(id).branch, "factory/org-001-e1");
  assert.equal(f.row(id).created_at, f.clock().toISOString()); assert.equal(f.row(id).attempts, 0);
});
for (const state of ["draft", "proposed", "accepted", "ready", "awaiting-go", "active", "in-review", "failed", "cancelled"]) test(`enqueue ignores task state ${state}`, t => {
  const f = integrationFixture(t), id = f.task({ state }); f.attempt(id); f.enqueueMerge(id); assert.equal(f.row(id), undefined);
});
test("unknown task is ignored", t => { const f = integrationFixture(t); assert.doesNotThrow(() => f.enqueueMerge(randomUUID())); });
test("done task without an attempt is ignored", t => { const f = integrationFixture(t), id = f.task({ state: "done" }); f.enqueueMerge(id); assert.equal(f.row(id), undefined); });
test("done task without workspace-ready is ignored", t => { const f = integrationFixture(t), id = f.task({ state: "done" }); f.attempt(id, { branch: null }); f.enqueueMerge(id); assert.equal(f.row(id), undefined); });
test("latest attempt without a branch never falls back to an earlier attempt", t => {
  const f = integrationFixture(t), id = f.task({ state: "done" }); f.attempt(id); f.attempt(id, { epoch: 2, branch: null }); f.enqueueMerge(id); assert.equal(f.row(id), undefined);
});
test("latest epoch supplies the branch", t => {
  const f = integrationFixture(t), id = f.task({ state: "done" }); f.attempt(id); f.attempt(id, { epoch: 2, branch: "factory/org-001-e2" }); f.enqueueMerge(id); assert.equal(f.row(id).branch, "factory/org-001-e2");
});
test("workspace-ready must be a state event", t => {
  const f = integrationFixture(t), id = f.task({ state: "done" }), a = f.attempt(id, { branch: null });
  appendAttemptEvent(f.raw, { projectId: f.projectId, attemptId: a, kind: "evidence", body: { to: "workspace-ready", branch: "factory/work" }, at: f.clock().toISOString() });
  f.enqueueMerge(id); assert.equal(f.row(id), undefined);
});
for (const branch of [null, 123, "main", "", "refs/heads/factory/work"]) test(`enqueue ignores unsupported branch ${branch}`, t => {
  const f = integrationFixture(t), id = f.task({ state: "done" }); f.attempt(id, { branch }); f.enqueueMerge(id); assert.equal(f.row(id), undefined);
});
for (const state of ["pending", "merged", "conflict", "skipped"]) test(`enqueue leaves existing ${state} row unchanged`, t => {
  const f = integrationFixture(t), id = f.task({ state: "done" }); f.attempt(id); f.merge(id, { state }); const before = f.row(id);
  f.enqueueMerge(id); f.enqueueMerge(id); assert.deepEqual(f.row(id), before);
});
test("enqueue rolls back with the acceptance transaction", t => {
  const f = integrationFixture(t), id = f.task({ state: "done" }); f.attempt(id);
  assert.throws(() => f.raw.transaction(() => { enqueueIntegration(f.raw, { projectId: f.projectId, taskId: id, now: f.clock().toISOString() }); throw Error("rollback"); })());
  assert.equal(f.row(id), undefined);
});
test("review accept enqueues the accepted attempt in the same decision", t => {
  const f = integrationFixture(t), id = f.task({ state: "in-review" }); success(f.accept(id)); assert.equal(f.getTask(id).state, "done"); assert.equal(f.row(id).state, "pending");
});
test("manual tasks.transition to done enqueues", t => {
  const f = integrationFixture(t), id = f.task({ state: "in-review" }); f.attempt(id);
  success(f.command("tasks.transition", id, { payload: { to: "done", expectedRevision: f.getTask(id).revision } })); assert.equal(f.row(id).state, "pending");
});
test("review request-changes does not enqueue", t => {
  const f = integrationFixture(t), id = f.task({ state: "in-review" }), approval = f.review(id); success(f.accept(id, approval, "request-changes")); assert.equal(f.row(id), undefined);
});
test("accept without workspace still has no integration row", t => {
  const f = integrationFixture(t, { workspace: false }), id = f.task({ state: "in-review" }), approval = f.review(id);
  f.raw.prepare("DELETE FROM attempt_events WHERE attempt_id IN (SELECT id FROM attempts WHERE task_id=?)").run(id);
  success(f.accept(id, approval)); assert.equal(f.row(id), undefined);
});
test("CTR fourth-round Operator accept-as-is enqueues latest workspace branch", async t => {
  const f = requestFixture(t), id = await f.escalate();
  const attempt = f.raw.prepare("SELECT id FROM attempts WHERE project_id=? AND task_id=? ORDER BY epoch DESC LIMIT 1").get(f.projectId, id);
  appendAttemptEvent(f.raw, { projectId: f.projectId, attemptId: attempt.id, kind: "state", body: { to: "workspace-ready", branch: "factory/ctr-e4" }, at: f.clock().toISOString() });
  const row = f.raw.prepare("SELECT id FROM approvals WHERE task_id=?").get(id), approval = getApprovalView(f.raw, f.projectId, row.id);
  success(f.executeCtr("approvals.decide", { approvalId: row.id, expectedRevision: approval.revision, contextDigest: approval.context.digest, optionId: "accept-as-is", comment: "Accept" }));
  assert.equal(f.getTask(id).state, "done"); const merge = f.raw.prepare("SELECT * FROM integration_merges WHERE project_id=? AND task_id=?").get(f.projectId, id);
  assert.equal(merge.state, "pending"); assert.equal(merge.branch, "factory/ctr-e4"); assert.equal(merge.created_at, f.clock().toISOString());
});
