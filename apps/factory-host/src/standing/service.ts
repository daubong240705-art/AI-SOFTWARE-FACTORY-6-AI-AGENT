import type { Database } from "better-sqlite3";
import { allows, type StandingActionKind, type StandingScope } from "@factory/contracts";
import type { EventHub } from "../events/hub.js";
import type { Clock } from "../ids.js";
import { autonomyLevel } from "../policy/autonomy.js";
import { dayKey } from "../policy/budget.js";
import { createNotification } from "../notify/service.js";

export interface StandingRow {
  project_id: string; id: string; revision: number; action_kind: StandingActionKind;
  scope_kind: StandingScope["kind"]; scope_ref: string; limit_per_day: number; max_tokens_per_use: number | null;
  state: "active" | "revoked"; created_at: string; expires_at: string; revoked_at: string | null;
}
export interface StandingDeps { raw: Database; hub: EventHub; clock: Clock; utcOffsetMinutes?: number }
export type StandingResult = { allowed: true; standingId: string }
  | { allowed: false; reason: "autonomy" | "none" | "expired" | "limit" | "tokens" };
export interface StandingUse {
  projectId: string; actionKind: StandingActionKind; teamId?: string; tokens?: number;
  now: Date; useId: string; utcOffsetMinutes?: number;
}
export const getStandingApproval = (raw: Database, projectId: string, id: string): StandingRow | undefined =>
  raw.prepare("SELECT * FROM standing_approvals WHERE project_id=? AND id=?").get(projectId, id) as StandingRow | undefined;

// Agent-provided text may contain labelled credentials as well as the token/path forms masked by createNotification.
const cleanText = (text: string): string => text
  .replace(/\bauthorization\s*[:=]\s*(?:[A-Za-z]+\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "[redacted]")
  .replace(/\b(?:token|api[_-]?key|password|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "[redacted]")
  .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[redacted]");

/** Standalone calls acquire a write lock before reading. Callers composing effects use a hub IMMEDIATE transaction. */
export function useStandingApproval(raw: Database, input: StandingUse): StandingResult {
  return raw.transaction((): StandingResult => {
    if (!allows(autonomyLevel(raw, input.projectId, "project", input.projectId).level, "external-action"))
      return { allowed: false, reason: "autonomy" };
    const rows = raw.prepare(`SELECT * FROM standing_approvals WHERE project_id=? AND action_kind=? AND state='active'
      AND ((scope_kind='project' AND scope_ref=?) OR (scope_kind='team' AND scope_ref=?))
      ORDER BY expires_at,id`).all(input.projectId, input.actionKind, input.projectId, input.teamId ?? null) as StandingRow[];
    if (!rows.length) return { allowed: false, reason: "none" };
    const current = rows.filter((row) => Date.parse(row.expires_at) > input.now.getTime());
    if (!current.length) return { allowed: false, reason: "expired" };
    const prior = raw.prepare("SELECT standing_id FROM standing_approval_uses WHERE project_id=? AND id=?")
      .get(input.projectId, input.useId) as { standing_id: string } | undefined;
    const tokenFits = (row: StandingRow): boolean => (input.tokens === undefined
      || (Number.isSafeInteger(input.tokens) && input.tokens >= 0))
      && (row.max_tokens_per_use === null || (input.tokens ?? 0) <= row.max_tokens_per_use);
    // A retry cannot consume another allowance, or reauthorize a revoked/expired or differently scoped approval.
    if (prior) {
      const row = current.find((candidate) => candidate.id === prior.standing_id);
      return row ? tokenFits(row) ? { allowed: true, standingId: row.id } : { allowed: false, reason: "tokens" }
        : { allowed: false, reason: "none" };
    }
    const day = dayKey(input.now, input.utcOffsetMinutes ?? 420);
    const available = current.filter((row) => {
      const { n } = raw.prepare("SELECT count(*) AS n FROM standing_approval_uses WHERE project_id=? AND standing_id=? AND local_day=?")
        .get(input.projectId, row.id, day) as { n: number };
      return n < row.limit_per_day;
    });
    if (!available.length) return { allowed: false, reason: "limit" };
    const selected = available.find(tokenFits);
    if (!selected) return { allowed: false, reason: "tokens" };
    raw.prepare("INSERT INTO standing_approval_uses (project_id,id,standing_id,used_at,local_day,tokens) VALUES (?,?,?,?,?,?)")
      .run(input.projectId, input.useId, selected.id, input.now.toISOString(), day, input.tokens ?? null);
    return { allowed: true, standingId: selected.id };
  }).immediate();
}

export function sendInternalNotification(deps: Pick<StandingDeps, "raw" | "hub" | "utcOffsetMinutes">, input: {
  projectId: string; teamId?: string; title: string; body: string; now: Date; id: string;
}): StandingResult {
  return deps.hub.transaction(() => {
    const result = useStandingApproval(deps.raw, { projectId: input.projectId, actionKind: "notify.send-internal",
      ...(input.teamId === undefined ? {} : { teamId: input.teamId }), now: input.now, useId: input.id,
      ...(deps.utcOffsetMinutes === undefined ? {} : { utcOffsetMinutes: deps.utcOffsetMinutes }) });
    if (!result.allowed) return result;
    if (createNotification(deps.raw, { ...input, title: cleanText(input.title), body: cleanText(input.body),
      dedupKey: input.id, category: "important", urgency: "normal",
      entity: { kind: "standing-approval", id: result.standingId } }).created)
      deps.hub.append({ projectId: input.projectId, causationId: input.id,
        payload: { type: "entity.changed", entity: { kind: "notification", id: input.id, revision: 1 } } });
    return result;
  });
}

export function listStandingApprovals(raw: Database, projectId: string, now: Date, utcOffsetMinutes = 420) {
  const rows = raw.prepare(`SELECT s.*, (SELECT count(*) FROM standing_approval_uses u
    WHERE u.project_id=s.project_id AND u.standing_id=s.id AND u.local_day=?) AS used_today
    FROM standing_approvals s WHERE s.project_id=? ORDER BY s.created_at DESC,s.rowid DESC LIMIT 100`)
    .all(dayKey(now, utcOffsetMinutes), projectId) as (StandingRow & { used_today: number })[];
  return { items: rows.map((row) => ({ id: row.id, revision: row.revision, actionKind: row.action_kind,
    scope: { kind: row.scope_kind, ref: row.scope_ref }, limitPerDay: row.limit_per_day, maxTokensPerUse: row.max_tokens_per_use,
    state: row.state, createdAt: row.created_at, expiresAt: row.expires_at, revokedAt: row.revoked_at,
    usedToday: row.used_today, remainingToday: Math.max(0, row.limit_per_day - row.used_today) })),
  level: autonomyLevel(raw, projectId, "project", projectId) };
}
