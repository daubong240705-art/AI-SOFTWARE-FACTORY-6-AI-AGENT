import type { Database } from "better-sqlite3";
import type { EntityRef, Task, TaskState } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import { advanceTasks } from "./advance.js";
import { listAttempts, liveAttemptOfTask } from "./attempts.js";
import type { Dispatcher } from "./dispatcher.js";
import { moveTask } from "./tasks.js";
import { enqueueIntegration } from "../integration/service.js";

const taskEffect = (task: Task): EntityRef => ({ kind: "task", id: task.id, revision: task.revision });

/** Shared application for manual transitions and review decisions; caller owns the transaction. */
export function moveTaskAndAdvance(raw: Database, task: Task, to: TaskState, deps: { dispatcher: Dispatcher; integrationAt?: string }): EntityRef[] {
  const projectId = task.projectId;
  if (to === "active") {
    if (task.holds.some((hold) => hold.kind === "decision" || hold.kind === "cross-team"))
      throw new CommandError("conflict", "task is waiting", "refresh");
    if (liveAttemptOfTask(raw, projectId, task.id))
      throw new CommandError("conflict", "task has a live attempt", "refresh");
    const seatId = task.ownerSeatId ?? listAttempts(raw, projectId, task.id).at(-1)?.seatId;
    if (!seatId) throw new CommandError("validation", "no-seat", "correct-input");
    if (task.ownerSeatId === null) raw.prepare("UPDATE tasks SET owner_seat_id = ?, revision = revision + 1 WHERE project_id = ? AND id = ?")
      .run(seatId, projectId, task.id);
    const active = moveTask(raw, projectId, task.id, "active");
    const attempt = deps.dispatcher.enqueue({ projectId, taskId: task.id, seatId });
    return [taskEffect(active), { kind: "attempt", id: attempt.id, revision: attempt.revision }];
  }
  const effects = new Map<string, EntityRef>();
  effects.set(task.id, taskEffect(moveTask(raw, projectId, task.id, to)));
  if (to === "done") enqueueIntegration(raw, { projectId, taskId: task.id, now: deps.integrationAt ?? new Date().toISOString() });
  if (to === "accepted" || to === "done") {
    for (const next of advanceTasks(raw, projectId, deps)) {
      effects.set(next.id, taskEffect(next));
      if (next.state === "active") {
        const attempt = listAttempts(raw, projectId, next.id).at(-1)!;
        effects.set(attempt.id, { kind: "attempt", id: attempt.id, revision: attempt.revision });
      }
    }
  }
  return [...effects.values()];
}
