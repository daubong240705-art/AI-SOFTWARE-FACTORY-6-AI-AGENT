import { fixture, until } from "./requests-fixture.mjs";
import { listAttempts } from "../dist/dispatch/attempts.js";
export { fixture, until };
export function attempts(f, taskId) { return listAttempts(f.raw, f.projectId, taskId); }
export async function live(f) {
  f.slots(4);
  const taskId = f.task({ seatId: f.seat.id }); const attempt = f.enqueue(taskId, f.projectId, f.seat.id);
  await until(() => f.read(attempt).state === "running");
  return { ...f.grant, taskId, attemptId: attempt.id, epoch: attempt.epoch };
}
export async function blocked(f, patch = {}, grant) {
  const by = grant ?? await live(f); const result = f.create({ responseMode: "blocking", ...patch }, by);
  f.raw.prepare("UPDATE tasks SET goal = '[fake:hang]' WHERE project_id = ? AND id = ?").run(f.projectId, result.requestId);
  await until(() => attempts(f, by.taskId)[0].state === "parked");
  return { ...result, grant: by };
}
export function wait(f, grant, id) {
  return f.raw.prepare("SELECT * FROM ctr_waits WHERE project_id = ? AND waiter_task_id = ? AND ctr_task_id = ?").get(f.projectId, grant.taskId, id);
}
