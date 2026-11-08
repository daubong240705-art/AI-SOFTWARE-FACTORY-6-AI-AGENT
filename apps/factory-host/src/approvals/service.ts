import { createHash } from "node:crypto";
import type { Database } from "better-sqlite3";
import { type Approval, type ApprovalState, type Command, type EntityRef } from "@factory/contracts";
import { listTaskArtifacts, setTaskArtifactStatus } from "../artifacts/service.js";
import { CommandError } from "../commands/errors.js";
import type { HandlerContext, HandlerMap, HandlerResult } from "../commands/pipeline.js";
import type { Dispatcher } from "../dispatch/dispatcher.js";
import { moveTaskAndAdvance } from "../dispatch/transitions.js";
import type { EventHub } from "../events/hub.js";
import { getTask } from "../work/service.js";
import { assertActiveGrant, McpToolError, sanitizeAgentText } from "../mcp/security.js";
import { cleanDecisionRequest, type DecisionRequestInput } from "../mcp/tools.js";
import { listAttempts, liveAttemptOfTask } from "../dispatch/attempts.js";
import { ArtifactLifecycleError } from "../knowledge/lifecycle.js";

interface ApprovalRow {
  project_id: string; id: string; revision: number; kind: Approval["kind"]; task_id: string | null;
  subject: string; summary: string; options_json: string; recommendation: string | null;
  impact_if_waiting: string; context_digest: string; approver: "operator" | "team-lead";
  requested_at: string; expires_at: string; state: ApprovalState; outcome_option_id: string | null;
  outcome_actor_id: string | null; decided_at: string | null; applied_by_command_id: string | null;
  comment: string | null;
}
const columns = "SELECT a.*, c.comment FROM approvals a LEFT JOIN approval_comments c ON c.project_id = a.project_id AND c.approval_id = a.id";
const rowOf = (raw: Database, projectId: string, id: string): ApprovalRow | undefined =>
  raw.prepare(`${columns} WHERE a.project_id = ? AND a.id = ?`).get(projectId, id) as ApprovalRow | undefined;
const effect = (id: string, revision: number): EntityRef => ({ kind: "approval", id, revision });
// Review text is untrusted. Public views never expose local absolute paths or control characters.
export const publicApprovalText = (text: string): string => text.replace(/fpx_[A-Za-z0-9_-]+|\bsk-[A-Za-z0-9_-]+/g, "[redacted]")
  .replace(/[\u0000-\u0008\u000b-\u001f\u007f\p{Cf}]/gu, " ")
  // Only a token that STARTS like a path is masked: "CI/CD", "accept/reject" and URLs stay readable.
  .replace(/(?<![\w./:\\-])(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s<>"')\]},;]*/g, "[path]");
const view = (row: ApprovalRow): Approval => ({
  id: row.id, projectId: row.project_id, revision: row.revision, kind: row.kind, taskId: row.task_id,
  subject: publicApprovalText(row.subject), summary: publicApprovalText(row.summary),
  options: (JSON.parse(row.options_json) as Approval["options"]).map((option) => ({
    ...option, id: publicApprovalText(option.id), label: publicApprovalText(option.label), consequence: publicApprovalText(option.consequence),
  })), recommendation: row.recommendation === null ? null : publicApprovalText(row.recommendation), impactIfWaiting: publicApprovalText(row.impact_if_waiting),
  context: { refs: [], digest: row.context_digest }, approver: row.approver === "team-lead" ? "project-lead" : "operator",
  requestedAt: row.requested_at, expiresAt: row.expires_at, state: row.state,
  outcome: row.outcome_option_id === null ? null : {
    optionId: publicApprovalText(row.outcome_option_id), actorId: row.outcome_actor_id!, decidedAt: row.decided_at!, comment: publicApprovalText(row.comment ?? ""),
  }, appliedByCommandId: row.applied_by_command_id,
});

export function getApprovalView(raw: Database, projectId: string, approvalId: string): Approval | null {
  const row = rowOf(raw, projectId, approvalId);
  return row ? view(row) : null;
}
/** History is newest first; Inbox callers reverse the requestedAt ordering. */
export function listApprovals(raw: Database, projectId: string, options: { states?: ApprovalState[]; taskId?: string } = {}): Approval[] {
  const rows = raw.prepare(`${columns} WHERE a.project_id = ? ORDER BY a.requested_at DESC, a.rowid DESC`)
    .all(projectId) as ApprovalRow[];
  return rows.filter((row) => (options.states === undefined || options.states.includes(row.state))
    && (options.taskId === undefined || row.task_id === options.taskId)).map(view);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) as string;
}
export function computeReviewDigest(raw: Database, projectId: string, taskId: string): string {
  const artifacts = listTaskArtifacts(raw, projectId, taskId).map((artifact) => {
    const latest = artifact.versions[0]!;
    return { artifactId: artifact.artifactId, version: latest.version, contentHash: latest.contentHash };
  }).sort((a, b) => a.artifactId < b.artifactId ? -1 : a.artifactId > b.artifactId ? 1 : 0);
  const attempt = raw.prepare("SELECT id FROM attempts WHERE project_id = ? AND task_id = ? ORDER BY epoch DESC LIMIT 1")
    .get(projectId, taskId) as { id: string } | undefined;
  return createHash("sha256").update(canonicalJson(artifacts.length ? artifacts : { taskId, attemptId: attempt?.id ?? null })).digest("hex");
}
const publish = (hub: EventHub | undefined, projectId: string, entity: EntityRef): void => {
  if (hub) hub.append({ projectId, causationId: entity.id, payload: { type: "entity.changed", entity } });
};
function finishPending(raw: Database, projectId: string, taskId: string, state: "superseded" | "withdrawn"): EntityRef[] {
  const rows = raw.prepare(`SELECT id, revision FROM approvals WHERE project_id = ? AND task_id = ?
    AND (kind = 'review' OR (? = 'withdrawn' AND kind = 'question')) AND state = 'pending'`)
    .all(projectId, taskId, state) as { id: string; revision: number }[];
  for (const row of rows) raw.prepare("UPDATE approvals SET state = ?, revision = revision + 1 WHERE project_id = ? AND id = ?")
    .run(state, projectId, row.id);
  return rows.map((row) => effect(row.id, row.revision + 1));
}
export function withdrawPendingReviews(raw: Database, projectId: string, taskId: string, _now: Date): EntityRef[] {
  const effects = finishPending(raw, projectId, taskId, "withdrawn");
  const deleted = raw.prepare("DELETE FROM task_holds WHERE project_id = ? AND task_id = ? AND kind = 'decision'").run(projectId, taskId);
  if (deleted.changes) {
    raw.prepare("UPDATE tasks SET revision = revision + 1 WHERE project_id = ? AND id = ?").run(projectId, taskId);
    effects.push({ kind: "task", id: taskId, revision: getTask(raw, projectId, taskId)!.revision });
  }
  return effects;
}

export function requestAgentDecision(deps: { raw: Database; hub?: EventHub; now: () => Date; newId: () => string },
  input: { grant: { projectId: string; taskId: string; attemptId: string; epoch: number }; request: DecisionRequestInput }): { approvalId: string } {
  const { raw } = deps;
  const run = (): { approvalId: string } => {
    const { projectId, taskId, attemptId } = input.grant;
    const now = deps.now();
    assertActiveGrant(raw, input.grant, now);
    if (raw.prepare("SELECT 1 FROM approvals WHERE project_id = ? AND task_id = ? AND kind = 'question' AND state = 'pending'").get(projectId, taskId)
      || raw.prepare("SELECT 1 FROM task_holds WHERE project_id = ? AND task_id = ? AND kind = 'decision'").get(projectId, taskId))
      throw new McpToolError("a decision is already pending");
    const request = cleanDecisionRequest(input.request);
    const id = deps.newId();
    const digest = createHash("sha256").update(canonicalJson({ taskId, attemptId,
      subject: request.subject, summary: request.summary, options: request.options })).digest("hex");
    raw.prepare(`INSERT INTO approvals (project_id,id,revision,kind,task_id,subject,summary,options_json,recommendation,
      impact_if_waiting,context_digest,approver,requested_at,expires_at,state)
      VALUES (?,?,1,'question',?,?,?,?,?,?,?,'operator',?,?,'pending')`).run(projectId, id, taskId,
      request.subject, request.summary, JSON.stringify(request.options), request.recommendation ?? null, request.impactIfWaiting, digest,
      now.toISOString(), new Date(now.getTime() + 7 * 86400000).toISOString());
    raw.prepare(`INSERT INTO task_holds (project_id,task_id,kind,reason,ref_kind,ref_id,since,needs_action)
      VALUES (?,?,'decision',?,'approval',?,?,1)`).run(projectId, taskId, `Waiting for your decision: ${request.subject.trim()}`, id, now.toISOString());
    raw.prepare("UPDATE tasks SET revision = revision + 1 WHERE project_id = ? AND id = ?").run(projectId, taskId);
    publish(deps.hub, projectId, effect(id, 1));
    publish(deps.hub, projectId, { kind: "task", id: taskId, revision: getTask(raw, projectId, taskId)!.revision });
    return { approvalId: id };
  };
  return deps.hub ? deps.hub.transaction(run) : raw.transaction(run).immediate();
}

export function requestTaskReview(deps: { raw: Database; now: () => Date; newId: () => string; hub?: EventHub },
  input: { projectId: string; taskId: string; attemptId: string }): string | null {
  const { raw } = deps;
  const { projectId, taskId, attemptId } = input;
  const task = raw.prepare("SELECT code, title, state, review_policy FROM tasks WHERE project_id = ? AND id = ?")
    .get(projectId, taskId) as { code: string; title: string; state: string; review_policy: string } | undefined;
  if (task?.state !== "in-review" || task.review_policy !== "human-final") return null;
  const attempt = raw.prepare("SELECT id FROM attempts WHERE project_id = ? AND task_id = ? ORDER BY epoch DESC LIMIT 1")
    .get(projectId, taskId) as { id: string } | undefined;
  if (attempt?.id !== attemptId) return null;
  return raw.transaction(() => {
    for (const entity of finishPending(raw, projectId, taskId, "superseded")) publish(deps.hub, projectId, entity);
    const rows = raw.prepare("SELECT body_json FROM attempt_events WHERE project_id = ? AND attempt_id = ? AND kind = 'state' ORDER BY seq DESC")
      .all(projectId, attemptId) as { body_json: string }[];
    const summaries = rows.map((row) => JSON.parse(row.body_json) as { summary?: unknown });
    let summary = publicApprovalText(summaries.find((body) => typeof body.summary === "string" && body.summary.trim())?.summary as string ?? "Task completed.").trim().slice(0, 3500);
    const evidenceRows = raw.prepare("SELECT body_json FROM attempt_events WHERE project_id = ? AND attempt_id = ? AND kind = 'evidence' ORDER BY seq DESC")
      .all(projectId, attemptId) as { body_json: string }[];
    const totals = evidenceRows.map((row) => JSON.parse(row.body_json) as { totals?: Record<string, unknown> }).find((body) => body.totals)?.totals;
    const count = (value: unknown): number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
    if (totals) summary += `\nEvidence: ${count(totals.files)} files changed, +${count(totals.additions)} -${count(totals.deletions)}.`;
    const id = deps.newId();
    const now = deps.now();
    raw.prepare(`INSERT INTO approvals (project_id,id,revision,kind,task_id,subject,summary,options_json,recommendation,
      impact_if_waiting,context_digest,approver,requested_at,expires_at,state)
      VALUES (?,?,1,'review',?,?,?,?,NULL,?,?,'operator',?,?,'pending')`).run(projectId, id, taskId,
      publicApprovalText(`Review ${task.code}: ${task.title}`).trim().slice(0, 160), summary, JSON.stringify([
        { id: "accept", label: "Accept", consequence: "The task is marked done and tasks waiting for it can start." },
        { id: "request-changes", label: "Request changes", consequence: "A new attempt starts from the previous branch with your comment." },
      ]), "The task stays in review and tasks that depend on it wait.", computeReviewDigest(raw, projectId, taskId),
      now.toISOString(), new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString());
    publish(deps.hub, projectId, effect(id, 1));
    return id;
  })();
}

/** The optional dispatcher is supplied by host wiring; the command remains kind agnostic. */
export function approvalsDecideHandler(ctx: HandlerContext, command: Extract<Command, { type: "approvals.decide" }>,
  deps?: { dispatcher: Dispatcher; multiTeam?: boolean }): HandlerResult {
  const { raw } = ctx;
  const { projectId, payload } = command;
  const approval = rowOf(raw, projectId, payload.approvalId);
  if (!approval) throw new CommandError("not-found", "approval not found", "correct-input");
  if (approval.state !== "pending") throw new CommandError("conflict", "approval already decided", "refresh");
  if (Date.parse(approval.expires_at) <= ctx.clock().getTime()) throw new CommandError("conflict", "approval expired", "refresh");
  if (approval.revision !== payload.expectedRevision)
    throw new CommandError("conflict", "approval revision changed", "refresh", { currentRevision: approval.revision });
  if (payload.contextDigest !== approval.context_digest || (approval.kind === "review" && approval.task_id !== null
    && payload.contextDigest !== computeReviewDigest(raw, projectId, approval.task_id)))
    throw new CommandError("conflict", "context changed", "refresh");
  const options = JSON.parse(approval.options_json) as Approval["options"];
  if (!options.some((option) => option.id === payload.optionId)) throw new CommandError("validation", "unknown option", "correct-input");
  const task = approval.kind === "review" && approval.task_id ? getTask(raw, projectId, approval.task_id) : null;
  // A terminal task may still carry a stale hold. Read its identity/state without projecting an
  // invalid done-with-holds Task, then clear that hold as part of applying the answer.
  const questionTask = approval.kind === "question" && approval.task_id
    ? raw.prepare("SELECT id, state FROM tasks WHERE project_id = ? AND id = ?").get(projectId, approval.task_id) as { id: string; state: string } | undefined : undefined;
  const previous = questionTask ? listAttempts(raw, projectId, questionTask.id).at(-1) : undefined;
  const ctrDecision = questionTask && raw.prepare(`SELECT 1 FROM ctr_meta m JOIN task_holds h
    ON h.project_id = m.project_id AND h.task_id = m.task_id AND h.kind = 'decision' AND h.ref_id = ?
    WHERE m.project_id = ? AND m.task_id = ? AND m.rounds = 4`).get(approval.id, projectId, questionTask.id);
  if (ctrDecision && (questionTask?.state !== "in-review" || !deps))
    throw new CommandError("conflict", "request cannot apply this decision", "refresh");
  if (ctrDecision && !["accept-as-is", "cancel-request", "continue"].includes(payload.optionId))
    throw new CommandError("validation", "unknown option", "correct-input");
  if (questionTask?.state === "active" && liveAttemptOfTask(raw, projectId, questionTask.id))
    throw new CommandError("conflict", "attempt is still parking", "refresh");
  if (questionTask?.state === "active" && !liveAttemptOfTask(raw, projectId, questionTask.id)
    && (!deps || !previous?.seatId)) throw new CommandError("unsupported", "decision dispatch is unavailable", "contact-host");
  if (approval.kind === "review") {
    if (task?.state !== "in-review") throw new CommandError("conflict", "task is not in review", "refresh");
    if (!deps) throw new CommandError("unsupported", "review dispatch is unavailable", "contact-host");
    if (!["accept", "request-changes"].includes(payload.optionId)) throw new CommandError("validation", "unknown review option", "correct-input");
  }
  const state = approval.kind === "question" ? "approved"
    : payload.optionId === "request-changes" ? "changes-requested" : payload.optionId === "reject" ? "rejected" : "approved";
  raw.prepare(`UPDATE approvals SET state = ?, outcome_option_id = ?, outcome_actor_id = ?, decided_at = ?, revision = revision + 1
    WHERE project_id = ? AND id = ?`).run(state, payload.optionId, ctx.actorId, ctx.clock().toISOString(), projectId, approval.id);
  raw.prepare("INSERT INTO approval_comments (project_id,approval_id,comment) VALUES (?,?,?)")
    .run(projectId, approval.id, approval.kind === "question" ? sanitizeAgentText(payload.comment).slice(0, 32000) : payload.comment);
  const effects: EntityRef[] = [effect(approval.id, approval.revision + 1)];
  if (approval.kind === "question") {
    const task = questionTask;
    if (task) {
      const deleted = raw.prepare("DELETE FROM task_holds WHERE project_id = ? AND task_id = ? AND kind = 'decision'").run(projectId, task.id);
      if (deleted.changes) {
        raw.prepare("UPDATE tasks SET revision = revision + 1 WHERE project_id = ? AND id = ?").run(projectId, task.id);
        effects.push({ kind: "task", id: task.id, revision: getTask(raw, projectId, task.id)!.revision });
      }
      if (ctrDecision && deps) {
        const to = payload.optionId === "accept-as-is" ? "done" : payload.optionId === "cancel-request" ? "cancelled" : "active";
        if (to === "done") raw.prepare("DELETE FROM task_holds WHERE project_id = ? AND task_id = ? AND kind = 'input'").run(projectId, task.id);
        effects.push(...moveTaskAndAdvance(raw, getTask(raw, projectId, task.id)!, to, deps));
        raw.prepare("UPDATE ctr_meta SET rounds = CASE WHEN ? = 'active' THEN 3 ELSE rounds END, closed_at = ? WHERE project_id = ? AND task_id = ?")
          .run(to, to === "active" ? null : ctx.clock().toISOString(), projectId, task.id);
        raw.prepare(`INSERT INTO ctr_messages (project_id,task_id,seq,author,text,at)
          SELECT ?,?,COALESCE(MAX(seq),0)+1,'system',?,? FROM ctr_messages WHERE project_id = ? AND task_id = ?`)
          .run(projectId, task.id, payload.optionId === "accept-as-is" ? "request accepted; followers notified"
            : payload.optionId === "cancel-request" ? "request cancelled" : "operator continued the request", ctx.clock().toISOString(), projectId, task.id);
      }
      if (task.state === "active" && !liveAttemptOfTask(raw, projectId, task.id) && deps && previous?.seatId
        && !raw.prepare("SELECT 1 FROM task_holds WHERE project_id = ? AND task_id = ? AND kind = 'cross-team'").get(projectId, task.id)) {
        const attempt = deps.dispatcher.enqueue({ projectId, taskId: task.id, seatId: previous.seatId });
        effects.push({ kind: "attempt", id: attempt.id, revision: attempt.revision });
      }
    }
    raw.prepare("UPDATE approvals SET state = 'applied', applied_by_command_id = ?, revision = revision + 1 WHERE project_id = ? AND id = ?")
      .run(command.commandId, projectId, approval.id);
    effects.push(effect(approval.id, approval.revision + 2));
  } else if (task && deps) {
    effects.push(...moveTaskAndAdvance(raw, task, payload.optionId === "accept" ? "done" : "active", deps));
    let refs: ReturnType<typeof setTaskArtifactStatus>;
    try { refs = setTaskArtifactStatus(raw, { projectId, taskId: task.id, to: payload.optionId === "accept" ? "approved" : "rejected", multiTeam: deps.multiTeam === true }); }
    catch (error) {
      // The whole decision rolls back: accepting must not approve a document that lacks its summary (L1).
      if (error instanceof ArtifactLifecycleError) throw new CommandError("conflict", error.message, "correct-input");
      throw error;
    }
    for (const ref of refs) effects.push({ kind: "artifact-version", id: ref.artifactId, revision: ref.version });
    if (payload.optionId === "accept") {
      raw.prepare("UPDATE approvals SET state = 'applied', applied_by_command_id = ?, revision = revision + 1 WHERE project_id = ? AND id = ?")
        .run(command.commandId, projectId, approval.id);
      effects.push(effect(approval.id, approval.revision + 2));
    }
  }
  return { effects };
}

export function createApprovalsDecideHandler(deps: { dispatcher: Dispatcher; multiTeam?: boolean }): HandlerMap["approvals.decide"] {
  return (ctx, command) => approvalsDecideHandler(ctx, command, deps);
}

export function expirePendingApprovals(deps: { raw: Database; hub?: EventHub; now: () => Date }): number {
  const run = (): number => {
    const rows = deps.raw.prepare("SELECT project_id, id, revision FROM approvals WHERE state = 'pending' AND expires_at <= ? ORDER BY expires_at, id")
      .all(deps.now().toISOString()) as { project_id: string; id: string; revision: number }[];
    for (const row of rows) {
      // Expiring a question leaves it unanswered and retains its needs-action hold. The operator
      // must cancel or explicitly retry the task; expiry must never start another execution.
      deps.raw.prepare("UPDATE approvals SET state = 'expired', revision = revision + 1 WHERE project_id = ? AND id = ?").run(row.project_id, row.id);
      publish(deps.hub, row.project_id, effect(row.id, row.revision + 1));
    }
    return rows.length;
  };
  return deps.hub ? deps.hub.transaction(run) : deps.raw.transaction(run)();
}
