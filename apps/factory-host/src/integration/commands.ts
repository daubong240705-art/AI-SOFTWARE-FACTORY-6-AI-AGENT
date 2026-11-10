import { CommandError } from "../commands/errors.js";
import type { HandlerContext, HandlerMap, HandlerResult } from "../commands/pipeline.js";
import type { IntegrationRow } from "./service.js";

export const INTEGRATION_COMMANDS = ["integration.retry", "integration.skip"] as const;
function decide(ctx: HandlerContext, projectId: string, taskId: string, to: "pending" | "skipped"): HandlerResult {
  if (ctx.actorId !== "operator") throw new CommandError("forbidden", "Operator decision required", "correct-input");
  const task = ctx.raw.prepare("SELECT revision FROM tasks WHERE project_id=? AND id=?").get(projectId, taskId) as { revision: number } | undefined;
  if (!task) throw new CommandError("not-found", "task not found", "correct-input");
  const row = ctx.raw.prepare("SELECT * FROM integration_merges WHERE project_id=? AND task_id=?").get(projectId, taskId) as IntegrationRow | undefined;
  if (row?.state === to) return { effects: [] };
  if (row?.state !== "conflict") throw new CommandError("conflict", "task has no integration conflict", "refresh");
  ctx.raw.prepare(`UPDATE integration_merges SET state=?,attempts=?,error_kind=NULL,resolved_at=?
    WHERE project_id=? AND task_id=?`).run(to, to === "pending" ? 0 : row.attempts,
    to === "skipped" ? ctx.clock().toISOString() : null, projectId, taskId);
  ctx.raw.prepare("UPDATE tasks SET revision=revision+1 WHERE project_id=? AND id=?").run(projectId, taskId);
  return { effects: [{ kind: "task", id: taskId, revision: task.revision + 1 }] };
}
export function createIntegrationHandlers(): Partial<HandlerMap> {
  return {
    "integration.retry": (ctx, { projectId, payload }) => decide(ctx, projectId, payload.taskId, "pending"),
    "integration.skip": (ctx, { projectId, payload }) => decide(ctx, projectId, payload.taskId, "skipped"),
  };
}
