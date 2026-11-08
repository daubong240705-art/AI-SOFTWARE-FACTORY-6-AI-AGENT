import type { Database } from "better-sqlite3";
import type { Task } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import { getTask, listTasks } from "../work/service.js";
import type { Dispatcher } from "./dispatcher.js";
import { DispatchCommandError, engagementAvailable, pickSeat } from "./seats.js";
import { liveAttemptOfTask } from "./attempts.js";
import { moveTask } from "./tasks.js";

const dependenciesDone = (raw: Database, projectId: string, task: Task): boolean =>
  task.dependsOn.every((id) => getTask(raw, projectId, id)?.state === "done");

/** The caller owns the transaction. */
export function startTask(raw: Database, projectId: string, taskId: string, deps: { dispatcher: Dispatcher }) {
  const task = getTask(raw, projectId, taskId);
  if (!task) throw new CommandError("not-found", "task not found", "correct-input");
  if (!["ready", "awaiting-go"].includes(task.state))
    throw new CommandError("conflict", "task cannot be started in its current state", "refresh");
  if (!dependenciesDone(raw, projectId, task))
    throw new CommandError("conflict", "task dependencies are not done", "refresh");
  if (liveAttemptOfTask(raw, projectId, taskId))
    throw new CommandError("conflict", "task has a live attempt", "refresh");
  if (deps.dispatcher.multiTeam && !engagementAvailable(raw, projectId, task.engagementId))
    throw new CommandError("conflict", "task engagement or team is not active", "refresh");
  let seatId: string;
  try { seatId = pickSeat(raw, projectId, task).seatId; }
  catch (error) {
    if (error instanceof DispatchCommandError) throw new CommandError("validation", error.code, "correct-input");
    throw error;
  }
  if (task.ownerSeatId === null) raw.prepare("UPDATE tasks SET owner_seat_id = ?, revision = revision + 1 WHERE project_id = ? AND id = ?")
    .run(seatId, projectId, taskId);
  const active = moveTask(raw, projectId, taskId, "active");
  const attempt = deps.dispatcher.enqueue({ projectId, taskId, seatId });
  return { task: active, attempt };
}

/** Advance only accepted/ready tasks, in code order, inside the caller's transaction. */
export function advanceTasks(raw: Database, projectId: string, deps: { dispatcher: Dispatcher }): Task[] {
  const changed = new Map<string, Task>();
  for (const task of listTasks(raw, projectId)) {
    if (task.state === "accepted" && dependenciesDone(raw, projectId, task))
      changed.set(task.id, moveTask(raw, projectId, task.id, "ready"));
  }
  for (const task of listTasks(raw, projectId)) {
    if (task.state !== "ready" || !dependenciesDone(raw, projectId, task)) continue;
    if (deps.dispatcher.multiTeam && !engagementAvailable(raw, projectId, task.engagementId)) continue;
    const next = task.gate.requiresGo ? moveTask(raw, projectId, task.id, "awaiting-go")
      : startTask(raw, projectId, task.id, deps).task;
    changed.set(task.id, next);
  }
  return [...changed.values()];
}
