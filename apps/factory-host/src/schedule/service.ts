import type { Database } from "better-sqlite3";
import { Cron } from "croner";
import { scheduleInputSchema, workflowDefinitionSchema, type ScheduleInput, type ScheduleAction } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import { registryPack, type RegistryPack } from "../org/registry.js";
import { validateWorkflowDefinition } from "../workflow/validate.js";

export interface ScheduleRow {
  project_id: string; id: string; revision: number; name: string; kind: ScheduleInput["kind"]; expr: string;
  timezone: string; action_json: string; missed_policy: ScheduleInput["missedPolicy"]; catch_up_limit: number;
  concurrency: ScheduleInput["concurrency"]; parallel_limit: number; state: "active" | "paused" | "quarantined";
  consecutive_failures: number; next_run_at: string | null; last_run_at: string | null; last_status: string | null; created_at: string;
}
export type ScheduleTime = Pick<ScheduleRow, "kind" | "expr" | "timezone" | "created_at">;
export function nextRunAfter(schedule: ScheduleTime, from: Date): Date | null {
  if (schedule.kind === "cron") return new Cron(schedule.expr, { timezone: schedule.timezone }).nextRun(from);
  if (schedule.kind === "once") {
    const at = new Date(schedule.expr);
    return at.getTime() > from.getTime() ? at : null;
  }
  const anchor = Date.parse(schedule.created_at), interval = Number(schedule.expr) * 1000;
  return new Date(anchor + Math.max(1, Math.floor((from.getTime() - anchor) / interval) + 1) * interval);
}
export function resolveScheduleAction(packs: readonly RegistryPack[], action: ScheduleAction) {
  const matches = packs.filter((entry) => action.packKey === undefined || entry.key === action.packKey)
    .flatMap((entry) => registryPack(entry).files.workflows.filter((file) => file.definition.key === action.definitionKey)
      .map((file) => file.definition));
  if (matches.length !== 1) throw new CommandError("validation", matches.length ? "ambiguous workflow definition" : "workflow definition not found", "correct-input");
  const parsed = workflowDefinitionSchema.safeParse(matches[0]);
  if (!parsed.success || !validateWorkflowDefinition(parsed.data).ok)
    throw new CommandError("validation", "invalid workflow definition", "correct-input");
  const definition = parsed.data, overrides = action.params ?? {};
  if (Object.keys(overrides).some((name) => !definition.parameters.some((p) => p.name === name)))
    throw new CommandError("validation", "invalid workflow parameters", "correct-input");
  for (const p of definition.parameters) {
    const value = Object.hasOwn(overrides, p.name) ? overrides[p.name] : p.default;
    const type = p.type === "bool" ? "boolean" : p.type === "enum" ? "string" : p.type;
    if (typeof value !== type || (p.type === "enum" && !p.values.includes(String(value))))
      throw new CommandError("validation", "invalid workflow parameters", "correct-input");
  }
  return definition;
}
export function validateSchedule(input: unknown, packs: readonly RegistryPack[], now: Date, requireFuture = true): ScheduleInput {
  const parsed = scheduleInputSchema.safeParse(input);
  if (!parsed.success) throw new CommandError("validation", "invalid schedule input", "correct-input");
  const value = parsed.data;
  try {
    if (/^[+-]/.test(value.timezone)) throw new Error();
    new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format(now);
  } catch { throw new CommandError("validation", "invalid schedule timezone", "correct-input"); }
  if (value.kind === "cron") {
    let runs: Date[];
    try { runs = new Cron(value.expr, { timezone: value.timezone }).nextRuns(2, now); }
    catch { throw new CommandError("validation", "invalid cron expression", "correct-input"); }
    if (!runs.length) throw new CommandError("validation", "cron has no future occurrence", "correct-input");
    if (runs[0] && runs[1] && runs[1].getTime() - runs[0].getTime() < 60_000)
      throw new CommandError("validation", "cron interval must be at least 60 seconds", "correct-input");
  }
  if (value.kind === "once" && requireFuture && Date.parse(value.expr) <= now.getTime())
    throw new CommandError("validation", "once must be in the future", "correct-input");
  resolveScheduleAction(packs, value.action);
  return value;
}
export function getSchedule(raw: Database, projectId: string, id: string): ScheduleRow | undefined {
  return raw.prepare("SELECT * FROM schedules WHERE project_id = ? AND id = ?").get(projectId, id) as ScheduleRow | undefined;
}
export function scheduleInput(row: ScheduleRow): ScheduleInput {
  return { name: row.name, kind: row.kind, expr: row.expr, timezone: row.timezone,
    action: JSON.parse(row.action_json) as ScheduleAction, missedPolicy: row.missed_policy, catchUpLimit: row.catch_up_limit,
    concurrency: row.concurrency, parallelLimit: row.parallel_limit, enabled: row.state === "active" };
}
export function listSchedules(raw: Database, projectId: string, now: Date) {
  const rows = raw.prepare("SELECT * FROM schedules WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100").all(projectId) as ScheduleRow[];
  return rows.map((row) => {
    const action = JSON.parse(row.action_json) as ScheduleAction, upcoming: string[] = [];
    let from = now;
    if (row.state === "active") for (let i = 0; i < 3; i++) {
      const next = nextRunAfter(row, from); if (!next) break;
      upcoming.push(next.toISOString()); from = next;
    }
    return { id: row.id, revision: row.revision, name: row.name, kind: row.kind, expr: row.expr, timezone: row.timezone,
      state: row.state, enabled: row.state === "active", nextRunAt: row.next_run_at, lastRunAt: row.last_run_at,
      lastStatus: row.last_status, consecutiveFailures: row.consecutive_failures, missedPolicy: row.missed_policy,
      concurrency: row.concurrency, action: { definitionKey: action.definitionKey, packKey: action.packKey,
        autoStart: action.autoStart, paramKeys: Object.keys(action.params ?? {}).sort() }, upcoming };
  });
}
export function listOccurrences(raw: Database, projectId: string, id: string) {
  return raw.prepare(`SELECT scheduled_for AS scheduledFor, trigger, status, reason, instance_id AS instanceId, fired_at AS firedAt
    FROM schedule_occurrences WHERE project_id = ? AND schedule_id = ? ORDER BY fired_at DESC, scheduled_for DESC, trigger DESC LIMIT 50`).all(projectId, id);
}
