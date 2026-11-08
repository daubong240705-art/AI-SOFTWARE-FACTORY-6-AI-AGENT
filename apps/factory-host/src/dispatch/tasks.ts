import type { Database } from "better-sqlite3";
import { canTransitionTask, taskSchema, type Task, type TaskState } from "@factory/contracts";
import { getTask } from "../work/service.js";
import type { AttemptRecord } from "./types.js";

export class TaskMoveError extends Error {
  constructor(readonly code: string) { super(code); this.name = "TaskMoveError"; }
}

export function moveTask(raw: Database, projectId: string, taskId: string, to: TaskState,
  { expectedRevision, expectedState, now }: { expectedRevision?: number; expectedState?: TaskState; now?: string } = {},
): Task {
  return raw.transaction(() => {
    const task = getTask(raw, projectId, taskId);
    if (!task) throw new TaskMoveError("not-found");
    if ((expectedRevision !== undefined && task.revision !== expectedRevision)
      || (expectedState !== undefined && task.state !== expectedState)) throw new TaskMoveError("task-changed");
    if (!canTransitionTask(task.state, to)) throw new TaskMoveError("transition-not-allowed");
    taskSchema.parse({ ...task, state: to, revision: task.revision + 1 });
    const changed = raw.prepare("UPDATE tasks SET state = ?, revision = revision + 1 WHERE project_id = ? AND id = ? AND state = ? AND revision = ?")
      .run(to, projectId, taskId, task.state, task.revision);
    if (changed.changes !== 1) throw new TaskMoveError("task-changed");
    if (task.origin.kind === "cross-team") {
      if (["done", "cancelled", "declined", "superseded"].includes(to))
        raw.prepare("UPDATE ctr_meta SET closed_at = ? WHERE project_id = ? AND task_id = ?").run(now ?? new Date().toISOString(), projectId, taskId);
      if (to === "in-review") raw.prepare("UPDATE ctr_meta SET delivered_at = ? WHERE project_id = ? AND task_id = ?")
        .run(now ?? new Date().toISOString(), projectId, taskId);
    }
    return getTask(raw, projectId, taskId) as Task;
  }).immediate();
}

export function applyAttemptOutcome(raw: Database, projectId: string, taskId: string,
  outcome: "succeeded" | "failed" | "stopped", now: string,
): Task | null {
  return raw.transaction(() => {
    const task = getTask(raw, projectId, taskId);
    if (task?.state !== "active") return null;
    return moveTask(raw, projectId, taskId, outcome === "succeeded" ? "in-review" : "failed",
      { expectedRevision: task.revision, expectedState: "active", now });
  }).immediate();
}

export const eventsForAttempt = (attempt: AttemptRecord) => ({
  type: "entity.changed" as const, entity: { kind: "attempt" as const, id: attempt.id, revision: attempt.revision },
});
export const eventsForTask = (task: Task) => ({
  type: "entity.changed" as const, entity: { kind: "task" as const, id: task.id, revision: task.revision },
});
