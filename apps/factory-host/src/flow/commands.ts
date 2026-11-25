import type { Database } from "better-sqlite3";
import { convertWorkflowV1, validateFlow, type ApiError, type FlowCondition, type FlowDefinition, type JsonSubset } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerContext, HandlerMap } from "../commands/pipeline.js";
import { registryPack, type RegistryPack } from "../org/registry.js";
import { advanceProject, cancelRun, fireFlowTimers, insertRun, retryNode, setRun, stopTasks, type FlowEngineDeps } from "./engine.js";
import { boundedJson, definitionOf, flowByKey, flowRef, getFlow, getRun, getVersion, hash, runRef } from "./store.js";
import { activeAgents } from "./work.js";

export const FLOW_COMMANDS = ["flows.create", "flows.save-draft", "flows.publish", "flows.archive", "flows.import-v1",
  "flow-runs.start", "flow-runs.pause", "flow-runs.resume", "flow-runs.cancel", "flow-runs.retry-node"] as const;

const missing = (entity: string) => new CommandError("not-found", `${entity} not found`, "correct-input");
function checkRevision(entity: { revision: number } | undefined, name: string, expected: number): void {
  if (!entity) throw missing(name);
  if (entity.revision !== expected) throw new CommandError("conflict", `${name} revision changed`, "refresh", { currentRevision: entity.revision });
}
function draftKey(raw: Database, projectId: string, flowId: string, key: string): void {
  if (raw.prepare("SELECT 1 FROM flows WHERE project_id=? AND key=? AND id<>?").get(projectId, key, flowId))
    throw new CommandError("conflict", "flow key already exists", "correct-input");
}
function create(ctx: HandlerContext, projectId: string, flowId: string, definition: FlowDefinition, source: string | null) {
  if (!ctx.raw.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId)) throw missing("project");
  if (getFlow(ctx.raw, projectId, flowId)) throw new CommandError("conflict", "flow already exists", "correct-input");
  draftKey(ctx.raw, projectId, flowId, definition.key);
  const now = ctx.clock().toISOString();
  ctx.raw.prepare("INSERT INTO flows VALUES(?,?,1,?,?,?,0,?,?,?)")
    .run(projectId, flowId, definition.key, definition.title, boundedJson(definition), source, now, now);
  return { effects: [flowRef(getFlow(ctx.raw, projectId, flowId)!)] };
}

function knownComparisonType(definition: FlowDefinition, path: string): string | undefined {
  const [root, id, field, ...parts] = path.match(/[A-Za-z0-9_-]+/g) ?? [];
  if (root === "inputs" && id && field === undefined) {
    const type = definition.inputs.find(({ name }) => name === id)?.type;
    return type === "bool" ? "boolean" : type === "number" ? "number" : type ? "string" : undefined;
  }
  if (root === "loop" && id === "iteration" && field === undefined) return "number";
  if (root !== "nodes" || field !== "output" || !parts.length) return;
  const source = definition.nodes.find((node) => node.id === id);
  if (source?.type !== "agent" || !source.outputSchema) return;
  if (["summary", "artifacts"].includes(parts[0]!)) return;
  if (parts[0] === "result") parts.shift();
  let schema: JsonSubset | undefined = source.outputSchema;
  for (const part of parts) {
    schema = schema?.type === "object" && Object.hasOwn(schema.properties, part) ? schema.properties[part]
      : schema?.type === "array" && /^\d+$/.test(part) ? schema.items : undefined;
  }
  return schema?.type === "integer" ? "number" : schema?.type;
}

export function publishIssues(raw: Database, projectId: string, definition: FlowDefinition) {
  const issues: Array<{ code: string; message: string; node?: string; edge?: string }> = validateFlow(definition,
    { agentIds: new Set(activeAgents(raw, projectId).map(({ id }) => id)) });
  const recursive = (target: string, version: "published" | number, visited: Set<string>): boolean => {
    if (target === definition.key) return true;
    const flow = flowByKey(raw, projectId, target);
    const snapshot = flow && getVersion(raw, projectId, flow.id, version === "published" ? undefined : version);
    const key = `${target}/${snapshot?.version}`;
    if (!snapshot || visited.has(key)) return false;
    visited.add(key);
    return definitionOf(snapshot.definition_json).nodes.some((node) => node.type === "subflow" && recursive(node.workflow, node.version, visited));
  };
  for (const node of definition.nodes) {
    if (node.type === "parallel") issues.push({ code: "unsupported", message: "parallel forEach arrives later", node: node.id });
    if (node.type === "orchestrate") issues.push({ code: "unsupported", message: "orchestrate arrives in U6", node: node.id });
    if (node.type === "subflow" && node.workflow !== definition.key && recursive(node.workflow, node.version, new Set()))
      issues.push({ code: "subflow-recursion", message: "Sub-workflow would create recursion", node: node.id });
    const checkCondition = (condition: FlowCondition): void => {
      if ("all" in condition) return condition.all.forEach(checkCondition);
      if ("any" in condition) return condition.any.forEach(checkCondition);
      if ("not" in condition) return checkCondition(condition.not);
      if (!("path" in condition)) return;
      const type = knownComparisonType(definition, condition.path);
      const value = Array.isArray(condition.value) ? condition.value[0] : condition.value;
      if (type && type !== typeof value)
        issues.push({ code: "condition-type", message: `Condition value has the wrong type for ${condition.path}`, node: node.id });
    };
    if (node.type === "condition") node.rules.forEach(({ when }) => checkCondition(when));
    if (node.type === "loop" && node.until) checkCondition(node.until);
  }
  const budget = raw.prepare("SELECT MIN(limit_tokens) AS tokens FROM budgets WHERE project_id=? AND scope='project'").get(projectId) as { tokens: number | null };
  if (definition.settings.budgetTokens && budget.tokens !== null && definition.settings.budgetTokens > budget.tokens)
    issues.push({ code: "budget", message: "Suggested tokens exceed the project budget" });
  return issues;
}

function assertPublishable(raw: Database, projectId: string, definition: FlowDefinition): void {
  const issues = publishIssues(raw, projectId, definition);
  if (!issues.length) return;
  const extra: Pick<ApiError, "fields"> & { currentRevision?: number } = { fields: issues.slice(0, 50).map(({ node, edge, message }) => ({
    path: node ? `nodes.${node}` : edge ? `edges.${edge}` : "definition", message,
  })) };
  throw new CommandError("validation", `${issues.length} issue(s) block publishing`, "correct-input", extra);
}

export function createFlowHandlers({ engine, packs = [] }: { engine: FlowEngineDeps; packs?: readonly RegistryPack[] }): Pick<HandlerMap, typeof FLOW_COMMANDS[number]> {
  return {
    "flows.create": (ctx, { projectId, payload }) => create(ctx, projectId, payload.flowId, payload.definition, null),
    "flows.save-draft": (ctx, { projectId, payload }) => {
      const flow = getFlow(ctx.raw, projectId, payload.flowId);
      checkRevision(flow, "flow", payload.expectedRevision);
      const definition = payload.definition;
      draftKey(ctx.raw, projectId, payload.flowId, definition.key);
      ctx.raw.prepare("UPDATE flows SET key=?,title=?,draft_json=?,updated_at=?,revision=revision+1 WHERE project_id=? AND id=?")
        .run(definition.key, definition.title, boundedJson(definition), ctx.clock().toISOString(), projectId, payload.flowId);
      return { effects: [flowRef(getFlow(ctx.raw, projectId, payload.flowId)!)] };
    },
    "flows.publish": (ctx, { projectId, payload }) => {
      const flow = getFlow(ctx.raw, projectId, payload.flowId);
      checkRevision(flow, "flow", payload.expectedRevision);
      const draft = flow!.draft_json;
      assertPublishable(ctx.raw, projectId, definitionOf(draft));
      const digest = hash(draft);
      const previous = getVersion(ctx.raw, projectId, payload.flowId);
      if (previous?.sha256 !== digest) {
        const now = ctx.clock().toISOString();
        ctx.raw.prepare("INSERT INTO flow_versions VALUES(?,?,?,?,?,?,?)")
          .run(projectId, payload.flowId, (previous?.version ?? 0) + 1, draft, digest, ctx.actorId, now);
        ctx.raw.prepare("UPDATE flows SET revision=revision+1,updated_at=? WHERE project_id=? AND id=?").run(now, projectId, payload.flowId);
      }
      return { effects: [flowRef(getFlow(ctx.raw, projectId, payload.flowId)!)] };
    },
    "flows.archive": (ctx, { projectId, payload }) => {
      const flow = getFlow(ctx.raw, projectId, payload.flowId);
      checkRevision(flow, "flow", payload.expectedRevision);
      ctx.raw.prepare("UPDATE flows SET archived=?,revision=revision+1,updated_at=? WHERE project_id=? AND id=?")
        .run(Number(payload.archived), ctx.clock().toISOString(), projectId, payload.flowId);
      return { effects: [flowRef(getFlow(ctx.raw, projectId, payload.flowId)!)] };
    },
    "flows.import-v1": (ctx, { projectId, payload }) => {
      const pack = packs.find(({ key }) => key === payload.packKey);
      const match = pack && registryPack(pack).files.workflows.find(({ definition }) => definition.key === payload.definitionKey);
      if (!match) throw missing("workflow pack definition");
      return create(ctx, projectId, payload.flowId, convertWorkflowV1(match.definition).definition, `pack:${payload.packKey}`);
    },
    "flow-runs.start": (ctx, { projectId, payload }) => {
      const flow = getFlow(ctx.raw, projectId, payload.flowId);
      if (!flow) throw missing("flow");
      const test = payload.test || payload.version === "draft";
      if (!test && (payload.mockAgents || Object.keys(payload.pinned).length))
        throw new CommandError("validation", "pinned outputs and mockAgents require a test run", "correct-input");
      const version = payload.version === "draft" ? undefined : getVersion(ctx.raw, projectId, flow.id, typeof payload.version === "number" ? payload.version : undefined);
      if (!version && payload.version !== "draft") throw missing("published flow version");
      if (!version) assertPublishable(ctx.raw, projectId, definitionOf(flow.draft_json));
      insertRun(engine, flow, { id: payload.runId, ...(version ? { version } : {}), inputs: payload.inputs, pinned: payload.pinned,
        test, mockAgents: payload.mockAgents, trigger: "manual" });
      advanceProject(engine, projectId);
      return { effects: [runRef(getRun(ctx.raw, projectId, payload.runId)!)] };
    },
    "flow-runs.pause": (ctx, { projectId, payload }) => {
      const run = getRun(ctx.raw, projectId, payload.runId);
      checkRevision(run, "flow run", payload.expectedRevision);
      if (!["running", "waiting", "stalled"].includes(run!.state)) throw new CommandError("conflict", "run cannot be paused", "refresh");
      setRun(engine, run!, "paused", "paused by operator");
      if (payload.stopRunning) stopTasks(engine, run!, false);
      return { effects: [runRef(run!)] };
    },
    "flow-runs.resume": (ctx, { projectId, payload }) => {
      const run = getRun(ctx.raw, projectId, payload.runId);
      checkRevision(run, "flow run", payload.expectedRevision);
      if (run!.state !== "paused") throw new CommandError("conflict", "run is not paused", "refresh");
      setRun(engine, run!, "running");
      advanceProject(engine, projectId);
      fireFlowTimers(engine, projectId);
      return { effects: [runRef(getRun(ctx.raw, projectId, payload.runId)!)] };
    },
    "flow-runs.cancel": (ctx, { projectId, payload }) => {
      const run = getRun(ctx.raw, projectId, payload.runId);
      checkRevision(run, "flow run", payload.expectedRevision);
      cancelRun(engine, run!, payload.reason);
      advanceProject(engine, projectId);
      return { effects: [runRef(run!)] };
    },
    "flow-runs.retry-node": (ctx, { projectId, payload }) => {
      const run = getRun(ctx.raw, projectId, payload.runId);
      checkRevision(run, "flow run", payload.expectedRevision);
      retryNode(engine, run!, payload.nodeId);
      return { effects: [runRef(getRun(ctx.raw, projectId, payload.runId)!)] };
    },
  };
}
