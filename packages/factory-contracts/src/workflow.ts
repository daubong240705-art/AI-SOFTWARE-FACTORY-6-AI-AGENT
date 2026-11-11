import { z } from "zod";
import { labelSchema } from "./base.js";
import { artifactKindSchema, artifactStatusSchema } from "./knowledge.js";

export const workflowKeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/);
const parameterName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/);
const scalar = z.union([z.boolean(), z.string().max(500), z.number().finite()]);
export type WorkflowValue = z.infer<typeof scalar>;
export type Condition =
  | { param: string; op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in"; value: WorkflowValue | WorkflowValue[] }
  | { fact: "project.hasApprovedArtifact" | "review.verdict" | "artifact.status" | "check.result" | "monitor.value" | "label";
      kind?: z.infer<typeof artifactKindSchema> | undefined; stage?: string | undefined; check?: string | undefined; monitor?: string | undefined; name?: string | undefined;
      op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in"; value: WorkflowValue | WorkflowValue[] }
  | { all: Condition[] } | { any: Condition[] } | { not: Condition };
const comparison = { op: z.enum(["eq", "ne", "lt", "lte", "gt", "gte", "in"]),
  value: z.union([scalar, z.array(scalar).min(1).max(40)]) };
const leaf = z.union([
  z.strictObject({ param: parameterName, ...comparison }),
  // Fact descriptors: approved-artifact and artifact-status require `kind`;
  // review accepts an optional `stage`; check/monitor require their named identifier;
  // label requires `name`. Values are boolean, verdict/status strings, check/label
  // strings, or monitor numbers respectively. W1a never reads these facts.
  z.strictObject({ fact: z.literal("project.hasApprovedArtifact"), kind: artifactKindSchema, ...comparison }),
  z.strictObject({ fact: z.literal("review.verdict"), stage: workflowKeySchema.optional(), ...comparison }),
  z.strictObject({ fact: z.literal("artifact.status"), kind: artifactKindSchema, stage: workflowKeySchema.optional(), ...comparison }),
  z.strictObject({ fact: z.literal("check.result"), check: labelSchema, ...comparison }),
  z.strictObject({ fact: z.literal("monitor.value"), monitor: labelSchema, ...comparison }),
  z.strictObject({ fact: z.literal("label"), name: labelSchema, ...comparison }),
]).superRefine((condition, ctx) => {
  const values = Array.isArray(condition.value) ? condition.value : [condition.value];
  let valid = condition.op === "in" ? Array.isArray(condition.value) : !Array.isArray(condition.value);
  valid &&= values.every((v) => typeof v === typeof values[0]);
  if (["lt", "lte", "gt", "gte"].includes(condition.op)) valid &&= values.every((v) => typeof v === "number");
  if ("fact" in condition) {
    const fact = condition.fact;
    valid &&= values.every((v) => fact === "project.hasApprovedArtifact" ? typeof v === "boolean"
      : fact === "monitor.value" ? typeof v === "number" : typeof v === "string");
    if (fact === "review.verdict") valid &&= values.every((v) => ["accepted", "approved", "changes-requested", "none"].includes(String(v)));
    if (fact === "artifact.status") valid &&= values.every((v) => artifactStatusSchema.safeParse(v).success);
  }
  if (!valid) ctx.addIssue({ code: "custom", message: "invalid comparison" });
});
// The root is depth one; constructing a bounded grammar also bounds parsing work.
function conditionAt(depth: number): z.ZodType<Condition> {
  if (depth === 4) return leaf;
  const child = conditionAt(depth + 1);
  return z.union([leaf, z.strictObject({ all: z.array(child).min(1).max(20) }),
    z.strictObject({ any: z.array(child).min(1).max(20) }), z.strictObject({ not: child })]);
}
export const workflowConditionSchema = conditionAt(1);
export const conditionSchema = workflowConditionSchema;
const parameter = z.discriminatedUnion("type", [
  z.strictObject({ name: parameterName, type: z.literal("bool"), default: z.boolean() }),
  z.strictObject({ name: parameterName, type: z.literal("string"), default: z.string().max(500) }),
  z.strictObject({ name: parameterName, type: z.literal("number"), default: z.number().finite() }),
  z.strictObject({ name: parameterName, type: z.literal("enum"), default: z.string().max(500),
    values: z.array(z.string().min(1).max(500)).min(1).max(40).refine((v) => new Set(v).size === v.length) }),
]).refine((p) => p.type !== "enum" || p.values.includes(p.default), "invalid enum default");
const patchPolicy = z.enum(["auto", "approval", "operator"]);
export const workflowAllowedPatchesSchema = z.strictObject({
  addTaskWithinStage: patchPolicy.default("auto"), skipOptionalStage: patchPolicy.default("auto"),
  splitStage: patchPolicy.default("auto"), addStage: patchPolicy.default("approval"),
  reorderStages: patchPolicy.default("approval"), removeRequiredStage: patchPolicy.default("operator"),
}).refine((p) => p.removeRequiredStage !== "auto", "required stage removal cannot be automatic");
const autonomyLevel = z.enum(["L0", "L1", "L2", "L3", "L4"]);
export const workflowStageSchema = z.strictObject({
    key: workflowKeySchema, phase: labelSchema, title: labelSchema,
    requiredCapabilities: z.array(z.string().regex(/^[a-z0-9][a-z0-9.-]{0,39}$/)).max(8),
    teamHint: labelSchema.optional(), optional: z.boolean().default(false),
    includeIf: workflowConditionSchema.optional(), skipIf: workflowConditionSchema.optional(),
    parallelGroup: workflowKeySchema.optional(), placement: z.enum(["portable", "node-bound"]).default("portable"),
    sideEffect: z.enum(["none", "artifact", "code", "external"]).optional(),
    inputs: z.array(z.strictObject({ kind: z.union([artifactKindSchema, z.literal("brief")]), required: z.boolean() })).max(8),
    outputs: z.array(z.strictObject({ kind: artifactKindSchema, mustReach: z.enum(["draft", "reviewed", "approved"]) })).max(8),
    limits: z.strictObject({ maxTasks: z.number().int().min(1).max(50), budgetShare: z.number().min(0).max(1) }).optional(),
  });
export const workflowDefinitionSchema = z.strictObject({
  key: workflowKeySchema, revision: z.number().int().min(1), title: labelSchema, domain: labelSchema.optional(),
  parameters: z.array(parameter).max(20),
  phases: z.array(labelSchema).min(1).max(12),
  stages: z.array(workflowStageSchema).min(1).max(60),
  edges: z.array(z.strictObject({ from: workflowKeySchema, to: workflowKeySchema,
    type: z.enum(["finish-to-start", "artifact-approved", "informs", "rework"]), artifact: artifactKindSchema.optional(),
    when: workflowConditionSchema.optional(), maxLoops: z.number().int().min(1).max(10).optional(),
  }).superRefine((e, ctx) => {
    if (e.type === "artifact-approved" && e.artifact === undefined)
      ctx.addIssue({ code: "custom", message: "artifact required" });
    if (e.type === "rework" ? e.when === undefined || e.maxLoops === undefined : e.maxLoops !== undefined)
      ctx.addIssue({ code: "custom", message: "invalid rework limits" });
  })).max(200),
  joins: z.array(z.strictObject({ group: workflowKeySchema, policy: z.enum(["all", "any", "quorum"]),
    n: z.number().int().min(1).optional() }).refine((j) => j.policy === "quorum" ? j.n !== undefined : j.n === undefined,
  "invalid quorum")).max(60),
  gates: z.array(z.strictObject({ before: workflowKeySchema, kind: z.enum(["execution-gate", "irreversible-action", "review"]),
    approver: z.enum(["operator", "project-lead"]), when: workflowConditionSchema.optional() })).max(200),
  allowedPatches: workflowAllowedPatchesSchema.prefault({}),
  autonomy: z.strictObject({ default: autonomyLevel, crossTeam: autonomyLevel.optional() }).optional(),
  budgets: z.strictObject({ suggestedTokens: z.number().int().min(0), stageShares: z.boolean().optional() }).optional(),
  timeouts: z.strictObject({ stallAfterMinutes: z.number().int().min(1).max(43200),
    maxDurationMinutes: z.number().int().min(1).max(525600) }).optional(),
}).superRefine((d, ctx) => {
  for (const [field, values] of [["parameters", d.parameters.map((p) => p.name)], ["phases", d.phases],
    ["stages", d.stages.map((s) => s.key)], ["joins", d.joins.map((j) => j.group)]] as const)
    if (new Set(values).size !== values.length) ctx.addIssue({ code: "custom", path: [field], message: "duplicate value" });
  for (const [i, stage] of d.stages.entries()) {
    if (!d.phases.includes(stage.phase)) ctx.addIssue({ code: "custom", path: ["stages", i, "phase"], message: "unknown phase" });
    if (!stage.requiredCapabilities.length && !d.gates.some((g) => g.before === stage.key))
      ctx.addIssue({ code: "custom", path: ["stages", i, "requiredCapabilities"], message: "capability or gate required" });
  }
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export type ConditionResult = "true" | "false" | "unknown";
export function evaluateParamCondition(condition: Condition, params: Readonly<Record<string, unknown>>): ConditionResult {
  try {
    const visit = (c: Condition, depth: number): ConditionResult => {
      if (depth > 4) return "unknown";
      if ("fact" in c) return "unknown";
      if ("not" in c) { const r = visit(c.not, depth + 1); return r === "unknown" ? r : r === "true" ? "false" : "true"; }
      if ("all" in c || "any" in c) {
        const all = "all" in c; const results = (all ? c.all : c.any).map((v) => visit(v, depth + 1));
        return all ? results.includes("false") ? "false" : results.includes("unknown") ? "unknown" : "true"
          : results.includes("true") ? "true" : results.includes("unknown") ? "unknown" : "false";
      }
      if (!Object.hasOwn(params, c.param)) return "unknown";
      const actual = params[c.param]; const value = c.value;
      if (c.op === "in") return Array.isArray(value) && value.every((v) => typeof v === typeof actual)
        ? value.includes(actual as WorkflowValue) ? "true" : "false" : "unknown";
      if (Array.isArray(value) || typeof actual !== typeof value) return "unknown";
      let result: boolean;
      if (c.op === "eq" || c.op === "ne") result = c.op === "eq" ? actual === value : actual !== value;
      else if (typeof actual === "number" && typeof value === "number") result = c.op === "lt" ? actual < value
        : c.op === "lte" ? actual <= value : c.op === "gt" ? actual > value : actual >= value;
      else return "unknown";
      return result ? "true" : "false";
    };
    return visit(condition, 1);
  } catch { return "unknown"; }
}

export const workflowInstanceStateSchema = z.enum(["draft", "proposed", "active", "awaiting-approval", "paused",
  "resuming", "suspended", "stalled", "completed", "failed", "cancelled", "superseded"]);
export type WorkflowInstanceState = z.infer<typeof workflowInstanceStateSchema>;
export const WORKFLOW_TRANSITIONS: Readonly<Record<WorkflowInstanceState, readonly WorkflowInstanceState[]>> = {
  draft: ["proposed", "cancelled"], proposed: ["active", "cancelled"],
  active: ["awaiting-approval", "paused", "suspended", "stalled", "completed", "failed", "cancelled", "superseded"],
  "awaiting-approval": ["active", "suspended"], paused: ["resuming", "cancelled"], resuming: ["active", "paused"],
  suspended: ["resuming", "cancelled"], stalled: ["active", "paused"], completed: [], failed: [], cancelled: [], superseded: [],
};
export const canTransitionWorkflow = (from: WorkflowInstanceState, to: WorkflowInstanceState): boolean => WORKFLOW_TRANSITIONS[from].includes(to);
export const isTerminalWorkflowState = (state: WorkflowInstanceState): boolean => WORKFLOW_TRANSITIONS[state].length === 0;
export const workflowStageStateSchema = z.enum(["pending", "ready", "active", "done", "skipped", "failed", "blocked"]);
export type WorkflowStageState = z.infer<typeof workflowStageStateSchema>;

export const workflowPatchOpSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("addTaskWithinStage"), stage: workflowKeySchema, title: z.string().min(1).max(120) }),
  z.strictObject({ op: z.literal("skipOptionalStage"), stage: workflowKeySchema }),
  z.strictObject({ op: z.literal("splitStage"), stage: workflowKeySchema, into: z.array(z.strictObject({
    key: workflowKeySchema, title: z.string().min(1).max(120),
    requiredCapabilities: workflowStageSchema.shape.requiredCapabilities.optional(),
  })).min(2).max(5) }),
  z.strictObject({ op: z.literal("addStage"), stage: workflowStageSchema,
    after: workflowKeySchema.optional(), before: workflowKeySchema.optional(),
  }).refine((op) => op.after !== undefined || op.before !== undefined, "placement required"),
  z.strictObject({ op: z.literal("reorderStages"), stage: workflowKeySchema, after: workflowKeySchema }),
  z.strictObject({ op: z.literal("removeRequiredStage"), stage: workflowKeySchema }),
]);
export const workflowPatchSchema = z.strictObject({ ops: z.array(workflowPatchOpSchema).min(1).max(10), reason: z.string().min(1).max(500) });
export type WorkflowPatchOp = z.infer<typeof workflowPatchOpSchema>;
export type WorkflowPatch = z.infer<typeof workflowPatchSchema>;
export type WorkflowPatchPolicy = "auto" | "approval" | "operator";
/** Always pass the copied instance definition, never a template from the pack registry. */
export function patchPolicyOf(op: WorkflowPatchOp, definition: Pick<WorkflowDefinition, "allowedPatches">): WorkflowPatchPolicy {
  return definition.allowedPatches[op.op];
}
