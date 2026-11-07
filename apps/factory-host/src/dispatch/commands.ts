import { canTransitionTask, type EntityRef, type Task } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerContext, HandlerMap } from "../commands/pipeline.js";
import { getTask } from "../work/service.js";
import { startTask } from "./advance.js";
import { getAttempt, liveAttemptOfTask } from "./attempts.js";
import type { Dispatcher } from "./dispatcher.js";
import { moveTaskAndAdvance } from "./transitions.js";
import { withdrawPendingReviews } from "../approvals/service.js";

export { DispatchCommandError } from "./seats.js";
const taskEffect = (task: Task): EntityRef => ({ kind: "task", id: task.id, revision: task.revision });
const revisionCheck = (actual: number, expected: number, entity: string): void => {
  if (actual !== expected) throw new CommandError("conflict", `${entity} revision changed`, "refresh", { currentRevision: actual });
};
const requireTask = ({ raw }: HandlerContext, projectId: string, id: string, revision: number): Task => {
  const task = getTask(raw, projectId, id);
  if (!task) throw new CommandError("not-found", "task not found", "correct-input");
  revisionCheck(task.revision, revision, "task");
  return task;
};
const requireAttempt = ({ raw }: HandlerContext, projectId: string, id: string, revision: number) => {
  const attempt = getAttempt(raw, projectId, id);
  if (!attempt) throw new CommandError("not-found", "attempt not found", "correct-input");
  revisionCheck(attempt.revision, revision, "attempt");
  return attempt;
};

export function createDispatchHandlers(deps: { dispatcher: Dispatcher }): Partial<HandlerMap> {
  return {
    "tasks.release": (ctx, { projectId, payload }) => {
      const task = requireTask(ctx, projectId, payload.taskId, payload.expectedRevision);
      if (task.state !== "awaiting-go")
        throw new CommandError("conflict", "task is not waiting for the start gate", "refresh");
      const started = startTask(ctx.raw, projectId, task.id, deps);
      return { effects: [taskEffect(started.task), { kind: "attempt", id: started.attempt.id, revision: started.attempt.revision }] };
    },
    "tasks.transition": (ctx, { projectId, payload }) => {
      const { raw } = ctx;
      const task = requireTask(ctx, projectId, payload.taskId, payload.expectedRevision);
      if (!canTransitionTask(task.state, payload.to))
        throw new CommandError("conflict", "transition not allowed", "refresh");
      if (!["proposed", "accepted", "declined", "cancelled", "done", "active"].includes(payload.to)
        || (payload.to === "active" && !["in-review", "failed"].includes(task.state)))
        throw new CommandError("unsupported", "transition not available yet", "contact-host");
      if (payload.to === "accepted" && task.dependsOn.some((id) => ["cancelled", "declined"].includes(getTask(raw, projectId, id)?.state ?? "")))
        throw new CommandError("conflict", "dependency is cancelled or declined", "refresh");
      if (payload.to === "cancelled" && task.state === "active" && liveAttemptOfTask(raw, projectId, task.id))
        throw new CommandError("conflict", "stop the attempt before cancelling the task", "refresh");
      const effects = moveTaskAndAdvance(raw, task, payload.to, deps);
      if (task.state === "in-review" || payload.to === "cancelled") effects.push(...withdrawPendingReviews(raw, projectId, task.id, ctx.clock()));
      return { effects };
    },
    "runs.cancel": (ctx, { projectId, payload }) => {
      const attempt = requireAttempt(ctx, projectId, payload.runId, payload.expectedRevision);
      if (!["queued", "leased", "preparing", "running", "waiting-input"].includes(attempt.state))
        throw new CommandError("conflict", "attempt cannot be stopped in its current state", "refresh");
      void deps.dispatcher.stopAttempt(projectId, attempt.id).catch(() => undefined);
      return { effects: [{ kind: "attempt", id: attempt.id, revision: attempt.revision }] };
    },
    "runs.reconcile": (ctx, { projectId, payload }) => {
      const attempt = requireAttempt(ctx, projectId, payload.runId, payload.expectedRevision);
      if (attempt.state !== "unknown")
        throw new CommandError("conflict", "attempt is not unknown", "refresh");
      const next = deps.dispatcher.reconcileAttempt(projectId, attempt.id);
      return { effects: [{ kind: "attempt", id: next.id, revision: next.revision },
        taskEffect(getTask(ctx.raw, projectId, next.taskId)!)] };
    },
    "work.assign": (ctx, { projectId, payload }) => {
      const task = requireTask(ctx, projectId, payload.workItemId, payload.expectedRevision);
      if (!["draft", "proposed", "accepted", "ready", "awaiting-go"].includes(task.state))
        throw new CommandError("conflict", "task cannot be assigned in its current state", "refresh");
      if (payload.agentId !== null && !ctx.raw.prepare(`SELECT s.id FROM seats AS s JOIN engagements AS e ON e.team_id = s.team_id
        WHERE e.project_id = ? AND e.id = ? AND s.id = ?`).get(projectId, task.engagementId, payload.agentId))
        throw new CommandError("validation", "owner seat must belong to the engagement team", "correct-input");
      ctx.raw.prepare("UPDATE tasks SET owner_seat_id = ?, revision = revision + 1 WHERE project_id = ? AND id = ?")
        .run(payload.agentId, projectId, task.id);
      return { effects: [taskEffect(getTask(ctx.raw, projectId, task.id)!)] };
    },
  };
}
