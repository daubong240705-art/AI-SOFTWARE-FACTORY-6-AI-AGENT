import type { Database } from "better-sqlite3";
import { canTransitionAttempt, isLiveAttempt, LIVE_ATTEMPT_STATES, TERMINAL_ATTEMPT_STATES, type AttemptState } from "@factory/contracts";
import type { AttemptRecord, AttemptRef, AttemptRow, ReasoningEffort, RuntimeKind } from "./types.js";

export class AttemptError extends Error {
  constructor(readonly code: string) { super(code); this.name = "AttemptError"; }
}

export const PLACED_ATTEMPT_STATES: ReadonlySet<AttemptState> = new Set([
  "leased", "preparing", "running", "waiting-input", "stopping", "submitting",
]);
/** Uncertain executions may still be running and must retain capacity. */
export const CAPACITY_ATTEMPT_STATES: ReadonlySet<AttemptState> = new Set([
  ...PLACED_ATTEMPT_STATES, "lease-expired", "unknown", "reconciling",
]);
const selection = `SELECT a.*, s.seat_id FROM attempts AS a LEFT JOIN attempt_seats AS s
  ON s.project_id = a.project_id AND s.attempt_id = a.id`;
const fromRow = (row: AttemptRow): AttemptRecord => ({
  projectId: row.project_id, id: row.id, taskId: row.task_id, revision: row.revision, epoch: row.epoch,
  state: row.state, outcome: row.outcome, nodeId: row.node_id, seatId: row.seat_id,
  runtime: row.runtime, provider: row.provider, model: row.model, effort: row.effort,
  leaseId: row.lease_id, leaseExpiresAt: row.lease_expires_at, startedAt: row.started_at, endedAt: row.ended_at,
});

export function getAttempt(raw: Database, projectId: string, id: string): AttemptRecord | undefined {
  const row = raw.prepare(`${selection} WHERE a.project_id = ? AND a.id = ?`).get(projectId, id) as AttemptRow | undefined;
  return row === undefined ? undefined : fromRow(row);
}

export function listAttempts(raw: Database, projectId: string, taskId: string): AttemptRecord[] {
  return (raw.prepare(`${selection} WHERE a.project_id = ? AND a.task_id = ? ORDER BY a.epoch`)
    .all(projectId, taskId) as AttemptRow[]).map(fromRow);
}

export function liveAttemptOfTask(raw: Database, projectId: string, taskId: string): AttemptRecord | undefined {
  return listAttempts(raw, projectId, taskId).find((attempt) => isLiveAttempt(attempt.state));
}

export function listLiveAttempts(raw: Database): AttemptRecord[] {
  const states = [...LIVE_ATTEMPT_STATES];
  return (raw.prepare(`${selection} WHERE a.state IN (${states.map(() => "?").join(",")}) ORDER BY a.project_id, a.task_id, a.epoch`)
    .all(...states) as AttemptRow[]).map(fromRow);
}

export function nextEpoch(raw: Database, projectId: string, taskId: string): number {
  return (raw.prepare("SELECT COALESCE(MAX(epoch), 0) + 1 AS epoch FROM attempts WHERE project_id = ? AND task_id = ?")
    .get(projectId, taskId) as { epoch: number }).epoch;
}

export function createAttempt(raw: Database, input: {
  projectId: string; id: string; taskId: string; seatId: string; runtime: RuntimeKind;
  provider: string; model: string; effort: ReasoningEffort; now: string;
}): AttemptRecord {
  return raw.transaction(() => {
    const task = raw.prepare("SELECT state, engagement_id FROM tasks WHERE project_id = ? AND id = ?")
      .get(input.projectId, input.taskId) as { state: string; engagement_id: string | null } | undefined;
    if (task?.state !== "active") throw new AttemptError("task-not-active");
    if (!raw.prepare(`SELECT s.id FROM seats AS s JOIN engagements AS e ON e.team_id = s.team_id
      WHERE e.project_id = ? AND e.id = ? AND s.id = ?`).get(input.projectId, task.engagement_id, input.seatId))
      throw new AttemptError("seat-not-in-team");
    if (liveAttemptOfTask(raw, input.projectId, input.taskId)) throw new AttemptError("live-attempt-exists");
    try {
      raw.prepare(`INSERT INTO attempts (project_id, id, task_id, revision, epoch, state, outcome, runtime, provider, model, effort)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.projectId, input.id, input.taskId, 1, nextEpoch(raw, input.projectId, input.taskId), "queued", "known",
          input.runtime, input.provider, input.model, input.effort);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed: attempts.project_id, attempts.task_id")
        && !error.message.includes("attempts.epoch")) throw new AttemptError("live-attempt-exists");
      throw error;
    }
    raw.prepare("INSERT INTO attempt_seats (project_id, attempt_id, seat_id) VALUES (?, ?, ?)")
      .run(input.projectId, input.id, input.seatId);
    return getAttempt(raw, input.projectId, input.id) as AttemptRecord;
  }).immediate();
}

type TransitionPatch = {
  nodeId?: string | null; leaseId?: string | null; leaseExpiresAt?: string | null; startedAt?: string | null;
  endedAt?: string | null; outcome?: "known" | "unknown"; expectedState?: AttemptState; expectedLeaseId?: string | null; now: string;
};

export function transitionAttempt(raw: Database, ref: { projectId: string; id: string }, to: AttemptState, patch: TransitionPatch): AttemptRecord {
  return transition(raw, ref, to, patch);
}

function transition(raw: Database, ref: { projectId: string; id: string }, to: AttemptState,
  patch: TransitionPatch,
): AttemptRecord {
  return raw.transaction(() => {
    const attempt = getAttempt(raw, ref.projectId, ref.id);
    if (!attempt) throw new AttemptError("not-found");
    if (patch.expectedState !== undefined && patch.expectedState !== attempt.state) throw new AttemptError("state-changed");
    if (patch.expectedLeaseId !== undefined && patch.expectedLeaseId !== attempt.leaseId) throw new AttemptError("lease-changed");
    if (!canTransitionAttempt(attempt.state, to)) throw new AttemptError("transition-not-allowed");
    const placed = PLACED_ATTEMPT_STATES.has(to);
    const nodeId = to === "queued" ? null : patch.nodeId === undefined ? attempt.nodeId : patch.nodeId;
    const leaseId = placed ? patch.leaseId === undefined ? attempt.leaseId : patch.leaseId : null;
    const leaseExpiresAt = placed ? patch.leaseExpiresAt === undefined ? attempt.leaseExpiresAt : patch.leaseExpiresAt : null;
    if (placed && (nodeId === null || leaseId === null || leaseExpiresAt === null)) throw new AttemptError("placement-required");
    const outcome = patch.outcome ?? (to === "unknown" ? "unknown"
      : to === "reconciling" || to === "lease-expired" ? attempt.outcome : "known");
    if ((to === "unknown" && outcome !== "unknown")
      || (!["unknown", "reconciling", "lease-expired"].includes(to) && outcome !== "known")) throw new AttemptError("invalid-outcome");
    const endedAt = TERMINAL_ATTEMPT_STATES.has(to) ? patch.endedAt ?? patch.now : null;
    const changed = raw.prepare(`UPDATE attempts SET state = ?, revision = revision + 1, node_id = ?, lease_id = ?,
      lease_expires_at = ?, started_at = ?, ended_at = ?, outcome = ?
      WHERE project_id = ? AND id = ? AND state = ? AND lease_id IS ?`)
      .run(to, nodeId, leaseId, leaseExpiresAt, patch.startedAt === undefined ? attempt.startedAt : patch.startedAt,
        endedAt, outcome, ref.projectId, ref.id, attempt.state, attempt.leaseId);
    if (changed.changes !== 1) throw new AttemptError("state-changed");
    return getAttempt(raw, ref.projectId, ref.id) as AttemptRecord;
  }).immediate();
}

export function renewLease(raw: Database, ref: { projectId: string; id: string }, leaseId: string, expiresAt: string, now: string): AttemptRecord {
  return raw.transaction(() => {
    const attempt = getAttempt(raw, ref.projectId, ref.id);
    if (!attempt) throw new AttemptError("not-found");
    if (!PLACED_ATTEMPT_STATES.has(attempt.state)) throw new AttemptError("transition-not-allowed");
    if (attempt.leaseId !== leaseId) throw new AttemptError("lease-changed");
    if (!Number.isFinite(Date.parse(now)) || attempt.leaseExpiresAt === null || !(Date.parse(attempt.leaseExpiresAt) > Date.parse(now)))
      throw new AttemptError("lease-expired");
    if (!(Date.parse(expiresAt) > Date.parse(attempt.leaseExpiresAt))) throw new AttemptError("invalid-lease-expiry");
    raw.prepare("UPDATE attempts SET lease_expires_at = ?, revision = revision + 1 WHERE project_id = ? AND id = ? AND state = ? AND lease_id = ?")
      .run(expiresAt, ref.projectId, ref.id, attempt.state, leaseId);
    return getAttempt(raw, ref.projectId, ref.id) as AttemptRecord;
  }).immediate();
}

export type AttemptEventKind = "progress" | "output" | "evidence" | "question" | "usage" | "state";
export interface AttemptEvent { projectId: string; attemptId: string; seq: number; at: string; kind: AttemptEventKind; body: unknown }
const MAX_EVENT_BYTES = 64 * 1024;

function eventJson(body: unknown): string {
  const json = JSON.stringify(body);
  if (json === undefined) throw new AttemptError("invalid-event-body");
  if (Buffer.byteLength(json, "utf8") <= MAX_EVENT_BYTES) return json;
  // Keep valid JSON even when the cut falls inside an escape or a multi-byte character.
  const source = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const text = [source.message, source.summary, source.text, source.detail].find((value): value is string => typeof value === "string") ?? json;
  const field = ["message", "summary", "text", "detail"].find((key) => source[key] === text) ?? "text";
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(JSON.stringify({ [field]: text.slice(0, mid), truncated: true }), "utf8") <= MAX_EVENT_BYTES) low = mid;
    else high = mid - 1;
  }
  return JSON.stringify({ [field]: text.slice(0, low), truncated: true });
}

export function appendAttemptEvent(raw: Database, input: {
  projectId: string; attemptId: string; kind: AttemptEventKind; body: unknown; at: string;
}): number {
  const body = eventJson(input.body);
  return raw.transaction(() => {
    const { seq } = raw.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM attempt_events WHERE project_id = ? AND attempt_id = ?")
      .get(input.projectId, input.attemptId) as { seq: number };
    raw.prepare("INSERT INTO attempt_events (project_id, attempt_id, seq, at, kind, body_json) VALUES (?, ?, ?, ?, ?, ?)")
      .run(input.projectId, input.attemptId, seq, input.at, input.kind, body);
    return seq;
  }).immediate();
}

export function listAttemptEvents(raw: Database, projectId: string, attemptId: string,
  { afterSeq = 0, limit = 100 }: { afterSeq?: number; limit?: number } = {},
): AttemptEvent[] {
  const size = Number.isNaN(limit) ? 100 : Math.max(1, Math.min(500, Math.trunc(limit)));
  const rows = raw.prepare("SELECT seq, at, kind, body_json FROM attempt_events WHERE project_id = ? AND attempt_id = ? AND seq > ? ORDER BY seq LIMIT ?")
    .all(projectId, attemptId, afterSeq, size) as { seq: number; at: string; kind: AttemptEventKind; body_json: string }[];
  return rows.map((row) => ({ projectId, attemptId, seq: row.seq, at: row.at, kind: row.kind, body: JSON.parse(row.body_json) as unknown }));
}

export function isStaleCallback(attempt: AttemptRecord, ref: AttemptRef, nowMs: number): boolean {
  return !PLACED_ATTEMPT_STATES.has(attempt.state) || attempt.projectId !== ref.projectId || attempt.id !== ref.attemptId
    || attempt.epoch !== ref.epoch || attempt.leaseId !== ref.leaseId || !Number.isFinite(nowMs)
    || attempt.leaseExpiresAt === null || !(Date.parse(attempt.leaseExpiresAt) > nowMs);
}
