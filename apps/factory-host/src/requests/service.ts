import { createHash } from "node:crypto";
import type { Database } from "better-sqlite3";
import { requestCreateInputSchema, requestReplyInputSchema, type EntityRef, type RequestCreateInput, type RequestReplyInput } from "@factory/contracts";
import type { Dispatcher } from "../dispatch/dispatcher.js";
import { appendAttemptEvent } from "../dispatch/attempts.js";
import { moveTask } from "../dispatch/tasks.js";
import { moveTaskAndAdvance } from "../dispatch/transitions.js";
import type { EventHub } from "../events/hub.js";
import { knowledgeScopeForGrant } from "../knowledge/mcp.js";
import { visibleToScope, type KnowledgeScope } from "../knowledge/permissions.js";
import { normalizeForSearch } from "../knowledge/text.js";
import { assertActiveGrant, sanitizeAgentText } from "../mcp/security.js";
import { findLeadSeat } from "../org/service.js";
import { getTask } from "../work/service.js";

export type RequestGrant = { projectId: string; taskId: string; attemptId: string; epoch: number };
export interface RequestDeps {
  raw: Database; multiTeam: boolean; dispatcher: Dispatcher; hub?: EventHub; now: () => Date; newId: () => string;
}
type ErrorCode = "not-found" | "validation" | "conflict" | "disabled";
export class RequestError extends Error {
  constructor(readonly code: ErrorCode, readonly reason: string) { super(reason); this.name = "RequestError"; }
}
function refuse(reason: string, code: ErrorCode = "conflict"): never { throw new RequestError(code, reason); }
const terminal = new Set(["done", "cancelled", "declined", "superseded"]);
interface RequestRow {
  project_id: string; task_id: string; root_task_id: string; dedup_key: string; target_team_id: string;
  response_mode: "async" | "blocking"; needed_by: string | null; expected_response_json: string; context_refs_json: string;
  excerpt: string | null; triage_state: string; rounds: number; requester_task_id: string; request_kind: RequestCreateInput["kind"];
  hop: number; code: string; title: string; brief: string; state: string; engagement_id: string | null; owner_seat_id: string | null;
}
const selection = `SELECT m.*, t.requester_task_id, t.request_kind, t.hop, t.code, t.title, t.brief, t.state, t.engagement_id, t.owner_seat_id
  FROM ctr_meta m JOIN tasks t ON t.project_id = m.project_id AND t.id = m.task_id AND t.origin_kind = 'cross-team'`;
const rowOf = (raw: Database, projectId: string, id: string): RequestRow =>
  raw.prepare(`${selection} WHERE m.project_id = ? AND m.task_id = ?`).get(projectId, id) as RequestRow | undefined ?? refuse("not found", "not-found");
const open = (row: RequestRow): boolean => !terminal.has(row.state) && !["declined", "redirected", "merged"].includes(row.triage_state);
// Thread text is public to both participants. Task identities in prose are never part of the protocol.
export const requestText = (value: string): string => sanitizeAgentText(value)
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted]");
export function appendRequestMessage(raw: Database, input: {
  projectId: string; requestTaskId: string; author: "requester" | "target" | "operator" | "system"; text: string; now: string;
}): void {
  raw.prepare(`INSERT INTO ctr_messages (project_id, task_id, seq, author, text, at)
    SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ? FROM ctr_messages WHERE project_id = ? AND task_id = ?`)
    .run(input.projectId, input.requestTaskId, input.author, requestText(input.text).slice(0, 4000), input.now, input.projectId, input.requestTaskId);
}
function follow(raw: Database, row: RequestRow, taskId: string, now: string): void {
  raw.prepare("INSERT OR IGNORE INTO ctr_followers (project_id,task_id,follower_task_id,since) VALUES (?,?,?,?)")
    .run(row.project_id, row.task_id, taskId, now);
}
function requester(raw: Database, row: RequestRow, grant: RequestGrant): void {
  if (row.requester_task_id !== grant.taskId && !raw.prepare("SELECT 1 FROM ctr_followers WHERE project_id = ? AND task_id = ? AND follower_task_id = ?")
    .get(grant.projectId, row.task_id, grant.taskId)) refuse("not found", "not-found");
}
function targetTeam(raw: Database, id: string): void {
  const team = raw.prepare("SELECT lifecycle FROM teams WHERE id = ?").get(id) as { lifecycle: string } | undefined;
  if (!team) refuse("team not found", "not-found");
  if (team.lifecycle !== "active") refuse("team is not active");
}
function engagement(raw: Database, projectId: string, teamId: string, create: boolean, now: string, newId: () => string, priority = 30, max = 1): string | null {
  const existing = raw.prepare("SELECT id FROM engagements WHERE project_id = ? AND team_id = ? AND state = 'active'")
    .get(projectId, teamId) as { id: string } | undefined;
  if (existing) return existing.id;
  if (!create) return null;
  const id = newId();
  raw.prepare(`INSERT INTO engagements (project_id,id,team_id,revision,priority,max_concurrent,state,created_at)
    VALUES (?,?,?,1,?,?,'active',?)`).run(projectId, id, teamId, priority, max, now);
  return id;
}
function owner(raw: Database, teamId: string, explicit?: string): string {
  const id = explicit ?? findLeadSeat(raw, teamId)?.id;
  if (!id) return refuse("owner seat is required", "validation");
  if (!raw.prepare("SELECT 1 FROM seats WHERE id = ? AND team_id = ?").get(id, teamId))
    refuse("owner seat must belong to the target team", "validation");
  return id;
}
function publish(deps: RequestDeps, projectId: string, ids: readonly string[]): void {
  for (const id of new Set(ids)) {
    const task = getTask(deps.raw, projectId, id)!;
    deps.hub?.append({ projectId, causationId: id, payload: { type: "entity.changed", entity: { kind: "task", id, revision: task.revision } } });
  }
}
function transaction<T>(deps: RequestDeps, fn: () => T): T {
  return deps.hub ? deps.hub.transaction(() => deps.raw.transaction(fn)()) : deps.raw.transaction(fn).immediate();
}
export function requestDedupKey(input: RequestCreateInput): string {
  const refs = input.contextRefs.map(({ artifactId, version }) => ({ artifactId, version }))
    .sort((a, b) => a.artifactId.localeCompare(b.artifactId) || a.version - b.version);
  return createHash("sha256").update(JSON.stringify({ targetTeamId: input.targetTeamId, kind: input.kind,
    refs, ask: normalizeForSearch(input.ask).slice(0, 300) })).digest("hex");
}
function insertRequest(deps: RequestDeps, input: RequestCreateInput, source: { projectId: string; requesterTaskId: string; rootTaskId: string; hop: number }) {
  const { raw } = deps; const now = deps.now().toISOString();
  const projectId = source.projectId;
  const engagementId = engagement(raw, projectId, input.targetTeamId, ["clarify", "consult", "review"].includes(input.kind), now, deps.newId);
  const automatic = ["clarify", "consult"].includes(input.kind) && engagementId !== null;
  const seatId = automatic ? owner(raw, input.targetTeamId) : null;
  const id = deps.newId();
  const codes = raw.prepare("SELECT code FROM tasks WHERE project_id = ?").all(projectId) as { code: string }[];
  const next = codes.reduce((max, row) => /^REQ-\d+$/.test(row.code) ? Math.max(max, Number(row.code.slice(4))) : max, 0) + 1;
  const code = `REQ-${String(next).padStart(3, "0")}`;
  raw.prepare(`INSERT INTO tasks (project_id,id,revision,code,title,goal,brief,engagement_id,owner_seat_id,
    origin_kind,requester_task_id,request_kind,hop,state,disposition,placement,side_effect,review_policy,requires_go,
    required_capabilities_json,acceptance_json,inputs_json)
    VALUES (?,?,1,?,?,?,?,?,?,'cross-team',?,?,?,'draft','active',?,?,'automatic',?,'[]',?,?)`)
    .run(projectId, id, code, input.subject, input.ask.slice(0, 500), input.ask, engagementId, seatId,
      source.requesterTaskId, input.kind, source.hop, ["clarify", "consult"].includes(input.kind) ? "portable" : "node-bound",
      ["produce", "review"].includes(input.kind) ? "artifact" : "none", Number(!["clarify", "consult", "notify"].includes(input.kind)),
      JSON.stringify(input.expectedResponse.acceptance), JSON.stringify(input.contextRefs));
  raw.prepare(`INSERT INTO ctr_meta (project_id,task_id,root_task_id,dedup_key,target_team_id,response_mode,needed_by,
    expected_response_json,context_refs_json,excerpt,triage_state) VALUES (?,?,?,?,?,'async',?,?,?,?,'submitted')`)
    .run(projectId, id, source.rootTaskId, requestDedupKey(input), input.targetTeamId, input.neededBy ?? null,
      JSON.stringify(input.expectedResponse), JSON.stringify(input.contextRefs), input.excerpt ?? null);
  appendRequestMessage(raw, { projectId, requestTaskId: id, author: "requester", text: input.ask, now });
  moveTask(raw, projectId, id, "proposed");
  if (automatic) {
    raw.prepare("UPDATE ctr_meta SET triage_state = 'accepted',triage_by = 'system',triage_at = ? WHERE project_id = ? AND task_id = ?")
      .run(now, projectId, id);
    moveTaskAndAdvance(raw, getTask(raw, projectId, id)!, "accepted", deps);
  } else if (engagementId === null) appendRequestMessage(raw, { projectId, requestTaskId: id, author: "system",
    text: "needs an engagement: operator triage required", now });
  return { requestId: id, code, state: getTask(raw, projectId, id)!.state, merged: false as const };
}

export function createRequest(deps: RequestDeps, { grant, input }: { grant: RequestGrant; input: unknown }) {
  return transaction(deps, () => {
    const { raw } = deps;
    assertActiveGrant(raw, grant, deps.now());
    if (!deps.multiTeam) refuse("multi-team is disabled", "disabled");
    const parsed = requestCreateInputSchema.safeParse(input);
    if (!parsed.success) refuse("invalid tool input", "validation");
    const value = parsed.data;
    if (value.responseMode === "blocking") refuse("blocking requests are not available yet");
    targetTeam(raw, value.targetTeamId);
    const task = getTask(raw, grant.projectId, grant.taskId)!;
    const team = raw.prepare("SELECT team_id FROM engagements WHERE project_id = ? AND id = ?")
      .get(grant.projectId, task.engagementId) as { team_id: string } | undefined;
    if (team?.team_id === value.targetTeamId) refuse("ask another team");
    const hop = (task.origin.kind === "cross-team" ? task.origin.hop : 0) + 1;
    if (hop > 3) refuse("request chain is too deep");
    const count = raw.prepare(`${selection} WHERE m.project_id = ? AND t.requester_task_id = ?`).all(grant.projectId, grant.taskId) as RequestRow[];
    const used = raw.prepare("SELECT COUNT(*) AS n FROM attempt_events WHERE project_id = ? AND attempt_id = ? AND json_extract(body_json,'$.ctrCreated') = 1")
      .get(grant.projectId, grant.attemptId) as { n: number };
    if (count.filter(open).length >= 10 || used.n >= 20) refuse("too many requests");
    const scope = knowledgeScopeForGrant(raw, grant); const visibility = visibleToScope(scope);
    for (const ref of value.contextRefs) if (!raw.prepare(`SELECT 1 FROM artifact_versions v WHERE v.project_id = ? AND v.artifact_id = ? AND v.version = ? AND ${visibility.sql}`)
      .get(grant.projectId, ref.artifactId, ref.version, ...visibility.params)) refuse("context is not readable");
    const clean = requestCreateInputSchema.safeParse({ ...value, subject: requestText(value.subject).trim(), ask: requestText(value.ask).trim(),
      expectedResponse: { ...value.expectedResponse, format: requestText(value.expectedResponse.format), acceptance: value.expectedResponse.acceptance.map(requestText) },
      ...(value.excerpt === undefined ? {} : { excerpt: requestText(value.excerpt) }) });
    if (!clean.success) refuse("invalid tool input", "validation");
    const duplicate = (raw.prepare(`${selection} WHERE m.project_id = ? AND m.dedup_key = ? ORDER BY m.rowid`)
      .all(grant.projectId, requestDedupKey(clean.data)) as RequestRow[]).find(open);
    if (duplicate) {
      follow(raw, duplicate, grant.taskId, deps.now().toISOString());
      publish(deps, grant.projectId, [duplicate.task_id]);
      return { requestId: duplicate.task_id, merged: true as const };
    }
    const rootTaskId = task.origin.kind === "cross-team" ? rowOf(raw, grant.projectId, task.id).root_task_id : task.id;
    const result = insertRequest(deps, clean.data, { projectId: grant.projectId, requesterTaskId: task.id, rootTaskId, hop });
    appendAttemptEvent(raw, { projectId: grant.projectId, attemptId: grant.attemptId, kind: "state", at: deps.now().toISOString(), body: { ctrCreated: true } });
    publish(deps, grant.projectId, [result.requestId]);
    return result;
  });
}

export interface TriageInput {
  projectId: string; requestTaskId: string; decision: "accept" | "need-info" | "decline" | "redirect" | "merge";
  reason: string; ownerSeatId?: string | undefined; redirectTeamId?: string | undefined; mergeIntoTaskId?: string | undefined; actorId: string; now: string;
}
/** Called inside the command transaction; direct callers get the same atomicity. */
export function triageRequest(raw: Database, input: TriageInput, deps: RequestDeps): EntityRef[] {
  return raw.transaction(() => {
    if (!deps.multiTeam) refuse("multi-team is disabled", "disabled");
    const row = rowOf(raw, input.projectId, input.requestTaskId);
    if (!["submitted", "need-info"].includes(row.triage_state) || row.state !== "proposed") refuse("request cannot be triaged");
    if (!input.reason.trim() || input.reason.length > 1000) refuse("invalid command input", "validation");
    const { projectId, requestTaskId, now } = input; const effects: EntityRef[] = [];
    let triageState: string = input.decision; let redirected: string | null = null; let merged: string | null = null;
    if (input.decision === "accept") {
      targetTeam(raw, row.target_team_id);
      const seatId = owner(raw, row.target_team_id, input.ownerSeatId);
      const engagementId = engagement(raw, projectId, row.target_team_id, row.request_kind === "produce", now, deps.newId, 50, 2);
      if (!engagementId) refuse("needs an engagement: operator triage required");
      raw.prepare("UPDATE tasks SET engagement_id = ?,owner_seat_id = ? WHERE project_id = ? AND id = ?").run(engagementId, seatId, projectId, requestTaskId);
      effects.push(...moveTaskAndAdvance(raw, getTask(raw, projectId, requestTaskId)!, "accepted", deps));
      triageState = "accepted";
    } else if (input.decision === "need-info") {
      appendRequestMessage(raw, { projectId, requestTaskId, author: "target", text: input.reason, now });
    } else {
      if (input.decision === "redirect") {
        if (!input.redirectTeamId) refuse("redirect team is required", "validation");
        targetTeam(raw, input.redirectTeamId);
        if (input.redirectTeamId === row.target_team_id) refuse("ask another team");
        const content = requestCreateInputSchema.parse({ kind: row.request_kind, targetTeamId: input.redirectTeamId,
          subject: row.title, ask: row.brief, expectedResponse: JSON.parse(row.expected_response_json) as unknown,
          contextRefs: JSON.parse(row.context_refs_json) as unknown, ...(row.needed_by === null ? {} : { neededBy: row.needed_by }),
          ...(row.excerpt === null ? {} : { excerpt: row.excerpt }) });
        redirected = insertRequest(deps, content, { projectId, requesterTaskId: row.requester_task_id, rootTaskId: row.root_task_id, hop: row.hop }).requestId;
        for (const follower of raw.prepare("SELECT follower_task_id FROM ctr_followers WHERE project_id = ? AND task_id = ?").all(projectId, requestTaskId) as { follower_task_id: string }[])
          follow(raw, rowOf(raw, projectId, redirected), follower.follower_task_id, now);
        effects.push({ kind: "task", id: redirected, revision: getTask(raw, projectId, redirected)!.revision });
        triageState = "redirected";
      } else if (input.decision === "merge") {
        if (!input.mergeIntoTaskId) refuse("merge target is required", "validation");
        const target = rowOf(raw, projectId, input.mergeIntoTaskId);
        if (target.task_id === requestTaskId || !open(target)) refuse("merge target is not open");
        follow(raw, target, row.requester_task_id, now);
        for (const follower of raw.prepare("SELECT follower_task_id FROM ctr_followers WHERE project_id = ? AND task_id = ?").all(projectId, requestTaskId) as { follower_task_id: string }[])
          follow(raw, target, follower.follower_task_id, now);
        merged = target.task_id; triageState = "merged";
        effects.push({ kind: "task", id: target.task_id, revision: getTask(raw, projectId, target.task_id)!.revision });
      } else if (input.decision !== "decline") refuse("invalid command input", "validation");
      else triageState = "declined";
      // The original schema requires an owner even when declining an unassigned proposal.
      raw.prepare("UPDATE tasks SET owner_seat_id = COALESCE(owner_seat_id,?) WHERE project_id = ? AND id = ?")
        .run(owner(raw, row.target_team_id), projectId, requestTaskId);
      moveTask(raw, projectId, requestTaskId, "declined");
    }
    raw.prepare(`UPDATE ctr_meta SET triage_state = ?,triage_by = ?,triage_at = ?,triage_reason = ?,
      redirected_to_task_id = ?,merged_into_task_id = ?,closed_at = ? WHERE project_id = ? AND task_id = ?`)
      .run(triageState, input.actorId, now, requestText(input.reason), redirected, merged,
        ["declined", "redirected", "merged"].includes(triageState) ? now : null, projectId, requestTaskId);
    appendRequestMessage(raw, { projectId, requestTaskId, author: "operator", text: input.reason, now });
    raw.prepare("UPDATE tasks SET revision = revision + 1 WHERE project_id = ? AND id = ?").run(projectId, requestTaskId);
    effects.push({ kind: "task", id: requestTaskId, revision: getTask(raw, projectId, requestTaskId)!.revision });
    return effects;
  }).immediate();
}

export function replyRequest(deps: RequestDeps, input: RequestReplyInput & { grant: RequestGrant }) {
  return transaction(deps, () => {
    const { raw } = deps; const { grant } = input; const now = deps.now().toISOString();
    assertActiveGrant(raw, grant, deps.now());
    if (!deps.multiTeam) refuse("multi-team is disabled", "disabled");
    const parsed = requestReplyInputSchema.safeParse({ requestId: input.requestId, action: input.action,
      ...(input.message === undefined ? {} : { message: input.message }) });
    if (!parsed.success) refuse("invalid tool input", "validation");
    const row = rowOf(raw, grant.projectId, input.requestId); requester(raw, row, grant);
    if (!open(row)) refuse("request is closed");
    if (raw.prepare("SELECT 1 FROM task_holds WHERE project_id = ? AND task_id = ? AND kind = 'decision'").get(grant.projectId, row.task_id))
      refuse("request needs an operator decision");
    if (input.action !== "message" && row.state !== "in-review") refuse("request is not delivered");
    const common = { projectId: grant.projectId, requestTaskId: row.task_id, now };
    if (input.message !== undefined) appendRequestMessage(raw, { ...common, author: "requester", text: input.message });
    if (input.action === "message") {
      raw.prepare("UPDATE ctr_meta SET triage_state = CASE WHEN triage_state = 'need-info' THEN 'submitted' ELSE triage_state END WHERE project_id = ? AND task_id = ?")
        .run(grant.projectId, row.task_id);
    } else if (input.action === "accept") {
      raw.prepare("DELETE FROM task_holds WHERE project_id = ? AND task_id = ? AND kind = 'input'").run(grant.projectId, row.task_id);
      moveTaskAndAdvance(raw, getTask(raw, grant.projectId, row.task_id)!, "done", deps);
      raw.prepare("UPDATE ctr_meta SET closed_at = ? WHERE project_id = ? AND task_id = ?").run(now, grant.projectId, row.task_id);
      appendRequestMessage(raw, { ...common, author: "system", text: "request accepted; followers notified" });
    } else {
      const rounds = row.rounds + 1;
      raw.prepare("UPDATE ctr_meta SET rounds = ?,delivered_at = NULL WHERE project_id = ? AND task_id = ?").run(rounds, grant.projectId, row.task_id);
      if (rounds <= 3) moveTaskAndAdvance(raw, getTask(raw, grant.projectId, row.task_id)!, "active", deps);
      else {
        const id = deps.newId();
        const options = [
          { id: "accept-as-is", label: "Accept as is", consequence: "Complete the request." },
          { id: "cancel-request", label: "Cancel request", consequence: "Cancel the request." },
          { id: "continue", label: "Continue", consequence: "Start another attempt with requester feedback." },
        ];
        const subject = requestText(`Request needs a decision: ${row.title}`).slice(0, 160);
        const summary = "The requester requested changes after three rounds.";
        const digest = createHash("sha256").update(JSON.stringify({ taskId: row.task_id, rounds, subject, options })).digest("hex");
        raw.prepare(`INSERT INTO approvals (project_id,id,revision,kind,task_id,subject,summary,options_json,recommendation,
          impact_if_waiting,context_digest,approver,requested_at,expires_at,state)
          VALUES (?,?,1,'question',?,?,?,?,NULL,?,?,'operator',?,?,'pending')`)
          .run(grant.projectId, id, row.task_id, subject, summary, JSON.stringify(options), "The request waits for your decision.", digest,
            now, new Date(deps.now().getTime() + 7 * 86400000).toISOString());
        raw.prepare(`INSERT INTO task_holds (project_id,task_id,kind,reason,ref_kind,ref_id,since,needs_action)
          VALUES (?,?,'decision',?,'approval',?,?,1)`).run(grant.projectId, row.task_id, "Request needs an operator decision", id, now);
        appendRequestMessage(raw, { ...common, author: "system", text: "escalated after 3 rounds" });
        deps.hub?.append({ projectId: grant.projectId, causationId: row.task_id,
          payload: { type: "entity.changed", entity: { kind: "approval", id, revision: 1 } } });
      }
    }
    raw.prepare("UPDATE tasks SET revision = revision + 1 WHERE project_id = ? AND id = ?").run(grant.projectId, row.task_id);
    publish(deps, grant.projectId, [row.task_id]);
    return { requestId: row.task_id, state: getTask(raw, grant.projectId, row.task_id)!.state, rounds: rowOf(raw, grant.projectId, row.task_id).rounds };
  });
}

export function getRequest(raw: Database, input: { grantOrOperator: RequestGrant | { projectId: string; operator: true }; requestId: string }) {
  const viewer = input.grantOrOperator; const row = rowOf(raw, viewer.projectId, input.requestId);
  let scope: KnowledgeScope;
  if ("operator" in viewer) scope = { projectId: viewer.projectId, teamId: null, viewer: "operator" };
  else {
    assertActiveGrant(raw, viewer);
    scope = knowledgeScopeForGrant(raw, viewer);
    if (scope.teamId !== row.target_team_id) requester(raw, row, viewer);
  }
  const visibility = visibleToScope(scope);
  const deliverables = raw.prepare(`SELECT v.artifact_id AS artifactId,v.version,v.title,v.status FROM artifact_versions v
    JOIN attempts a ON a.project_id = v.project_id AND a.id = v.produced_by_attempt_id
    WHERE a.project_id = ? AND a.task_id = ? AND ${visibility.sql} ORDER BY v.created_at DESC,v.rowid DESC`)
    .all(viewer.projectId, row.task_id, ...visibility.params) as { artifactId: string; version: number; title: string; status: string }[];
  const thread = raw.prepare(`SELECT seq,author,text,at FROM (SELECT seq,author,text,at FROM ctr_messages
    WHERE project_id = ? AND task_id = ? ORDER BY seq DESC LIMIT 200) ORDER BY seq`)
    .all(viewer.projectId, row.task_id) as { seq: number; author: string; text: string; at: string }[];
  const followers = raw.prepare("SELECT COUNT(*) AS n FROM ctr_followers WHERE project_id = ? AND task_id = ?")
    .get(viewer.projectId, row.task_id) as { n: number };
  return { requestId: row.task_id, code: row.code, kind: row.request_kind, subject: requestText(row.title), state: row.state,
    triageState: row.triage_state, rounds: row.rounds, hop: row.hop, thread: thread.map((message) => ({ ...message, text: requestText(message.text) })),
    deliverables: deliverables.map((item) => ({ ...item, title: requestText(item.title) })), followers: followers.n };
}

export function listRequests(raw: Database, projectId: string, options: { state?: string; team?: string; limit?: number } = {}) {
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? 100) || 100));
  return (raw.prepare(`SELECT t.id AS taskId,t.code,t.request_kind AS kind,t.title AS subject,t.state AS taskState,
    m.triage_state AS triageState,team.name AS targetTeamName,t.hop,m.rounds,r.code AS requesterCode,
    (SELECT at FROM ctr_messages WHERE project_id = t.project_id AND task_id = t.id AND seq = 1) AS createdAt
    FROM ctr_meta m JOIN tasks t ON t.project_id = m.project_id AND t.id = m.task_id
    JOIN teams team ON team.id = m.target_team_id JOIN tasks r ON r.project_id = t.project_id AND r.id = t.requester_task_id
    WHERE m.project_id = ? AND (? IS NULL OR m.triage_state = ? OR t.state = ?) AND (? IS NULL OR m.target_team_id = ?)
    ORDER BY createdAt DESC,m.rowid DESC LIMIT ?`)
    .all(projectId, options.state ?? null, options.state ?? null, options.state ?? null, options.team ?? null, options.team ?? null, limit) as {
      taskId: string; code: string; kind: string; subject: string; taskState: string; triageState: string; targetTeamName: string;
      hop: number; rounds: number; requesterCode: string; createdAt: string;
    }[]).map((item) => ({ ...item, subject: requestText(item.subject), targetTeamName: requestText(item.targetTeamName) }));
}

