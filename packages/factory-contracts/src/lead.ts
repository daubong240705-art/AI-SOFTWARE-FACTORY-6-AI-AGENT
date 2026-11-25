import { z } from "zod";
import { idSchema } from "./base.js";
import { flowRunsStartPayloadSchema } from "./flow-api.js";
import { workflowKeySchema } from "./workflow.js";

export * from "./lead-cards.js";
export const leadDecisionSchema = z.strictObject({ quote: z.string().trim().min(2).max(1000) });
const item = z.string().trim().min(1).max(300);
const items = z.array(item).max(8);
export const leadBriefSchema = z.strictObject({
  title: z.string().trim().min(1).max(160), goals: items, scope: items, outOfScope: items,
  decisions: z.array(z.strictObject({ decision: item, reason: item })).min(1).max(8),
  acceptance: items, openQuestions: items,
}).refine((brief) => [brief.title, ...brief.goals, ...brief.scope, ...brief.outOfScope, ...brief.acceptance, ...brief.openQuestions,
  ...brief.decisions.flatMap(({ decision, reason }) => [decision, reason])].reduce((total, value) => total + value.length, 0) <= 9000,
"Brief text must total at most 9,000 characters");
export const leadRunSchema = z.strictObject({
  flowKey: workflowKeySchema,
  inputs: flowRunsStartPayloadSchema.shape.inputs.removeDefault(),
  decision: leadDecisionSchema,
});
export const leadCancelSchema = z.strictObject({ runId: idSchema, decision: leadDecisionSchema });
export type LeadBrief = z.infer<typeof leadBriefSchema>;
