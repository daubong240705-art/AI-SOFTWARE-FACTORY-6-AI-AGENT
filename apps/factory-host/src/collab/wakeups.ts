import type { Database } from "better-sqlite3";
import { liveAttemptOfTask } from "../dispatch/attempts.js";
import { startTask } from "../dispatch/advance.js";
import type { Dispatcher } from "../dispatch/dispatcher.js";
import { seatLoad } from "../dispatch/node.js";
import { engagementAvailable } from "../dispatch/seats.js";
import { eventsForTask, moveTask } from "../dispatch/tasks.js";
import type { AttemptRecord } from "../dispatch/types.js";
import type { EventHub } from "../events/hub.js";
import { publicApprovalText } from "../approvals/service.js";
import { agentLoad } from "../flow/selector.js";
import { groupBudgetRefusal } from "../policy/budget.js";
import { getTask } from "../work/service.js";
import { isTerminalTask, terminalTasks } from "./policy.js";

type Reason = "assigned" | "dependency-done" | "subtask-done" | "comment-mention" | "review-requested" | "approval-answered";

export function wake(raw: Database, projectId: string, agentId: string, taskId: string, reason: Reason, now: Date): void {
  raw.prepare(`INSERT INTO agent_wakeups VALUES(?,?,?,?,?,?) ON CONFLICT(agent_id,task_id) DO UPDATE
    SET due_at=min(agent_wakeups.due_at,excluded.due_at), reason=CASE
      WHEN instr(',' || agent_wakeups.reason || ',',',' || excluded.reason || ',')=0 THEN agent_wakeups.reason || ',' || excluded.reason
      ELSE agent_wakeups.reason END`).run(projectId, agentId, taskId, reason, now.toISOString(), now.toISOString());
}

export function consumeWakeup(raw: Database, attempt: AttemptRecord, now: string): void {
  const { projectId, taskId, seatId } = attempt;
  const wakeup = raw.prepare("DELETE FROM agent_wakeups WHERE project_id=? AND agent_id=? AND task_id=? AND due_at<=? RETURNING reason")
    .get(projectId, seatId, taskId, now) as { reason: string } | undefined;
  if (!wakeup) return;
  if (wakeup.reason.split(",").includes("subtask-done"))
    raw.prepare("UPDATE collab_orchestrators SET failure_pending=0 WHERE project_id=? AND task_id=?").run(projectId, taskId);
  const lastComment = raw.prepare(`SELECT coalesce(max(w.last_comment_rowid),0) FROM attempt_wakeups w JOIN attempts a
    ON a.project_id=w.project_id AND a.id=w.attempt_id WHERE a.project_id=? AND a.task_id=?`).pluck().get(projectId, taskId) as number;
  const comments = raw.prepare(`SELECT rowid,text FROM task_comments WHERE project_id=? AND rowid>? AND (task_id=? OR task_id IN
    (SELECT source_task_id FROM collab_assignments WHERE project_id=? AND task_id=? AND kind='review')) ORDER BY rowid DESC LIMIT 10`)
    .all(projectId, lastComment, taskId, projectId, taskId) as { rowid: number; text: string }[];
  const results = raw.prepare(`SELECT t.id,t.title,t.state,(SELECT r.result_json FROM flow_task_results r JOIN attempts a
    ON a.project_id=r.project_id AND a.id=r.attempt_id WHERE a.project_id=t.project_id AND a.task_id=t.id ORDER BY a.epoch DESC LIMIT 1) AS result
    FROM tasks t WHERE t.project_id=? AND t.id<>? AND t.state IN (${terminalTasks}) AND (t.node_run_id=? OR t.id IN
    (SELECT task_id FROM collab_assignments WHERE project_id=? AND source_task_id=? UNION
    SELECT depends_on_task_id FROM task_dependencies WHERE project_id=? AND task_id=?)) ORDER BY t.rowid DESC LIMIT 12`)
    .all(projectId, taskId, taskId, projectId, taskId, projectId, taskId) as { id: string; title: string; state: string; result: string | null }[];
  const answers = raw.prepare(`SELECT a.outcome_option_id,c.comment FROM approvals a LEFT JOIN approval_comments c ON c.project_id=a.project_id AND c.approval_id=a.id
    WHERE a.project_id=? AND a.state<>'pending' AND (a.task_id=? OR a.id IN
      (SELECT approval_id FROM collab_blocks WHERE project_id=? AND task_id=?)) ORDER BY a.decided_at DESC LIMIT 3`)
    .all(projectId, taskId, projectId, taskId) as { outcome_option_id: string | null; comment: string | null }[];
  const data = { reasons: wakeup.reason.split(","), comments: comments.map(({ text }) => text.slice(0, 500)),
    results: results.map(({ result, ...task }) => ({ ...task, result: result?.slice(0, 750) ?? null })),
    answers: answers.map(({ outcome_option_id, comment }) => ({ option: outcome_option_id ?? "no operator answer", comment: comment?.slice(0, 500) ?? null })) };
  const context = `V\u00ec sao b\u1ea1n \u0111\u01b0\u1ee3c \u0111\u00e1nh th\u1ee9c\n${publicApprovalText(JSON.stringify(data))}`;
  raw.prepare("INSERT INTO attempt_wakeups VALUES(?,?,?,?)").run(projectId, attempt.id, context, comments[0]?.rowid ?? lastComment);
}

export function wakeupContext(raw: Database, projectId: string, attemptId: string): string | undefined {
  return (raw.prepare("SELECT context FROM attempt_wakeups WHERE project_id=? AND attempt_id=?").get(projectId, attemptId) as { context: string } | undefined)?.context;
}

function releaseAnsweredBlock(raw: Database, projectId: string, taskId: string): boolean {
  const released = raw.prepare(`DELETE FROM task_holds WHERE project_id=? AND task_id=? AND kind='decision' AND (
    (ref_kind='task' AND EXISTS (SELECT 1 FROM tasks WHERE project_id=task_holds.project_id AND id=task_holds.ref_id AND state IN (${terminalTasks}))) OR
    (ref_kind='approval' AND EXISTS (SELECT 1 FROM collab_blocks b JOIN approvals a ON a.project_id=b.project_id AND a.id=b.approval_id
      WHERE b.project_id=task_holds.project_id AND b.task_id=task_holds.task_id AND b.approval_id=task_holds.ref_id AND a.state<>'pending'))) `)
    .run(projectId, taskId).changes > 0;
  if (released) raw.prepare("UPDATE tasks SET revision=revision+1 WHERE project_id=? AND id=?").run(projectId, taskId);
  return released;
}

export function sweepWakeups(raw: Database, hub: EventHub, dispatcher: Dispatcher, now: string): void {
  hub.transaction(() => {
    const due = raw.prepare(`SELECT w.project_id,w.agent_id,w.task_id,t.node_run_id FROM agent_wakeups w JOIN tasks t ON t.project_id=w.project_id AND t.id=w.task_id
      JOIN seats s ON s.project_id=w.project_id AND s.id=w.agent_id LEFT JOIN collab_orchestrators o ON o.project_id=t.project_id AND o.task_id=t.node_run_id
      LEFT JOIN flow_runs f ON f.project_id=o.project_id AND f.id=o.run_id LEFT JOIN flow_node_runs n ON n.project_id=o.project_id
        AND n.run_id=o.run_id AND n.node_id=o.node_id AND n.iteration=o.iteration AND n.attempt_no=o.attempt_no
      JOIN projects p ON p.id=w.project_id WHERE w.due_at<=? AND p.disposition='active' AND s.status='active' AND t.owner_seat_id=w.agent_id AND t.disposition='active'
        AND (t.state IN ('accepted','ready','active') OR (t.state='in-review' AND o.task_id=t.id))
        AND (o.task_id IS NULL OR (f.state IN ('running','waiting','stalled') AND n.state='waiting'))
      ORDER BY w.due_at,w.created_at,t.code`).all(now) as { project_id: string; agent_id: string; task_id: string; node_run_id: string | null }[];
    for (const { project_id: projectId, agent_id: seatId, task_id: taskId, node_run_id: nodeRun } of due) {
      if (liveAttemptOfTask(raw, projectId, taskId)) continue;
      const released = releaseAnsweredBlock(raw, projectId, taskId);
      const task = getTask(raw, projectId, taskId);
      if (!task || isTerminalTask(task.state)) continue;
      const notify = (changed: typeof task) => hub.append({ projectId, causationId: taskId, rootCausationId: taskId, payload: eventsForTask(changed) });
      const dependencies = task.dependsOn.map((id) => getTask(raw, projectId, id)?.state ?? "");
      if (nodeRun && ["accepted", "ready"].includes(task.state) && dependencies.some((state) => state !== "done" && isTerminalTask(state))) {
        notify(moveTask(raw, projectId, taskId, "cancelled"));
        continue;
      }
      if (agentLoad(raw, projectId, seatId) >= seatLoad(raw, seatId).slots || groupBudgetRefusal(raw, projectId, new Date(now))
        || task.holds.some(({ kind }) => kind === "decision" || kind === "cross-team")
        || (task.gate.requiresGo && ["ready", "accepted"].includes(task.state)) || dependencies.some((state) => state !== "done")
        || !engagementAvailable(raw, projectId, task.engagementId)) { if (released) notify(task); continue; }
      if (task.state === "accepted") moveTask(raw, projectId, taskId, "ready");
      const active = task.state === "ready" || task.state === "accepted"
        ? startTask(raw, projectId, taskId, { dispatcher }).task
        : task.state === "in-review" ? moveTask(raw, projectId, taskId, "active") : task;
      if (task.state === "active" || task.state === "in-review") dispatcher.enqueue({ projectId, taskId, seatId });
      if (active !== task || released) notify(active);
    }
  });
}
