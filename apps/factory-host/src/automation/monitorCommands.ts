import { monitorInputSchema, type MonitorInput } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerContext, HandlerMap } from "../commands/pipeline.js";
import { getMonitor, monitorInput, type MonitorRow } from "./monitors.js";

export const MONITOR_COMMANDS = ["monitors.create", "monitors.update", "monitors.pause", "monitors.resume", "monitors.delete"] as const;
function project(ctx: HandlerContext, projectId: string): void {
  if (!ctx.raw.prepare("SELECT id FROM projects WHERE id=?").get(projectId)) throw new CommandError("not-found","project not found","correct-input");
}
function requireMonitor(ctx: HandlerContext, projectId: string, id: string, revision: number): MonitorRow {
  project(ctx,projectId);
  const row = getMonitor(ctx.raw,projectId,id);
  if (!row) throw new CommandError("not-found","monitor not found","correct-input");
  if (row.revision !== revision) throw new CommandError("conflict","revision changed","refresh",{ currentRevision: row.revision });
  return row;
}
function validate(value: unknown): MonitorInput {
  const parsed = monitorInputSchema.safeParse(value);
  if (!parsed.success) throw new CommandError("validation","invalid monitor input","correct-input");
  return parsed.data;
}
function unique(ctx: HandlerContext, projectId: string, id: string, name: string): void {
  if (ctx.raw.prepare("SELECT id FROM monitors WHERE project_id=? AND name=? AND id<>?").get(projectId,name,id))
    throw new CommandError("conflict","monitor name already exists","correct-input");
}
const effect = (id: string, revision: number) => ({ effects: [{ kind: "monitor" as const,id,revision }] });
function persist(ctx: HandlerContext, row: MonitorRow, input: MonitorInput) {
  unique(ctx,row.project_id,row.id,input.name);
  ctx.raw.prepare(`UPDATE monitors SET revision=revision+1,name=?,params_json=?,comparator=?,threshold=?,trip_after=?,recover_after=?,
    interval_seconds=?,state=?,next_check_at=?,breaches=0,recoveries=0 WHERE project_id=? AND id=?`)
    .run(input.name,JSON.stringify(input.params),input.comparator,input.threshold,input.tripAfter,input.recoverAfter,input.intervalSeconds,
      input.enabled ? "active" : "paused",input.enabled ? ctx.clock().toISOString() : null,row.project_id,row.id);
  return effect(row.id,row.revision+1);
}
export function createMonitorHandlers(): Partial<HandlerMap> {
  return {
    "monitors.create": (ctx,{ projectId,payload }) => {
      project(ctx,projectId);
      if (getMonitor(ctx.raw,projectId,payload.monitorId)) throw new CommandError("conflict","monitor id already exists","correct-input");
      const { monitorId,...candidate } = payload, input = validate(candidate);
      unique(ctx,projectId,monitorId,input.name);
      const count = ctx.raw.prepare("SELECT count(*) AS n FROM monitors WHERE project_id=?").get(projectId) as { n: number };
      if (count.n >= 30) throw new CommandError("resource-exhausted","monitor limit reached","correct-input");
      const at = ctx.clock().toISOString();
      ctx.raw.prepare(`INSERT INTO monitors (project_id,id,revision,name,kind,params_json,comparator,threshold,trip_after,recover_after,
        interval_seconds,state,status,next_check_at,created_at) VALUES (?,?,1,?,?,?,?,?,?,?,?,?,'unknown',?,?)`)
        .run(projectId,monitorId,input.name,input.kind,JSON.stringify(input.params),input.comparator,input.threshold,input.tripAfter,
          input.recoverAfter,input.intervalSeconds,input.enabled ? "active" : "paused",input.enabled ? at : null,at);
      return effect(monitorId,1);
    },
    "monitors.update": (ctx,{ projectId,payload }) => {
      const row = requireMonitor(ctx,projectId,payload.monitorId,payload.expectedRevision);
      return persist(ctx,row,validate({ ...monitorInput(row),...payload.patch }));
    },
    "monitors.pause": (ctx,{ projectId,payload }) => {
      const row = requireMonitor(ctx,projectId,payload.monitorId,payload.expectedRevision);
      return persist(ctx,row,{ ...monitorInput(row),enabled: false });
    },
    "monitors.resume": (ctx,{ projectId,payload }) => {
      const row = requireMonitor(ctx,projectId,payload.monitorId,payload.expectedRevision);
      return persist(ctx,row,{ ...monitorInput(row),enabled: true });
    },
    "monitors.delete": (ctx,{ projectId,payload }) => {
      const row = requireMonitor(ctx,projectId,payload.monitorId,payload.expectedRevision);
      ctx.raw.prepare("DELETE FROM monitor_events WHERE project_id=? AND monitor_id=?").run(projectId,row.id);
      ctx.raw.prepare("DELETE FROM monitors WHERE project_id=? AND id=?").run(projectId,row.id);
      return effect(row.id,row.revision+1);
    },
  };
}
