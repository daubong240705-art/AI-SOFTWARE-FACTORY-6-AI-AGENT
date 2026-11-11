import assert from "node:assert/strict";
import { test } from "node:test";
import { stage, flow } from "./workflow-engine-fixture.mjs";
import { reworkFixture, reworkFlow, reworkEdge } from "./rework-fixture.mjs";

function atReview(t, definition) {
  const f = reworkFixture(t, definition); f.start(); f.finish("author"); f.run();
  return { f, review: f.review(f.tasks("review")[0].id) };
}

test("rework source changes verdict completes the review task and retains the verdict", t => {
  const { f, review: r } = atReview(t);
  assert.equal(r.decide().status, 200);
  assert.equal(f.getTask(r.taskId).state, "done");
  const approval = f.raw.prepare("SELECT * FROM approvals WHERE id=?").get(r.approvalId);
  assert.equal(approval.state, "changes-requested"); assert.equal(approval.outcome_option_id, "request-changes");
  assert.equal(approval.applied_by_command_id, null);
});

test("rework verdict approves the report artifact as evidence", t => {
  const { f, review: r } = atReview(t); assert.equal(r.decide().status, 200);
  assert.equal(f.raw.prepare("SELECT status FROM artifact_versions WHERE artifact_id=?").get(r.artifactId).status, "approved");
});

test("a stage without a rework edge restarts its task", t => {
  const { f, review: r } = atReview(t, reworkFlow([])); assert.equal(r.decide().status, 200);
  assert.equal(f.getTask(r.taskId).state, "active");
  assert.equal(f.raw.prepare("SELECT status FROM artifact_versions WHERE artifact_id=?").get(r.artifactId).status, "rejected");
});

test("a standalone task cannot inherit a workflow's rework verdict semantics", t => {
  const f = reworkFixture(t); const id = f.task({ reviewPolicy: "human-final" }); const r = f.review(id);
  assert.equal(r.decide().status, 200); assert.equal(f.getTask(id).state, "active");
  assert.equal(f.raw.prepare("SELECT count(*) n FROM workflow_stage_tasks WHERE task_id=?").get(id).n, 0);
});

test("an outgoing rework edge from another stage does not classify review as a source", t => {
  const { f, review: r } = atReview(t, reworkFlow([reworkEdge("audit", "author")], [stage("author"), stage("review"), stage("audit")]));
  assert.equal(r.decide().status, 200); assert.equal(f.getTask(r.taskId).state, "active");
});

test("the destination of a rework edge keeps ordinary request-changes semantics", t => {
  const f = reworkFixture(t); f.start(); const r = f.review(f.tasks("author")[0].id);
  assert.equal(r.decide().status, 200); assert.equal(f.getTask(r.taskId).state, "active");
});

test("an informs edge alone does not classify a review as a rework source", t => {
  const definition = reworkFlow([{ from: "review", to: "author", type: "informs" }]);
  const { f, review: r } = atReview(t, definition); assert.equal(r.decide().status, 200);
  assert.equal(f.getTask(r.taskId).state, "active");
});

test("a rework source with no artifacts still records a completed task", t => {
  const f = reworkFixture(t); f.start(); f.finish("author"); f.run(); const r = f.review(f.tasks("review")[0].id, { artifact: false });
  assert.equal(r.decide().status, 200); assert.equal(f.getTask(r.taskId).state, "done");
});

test("accepting a rework source records applied approval and completes the workflow", t => {
  const { f, review: r } = atReview(t); assert.equal(r.decide("accept").status, 200); f.run();
  assert.equal(f.view().state, "completed"); assert.equal(f.view().stages[0].loopCount, 0);
  assert.equal(f.raw.prepare("SELECT state FROM approvals WHERE id=?").get(r.approvalId).state, "applied");
});

test("real changes verdict creates a fresh destination task without restarting review", t => {
  const { f, review: r } = atReview(t); const original = f.tasks("author")[0].id;
  assert.equal(r.decide().status, 200); f.run(); f.run();
  assert.equal(f.view().stages[0].loopCount, 1); assert.equal(f.tasks("author").length, 2);
  assert.notEqual(f.tasks("author")[0].id, original); assert.equal(f.getTask(original).state, "done");
  assert.equal(f.raw.prepare("SELECT count(*) n FROM attempts WHERE task_id=?").get(r.taskId).n, 1);
  assert.match(f.tasks("author")[0].brief, /Reviewer feedback:\nPlease correct the implementation/);
});

test("missing L1 evidence rejects a rework verdict atomically", t => {
  const f = reworkFixture(t); f.start(); f.finish("author"); f.run();
  const r = f.review(f.tasks("review")[0].id, { summary: null, kind: "requirements" }); const result = r.decide();
  assert.equal(result.status, 409); assert.equal(f.getTask(r.taskId).state, "in-review");
  assert.equal(f.raw.prepare("SELECT state FROM approvals WHERE id=?").get(r.approvalId).state, "pending");
  assert.equal(f.raw.prepare("SELECT status FROM artifact_versions WHERE artifact_id=?").get(r.artifactId).status, "in-review");
  assert.equal(f.raw.prepare("SELECT count(*) n FROM approval_comments").get().n, 0);
});

test("a stale context cannot apply a rework verdict", t => {
  const { f, review: r } = atReview(t); const result = r.decide("request-changes", { contextDigest: "b".repeat(64) });
  assert.equal(result.status, 409); assert.equal(f.getTask(r.taskId).state, "in-review");
  assert.equal(f.raw.prepare("SELECT state FROM approvals WHERE id=?").get(r.approvalId).state, "pending");
});

test("rework source detection uses the linked stage key instead of the task title", t => {
  const f = reworkFixture(t, flow([stage("author"), stage("review", { title: "Not QA" })], reworkFlow().edges));
  f.start(); f.finish("author"); f.run(); const r = f.verdict();
  assert.equal(f.getTask(r.taskId).title, "Not QA"); assert.equal(f.getTask(r.taskId).state, "done");
});
