import type { Database } from "better-sqlite3";
import { canTransitionTask, taskSchema, type Task, type TaskState, type TaskProposeInput } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerMap } from "../commands/pipeline.js";
import { deterministicUuid, getPrimaryEngagement } from "../org/service.js";

interface TaskRow {
  id: string; project_id: string; revision: number; code: string; title: string; goal: string; brief: string;
  parent_task_id: string | null; engagement_id: string | null; owner_seat_id: string | null;
  origin_kind: string; requester_task_id: string | null; request_kind: string | null; hop: number | null;
  state: TaskState; disposition: string; placement: string; side_effect: string; review_policy: string;
  requires_go: number; required_capabilities_json: string; acceptance_json: string; inputs_json: string;
}
interface HoldRow { kind: string; reason: string; ref_kind: string | null; ref_id: string | null; since: string; needs_action: number }

function taskFromRow(raw: Database, row: TaskRow): Task {
  const dependencies = raw.prepare("SELECT depends_on_task_id AS id FROM task_dependencies WHERE project_id = ? AND task_id = ? ORDER BY depends_on_task_id")
    .all(row.project_id, row.id) as { id: string }[];
  const holds = raw.prepare("SELECT * FROM task_holds WHERE project_id = ? AND task_id = ? ORDER BY kind")
    .all(row.project_id, row.id) as HoldRow[];
  return taskSchema.parse({
    id: row.id, projectId: row.project_id, revision: row.revision, code: row.code, title: row.title, goal: row.goal, brief: row.brief,
    parentTaskId: row.parent_task_id, engagementId: row.engagement_id, ownerSeatId: row.owner_seat_id,
    origin: row.origin_kind === "cross-team" ? { kind: row.origin_kind, requesterTaskId: row.requester_task_id, requestKind: row.request_kind, hop: row.hop }
      : row.origin_kind === "delegation" ? { kind: row.origin_kind, parentTaskId: row.parent_task_id } : { kind: row.origin_kind },
    state: row.state, disposition: row.disposition,
    holds: holds.map((hold) => ({ kind: hold.kind, reason: hold.reason,
      // M1 stores the reference identity only; no pinned revision exists in task_holds.
      ref: hold.ref_id === null ? null : { kind: hold.ref_kind, id: hold.ref_id, revision: 1 },
      since: hold.since, needsAction: hold.needs_action === 1 })),
    requiredCapabilities: JSON.parse(row.required_capabilities_json), placement: row.placement, sideEffect: row.side_effect,
    reviewPolicy: row.review_policy, gate: { requiresGo: row.requires_go === 1 },
    acceptance: JSON.parse(row.acceptance_json), inputs: JSON.parse(row.inputs_json), dependsOn: dependencies.map((dependency) => dependency.id),
  });
}

export function getTask(raw: Database, projectId: string, taskId: string): Task | undefined {
  const row = raw.prepare("SELECT * FROM tasks WHERE project_id = ? AND id = ?").get(projectId, taskId) as TaskRow | undefined;
  return row === undefined ? undefined : taskFromRow(raw, row);
}

export function listTasks(raw: Database, projectId: string): Task[] {
  return (raw.prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY code, id").all(projectId) as TaskRow[])
    .map((row) => taskFromRow(raw, row));
}

/** The caller owns the transaction, including rollback of the whole proposal. */
export function createProposedTasks(raw: Database, input: {
  projectId: string; turnId: string; plan: TaskProposeInput; engagementId: string | null;
}): Task[] {
  const { projectId, turnId, plan, engagementId } = input;
  const codes = raw.prepare("SELECT code FROM tasks WHERE project_id = ?").all(projectId) as { code: string }[];
  let next = codes.reduce((max, row) => /^TSK-\d+$/.test(row.code) ? Math.max(max, Number(row.code.slice(4))) : max, 0) + 1;
  const ids = plan.tasks.map((_, index) => deterministicUuid(`lead-turn:${turnId}:${index}`));
  // The Lead names the member that does each task; an unknown or Lead name falls back to the Host's own choice.
  const seatByName = new Map((engagementId === null ? [] : raw.prepare(`SELECT s.id, s.name FROM seats s JOIN engagements e ON e.team_id = s.team_id
    WHERE e.id = ? AND s.is_lead = 0`).all(engagementId) as { id: string; name: string }[]).map((seat) => [seat.name.toLowerCase(), seat.id]));
  return plan.tasks.map((entry, index) => {
    const id = ids[index] as string;
    const existing = getTask(raw, projectId, id);
    if (existing) return existing;
    const code = `TSK-${String(next++).padStart(3, "0")}`;
    raw.prepare(`INSERT INTO tasks (project_id, id, revision, code, title, goal, brief, parent_task_id, engagement_id,
      owner_seat_id, origin_kind, state, disposition, placement, side_effect, review_policy, requires_go,
      required_capabilities_json, acceptance_json, inputs_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(projectId, id, 1, code, entry.title, entry.goal, entry.goal, null, engagementId, seatByName.get((entry.ownerSeat ?? "").toLowerCase()) ?? null,
        // The Lead decides who reviews: "automatic" tasks are accepted by the Host when their result is clean
        // (approvals/service.ts autoReviewTask). Hybrid has no reviewer of its own and external effects always need
        // the operator. Tasks start without a Go; only an irreversible external effect waits for one.
        "operator", "proposed", "active", entry.placement, entry.sideEffect,
        entry.reviewPolicy === "automatic" && entry.sideEffect !== "external-idempotent" && entry.sideEffect !== "external-irreversible" ? "automatic" : "human-final",
        entry.sideEffect === "external-irreversible" ? 1 : 0,
        JSON.stringify(entry.requiredCapabilities), JSON.stringify(entry.acceptance), JSON.stringify([]));
    for (const dependency of entry.dependsOn)
      raw.prepare("INSERT INTO task_dependencies (project_id, task_id, depends_on_task_id) VALUES (?, ?, ?)")
        .run(projectId, id, ids[dependency] as string);
    const task = getTask(raw, projectId, id);
    if (!task) throw new Error("Proposed task was not inserted");
    return task;
  });
}

export const tasksCreateHandler: HandlerMap["tasks.create"] = ({ raw }, { projectId, payload }) => {
  if (!raw.prepare("SELECT id FROM projects WHERE id = ?").get(projectId))
    throw new CommandError("not-found", "project not found", "correct-input");
  if (raw.prepare("SELECT id FROM tasks WHERE id = ?").get(payload.taskId))
    throw new CommandError("conflict", "task already exists", "correct-input");
  if (raw.prepare("SELECT id FROM tasks WHERE project_id = ? AND code = ?").get(projectId, payload.code))
    throw new CommandError("conflict", "task code already exists", "correct-input");
  if (payload.parentTaskId === payload.taskId || payload.dependsOn.includes(payload.taskId))
    throw new CommandError("validation", "task cannot reference itself", "correct-input");
  if (new Set(payload.dependsOn).size !== payload.dependsOn.length)
    throw new CommandError("validation", "duplicate dependency", "correct-input");
  for (const id of [...(payload.parentTaskId === null ? [] : [payload.parentTaskId]), ...payload.dependsOn]) {
    if (!raw.prepare("SELECT id FROM tasks WHERE project_id = ? AND id = ?").get(projectId, id))
      throw new CommandError("not-found", "referenced task not found in project", "correct-input");
  }
  const engagementId = payload.engagementId ?? getPrimaryEngagement(raw, projectId)?.id ?? null;
  const engagement = engagementId === null ? undefined : raw.prepare("SELECT team_id FROM engagements WHERE project_id = ? AND id = ?")
    .get(projectId, engagementId) as { team_id: string } | undefined;
  if (engagementId !== null && !engagement)
    throw new CommandError("not-found", "engagement not found in project", "correct-input");
  if (payload.ownerSeatId !== null && (!engagement || !raw.prepare("SELECT id FROM seats WHERE id = ? AND team_id = ?")
    .get(payload.ownerSeatId, engagement.team_id)))
    throw new CommandError("validation", "owner seat must belong to the engagement team", "correct-input");
  raw.prepare(`INSERT INTO tasks (project_id, id, revision, code, title, goal, brief, parent_task_id, engagement_id,
    owner_seat_id, origin_kind, state, disposition, placement, side_effect, review_policy, requires_go,
    required_capabilities_json, acceptance_json, inputs_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(projectId, payload.taskId, 1, payload.code, payload.title, payload.goal, payload.brief, payload.parentTaskId,
      engagementId, payload.ownerSeatId, "operator", "draft", "active", payload.placement, payload.sideEffect,
      payload.reviewPolicy, Number(payload.requiresGo), JSON.stringify(payload.requiredCapabilities), JSON.stringify(payload.acceptance), JSON.stringify(payload.inputs));
  for (const dependency of payload.dependsOn)
    raw.prepare("INSERT INTO task_dependencies (project_id, task_id, depends_on_task_id) VALUES (?, ?, ?)")
      .run(projectId, payload.taskId, dependency);
  return { effects: [{ kind: "task", id: payload.taskId, revision: 1 }] };
};

export const tasksTransitionHandler: HandlerMap["tasks.transition"] = ({ raw }, { projectId, payload }) => {
  // An input hold reports stale knowledge; it alone never vetoes an operator's move.
  // The Lead decides whether the pinned input needs replacement or any work needs redoing.
  const task = raw.prepare("SELECT * FROM tasks WHERE project_id = ? AND id = ?").get(projectId, payload.taskId) as TaskRow | undefined;
  if (!task) throw new CommandError("not-found", "task not found", "correct-input");
  if (payload.expectedRevision !== task.revision)
    throw new CommandError("conflict", "task revision changed", "refresh", { currentRevision: task.revision });
  if (!canTransitionTask(task.state, payload.to))
    throw new CommandError("conflict", "transition not allowed", "refresh");
  if (!["proposed", "accepted", "declined", "cancelled"].includes(payload.to))
    throw new CommandError("unsupported", "transition not available yet", "contact-host");
  if (payload.to === "accepted" && raw.prepare(`SELECT 1 FROM task_dependencies AS d
    JOIN tasks AS t ON t.project_id = d.project_id AND t.id = d.depends_on_task_id
    WHERE d.project_id = ? AND d.task_id = ? AND t.state IN (?, ?) LIMIT 1`).get(projectId, task.id, "cancelled", "declined"))
    throw new CommandError("conflict", "dependency is cancelled or declined", "refresh");
  const revision = task.revision + 1;
  raw.prepare("UPDATE tasks SET state = ?, revision = ? WHERE project_id = ? AND id = ?")
    .run(payload.to, revision, projectId, task.id);
  return { effects: [{ kind: "task", id: task.id, revision }] };
};
