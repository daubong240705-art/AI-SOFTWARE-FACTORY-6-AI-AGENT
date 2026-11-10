import { proposePatch, decidePatch, PatchError } from "./patch.js";
import { canTransitionWorkflow, evaluateParamCondition, isTerminalWorkflowState, workflowDefinitionSchema,
  type WorkflowInstanceState, type WorkflowValue } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerContext, HandlerMap } from "../commands/pipeline.js";
import { registryPack, type RegistryPack } from "../org/registry.js";
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
  ctx.raw.prepare(`UPDATE workflow_instances SET state = ?, state_reason = ?, revision = revision + 1,
    started_at = ?, ended_at = ? WHERE project_id = ? AND id = ? AND revision = ?`)
    .run(target, reason ?? null, row.started_at ?? (target === "active" ? now : null),
      isTerminalWorkflowState(target) ? now : null, projectId, row.id, payload.expectedRevision);
  return { effects: [{ kind: "workflow-instance" as const, id: row.id, revision: row.revision + 1 }] };
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
      const matches = deps.packs.filter((entry) => payload.packKey === undefined || entry.key === payload.packKey)
        .flatMap((entry) => registryPack(entry).files.workflows.filter((file) => file.definition.key === payload.definitionKey)
          .map((file) => ({ entry, definition: file.definition })));
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
      ctx.raw.prepare("UPDATE workflow_instances SET revision = revision + 1 WHERE project_id = ? AND id = ?").run(projectId, row.id);
      if (deps.engine) advanceWorkflow(deps.engine, projectId, row.id);
      return { effects: [{ kind: "workflow-instance", id: row.id, revision: getWorkflowInstance(ctx.raw, projectId, row.id)!.revision }] };
    },
  };
}
