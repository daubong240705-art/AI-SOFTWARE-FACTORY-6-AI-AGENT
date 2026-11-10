import { writeWorkflowState } from "./state.js";
import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { workflowDefinitionSchema, type Condition, type EntityRef, type WorkflowInstanceState,
  type WorkflowStageState, type WorkflowValue, type Task } from "@factory/contracts";
import type { EventHub } from "../events/hub.js";
import type { Dispatcher } from "../dispatch/dispatcher.js";
import { advanceTasks } from "../dispatch/advance.js";
import { moveTask } from "../dispatch/tasks.js";
import { tasksCreateHandler, getTask } from "../work/service.js";
import { publicApprovalText } from "../approvals/service.js";
import { getWorkflowInstance } from "./service.js";
import { evaluateWorkflowCondition } from "./conditions.js";
import { selectWorkflowEngagement } from "./teams.js";
import { registerWorkflowLifecycle } from "./lifecycle.js";

export interface WorkflowEngineDeps { raw: Database; hub: EventHub; clock: () => Date; newId?: () => string; dispatcher?: Dispatcher }
interface StageRow { stage_key: string; state: WorkflowStageState; optional: number; loop_count: number;
  blocked_reason: string | null; engagement_id: string | null; extra_tasks: number; extra_titles: string; extra_loops: number }
interface Produced { artifact_id: string; version: number; kind: string; status: string; created_at: string }
const busy = new WeakSet<Database>();
const rank: Readonly<Record<string, number>> = { draft: 0, "in-review": 0, reviewed: 1, approved: 2, superseded: 2 };

/** One ordered evaluation pass. The outer caller may already own the transaction. */
export function advanceWorkflow(deps: WorkflowEngineDeps, projectId: string, instanceId: string): EntityRef[] {
  const { raw, hub } = deps;
  if (busy.has(raw)) return [];
  busy.add(raw);
  try { return hub.transaction(() => {
    const instance = getWorkflowInstance(raw, projectId, instanceId);
    if (!instance || !["active", "awaiting-approval"].includes(instance.state)) return [];
    const definition = workflowDefinitionSchema.parse(JSON.parse(instance.definition_json) as unknown);
    const params = JSON.parse(instance.params_json) as Record<string, WorkflowValue>;
    const stages = raw.prepare("SELECT * FROM workflow_stages WHERE project_id = ? AND instance_id = ?")
      .all(projectId, instanceId) as StageRow[];
    const byKey = new Map(stages.map((stage) => [stage.stage_key, stage]));
    const beforeStages = JSON.stringify(stages);
    const effects: EntityRef[] = []; let dirty = false;
    const now = deps.clock().toISOString();
    const update = (stage: StageRow, state: WorkflowStageState, reason: string | null = null): void => {
      reason = reason?.slice(0, 300) ?? null;
      if (stage.state === state && stage.blocked_reason === reason) return;
      raw.prepare("UPDATE workflow_stages SET state = ?, blocked_reason = ? WHERE project_id = ? AND instance_id = ? AND stage_key = ?")
        .run(state, reason, projectId, instanceId, stage.stage_key);
      stage.state = state; stage.blocked_reason = reason; dirty = true;
    };
    const currentTasks = (key: string): Task[] => (raw.prepare(`SELECT t.task_id FROM workflow_stage_tasks t
      WHERE t.project_id = ? AND t.instance_id = ? AND t.stage_key = ? AND t.iteration =
      (SELECT MAX(iteration) FROM workflow_stage_tasks WHERE project_id = t.project_id AND instance_id = t.instance_id AND stage_key = t.stage_key)
      ORDER BY t.task_id`).all(projectId, instanceId, key) as { task_id: string }[])
      .map((row) => getTask(raw, projectId, row.task_id)!);
    const produced = (key: string): Produced[] => raw.prepare(`SELECT v.artifact_id, v.version, v.kind, v.status, v.created_at
      FROM artifact_versions v JOIN attempts a ON a.project_id = v.project_id AND a.id = v.produced_by_attempt_id
      JOIN workflow_stage_tasks l ON l.project_id = a.project_id AND l.task_id = a.task_id
      WHERE l.project_id = ? AND l.instance_id = ? AND l.stage_key = ? AND l.iteration =
      (SELECT MAX(iteration) FROM workflow_stage_tasks WHERE project_id = l.project_id AND instance_id = l.instance_id AND stage_key = l.stage_key)
      ORDER BY v.created_at DESC, v.version DESC, v.artifact_id`).all(projectId, instanceId, key) as Produced[];
    const evaluate = (condition: Condition, key: string) => evaluateWorkflowCondition(condition, params, (fact) => {
      if (fact.fact === "project.hasApprovedArtifact") return Boolean(raw.prepare(
        "SELECT 1 FROM artifact_versions WHERE project_id = ? AND kind = ? AND status = 'approved' LIMIT 1").get(projectId, fact.kind ?? ""));
      if (fact.fact === "artifact.status") {
        if (fact.stage) return produced(fact.stage).find((v) => v.kind === fact.kind)?.status;
        return stages.flatMap((stage) => produced(stage.stage_key)).filter((v) => v.kind === fact.kind)
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.version - a.version || a.artifact_id.localeCompare(b.artifact_id))[0]?.status;
      }
      if (fact.fact === "review.verdict") {
        const tasks = currentTasks(fact.stage ?? key);
        const rows = tasks.flatMap((task) => raw.prepare(`SELECT state, outcome_option_id, decided_at, rowid AS sequence FROM approvals
          WHERE project_id = ? AND task_id = ? AND kind = 'review' AND state IN ('applied','approved','changes-requested')`)
          .all(projectId, task.id) as { state: string; outcome_option_id: string; decided_at: string; sequence: number }[])
          .sort((a, b) => b.decided_at.localeCompare(a.decided_at) || b.sequence - a.sequence);
        return rows[0] ? rows[0].state === "changes-requested" ? "changes-requested" : "approved" : "none";
      }
      return undefined;
    });
    // Awaiting approval is a waiting projection. Wake only when the blocking approval/gate clears.
    const waiting = (): boolean => stages.some((stage) => currentTasks(stage.stage_key).some((task) => task.state === "awaiting-go"
      || Boolean(raw.prepare("SELECT 1 FROM approvals WHERE project_id = ? AND task_id = ? AND state = 'pending'").get(projectId, task.id))));
    if (instance.state === "awaiting-approval" && !stages.some((s) => s.state === "active" && currentTasks(s.stage_key).length < 1 + s.extra_tasks) && waiting() && !stages.some((stage) => currentTasks(stage.stage_key).some((task) => task.state === "active"))) return [];
    let target: WorkflowInstanceState = instance.state === "awaiting-approval" ? "active" : instance.state;
    let reason: string | null = null;
    // (a) Refresh current work. Pending stages deliberately do not reuse historical tasks.
    for (const stage of stages) {
      if (!["active", "failed", "done"].includes(stage.state)) continue;
      const tasks = currentTasks(stage.stage_key); if (!tasks.length) continue;
      if (tasks.some((task) => ["failed", "cancelled", "declined"].includes(task.state))) update(stage, "failed");
      else if (tasks.some((task) => !["done", "superseded"].includes(task.state))) update(stage, "active");
      else if (tasks.length < 1 + stage.extra_tasks) update(stage, "active");
      else {
        const outputs = definition.stages.find((s) => s.key === stage.stage_key)!.outputs;
        const versions = produced(stage.stage_key);
        update(stage, outputs.every((output) => versions.some((v) => v.kind === output.kind
          && (rank[v.status] ?? -1) >= (rank[output.mustReach] ?? 0))) ? "done" : "active");
      }
    }
    for (const stage of stages) if (stage.state === "failed" && stage.optional) update(stage, "skipped", "optional stage failed");
    const requiredFailed = stages.some((stage) => stage.state === "failed" && !stage.optional);
    // (b,c) Readiness uses all incoming constraints, with a group policy replacing member completion constraints.
    for (const spec of definition.stages) {
      const stage = byKey.get(spec.key)!;
      if (!["pending", "blocked", "ready"].includes(stage.state) || stage.blocked_reason === "rework limit reached") continue;
      let warning: string | null = null;
      const incoming = definition.edges.filter((edge) => edge.to === spec.key && edge.type !== "rework" && edge.type !== "informs");
      const ready = incoming.every((edge) => {
        if (edge.when) { const result = evaluate(edge.when, spec.key); if (result === "unknown") warning = "warning: condition fact unavailable"; if (result !== "true") return false; }
        const source = byKey.get(edge.from)!;
        if (definition.edges.some((rework) => rework.type === "rework" && rework.from === edge.from
          && source.state === "done" && evaluate(rework.when!, edge.from) !== "false")) return false;
        const sourceSpec = definition.stages.find((s) => s.key === edge.from)!;
        if (edge.type === "artifact-approved" && source.state !== "skipped"
          && !produced(edge.from).some((v) => v.kind === edge.artifact && v.status === "approved")) return false;
        if (sourceSpec.parallelGroup) {
          const members = definition.stages.filter((s) => s.parallelGroup === sourceSpec.parallelGroup);
          const count = members.filter((s) => ["done", "skipped"].includes(byKey.get(s.key)!.state)).length;
          const join = definition.joins.find((j) => j.group === sourceSpec.parallelGroup)!;
          return count >= (join.policy === "any" ? 1 : join.policy === "quorum" ? join.n! : members.length);
        }
        return edge.type === "artifact-approved" || ["done", "skipped"].includes(source.state);
      });
      if (!ready) { update(stage, "pending", warning); continue; }
      if (spec.skipIf && evaluate(spec.skipIf, spec.key) === "true") { update(stage, "skipped"); continue; }
      update(stage, "ready");
    }
    // (d) Ensure all planned tasks exist in this iteration; historical links remain immutable.
    for (const spec of definition.stages) {
      const stage = byKey.get(spec.key)!; if (!["ready", "active"].includes(stage.state) || requiredFailed) continue;
      const existing = stage.state === "active" ? currentTasks(spec.key) : [];
      if (existing.length >= 1 + stage.extra_tasks) continue;
      const engagement = selectWorkflowEngagement(raw, projectId, spec, stage.engagement_id);
      if (!engagement) { update(stage, "blocked", `no team covers ${spec.requiredCapabilities.join(", ")}`); continue; }
      let unknownGate = false;
      const gates = definition.gates.filter((gate) => gate.before === spec.key && (!gate.when || (() => {
        const value = evaluate(gate.when, spec.key); unknownGate ||= value === "unknown"; return value === "true";
      })()));
      if (unknownGate) { update(stage, "blocked", "warning: condition fact unavailable"); continue; }
      const iteration = (raw.prepare("SELECT MAX(iteration) AS n FROM workflow_stage_tasks WHERE project_id = ? AND instance_id = ? AND stage_key = ?")
        .get(projectId, instanceId, spec.key) as { n: number | null }).n ?? 0;
      const codes = raw.prepare("SELECT code FROM tasks WHERE project_id = ? AND code GLOB 'WF-*'").all(projectId) as { code: string }[];
      const next = codes.reduce((max, row) => Math.max(max, Number(row.code.slice(3)) || 0), 0) + 1;
      const titles = JSON.parse(stage.extra_titles) as string[];
      const currentIteration = stage.state === "active" ? Math.max(1, iteration) : iteration + 1;
      for (let taskIndex = existing.length; taskIndex < 1 + stage.extra_tasks; taskIndex++) {
      const taskId = (deps.newId ?? randomUUID)();
      const title = taskIndex === 0 ? spec.title : titles[taskIndex - 1] ?? "Additional task";
      const upstream = new Set<string>();
      const visit = (key: string): void => { for (const edge of definition.edges) if (edge.to === key && edge.type !== "rework" && !upstream.has(edge.from)) { upstream.add(edge.from); visit(edge.from); } };
      visit(spec.key);
      const versions = [...upstream].flatMap(produced).filter((v) => v.status === "approved")
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.version - a.version || a.artifact_id.localeCompare(b.artifact_id));
      const inputs = spec.inputs.flatMap((input) => { const version = versions.find((v) => v.kind === input.kind);
        return version ? [{ artifactId: version.artifact_id, version: version.version }] : []; }).slice(0, 8);
      const lines = [title, `Phase: ${spec.phase}`, `Capabilities: ${spec.requiredCapabilities.join(", ")}`,
        ...spec.inputs.map((input) => `Input: ${input.kind} (${input.required ? "required" : "optional"})`),
        ...spec.outputs.map((output) => `Output: ${output.kind} (${output.mustReach})`),
        ...definition.parameters.map((p) => `${p.name}=${String(params[p.name])}`)];
      if (stage.loop_count > 0) {
        const max = definition.edges.find((edge) => edge.type === "rework" && edge.to === spec.key)?.maxLoops ?? stage.loop_count;
        lines.push(`Rework ${stage.loop_count} of ${max}`);
        const feedback = raw.prepare(`SELECT c.comment FROM approval_comments c JOIN approvals a ON a.project_id = c.project_id AND a.id = c.approval_id
          JOIN workflow_stage_tasks l ON l.project_id = a.project_id AND l.task_id = a.task_id
          WHERE l.project_id = ? AND l.instance_id = ? AND a.kind = 'review' AND a.outcome_option_id = 'request-changes'
          ORDER BY a.decided_at DESC, a.rowid DESC LIMIT 1`).get(projectId, instanceId) as { comment: string } | undefined;
        if (feedback) lines.push(`Reviewer feedback:\n${publicApprovalText(feedback.comment).slice(0, 1000)}`);
      }
      tasksCreateHandler({ raw, hub, clock: deps.clock, newId: deps.newId ?? randomUUID, actorId: "operator" }, {
        apiVersion: 1, commandId: taskId, projectId, type: "tasks.create", payload: { taskId, code: `WF-${String(next + taskIndex - existing.length).padStart(3, "0")}`,
          title, goal: title, brief: lines.join("\n"), parentTaskId: null, engagementId: engagement, ownerSeatId: null,
          requiredCapabilities: spec.requiredCapabilities, placement: spec.placement,
          sideEffect: spec.sideEffect === "external" ? "external-irreversible" : spec.sideEffect === "code" ? "artifact" : spec.sideEffect ?? "none",
          reviewPolicy: "human-final",
          requiresGo: gates.some((gate) => gate.kind !== "review"), acceptance: spec.outputs.map((output) => `Register a ${output.kind} artifact and reach ${output.mustReach}`), inputs, dependsOn: [] } });
      raw.prepare("INSERT INTO workflow_stage_tasks VALUES (?,?,?,?,?,?)").run(projectId, instanceId, spec.key, currentIteration, taskId, now);
      raw.prepare("UPDATE workflow_stages SET engagement_id = ? WHERE project_id = ? AND instance_id = ? AND stage_key = ?")
        .run(engagement, projectId, instanceId, spec.key); stage.engagement_id = engagement;
      moveTask(raw, projectId, taskId, "accepted"); moveTask(raw, projectId, taskId, "ready");
      if (gates.some((gate) => gate.kind !== "review")) moveTask(raw, projectId, taskId, "awaiting-go");
      update(stage, "active"); effects.push({ kind: "task", id: taskId, revision: getTask(raw, projectId, taskId)!.revision });
      }
    }
    // (e) Rework resets both ends; old links, attempts and versions remain immutable history.
    for (const edge of definition.edges) {
      if (edge.type !== "rework") continue;
      const source = byKey.get(edge.from)!; const dest = byKey.get(edge.to)!;
      if (source.state !== "done") continue;
      const result = evaluate(edge.when!, edge.from);
      if (result === "unknown") { update(source, "blocked", "warning: condition fact unavailable"); continue; }
      if (result !== "true") continue;
      if (dest.loop_count >= edge.maxLoops! + dest.extra_loops) { update(source, "blocked", "rework limit reached"); target = "stalled"; reason = "rework limit reached"; break; }
      raw.prepare("UPDATE workflow_stages SET loop_count = loop_count + 1 WHERE project_id = ? AND instance_id = ? AND stage_key = ?")
        .run(projectId, instanceId, dest.stage_key); dest.loop_count += 1;
      update(dest, "pending"); update(source, "pending");
    }
    // (f,g) Instance transitions and revisions are recorded once for this pass.
    for (const stage of stages) if (stage.state === "failed") {
      if (stage.optional) update(stage, "skipped", "optional stage failed");
      else { target = "stalled"; reason = `stage failed: ${stage.stage_key}`; break; }
    }
    if (target !== "stalled") {
      if (stages.every((stage) => ["done", "skipped"].includes(stage.state))) target = "completed";
      else if (!stages.some((stage) => currentTasks(stage.stage_key).some((task) => task.state === "active")) && waiting()) target = "awaiting-approval";
    }
    dirty = JSON.stringify(stages) !== beforeStages || effects.some((entity) => entity.kind === "task");
    if (dirty || target !== instance.state) {
      writeWorkflowState(deps, getWorkflowInstance(raw,projectId,instanceId)!, target, reason, now);
      effects.push({ kind: "workflow-instance", id: instanceId, revision: instance.revision + 1 });
    }
    if (deps.dispatcher && target !== "stalled") {
      for (const task of advanceTasks(raw, projectId, { dispatcher: deps.dispatcher })) {
        effects.push({ kind: "task", id: task.id, revision: task.revision });
        if (task.state === "active") {
          const attempt = raw.prepare("SELECT id, revision FROM attempts WHERE project_id = ? AND task_id = ? ORDER BY epoch DESC LIMIT 1")
            .get(projectId, task.id) as { id: string; revision: number };
          effects.push({ kind: "attempt", ...attempt });
        }
      }
    }
    const unique = [...new Map(effects.map((entity) => [`${entity.kind}:${entity.id}`, entity])).values()];
    if (hub.currentCursor(projectId)) for (const entity of unique) hub.append({ projectId, causationId: instanceId, payload: { type: "entity.changed", entity } });
    return unique;
  }); } finally { busy.delete(raw); }
}

export function advanceProjectWorkflows(deps: WorkflowEngineDeps, projectId: string): EntityRef[] {
  const rows = deps.raw.prepare("SELECT id FROM workflow_instances WHERE project_id = ? AND state IN ('active','awaiting-approval') ORDER BY created_at, id")
    .all(projectId) as { id: string }[];
  return rows.flatMap((row) => advanceWorkflow(deps, projectId, row.id));
}
export function sweepWorkflows(deps: WorkflowEngineDeps): EntityRef[] {
  const projects = deps.raw.prepare("SELECT DISTINCT project_id FROM workflow_instances WHERE state IN ('active','awaiting-approval') ORDER BY project_id")
    .all() as { project_id: string }[];
  return projects.flatMap((row) => advanceProjectWorkflows(deps, row.project_id));
}
export function registerWorkflowEngine(deps: WorkflowEngineDeps): void {
  registerWorkflowLifecycle(deps.raw, (projectId) => { advanceProjectWorkflows(deps, projectId); });
}
