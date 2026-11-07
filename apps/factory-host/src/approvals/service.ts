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
export const publicApprovalText = (text: string): string => text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
  // Only a token that STARTS like a path is masked: "CI/CD", "accept/reject" and URLs stay readable.
  .replace(/(?<![\w./:\\-])(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s<>"')\]},;]*/g, "[path]");
const view = (row: ApprovalRow): Approval => ({
  id: row.id, projectId: row.project_id, revision: row.revision, kind: row.kind, taskId: row.task_id,
  subject: publicApprovalText(row.subject), summary: publicApprovalText(row.summary),
  options: (JSON.parse(row.options_json) as Approval["options"]).map((option) => ({
    ...option, label: publicApprovalText(option.label), consequence: publicApprovalText(option.consequence),
  })), recommendation: row.recommendation, impactIfWaiting: publicApprovalText(row.impact_if_waiting),
  context: { refs: [], digest: row.context_digest }, approver: row.approver === "team-lead" ? "project-lead" : "operator",
  requestedAt: row.requested_at, expiresAt: row.expires_at, state: row.state,
  outcome: row.outcome_option_id === null ? null : {
    optionId: row.outcome_option_id, actorId: row.outcome_actor_id!, decidedAt: row.decided_at!, comment: publicApprovalText(row.comment ?? ""),
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
  const rows = raw.prepare("SELECT id, revision FROM approvals WHERE project_id = ? AND task_id = ? AND kind = 'review' AND state = 'pending'")
    .all(projectId, taskId) as { id: string; revision: number }[];
  for (const row of rows) raw.prepare("UPDATE approvals SET state = ?, revision = revision + 1 WHERE project_id = ? AND id = ?")
    .run(state, projectId, row.id);
  return rows.map((row) => effect(row.id, row.revision + 1));
}
export function withdrawPendingReviews(raw: Database, projectId: string, taskId: string, _now: Date): EntityRef[] {
  return finishPending(raw, projectId, taskId, "withdrawn");
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
  deps?: { dispatcher: Dispatcher }): HandlerResult {
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
  if (approval.kind === "review") {
    if (task?.state !== "in-review") throw new CommandError("conflict", "task is not in review", "refresh");
    if (!deps) throw new CommandError("unsupported", "review dispatch is unavailable", "contact-host");
    if (!["accept", "request-changes"].includes(payload.optionId)) throw new CommandError("validation", "unknown review option", "correct-input");
  }
  const state = payload.optionId === "request-changes" ? "changes-requested" : payload.optionId === "reject" ? "rejected" : "approved";
  raw.prepare(`UPDATE approvals SET state = ?, outcome_option_id = ?, outcome_actor_id = ?, decided_at = ?, revision = revision + 1
    WHERE project_id = ? AND id = ?`).run(state, payload.optionId, ctx.actorId, ctx.clock().toISOString(), projectId, approval.id);
  raw.prepare("INSERT INTO approval_comments (project_id,approval_id,comment) VALUES (?,?,?)").run(projectId, approval.id, payload.comment);
  const effects: EntityRef[] = [effect(approval.id, approval.revision + 1)];
  if (task && deps) {
    effects.push(...moveTaskAndAdvance(raw, task, payload.optionId === "accept" ? "done" : "active", deps));
    for (const ref of setTaskArtifactStatus(raw, { projectId, taskId: task.id, to: payload.optionId === "accept" ? "approved" : "rejected" }))
      effects.push({ kind: "artifact-version", id: ref.artifactId, revision: ref.version });
    if (payload.optionId === "accept") {
      raw.prepare("UPDATE approvals SET state = 'applied', applied_by_command_id = ?, revision = revision + 1 WHERE project_id = ? AND id = ?")
        .run(command.commandId, projectId, approval.id);
      effects.push(effect(approval.id, approval.revision + 2));
    }
  }
  return { effects };
}

export function createApprovalsDecideHandler(deps: { dispatcher: Dispatcher }): HandlerMap["approvals.decide"] {
  return (ctx, command) => approvalsDecideHandler(ctx, command, deps);
}

export function expirePendingApprovals(deps: { raw: Database; hub?: EventHub; now: () => Date }): number {
  const run = (): number => {
    const rows = deps.raw.prepare("SELECT project_id, id, revision FROM approvals WHERE state = 'pending' AND expires_at <= ? ORDER BY expires_at, id")
      .all(deps.now().toISOString()) as { project_id: string; id: string; revision: number }[];
    for (const row of rows) {
      deps.raw.prepare("UPDATE approvals SET state = 'expired', revision = revision + 1 WHERE project_id = ? AND id = ?").run(row.project_id, row.id);
      publish(deps.hub, row.project_id, effect(row.id, row.revision + 1));
    }
    return rows.length;
  };
  return deps.hub ? deps.hub.transaction(run) : deps.raw.transaction(run)();
}
