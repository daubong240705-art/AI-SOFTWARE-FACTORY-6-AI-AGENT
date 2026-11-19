import { z } from "zod";
import { agentSelectorSchema } from "./agents.js";
import { labelSchema } from "./base.js";
import { workflowConditionSchema, workflowKeySchema, type Condition, type WorkflowValue } from "./workflow.js";

export const flowNodeIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
export const flowPortSchema = z.string().regex(/^[a-z][a-z0-9-]{0,23}$/);
export const flowPathSchema = z.string().max(200).regex(/^(trigger|inputs|nodes|loop|item|run)(\.[A-Za-z0-9_-]+|\[\d{1,3}\])*$/);
export const flowTemplateSchema = z.string().max(20_000);

const inputName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/);
const scalar = z.union([z.boolean(), z.string().max(4000), z.number().finite()]);
const comparison = {
  op: z.enum(["eq", "ne", "lt", "lte", "gt", "gte", "in"]),
  value: z.union([scalar, z.array(scalar).min(1).max(40)]),
};
type FactCondition = Extract<Condition, { fact: string }>;
type ParamCondition = Extract<Condition, { param: string }>;
type PathCondition = { path: string; op: ParamCondition["op"]; value: WorkflowValue | WorkflowValue[] };
export type FlowCondition = ParamCondition | FactCondition | PathCondition
  | { all: FlowCondition[] } | { any: FlowCondition[] } | { not: FlowCondition };

const conditionLeaf = z.union([
  z.union([
    z.strictObject({ param: inputName, ...comparison }),
    z.strictObject({ path: flowPathSchema, ...comparison }),
  ]).refine(({ op, value }) => {
    if (Array.isArray(value)) return op === "in" && value.every((item) => typeof item === typeof value[0]);
    if (op === "eq" || op === "ne") return true;
    return op !== "in" && typeof value === "number";
  }, "invalid comparison"),
  z.unknown().refine((value): boolean => typeof value === "object" && value !== null && Object.hasOwn(value, "fact"))
    .pipe(workflowConditionSchema).transform((condition) => condition as FactCondition),
]);

function conditionAt(depth: number): z.ZodType<FlowCondition> {
  if (depth === 4) return conditionLeaf;
  const child = conditionAt(depth + 1);
  return z.union([
    conditionLeaf,
    z.strictObject({ all: z.array(child).min(1).max(20) }),
    z.strictObject({ any: z.array(child).min(1).max(20) }),
    z.strictObject({ not: child }),
  ]);
}
export const flowConditionSchema = conditionAt(1);

export type JsonSubset =
  | { type: "object"; properties: Record<string, JsonSubset>; required?: string[] | undefined }
  | { type: "array"; items: JsonSubset; maxItems?: number | undefined }
  | { type: "string"; enum?: string[] | undefined; maxLength?: number | undefined }
  | { type: "number" } | { type: "integer" } | { type: "boolean" };

const positiveInt = z.number().int().positive();
const size = z.number().int().nonnegative();

function jsonSubsetAt(depth: number): z.ZodType<JsonSubset> {
  const child = depth === 4 ? z.never() : jsonSubsetAt(depth + 1);
  return z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("object"), properties: z.record(z.string(), child), required: z.array(z.string()).optional() }),
    z.strictObject({ type: z.literal("array"), items: child, maxItems: size.optional() }),
    z.strictObject({ type: z.literal("string"), enum: z.array(z.string()).optional(), maxLength: size.optional() }),
    z.strictObject({ type: z.literal("number") }),
    z.strictObject({ type: z.literal("integer") }),
    z.strictObject({ type: z.literal("boolean") }),
  ]);
}
export const jsonSubsetSchema = jsonSubsetAt(1);

const common = {
  id: flowNodeIdSchema,
  title: labelSchema,
  retry: z.strictObject({ max: size.max(5), backoffSeconds: positiveInt.max(3600) }).optional(),
  timeoutMinutes: positiveInt.max(10080).optional(),
  onError: z.enum(["fail", "continue", "port"]).default("fail"),
};
const agent = z.strictObject({ agent: agentSelectorSchema });
const rules = z.array(z.strictObject({ when: flowConditionSchema, port: flowPortSchema })).min(1).max(10)
  .refine((items) => items.every(({ port }) => port !== "else") && new Set(items.map(({ port }) => port)).size === items.length,
    "Rule ports must be unique and cannot be named else");

const nodes = z.discriminatedUnion("type", [
  z.strictObject({ ...common, type: z.literal("trigger"), trigger: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("manual") }),
    z.strictObject({ kind: z.literal("chat") }),
    z.strictObject({ kind: z.literal("schedule"), cron: z.string().min(1).max(120), timezone: z.string().optional() }),
    z.strictObject({ kind: z.literal("webhook") }),
    z.strictObject({ kind: z.literal("event"), event: z.enum(["task.created", "task.done", "artifact.approved", "run.completed"]) }),
    z.strictObject({ kind: z.literal("api") }),
  ]) }),
  z.strictObject({ ...common, type: z.literal("agent"), agent: agentSelectorSchema,
    task: z.strictObject({ title: flowTemplateSchema.max(160), instructions: flowTemplateSchema,
      acceptance: z.array(z.string().min(1).max(500)).min(1).max(8), inputs: z.array(flowPathSchema).max(8) }),
    review: z.union([z.enum(["none", "human"]), agent]).default("none"), outputSchema: jsonSubsetSchema.optional() }),
  z.strictObject({ ...common, type: z.literal("action"),
    action: z.enum(["http.request", "git.push-branch", "notify.send", "artifact.save", "knowledge.publish", "portal.publish"]),
    params: z.record(z.string(), z.union([flowTemplateSchema, z.number().finite(), z.boolean()]))
      .refine((params) => Object.keys(params).length <= 20, "At most 20 action parameters are allowed") }),
  z.strictObject({ ...common, type: z.literal("condition"), rules }),
  z.strictObject({ ...common, type: z.literal("parallel"), forEach: flowPathSchema, maxConcurrency: positiveInt.max(16) }),
  z.strictObject({ ...common, type: z.literal("join"), policy: z.union([z.enum(["all", "any"]),
    z.strictObject({ quorum: positiveInt.max(16) })]), merge: z.enum(["list", "object"]).default("object") }),
  z.strictObject({ ...common, type: z.literal("approval"),
    approver: z.union([z.enum(["operator", "relation:approves"]), agent]), prompt: flowTemplateSchema }),
  z.strictObject({ ...common, type: z.literal("loop"), maxIterations: positiveInt.max(20), until: flowConditionSchema.optional() }),
  z.strictObject({ ...common, type: z.literal("wait"), wait: z.union([
    z.strictObject({ for: positiveInt.max(43200) }),
    z.strictObject({ until: z.iso.datetime() }),
    z.strictObject({ event: z.string().min(1).max(80) }),
  ]) }),
  z.strictObject({ ...common, type: z.literal("subflow"), workflow: workflowKeySchema,
    version: z.union([z.literal("published"), positiveInt]), inputs: z.record(z.string(), flowTemplateSchema) }),
  z.strictObject({ ...common, type: z.literal("orchestrate"), lead: agentSelectorSchema, goal: flowTemplateSchema,
    allowed: z.array(agentSelectorSchema).min(1).max(20), maxTasks: positiveInt.max(50), maxDepth: positiveInt.max(3),
    budgetTokens: positiveInt.optional() }),
  z.strictObject({ ...common, type: z.literal("output"), target: z.enum(["artifact", "knowledge", "deliver"]),
    from: z.array(flowPathSchema).min(1).max(8) }),
]);
export type FlowNode = z.infer<typeof nodes>;

export function FLOW_NODE_PORTS(node: FlowNode): string[] {
  switch (node.type) {
    case "condition": return [...node.rules.map(({ port }) => port), "else"];
    case "agent": case "action": case "subflow": case "orchestrate": return ["out", "error"];
    case "parallel": return ["item", "done"];
    case "approval": return ["approved", "rejected", "timeout"];
    case "loop": return ["body", "done"];
    case "output": return [];
    case "trigger": case "join": case "wait": return ["out"];
  }
}

export const flowNodeSchema = nodes.refine((node) => node.onError !== "port" || FLOW_NODE_PORTS(node).includes("error"), {
  path: ["onError"], message: "This node does not have an error port",
});

const flowInput = z.strictObject({ name: inputName, type: z.enum(["string", "number", "bool", "enum", "artifact"]),
  required: z.boolean(), default: scalar.optional(), values: z.array(z.string()).min(1).optional(),
}).refine((input) => (input.type === "enum") === (input.values !== undefined), {
  path: ["values"], message: "Only enum inputs require values",
});

const flowEdge = z.strictObject({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  from: z.strictObject({ node: flowNodeIdSchema, port: flowPortSchema }), to: z.strictObject({ node: flowNodeIdSchema }),
  loopBack: z.boolean().default(false),
});
export type FlowEdge = z.infer<typeof flowEdge>;

export const flowDefinitionSchema = z.strictObject({
  schema: z.literal(2), key: workflowKeySchema, title: labelSchema, description: z.string().max(2000).default(""),
  inputs: z.array(flowInput).max(20).default([]),
  nodes: z.array(flowNodeSchema).min(1).max(200), edges: z.array(flowEdge).max(400),
  settings: z.strictObject({ maxDurationMinutes: positiveInt.optional(), stallAfterMinutes: positiveInt.optional(),
    budgetTokens: positiveInt.optional(), errorWorkflow: workflowKeySchema.optional(),
    concurrency: z.enum(["allow", "queue", "skip"]).default("allow") }).prefault({}),
  layout: z.record(flowNodeIdSchema, z.strictObject({ x: z.number().finite(), y: z.number().finite() })).default({}),
}).superRefine((definition, ctx) => {
  for (const field of ["nodes", "edges"] as const) {
    const seen = new Set<string>();
    for (const [index, { id }] of definition[field].entries()) {
      if (seen.has(id)) ctx.addIssue({ code: "custom", path: [field, index, "id"], message: `Duplicate id: ${id}` });
      seen.add(id);
    }
  }
});
export type FlowDefinition = z.infer<typeof flowDefinitionSchema>;
