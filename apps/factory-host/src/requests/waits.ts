import type { TaskState } from "@factory/contracts";
import { listAttempts, liveAttemptOfTask } from "../dispatch/attempts.js";
import { moveTask } from "../dispatch/tasks.js";
import { getTask } from "../work/service.js";
import { appendRequestMessage, type RequestDeps, type RequestGrant } from "./service.js";

export const WAIT_CEILING_MS = 24 * 60 * 60 * 1000;
export const TRIAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const BLOCKING_MESSAGE = "You will be resumed with the answer. Finish your turn.";
export type WaitOutcome = "delivered" | "declined" | "cancelled" | "expired" | "timed-out";
interface Wait { project_id: string; waiter_task_id: string; ctr_task_id: string; attempt_id: string }
export function resumeWaiter(deps: RequestDeps, projectId: string, taskId: string): void {
  const { raw } = deps;
  if (raw.prepare("SELECT 1 FROM task_holds WHERE project_id = ? AND task_id = ? AND kind IN ('cross-team','decision')").get(projectId, taskId)) return;
  const task = getTask(raw, projectId, taskId);
  const previous = listAttempts(raw, projectId, taskId).at(-1);
  if (task?.state !== "active" || previous?.state !== "parked" || !previous.seatId || liveAttemptOfTask(raw, projectId, taskId)) return;
  if (!raw.prepare("SELECT 1 FROM ctr_waits WHERE project_id = ? AND waiter_task_id = ? AND attempt_id = ? AND resolved_at IS NOT NULL")
    .get(projectId, taskId, previous.id)) return;
  deps.dispatcher.enqueue({ projectId, taskId, seatId: previous.seatId });
}
export function addWait(deps: RequestDeps, grant: RequestGrant, ctrTaskId: string): void {
  const { raw } = deps; const now = deps.now().toISOString();
  raw.prepare(`INSERT INTO ctr_waits (project_id,waiter_task_id,ctr_task_id,attempt_id,since) VALUES (?,?,?,?,?)
    ON CONFLICT(project_id,waiter_task_id,ctr_task_id) DO UPDATE SET attempt_id = excluded.attempt_id,
    since = excluded.since,resolved_at = NULL,outcome = NULL WHERE ctr_waits.resolved_at IS NOT NULL`)
    .run(grant.projectId, grant.taskId, ctrTaskId, grant.attemptId, now);
  raw.prepare(`INSERT OR IGNORE INTO task_holds (project_id,task_id,kind,reason,ref_kind,ref_id,since,needs_action)
    VALUES (?,?,'cross-team','Waiting for a cross-team request','task',?,?,0)`).run(grant.projectId, grant.taskId, ctrTaskId, now);
  raw.prepare("UPDATE tasks SET revision = revision + 1 WHERE project_id = ? AND id = ?").run(grant.projectId, grant.taskId);
  // Defer fencing until the synchronous tool response has left the session.
  setTimeout(() => {
    if (!raw.open) return;
    if (!raw.prepare(`SELECT 1 FROM ctr_waits w JOIN tasks t ON t.project_id = w.project_id AND t.id = w.waiter_task_id
      WHERE w.project_id = ? AND w.waiter_task_id = ? AND w.attempt_id = ? AND t.state = 'active'`)
      .get(grant.projectId, grant.taskId, grant.attemptId)) return;
    try { void deps.dispatcher.parkAttempt(grant).catch(() => { console.error("Request parking failed"); }); }
    catch { console.error("Request parking failed"); }
  }, 50).unref();
}
function resolve(deps: RequestDeps, row: Wait, outcome: WaitOutcome, resume = true): void {
  const { raw } = deps;
  const changed = raw.prepare(`UPDATE ctr_waits SET resolved_at = ?,outcome = ? WHERE project_id = ? AND waiter_task_id = ?
    AND ctr_task_id = ? AND resolved_at IS NULL`).run(deps.now().toISOString(), outcome, row.project_id, row.waiter_task_id, row.ctr_task_id);
  if (!changed.changes) return;
  if (outcome === "timed-out") raw.prepare("INSERT OR IGNORE INTO ctr_followers (project_id,task_id,follower_task_id,since) VALUES (?,?,?,?)")
    .run(row.project_id, row.ctr_task_id, row.waiter_task_id, deps.now().toISOString());
  const next = raw.prepare(`SELECT ctr_task_id FROM ctr_waits WHERE project_id = ? AND waiter_task_id = ? AND resolved_at IS NULL
    ORDER BY since,ctr_task_id LIMIT 1`).get(row.project_id, row.waiter_task_id) as { ctr_task_id: string } | undefined;
  if (next) raw.prepare("UPDATE task_holds SET ref_id = ? WHERE project_id = ? AND task_id = ? AND kind = 'cross-team'")
    .run(next.ctr_task_id, row.project_id, row.waiter_task_id);
  else raw.prepare("DELETE FROM task_holds WHERE project_id = ? AND task_id = ? AND kind = 'cross-team'").run(row.project_id, row.waiter_task_id);
  raw.prepare("UPDATE tasks SET revision = revision + 1 WHERE project_id = ? AND id = ?").run(row.project_id, row.waiter_task_id);
  const task = getTask(raw, row.project_id, row.waiter_task_id)!;
  deps.hub?.append({ projectId: row.project_id, causationId: row.ctr_task_id,
    payload: { type: "entity.changed", entity: { kind: "task", id: task.id, revision: task.revision } } });
  if (resume) resumeWaiter(deps, row.project_id, row.waiter_task_id);
}
/** Caller owns the transaction. */
export function releaseWaiters(deps: RequestDeps, ctrTaskId: string, outcome: WaitOutcome): void {
  const run = (): void => {
    for (const row of deps.raw.prepare("SELECT * FROM ctr_waits WHERE ctr_task_id = ? AND resolved_at IS NULL").all(ctrTaskId) as Wait[]) resolve(deps, row, outcome);
  };
  if (deps.hub) deps.hub.transaction(run); else deps.raw.transaction(run).immediate();
}
export function moveWaiters(deps: RequestDeps, projectId: string, from: string, to: string): void {
  const { raw } = deps;
  for (const row of raw.prepare("SELECT * FROM ctr_waits WHERE project_id = ? AND ctr_task_id = ? AND resolved_at IS NULL").all(projectId, from) as Wait[]) {
    raw.prepare(`INSERT INTO ctr_waits (project_id,waiter_task_id,ctr_task_id,attempt_id,since)
      SELECT project_id,waiter_task_id,?,attempt_id,since FROM ctr_waits WHERE project_id = ? AND waiter_task_id = ? AND ctr_task_id = ?
      ON CONFLICT(project_id,waiter_task_id,ctr_task_id) DO UPDATE SET attempt_id = excluded.attempt_id,since = excluded.since,resolved_at = NULL,outcome = NULL`)
      .run(to, projectId, row.waiter_task_id, from);
    raw.prepare("DELETE FROM ctr_waits WHERE project_id = ? AND waiter_task_id = ? AND ctr_task_id = ?").run(projectId, row.waiter_task_id, from);
    raw.prepare("DELETE FROM task_holds WHERE project_id = ? AND task_id = ? AND kind = 'cross-team' AND ref_id = ?").run(projectId, row.waiter_task_id, from);
    raw.prepare(`INSERT OR IGNORE INTO task_holds (project_id,task_id,kind,reason,ref_kind,ref_id,since,needs_action)
      VALUES (?,?,'cross-team','Waiting for a cross-team request','task',?,?,0)`).run(projectId, row.waiter_task_id, to, deps.now().toISOString());
  }
  if (getTask(raw, projectId, to)?.state === "in-review") releaseWaiters(deps, to, "delivered");
}
export function cancelRequester(deps: RequestDeps, projectId: string, taskId: string): void {
  const { raw } = deps;
  for (const row of raw.prepare("SELECT * FROM ctr_waits WHERE project_id = ? AND waiter_task_id = ? AND resolved_at IS NULL").all(projectId, taskId) as Wait[])
    resolve(deps, row, "cancelled", false);
  const children = raw.prepare(`SELECT t.id,m.target_team_id FROM tasks t JOIN ctr_meta m ON m.project_id = t.project_id AND m.task_id = t.id
    WHERE t.project_id = ? AND t.requester_task_id = ? AND t.state NOT IN ('done','declined','cancelled','superseded')
    AND m.triage_state NOT IN ('declined','merged','redirected')`).all(projectId, taskId) as { id: string; target_team_id: string }[];
  for (const child of children) {
    const shared = raw.prepare("SELECT 1 FROM ctr_followers WHERE project_id = ? AND task_id = ? AND follower_task_id <> ?").get(projectId, child.id, taskId);
    if (shared) continue;
    raw.prepare(`UPDATE tasks SET owner_seat_id = COALESCE(owner_seat_id,(SELECT id FROM seats WHERE team_id = ? ORDER BY is_lead DESC LIMIT 1))
      WHERE project_id = ? AND id = ?`).run(child.target_team_id, projectId, child.id);
    appendRequestMessage(raw, { projectId, requestTaskId: child.id, author: "system", text: "requester cancelled", now: deps.now().toISOString() });
    const attempt = liveAttemptOfTask(raw, projectId, child.id);
    moveTask(raw, projectId, child.id, "cancelled", { now: deps.now().toISOString() });
    if (attempt) setImmediate(() => { void deps.dispatcher.stopAttempt(projectId, attempt.id).catch(() => { console.error("Request cancellation failed"); }); });
  }
  raw.prepare("DELETE FROM ctr_followers WHERE project_id = ? AND follower_task_id = ?").run(projectId, taskId);
}
export function onRequestTransition(deps: RequestDeps, projectId: string, taskId: string, state: TaskState): void {
  if (state === "cancelled") cancelRequester(deps, projectId, taskId);
  const outcome = state === "in-review" || state === "done" ? "delivered" : state === "declined" ? "declined" : state === "cancelled" ? "cancelled" : null;
  if (outcome) releaseWaiters(deps, taskId, outcome);
}
export function expireRequests(deps: RequestDeps, now: Date = deps.now()): void {
  if (!deps.multiTeam) return;
  const run = (): void => {
    const { raw } = deps; const stamp = now.toISOString(); const timedDeps = { ...deps, now: () => now };
    const rows = raw.prepare(`SELECT m.project_id,m.task_id,m.target_team_id,m.needed_by,
      (SELECT at FROM ctr_messages WHERE project_id = m.project_id AND task_id = m.task_id AND seq = 1) AS created_at
      FROM ctr_meta m JOIN tasks t ON t.project_id = m.project_id AND t.id = m.task_id
      WHERE t.state = 'proposed' AND m.triage_state IN ('submitted','need-info')`).all() as {
        project_id: string; task_id: string; target_team_id: string; needed_by: string | null; created_at: string;
      }[];
    for (const row of rows) {
      if (now.getTime() - Date.parse(row.created_at) <= (deps.triageTtlMs ?? TRIAGE_TTL_MS) && !(row.needed_by && Date.parse(row.needed_by) <= now.getTime())) continue;
      raw.prepare(`UPDATE tasks SET owner_seat_id = COALESCE(owner_seat_id,(SELECT id FROM seats WHERE team_id = ? ORDER BY is_lead DESC LIMIT 1))
        WHERE project_id = ? AND id = ?`).run(row.target_team_id, row.project_id, row.task_id);
      raw.prepare("UPDATE ctr_meta SET triage_state = 'declined',triage_by = 'system',triage_reason = 'expired',triage_at = ?,closed_at = ? WHERE project_id = ? AND task_id = ?")
        .run(stamp, stamp, row.project_id, row.task_id);
      appendRequestMessage(raw, { projectId: row.project_id, requestTaskId: row.task_id, author: "system", text: "expired", now: stamp });
      releaseWaiters(timedDeps, row.task_id, "expired");
      moveTask(raw, row.project_id, row.task_id, "declined", { now: stamp });
    }
    for (const row of raw.prepare("SELECT * FROM ctr_waits WHERE resolved_at IS NULL AND julianday(?) - julianday(since) > ? / 86400000.0")
      .all(stamp, deps.waitCeilingMs ?? WAIT_CEILING_MS) as Wait[]) resolve(timedDeps, row, "timed-out");
  };
  if (deps.hub) deps.hub.transaction(() => deps.raw.transaction(run)()); else deps.raw.transaction(run).immediate();
}
