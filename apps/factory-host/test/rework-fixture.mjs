import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { engineFixture, flow, stage } from "./workflow-engine-fixture.mjs";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createApprovalsDecideHandler, getApprovalView, requestTaskReview } from "../dist/approvals/service.js";
import { moveTask } from "../dist/dispatch/tasks.js";

export const reworkEdge = (from = "review", to = "author", maxLoops = 3, when = { fact: "review.verdict", op: "eq", value: "changes-requested" }) =>
  ({ from, to, type: "rework", maxLoops, when });
export const reworkFlow = (edges = [reworkEdge()], stages = [stage("author"), stage("review")]) =>
  flow(stages, [{ from: "author", to: "review", type: "finish-to-start" }, ...edges]);
export const stageRow = (f, key) => f.raw.prepare("SELECT * FROM workflow_stages WHERE project_id=? AND instance_id=? AND stage_key=?")
  .get(f.projectId, f.id, key);

// Real review creation/decision with recorded attempt evidence, without a runtime or seeded verdicts.
export function reworkFixture(t, definition = reworkFlow()) {
  const f = engineFixture(t, definition);
  const pipeline = createCommandPipeline({ storage: f.storage, hub: f.hub, clock: f.clock,
    handlers: { "approvals.decide": createApprovalsDecideHandler({ dispatcher: f.dispatcher, multiTeam: true }) } });
  function review(taskId, { artifact = true, summary = "Review evidence", kind = "other" } = {}) {
    const task = f.getTask(taskId);
    if (["ready", "awaiting-go"].includes(task.state)) moveTask(f.raw, f.projectId, taskId, "active");
    const attemptId = randomUUID();
    f.raw.prepare(`INSERT INTO attempts (project_id,id,task_id,revision,epoch,state,outcome,runtime,provider,model,effort,ended_at)
      VALUES (?,?,?,1,1,'succeeded','known','fake','fake','fake','medium',?)`).run(f.projectId, attemptId, taskId, f.clock().toISOString());
    f.raw.prepare("INSERT INTO attempt_seats VALUES (?,?,?)").run(f.projectId, attemptId, f.seat.id);
    const artifactId = artifact ? randomUUID() : null;
    if (artifact) f.raw.prepare(`INSERT INTO artifact_versions
      (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,abstract_l0,abstract_l1,produced_by_attempt_id,visibility,created_at)
      VALUES (?,?,1,?,'Evidence','text/markdown',?,1,'in-review','Evidence',?,?,'project',?)`)
      .run(f.projectId, artifactId, kind, "a".repeat(64), summary, attemptId, f.clock().toISOString());
    moveTask(f.raw, f.projectId, taskId, "in-review");
    const approvalId = requestTaskReview({ raw: f.raw, hub: f.hub, now: f.clock, newId: randomUUID }, { projectId: f.projectId, taskId, attemptId });
    assert.ok(approvalId);
    const decide = (optionId = "request-changes", overrides = {}) => {
      const approval = getApprovalView(f.raw, f.projectId, approvalId);
      return pipeline.execute({ apiVersion: 1, commandId: randomUUID(), projectId: f.projectId, type: "approvals.decide",
        payload: { approvalId, expectedRevision: approval.revision, contextDigest: approval.context.digest, optionId, comment: "Please correct the implementation", ...overrides } });
    };
    return { taskId, attemptId, artifactId, approvalId, decide };
  }
  function verdict(key = "review", option = "request-changes") {
    const r = review(f.tasks(key)[0].id), result = r.decide(option);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return r;
  }
  function cycle(option = "request-changes") {
    f.finish("author"); f.run(); const r = verdict("review", option); f.run(); f.run(); return r;
  }
  return { ...f, review, verdict, cycle };
}
