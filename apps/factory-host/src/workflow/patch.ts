import { randomUUID } from "node:crypto";
import { evaluateParamCondition, isTerminalWorkflowState, patchPolicyOf, workflowDefinitionSchema, workflowPatchSchema,
  type Condition, type WorkflowDefinition, type WorkflowPatchOp, type WorkflowPatchPolicy, type WorkflowStageState } from "@factory/contracts";
import { publicApprovalText } from "../approvals/service.js";
import { sanitizeAgentText } from "../mcp/security.js";
import { advanceWorkflow, type WorkflowEngineDeps } from "./engine.js";
import { getWorkflowInstance } from "./service.js";
import { validateWorkflowDefinition } from "./validate.js";

export class PatchError extends Error {
  constructor(readonly code: "not-found" | "conflict" | "validation", message: string) { super(message); }
}
export interface PatchRecord {
  projectId: string; instanceId: string; id: string; number: number; proposedBy: "operator" | "lead";
  policy: WorkflowPatchPolicy; state: "applied" | "pending" | "rejected" | "refused";
  reason: string; refusal: string | null; createdAt: string; decidedAt: string | null; comment: string | null;
  appliedRevision: number | null;
}
interface PatchRow {
  project_id: string; instance_id: string; id: string; number: number; proposed_by: "operator" | "lead";
  policy: WorkflowPatchPolicy; state: PatchRecord["state"]; reason: string; refusal: string | null;
  created_at: string; decided_at: string | null; comment: string | null; applied_revision: number | null; ops_json: string;
}
interface StageRow {
  stage_key: string; phase: string; state: WorkflowStageState; optional: number; loop_count: number;
  engagement_id: string | null; blocked_reason: string | null; extra_tasks: number; extra_titles: string;
}
const view = (row: PatchRow): PatchRecord => ({ projectId: row.project_id, instanceId: row.instance_id, id: row.id,
  number: row.number, proposedBy: row.proposed_by, policy: row.policy, state: row.state, reason: patchText(row.reason),
  refusal: row.refusal, createdAt: row.created_at, decidedAt: row.decided_at, comment: row.comment === null ? null : patchText(row.comment),
  appliedRevision: row.applied_revision });
export function patchText(value: string): string {
  return sanitizeAgentText(publicApprovalText(value))
    .replace(/\bBearer\s+\S+|\b(?:token|api[_-]?key|password|secret)\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted]")
    .replace(/\{[^}]*\}|\[[^\]]*\]/g, " ").replace(/[{}\[\]<>`]/g, " ").replace(/\s+/g, " ").trim();
}
export function listPatches(deps: Pick<WorkflowEngineDeps, "raw">, projectId: string, instanceId: string): PatchRecord[] {
  return (deps.raw.prepare("SELECT * FROM workflow_patches WHERE project_id = ? AND instance_id = ? ORDER BY number DESC LIMIT 50")
    .all(projectId, instanceId) as PatchRow[]).map(view);
}
export function patchSummary(op: WorkflowPatchOp): string {
  switch (op.op) {
    case "addTaskWithinStage": return `add task within stage ${op.stage}`;
    case "skipOptionalStage": return `skip optional stage ${op.stage}`;
    case "splitStage": return `split stage ${op.stage}`;
    case "addStage": return `add stage ${op.stage.key}`;
    case "reorderStages": return `reorder stage ${op.stage}`;
    case "removeRequiredStage": return `remove required stage ${op.stage}`;
  }
}
export function pendingPatches(deps: Pick<WorkflowEngineDeps, "raw">, projectId: string) {
  const rows = deps.raw.prepare(`SELECT p.*, i.title AS instance_title FROM workflow_patches p
    JOIN workflow_instances i ON i.project_id = p.project_id AND i.id = p.instance_id
    WHERE p.project_id = ? AND p.state = 'pending' ORDER BY p.created_at, p.number`).all(projectId) as (PatchRow & { instance_title: string })[];
  return rows.map((row) => ({ ...view(row), instanceTitle: patchText(row.instance_title),
    ops: workflowPatchSchema.shape.ops.parse(JSON.parse(row.ops_json) as unknown).map(patchSummary) }));
}
class Refusal extends Error {}
const refuse = (message: string): never => { throw new Refusal(message); };

/** All edits happen on isolated values. No SQL mutation occurs during validation. */
function prepare(deps: WorkflowEngineDeps, projectId: string, instanceId: string, ops: WorkflowPatchOp[]) {
  const { raw } = deps;
  const instance = getWorkflowInstance(raw, projectId, instanceId)!;
  if (isTerminalWorkflowState(instance.state)) refuse("terminal workflow");
  const d = workflowDefinitionSchema.parse(JSON.parse(instance.definition_json) as unknown);
  const rows = raw.prepare("SELECT * FROM workflow_stages WHERE project_id = ? AND instance_id = ?")
    .all(projectId, instanceId) as StageRow[];
  const stages = new Map(rows.map((row) => [row.stage_key, { ...row }]));
  const hasTasks = (key: string): boolean => Boolean(raw.prepare(
    "SELECT 1 FROM workflow_stage_tasks WHERE project_id = ? AND instance_id = ? AND stage_key = ? LIMIT 1").get(projectId, instanceId, key));
  const specOf = (key: string) => d.stages.find((s) => s.key === key) ?? refuse("unknown stage");
  const rowOf = (key: string) => stages.get(key) ?? refuse("unknown stage");
  const pristine = (key: string, blocked = false): void => {
    const row = rowOf(key);
    if (row.state !== "pending" && !(blocked && row.state === "blocked")) refuse("stage has started");
    if (hasTasks(key)) refuse("stage has task history");
  };
  const edge = (from: string, to: string): void => {
    if (!d.edges.some((e) => e.from === from && e.to === to && e.type === "finish-to-start"))
      d.edges.push({ from, to, type: "finish-to-start" });
  };
  const newRow = (spec: WorkflowDefinition["stages"][number]): void => {
    if (stages.has(spec.key)) refuse("duplicate stage");
    stages.set(spec.key, { stage_key: spec.key, phase: spec.phase, state: spec.includeIf
      && evaluateParamCondition(spec.includeIf, JSON.parse(instance.params_json) as Record<string, unknown>) === "false" ? "skipped" : "pending",
      optional: Number(spec.optional), loop_count: 0, engagement_id: null, blocked_reason: null, extra_tasks: 0, extra_titles: "[]" });
  };
  const detach = (key: string): void => {
    if (d.edges.some((e) => (e.from === key || e.to === key) && ["artifact-approved", "rework"].includes(e.type)))
      refuse("stage has protected edges");
    const incoming = d.edges.filter((e) => e.to === key && e.type === "finish-to-start");
    const outgoing = d.edges.filter((e) => e.from === key && e.type === "finish-to-start");
    d.edges = d.edges.filter((e) => (e.from !== key && e.to !== key) || e.type !== "finish-to-start");
    for (const a of incoming) for (const b of outgoing) edge(a.from, b.to);
  };
  for (const op of ops) {
    if (op.op === "addStage") {
      if (d.stages.some((s) => s.key === op.stage.key)) refuse("duplicate stage");
      if (op.after !== undefined) specOf(op.after);
      if (op.before !== undefined) specOf(op.before);
      const added = structuredClone(op.stage); added.title = patchText(added.title) || "Stage";
      if (added.teamHint !== undefined) added.teamHint = patchText(added.teamHint) || "Team";
      newRow(added);
      const index = op.before !== undefined ? d.stages.findIndex((s) => s.key === op.before)
        : d.stages.findIndex((s) => s.key === op.after) + 1;
      d.stages.splice(index, 0, added);
      if (op.after !== undefined && op.before !== undefined)
        d.edges = d.edges.filter((e) => !(e.type === "finish-to-start" && e.from === op.after && e.to === op.before));
      if (op.after !== undefined) edge(op.after, added.key);
      if (op.before !== undefined) edge(added.key, op.before);
      continue;
    }
    const spec = specOf(op.stage); const row = rowOf(op.stage);
    switch (op.op) {
      case "addTaskWithinStage": {
        if (["done", "skipped", "failed"].includes(row.state)) refuse("stage is finished");
        if (row.extra_tasks >= 20 || 2 + row.extra_tasks > (spec.limits?.maxTasks ?? 1)) refuse("stage task limit reached");
        row.extra_tasks++;
        row.extra_titles = JSON.stringify([...(JSON.parse(row.extra_titles) as string[]), patchText(op.title) || "Additional task"]);
        break;
      }
      case "skipOptionalStage":
        if (!spec.optional) refuse("stage is required");
        if (!["pending", "ready", "blocked"].includes(row.state)) refuse("stage has started");
        if (hasTasks(op.stage)) refuse("stage has task history");
        row.state = "skipped"; row.blocked_reason = "skipped by patch"; break;
      case "splitStage": {
        pristine(op.stage, true);
        const first = op.into[0]!.key; const last = op.into[op.into.length - 1]!.key;
        const replacements = op.into.map((part, index) => {
          const s = { ...structuredClone(spec), key: part.key, title: patchText(part.title) || "Stage",
            requiredCapabilities: part.requiredCapabilities ?? spec.requiredCapabilities,
            inputs: index === 0 ? spec.inputs : [], outputs: index === op.into.length - 1 ? spec.outputs : [] };
          if (index !== op.into.length - 1) delete s.parallelGroup;
          return s;
        });
        for (const s of replacements) { if (d.stages.some((v) => v.key === s.key)) refuse("duplicate stage"); newRow(s); }
        d.stages.splice(d.stages.indexOf(spec), 1, ...replacements); stages.delete(op.stage);
        d.edges = d.edges.map((e) => ({ ...e, from: e.from === op.stage ? last : e.from, to: e.to === op.stage ? first : e.to }));
        d.gates = d.gates.map((g) => ({ ...g, before: g.before === op.stage ? first : g.before }));
        const rename = (c: Condition): void => {
          if ("all" in c) c.all.forEach(rename); else if ("any" in c) c.any.forEach(rename); else if ("not" in c) rename(c.not);
          else if ("fact" in c && c.stage === op.stage) c.stage = last;
        };
        for (const s of d.stages) { if (s.includeIf) rename(s.includeIf); if (s.skipIf) rename(s.skipIf); }
        for (const e of d.edges) if (e.when) rename(e.when);
        for (const g of d.gates) if (g.when) rename(g.when);
        for (let i = 1; i < replacements.length; i++) edge(replacements[i - 1]!.key, replacements[i]!.key);
        break;
      }
      case "reorderStages": {
        pristine(op.stage); specOf(op.after);
        if (op.stage === op.after) refuse("invalid placement");
        detach(op.stage);
        const outgoing = d.edges.filter((e) => e.from === op.after && e.type === "finish-to-start");
        d.edges = d.edges.filter((e) => !(e.from === op.after && e.type === "finish-to-start"));
        edge(op.after, op.stage); for (const e of outgoing) edge(op.stage, e.to);
        d.stages = d.stages.filter((s) => s.key !== op.stage);
        d.stages.splice(d.stages.findIndex((s) => s.key === op.after) + 1, 0, spec);
        break;
      }
      case "removeRequiredStage":
        pristine(op.stage); detach(op.stage);
        d.edges = d.edges.filter((e) => e.from !== op.stage && e.to !== op.stage);
        d.stages = d.stages.filter((s) => s.key !== op.stage); stages.delete(op.stage);
        d.gates = d.gates.filter((g) => g.before !== op.stage);
        d.joins = d.joins.filter((j) => d.stages.some((s) => s.parallelGroup === j.group));
        break;
    }
  }
  d.revision = instance.definition_revision + 1;
  const validation = validateWorkflowDefinition(d);
  if (!validation.ok) refuse(validation.errors.slice(0, 3).map((message) => message.replace(/cycle .*/, "cycle")).join("; ").slice(0, 300));
  return { definition: workflowDefinitionSchema.parse(d), stages, original: rows };
}
function apply(deps: WorkflowEngineDeps, projectId: string, instanceId: string, patchId: string, prepared: ReturnType<typeof prepare>): void {
  const { raw } = deps;
  for (const row of prepared.original) if (!prepared.stages.has(row.stage_key))
    raw.prepare("DELETE FROM workflow_stages WHERE project_id = ? AND instance_id = ? AND stage_key = ?").run(projectId, instanceId, row.stage_key);
  for (const row of prepared.stages.values()) raw.prepare(`INSERT INTO workflow_stages
    (project_id,instance_id,stage_key,phase,state,optional,loop_count,engagement_id,blocked_reason,extra_tasks,extra_titles)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,instance_id,stage_key) DO UPDATE SET
    state=excluded.state, blocked_reason=excluded.blocked_reason, extra_tasks=excluded.extra_tasks, extra_titles=excluded.extra_titles`)
    .run(projectId, instanceId, row.stage_key, row.phase, row.state, row.optional, row.loop_count, row.engagement_id, row.blocked_reason, row.extra_tasks, row.extra_titles);
  raw.prepare("UPDATE workflow_instances SET definition_json = ?, definition_revision = ?, revision = revision + 1 WHERE project_id = ? AND id = ?")
    .run(JSON.stringify(prepared.definition), prepared.definition.revision, projectId, instanceId);
  const revision = getWorkflowInstance(raw, projectId, instanceId)!.revision;
  raw.prepare("UPDATE workflow_patches SET state = 'applied', applied_revision = ? WHERE project_id = ? AND id = ?").run(revision, projectId, patchId);
  if (deps.hub.currentCursor(projectId) !== null) deps.hub.append({ projectId, causationId: patchId,
    payload: { type: "entity.changed", entity: { kind: "workflow-instance", id: instanceId, revision } } });
  advanceWorkflow(deps, projectId, instanceId);
}
export function proposePatch(deps: WorkflowEngineDeps, input: {
  projectId: string; instanceId: string; expectedRevision?: number; ops: WorkflowPatchOp[]; reason: string;
  proposedBy: "operator" | "lead"; sourceTaskId?: string;
}): PatchRecord {
  return deps.hub.transaction(() => {
    const { raw } = deps; const { projectId, instanceId } = input;
    const instance = getWorkflowInstance(raw, projectId, instanceId);
    if (!instance) throw new PatchError("not-found", "workflow not found");
    if (input.expectedRevision !== undefined && instance.revision !== input.expectedRevision) throw new PatchError("conflict", "revision changed");
    if (isTerminalWorkflowState(instance.state)) throw new PatchError("conflict", "terminal workflow");
    const parsed = workflowPatchSchema.safeParse({ ops: input.ops, reason: input.reason });
    if (!parsed.success || JSON.stringify(input.ops).length > 65536) throw new PatchError("validation", "invalid patch");
    const count = raw.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(number),0) AS last FROM workflow_patches WHERE project_id = ? AND instance_id = ?")
      .get(projectId, instanceId) as { n: number; last: number };
    if (count.n >= 50) throw new PatchError("conflict", "patch limit reached");
    const definition = workflowDefinitionSchema.parse(JSON.parse(instance.definition_json) as unknown);
    const levels: WorkflowPatchPolicy[] = ["auto", "approval", "operator"];
    const policy = levels[Math.max(...parsed.data.ops.map((op) => levels.indexOf(patchPolicyOf(op, definition))))]!;
    const pending = input.proposedBy === "lead" && policy !== "auto";
    if (pending && (raw.prepare("SELECT COUNT(*) AS n FROM workflow_patches WHERE project_id = ? AND instance_id = ? AND state = 'pending'")
      .get(projectId, instanceId) as { n: number }).n >= 3) throw new PatchError("conflict", "pending patch limit reached");
    let prepared: ReturnType<typeof prepare> | undefined; let refusal: string | null = null;
    try { prepared = prepare(deps, projectId, instanceId, parsed.data.ops); }
    catch (error) { if (!(error instanceof Refusal)) throw error; refusal = error.message; }
    const id = (deps.newId ?? randomUUID)();
    raw.prepare(`INSERT INTO workflow_patches (project_id,instance_id,id,number,proposed_by,source_task_id,reason,ops_json,policy,state,refusal,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(projectId, instanceId, id, count.last + 1, input.proposedBy, input.sourceTaskId ?? null,
      patchText(input.reason).slice(0, 500), JSON.stringify(parsed.data.ops), policy, refusal ? "refused" : "pending", refusal, deps.clock().toISOString());
    if (prepared && !pending) apply(deps, projectId, instanceId, id, prepared);
    return view(raw.prepare("SELECT * FROM workflow_patches WHERE project_id = ? AND id = ?").get(projectId, id) as PatchRow);
  });
}
export function decidePatch(deps: WorkflowEngineDeps, input: {
  projectId: string; patchId: string; decision: "approve" | "reject"; comment?: string | undefined;
}): PatchRecord {
  return deps.hub.transaction(() => {
    const { raw } = deps;
    const row = raw.prepare("SELECT * FROM workflow_patches WHERE project_id = ? AND id = ?").get(input.projectId, input.patchId) as PatchRow | undefined;
    if (!row) throw new PatchError("not-found", "patch not found");
    if (row.state !== "pending") throw new PatchError("conflict", "patch already decided");
    raw.prepare("UPDATE workflow_patches SET decided_by = 'operator', decided_at = ?, comment = ? WHERE project_id = ? AND id = ?")
      .run(deps.clock().toISOString(), input.comment === undefined ? null : patchText(input.comment).slice(0, 500), input.projectId, input.patchId);
    if (input.decision === "reject") raw.prepare("UPDATE workflow_patches SET state = 'rejected' WHERE project_id = ? AND id = ?").run(input.projectId, input.patchId);
    else {
      let prepared: ReturnType<typeof prepare> | undefined;
      try { prepared = prepare(deps, input.projectId, row.instance_id, workflowPatchSchema.shape.ops.parse(JSON.parse(row.ops_json) as unknown)); }
      catch (error) {
        if (!(error instanceof Refusal)) throw error;
        raw.prepare("UPDATE workflow_patches SET state = 'refused', refusal = 'stale' WHERE project_id = ? AND id = ?").run(input.projectId, input.patchId);
      }
      if (prepared) apply(deps, input.projectId, row.instance_id, input.patchId, prepared);
    }
    return view(raw.prepare("SELECT * FROM workflow_patches WHERE project_id = ? AND id = ?").get(input.projectId, input.patchId) as PatchRow);
  });
}
