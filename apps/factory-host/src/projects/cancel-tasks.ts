import type { EntityRef } from "@factory/contracts";
import type { HandlerContext } from "../commands/pipeline.js";
import { moveTask } from "../dispatch/tasks.js";
import { withdrawPendingReviews } from "../approvals/service.js";
import { getTask } from "../work/service.js";

/** Caller owns the transaction and prevents workflow advancement during bulk cancellation. */
export function cancelProjectTasks(ctx: HandlerContext, projectId: string, taskIds?: readonly string[]): EntityRef[] {
  const rows = ctx.raw.prepare(`SELECT id FROM tasks WHERE project_id=?
    AND (? IS NULL OR id IN (SELECT value FROM json_each(?)))`)
    .all(projectId, taskIds === undefined ? null : 1, JSON.stringify(taskIds ?? [])) as { id: string }[];
  const effects: EntityRef[] = [];
  for (const row of rows) {
    // Cancelling a requester can already have cancelled its children through the request lifecycle.
    if (!["done", "cancelled", "declined", "superseded"].includes(getTask(ctx.raw, projectId, row.id)!.state)) {
      const task = moveTask(ctx.raw, projectId, row.id, "cancelled", { now: ctx.clock().toISOString() });
      effects.push({ kind: "task", id: task.id, revision: task.revision });
    }
    effects.push(...withdrawPendingReviews(ctx.raw, projectId, row.id, ctx.clock()));
  }
  return effects;
}
