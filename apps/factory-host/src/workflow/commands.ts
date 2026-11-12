import { writeWorkflowState } from "./state.js";
import { proposePatch, decidePatch, PatchError } from "./patch.js";
import { canTransitionWorkflow, evaluateParamCondition, workflowDefinitionSchema,
  type WorkflowInstanceState, type WorkflowValue } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerContext, HandlerMap } from "../commands/pipeline.js";
import type { RegistryPack } from "../org/registry.js";
import { matchWorkflowDefinitions } from "./definitions.js";
import { getWorkflowInstance } from "./service.js";
import { validateWorkflowDefinition } from "./validate.js";
import { advanceWorkflow, type WorkflowEngineDeps } from "./engine.js";

export const WORKFLOW_COMMANDS = ["workflows.create", "workflows.start", "workflows.pause", "workflows.resume", "workflows.cancel", "workflows.assign-stage", "workflows.patch", "workflows.decide-patch"] as const;
function requireProject(ctx: HandlerContext, projectId: string): void {
  if (!ctx.raw.prepare("SELECT id FROM projects WHERE id = ?").get(projectId))
    throw new CommandError("not-found", "project not found", "correct-input");
}
function transition(ctx: HandlerContext, projectId: string, payload: { instanceId: string; expectedRevision: number },
  target: WorkflowInstanceState, required?: WorkflowInstanceState, reason?: string) {
  requireProject(ctx, projectId);
  const row = getWorkflowInstance(ctx.raw, projectId, payload.instanceId);
  if (!row) throw new CommandError("not-found", "workflow not found", "correct-input");
  if (row.revision !== payload.expectedRevision)
    throw new CommandError("conflict", "revision changed", "refresh", { currentRevision: row.revision });
  // W1a collapses paused -> resuming -> active atomically. W1b adds freshness checks in resuming.
  const allowed = row.state === "paused" && target === "active"
    ? canTransitionWorkflow(row.state, "resuming") && canTransitionWorkflow("resuming", target)
    : canTransitionWorkflow(row.state, target);
  if ((required !== undefined && row.state !== required) || !allowed)
    throw new CommandError("conflict", "invalid workflow transition", "refresh");
  const now = ctx.clock().toISOString();
  writeWorkflowState(ctx, row, target, reason ?? null, now);
  return { effects: [{ kind: "workflow-instance" as const, id: row.id, revision: row.revision + 1 }] };
}
/** Resuming an instance stalled on "rework limit reached" is the Operator's explicit decision to allow one more loop. */
function grantReworkExtension(raw: HandlerContext["raw"], projectId: string, row: { id: string; definition_json: string }): void {
  const blocked = raw.prepare("SELECT stage_key FROM workflow_stages WHERE project_id = ? AND instance_id = ? AND blocked_reason = ?")
    .all(projectId, row.id, "rework limit reached") as { stage_key: string }[];
  if (!blocked.length) return;
  const definition = JSON.parse(row.definition_json) as { edges?: { type: string; from: string; to: string; maxLoops?: number }[] };
  for (const source of blocked) {
    for (const edge of (definition.edges ?? []).filter((e) => e.type === "rework" && e.from === source.stage_key)) {
      const dest = raw.prepare("SELECT loop_count, extra_loops FROM workflow_stages WHERE project_id = ? AND instance_id = ? AND stage_key = ?")
        .get(projectId, row.id, edge.to) as { loop_count: number; extra_loops: number } | undefined;
      if (!dest || dest.loop_count < (edge.maxLoops ?? 0) + dest.extra_loops) continue;
      // workflow_stages.loop_count is limited to 10 by the schema, so the total allowance can never exceed it.
      if ((edge.maxLoops ?? 0) + dest.extra_loops >= 10) throw new CommandError("conflict", "rework extension limit reached", "correct-input");
      raw.prepare("UPDATE workflow_stages SET extra_loops = extra_loops + 1 WHERE project_id = ? AND instance_id = ? AND stage_key = ?")
        .run(projectId, row.id, edge.to);
    }
    raw.prepare("UPDATE workflow_stages SET state = 'done', blocked_reason = NULL WHERE project_id = ? AND instance_id = ? AND stage_key = ?")
      .run(projectId, row.id, source.stage_key);
  }
}
export function createWorkflowHandlers(deps: { packs: readonly RegistryPack[]; engine?: WorkflowEngineDeps }): Partial<HandlerMap> {
  const patchCommand = (ctx: HandlerContext, projectId: string, action: () => { instanceId: string }) => {
    if (ctx.actorId !== "operator") throw new CommandError("validation", "operator required", "correct-input");
    try {
      const record = action();
      return { effects: [{ kind: "workflow-instance" as const, id: record.instanceId,
        revision: getWorkflowInstance(ctx.raw, projectId, record.instanceId)!.revision }] };
    } catch (error) {
      if (!(error instanceof PatchError)) throw error;
      throw new CommandError(error.code, error.message, error.code === "conflict" ? "refresh" : "correct-input");
    }
  };
  return {
    "workflows.patch": (ctx, { projectId, payload }) => {
      requireProject(ctx, projectId);
      return patchCommand(ctx, projectId, () => proposePatch({ ...ctx, ...deps.engine }, { projectId, ...payload, proposedBy: "operator" }));
    },
    "workflows.decide-patch": (ctx, { projectId, payload }) => {
      requireProject(ctx, projectId);
      return patchCommand(ctx, projectId, () => decidePatch({ ...ctx, ...deps.engine }, { projectId, ...payload }));
    },
    "workflows.create": (ctx, { projectId, payload }) => {
      requireProject(ctx, projectId);
      if (getWorkflowInstance(ctx.raw, projectId, payload.instanceId))
        throw new CommandError("conflict", "workflow id already exists", "correct-input");
      const matches = matchWorkflowDefinitions(deps.packs, { definitionKey: payload.definitionKey,
        ...(payload.packKey === undefined ? {} : { packKey: payload.packKey }) });
      if (matches.length !== 1) throw new CommandError("validation", matches.length ? "ambiguous workflow definition" : "workflow definition not found", "correct-input");
      const { entry, definition: input } = matches[0]!;
      const parsed = workflowDefinitionSchema.safeParse(input);
      if (!parsed.success || !validateWorkflowDefinition(parsed.data).ok)
        throw new CommandError("validation", "invalid workflow definition", "correct-input");
      const definition = parsed.data; const overrides = payload.params ?? {};
      const params: Record<string, WorkflowValue> = {};
      if (Object.keys(overrides).some((name) => !definition.parameters.some((p) => p.name === name)))
        throw new CommandError("validation", "invalid workflow parameters", "correct-input");
      for (const p of definition.parameters) {
        const value = Object.hasOwn(overrides, p.name) ? overrides[p.name]! : p.default;
        const type = p.type === "bool" ? "boolean" : p.type === "enum" ? "string" : p.type;
        if (typeof value !== type || (p.type === "enum" && !p.values.includes(String(value))))
          throw new CommandError("validation", "invalid workflow parameters", "correct-input");
        Object.defineProperty(params, p.name, { value, enumerable: true, configurable: true, writable: true });
      }
      const latest = ctx.raw.prepare("SELECT MAX(created_at) AS at FROM workflow_instances WHERE project_id = ?").get(projectId) as { at: string | null };
      const createdAt = new Date(Math.max(ctx.clock().getTime(), latest.at === null ? 0 : Date.parse(latest.at) + 1)).toISOString();
      ctx.raw.prepare(`INSERT INTO workflow_instances (project_id,id,revision,key,pack_key,pack_version,definition_revision,
        definition_json,params_json,title,state,created_at) VALUES (?,?,1,?,?,?,?,?,?,?,'proposed',?)`)
        .run(projectId, payload.instanceId, definition.key, entry.key, entry.version, definition.revision,
          JSON.stringify(definition), JSON.stringify(params), payload.title ?? definition.title, createdAt);
      const insert = ctx.raw.prepare("INSERT INTO workflow_stages (project_id,instance_id,stage_key,phase,state,optional) VALUES (?,?,?,?,?,?)");
      for (const stage of definition.stages) insert.run(projectId, payload.instanceId, stage.key, stage.phase,
        stage.includeIf && evaluateParamCondition(stage.includeIf, params) === "false" ? "skipped" : "pending", Number(stage.optional));
      return { effects: [{ kind: "workflow-instance", id: payload.instanceId, revision: 1 }] };
    },
    "workflows.start": (ctx, { projectId, payload }) => {
      const result = transition(ctx, projectId, payload, "active", "proposed");
      if (deps.engine) advanceWorkflow(deps.engine, projectId, payload.instanceId);
      return result;
    },
    "workflows.pause": (ctx, { projectId, payload }) => transition(ctx, projectId, payload, "paused", "active", payload.reason),
    "workflows.resume": (ctx, { projectId, payload }) => {
      const row = getWorkflowInstance(ctx.raw, projectId, payload.instanceId);
      const result = transition(ctx, projectId, payload, "active", deps.engine && row?.state === "stalled" ? "stalled" : "paused");
      if (deps.engine && row?.state === "stalled") grantReworkExtension(ctx.raw, projectId, row);
      if (deps.engine) advanceWorkflow(deps.engine, projectId, payload.instanceId);
      return result;
    },
    "workflows.cancel": (ctx, { projectId, payload }) => transition(ctx, projectId, payload, "cancelled", undefined, payload.reason),
    "workflows.assign-stage": (ctx, { projectId, payload }) => {
      requireProject(ctx, projectId);
      const row = getWorkflowInstance(ctx.raw, projectId, payload.instanceId);
      if (!row) throw new CommandError("not-found", "workflow not found", "correct-input");
      if (row.revision !== payload.expectedRevision) throw new CommandError("conflict", "revision changed", "refresh", { currentRevision: row.revision });
      const stage = ctx.raw.prepare("SELECT state FROM workflow_stages WHERE project_id = ? AND instance_id = ? AND stage_key = ?")
        .get(projectId, row.id, payload.stageKey) as { state: string } | undefined;
      if (!stage) throw new CommandError("not-found", "stage not found", "correct-input");
      if (!["pending", "blocked"].includes(stage.state)) throw new CommandError("conflict", "stage cannot be assigned", "refresh");
      if (payload.engagementId !== null && !ctx.raw.prepare("SELECT id FROM engagements WHERE project_id = ? AND id = ?").get(projectId, payload.engagementId))
        throw new CommandError("not-found", "engagement not found in project", "correct-input");
      ctx.raw.prepare("UPDATE workflow_stages SET engagement_id = ?, blocked_reason = NULL, state = 'pending' WHERE project_id = ? AND instance_id = ? AND stage_key = ?")
        .run(payload.engagementId, projectId, row.id, payload.stageKey);
      ctx.raw.prepare("UPDATE workflow_instances SET revision = revision + 1, last_progress_at = ? WHERE project_id = ? AND id = ?").run(ctx.clock().toISOString(), projectId, row.id);
      if (deps.engine) advanceWorkflow(deps.engine, projectId, row.id);
      return { effects: [{ kind: "workflow-instance", id: row.id, revision: getWorkflowInstance(ctx.raw, projectId, row.id)!.revision }] };
    },
  };
}
