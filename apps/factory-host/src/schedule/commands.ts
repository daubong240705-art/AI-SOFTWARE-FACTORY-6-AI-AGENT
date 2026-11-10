import type { ScheduleInput } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerContext, HandlerMap } from "../commands/pipeline.js";
import type { RegistryPack } from "../org/registry.js";
import { fireOccurrence, type SchedulerDeps } from "./scheduler.js";
import { getSchedule, nextRunAfter, scheduleInput, validateSchedule, type ScheduleRow } from "./service.js";

export const SCHEDULE_COMMANDS = ["schedules.create", "schedules.update", "schedules.pause", "schedules.resume", "schedules.delete", "schedules.run-now"] as const;
function project(ctx: HandlerContext, projectId: string): void {
  if (!ctx.raw.prepare("SELECT id FROM projects WHERE id=?").get(projectId))
    throw new CommandError("not-found", "project not found", "correct-input");
}
function requireSchedule(ctx: HandlerContext, projectId: string, id: string, revision: number): ScheduleRow {
  project(ctx, projectId);
  const row = getSchedule(ctx.raw, projectId, id);
  if (!row) throw new CommandError("not-found", "schedule not found", "correct-input");
  if (row.revision !== revision) throw new CommandError("conflict", "revision changed", "refresh", { currentRevision: row.revision });
  return row;
}
function unique(ctx: HandlerContext, projectId: string, id: string, name: string): void {
  if (ctx.raw.prepare("SELECT id FROM schedules WHERE project_id=? AND name=? AND id<>?").get(projectId, name, id))
    throw new CommandError("conflict", "schedule name already exists", "correct-input");
}
const effect = (id: string, revision: number) => ({ effects: [{ kind: "schedule" as const, id, revision }] });
function persist(ctx: HandlerContext, row: ScheduleRow, input: ScheduleInput, state: ScheduleRow["state"], failures = row.consecutive_failures) {
  const next = state === "active" ? nextRunAfter({ ...row, expr: input.expr, timezone: input.timezone }, ctx.clock()) : null;
  ctx.raw.prepare(`UPDATE schedules SET revision=revision+1,name=?,expr=?,timezone=?,action_json=?,missed_policy=?,catch_up_limit=?,
    concurrency=?,parallel_limit=?,state=?,consecutive_failures=?,next_run_at=? WHERE project_id=? AND id=?`)
    .run(input.name, input.expr, input.timezone, JSON.stringify(input.action), input.missedPolicy, input.catchUpLimit,
      input.concurrency, input.parallelLimit ?? 2, state, failures, next?.toISOString() ?? null, row.project_id, row.id);
  return effect(row.id, row.revision + 1);
}
export function createScheduleHandlers(deps: { packs: readonly RegistryPack[]; pipeline: SchedulerDeps["pipeline"] }): Partial<HandlerMap> {
  return {
    "schedules.create": (ctx, { projectId, payload }) => {
      project(ctx, projectId);
      if (getSchedule(ctx.raw, projectId, payload.scheduleId)) throw new CommandError("conflict", "schedule id already exists", "correct-input");
      const { scheduleId, ...candidate } = payload;
      const input = validateSchedule(candidate, deps.packs, ctx.clock());
      unique(ctx, projectId, scheduleId, input.name);
      const count = ctx.raw.prepare("SELECT count(*) AS n FROM schedules WHERE project_id=?").get(projectId) as { n: number };
      if (count.n >= 50) throw new CommandError("resource-exhausted", "schedule limit reached", "correct-input");
      const createdAt = ctx.clock().toISOString();
      const next = input.enabled ? nextRunAfter({ ...input, created_at: createdAt }, ctx.clock()) : null;
      ctx.raw.prepare(`INSERT INTO schedules (project_id,id,revision,name,kind,expr,timezone,action_json,missed_policy,
        catch_up_limit,concurrency,parallel_limit,state,next_run_at,created_at) VALUES (?,?,1,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(projectId, scheduleId, input.name, input.kind, input.expr, input.timezone, JSON.stringify(input.action),
          input.missedPolicy, input.catchUpLimit, input.concurrency, input.parallelLimit ?? 2,
          input.enabled ? "active" : "paused", next?.toISOString() ?? null, createdAt);
      return effect(scheduleId, 1);
    },
    "schedules.update": (ctx, { projectId, payload }) => {
      const row = requireSchedule(ctx, projectId, payload.scheduleId, payload.expectedRevision);
      const input = validateSchedule({ ...scheduleInput(row), ...payload.patch }, deps.packs, ctx.clock(), payload.patch.expr !== undefined);
      unique(ctx, projectId, row.id, input.name);
      // Updating configuration cannot bypass the circuit breaker; resume is explicit.
      const state = row.state === "quarantined" ? "quarantined" : input.enabled ? "active" : "paused";
      return persist(ctx, row, input, state);
    },
    "schedules.pause": (ctx, { projectId, payload }) => {
      const row = requireSchedule(ctx, projectId, payload.scheduleId, payload.expectedRevision);
      return persist(ctx, row, scheduleInput(row), row.state === "quarantined" ? "quarantined" : "paused");
    },
    "schedules.resume": (ctx, { projectId, payload }) => {
      const row = requireSchedule(ctx, projectId, payload.scheduleId, payload.expectedRevision);
      const input = validateSchedule(scheduleInput(row), deps.packs, ctx.clock(), false);
      return persist(ctx, row, input, "active", 0);
    },
    "schedules.delete": (ctx, { projectId, payload }) => {
      const row = requireSchedule(ctx, projectId, payload.scheduleId, payload.expectedRevision);
      ctx.raw.prepare("DELETE FROM schedule_occurrences WHERE project_id=? AND schedule_id=?").run(projectId, row.id);
      ctx.raw.prepare("DELETE FROM schedules WHERE project_id=? AND id=?").run(projectId, row.id);
      return effect(row.id, row.revision + 1);
    },
    "schedules.run-now": (ctx, { projectId, payload }) => {
      const row = requireSchedule(ctx, projectId, payload.scheduleId, payload.expectedRevision), now = ctx.clock();
      if (row.last_run_at && now.getTime() < Date.parse(row.last_run_at)) return { effects: [] };
      const changed = fireOccurrence({ raw: ctx.raw, hub: ctx.hub, ...deps }, row, now.toISOString(), "manual", now);
      if (!changed) return { effects: [] };
      const current = getSchedule(ctx.raw, projectId, row.id)!;
      const state = current.state === "active" && row.kind === "once" ? "paused" : current.state;
      ctx.raw.prepare(`UPDATE schedules SET revision=revision+1,state=?,next_run_at=?,last_status=? WHERE project_id=? AND id=?`)
        .run(state, state === "active" ? row.next_run_at : null, row.kind === "once" && row.state === "active" && state === "paused" ? "done" : current.last_status, projectId, row.id);
      return effect(row.id, row.revision + 1);
    },
  };
}
