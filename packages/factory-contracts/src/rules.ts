import { z } from "zod";
import { labelSchema } from "./base.js";
import { scheduleActionSchema } from "./schedule.js";

export const ruleEventTypeSchema = z.enum(["task.status-changed", "artifact.status-changed", "workflow.state-changed", "monitor.changed"]);
export const RULE_FIELDS = {
  "task.status-changed": ["to", "taskCode"],
  "artifact.status-changed": ["to", "artifactKind"],
  "workflow.state-changed": ["to", "workflowKey"],
  "monitor.changed": ["from", "to", "monitorName", "monitorKind"],
} as const;
export type RuleCondition = { field: string; op: "eq" | "ne"; value: string }
  | { field: string; op: "in"; value: string[] }
  | { all: RuleCondition[] } | { any: RuleCondition[] } | { not: RuleCondition };
const field = z.enum(["to", "from", "taskCode", "artifactKind", "workflowKey", "monitorName", "monitorKind"]);
const leaf = z.union([
  z.strictObject({ field, op: z.enum(["eq", "ne"]), value: z.string().min(1).max(160) }),
  z.strictObject({ field, op: z.literal("in"), value: z.array(z.string().min(1).max(160)).min(1).max(10) }),
]);
function condition(depth: number): z.ZodType<RuleCondition> {
  if (depth === 3) return leaf;
  const child = condition(depth + 1);
  return z.union([leaf, z.strictObject({ all: z.array(child).min(1).max(10) }),
    z.strictObject({ any: z.array(child).min(1).max(10) }), z.strictObject({ not: child })]);
}
export const ruleConditionSchema = condition(1);
export function validRuleFields(eventType: keyof typeof RULE_FIELDS, value: RuleCondition): boolean {
  if ("all" in value) return value.all.every((c) => validRuleFields(eventType, c));
  if ("any" in value) return value.any.every((c) => validRuleFields(eventType, c));
  if ("not" in value) return validRuleFields(eventType, value.not);
  return (RULE_FIELDS[eventType] as readonly string[]).includes(value.field);
}
export const ruleActionSchema = scheduleActionSchema.omit({ autoStart: true }).extend({ kind: z.literal("start-workflow") });
const fields = { name: labelSchema, eventType: ruleEventTypeSchema, condition: ruleConditionSchema, action: ruleActionSchema,
  debounceSeconds: z.number().int().min(0).max(86400).default(0),
  maxFiresPerHour: z.number().int().min(1).max(60).default(6), enabled: z.boolean().default(true) };
export const ruleInputSchema = z.strictObject(fields).superRefine((value, ctx) => {
  if (!validRuleFields(value.eventType, value.condition))
    ctx.addIssue({ code: "custom", path: ["condition"], message: "invalid condition fields for event type" });
});
export const rulePatchSchema = z.strictObject({ name: fields.name.optional(), condition: fields.condition.optional(), action: fields.action.optional(),
  debounceSeconds: fields.debounceSeconds.removeDefault().optional(), maxFiresPerHour: fields.maxFiresPerHour.removeDefault().optional(),
  enabled: fields.enabled.removeDefault().optional() });
export type RuleInput = z.infer<typeof ruleInputSchema>;
export type RuleAction = z.infer<typeof ruleActionSchema>;
