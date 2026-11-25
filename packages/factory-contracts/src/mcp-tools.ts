import { notifySendInternalInputSchema } from "./standing.js";
import { z } from "zod";
import { idSchema, labelSchema, sha256Schema, textSchema, timestampSchema } from "./base.js";
import { artifactKindSchema, artifactRefSchema, artifactStatusSchema } from "./knowledge.js";
import { approvalOptionSchema } from "./approvals.js";
import {
  placementSchema,
  sideEffectSchema,
  reviewPolicySchema,
  requestKindSchema,
} from "./work.js";
import { capabilityIdSchema } from "./nodes.js";
import { agentConfigSchema, agentSelectorSchema } from "./agents.js";

/**
 * The tool surface an agent sees through the node's MCP relay (C-01, ADR-T06). Inputs carry NO
 * identity: project, task, attempt and epoch come from the relay's trusted context, never from the
 * model, so an agent cannot act as another attempt.
 * M0-lite surface only; CTR, workflow and action tools arrive with their features.
 */
const proposedTaskSchema = z.strictObject({
  title: labelSchema,
  goal: z.string().min(1).max(500),
  acceptance: z.array(z.string().min(1).max(500)).min(1).max(8),
  expectedFiles: z.number().int().min(0).max(200),
  requiredCapabilities: z.array(capabilityIdSchema).max(10),
  placement: placementSchema,
  sideEffect: sideEffectSchema,
  reviewPolicy: reviewPolicySchema,
  // Name of the team member that does the work (a non-Lead seat of the Team list). Omitted: the Host picks by capability.
  ownerSeat: z.string().min(1).max(40).optional(),
  // Indexes into this same array. Must point to EARLIER entries (same rule as V1 validatePlan).
  dependsOn: z.array(z.number().int().min(0).max(29)).max(29),
  // Ids of project documents or reference images the agent receives in its worktree (latest usable version).
  inputs: z.array(idSchema).max(10).optional(),
});

export const taskProposeInputSchema = z
  .strictObject({
    tasks: z.array(proposedTaskSchema).min(1).max(30),
    testingReason: z.string().max(1_000).optional(),
  })
  .superRefine((value, ctx) => {
    value.tasks.forEach((task, index) => {
      if (task.dependsOn.some((d) => d >= index))
        ctx.addIssue({
          code: "custom",
          path: ["tasks", index, "dependsOn"],
          message: "dependencies must point to earlier tasks (no cycles)",
        });
      if (new Set(task.dependsOn).size !== task.dependsOn.length)
        ctx.addIssue({ code: "custom", path: ["tasks", index, "dependsOn"], message: "duplicate dependency" });
    });
  });
export type TaskProposeInput = z.infer<typeof taskProposeInputSchema>;

export const taskProgressInputSchema = z.strictObject({
  summary: z.string().min(1).max(1_000),
  percent: z.number().int().min(0).max(100).optional(),
});

/** One acceptance criterion of the agent's own task, checked by the agent, with one sentence of evidence. */
export const criterionReportInputSchema = z.strictObject({
  criterion: z.string().min(1).max(500),
  passed: z.boolean(),
  evidence: z.string().min(1).max(1_000),
});
export type CriterionReportInput = z.infer<typeof criterionReportInputSchema>;

export const outputRegisterInputSchema = z.strictObject({
  title: labelSchema,
  kind: artifactKindSchema,
  mediaType: z.string().min(1).max(128),
  // The bytes are uploaded to the Host by hash first; the tool only names them.
  contentHash: sha256Schema,
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  abstractL0: z.string().min(1).max(400),
  abstractL1: textSchema.max(6_000).optional(),
  inputs: z.array(artifactRefSchema).max(100),
});

export const decisionRequestInputSchema = z
  .strictObject({
    subject: labelSchema,
    summary: textSchema.max(4_000),
    options: z.array(approvalOptionSchema).min(2).max(6),
    recommendation: labelSchema.optional(),
    impactIfWaiting: z.string().max(1_000),
  })
  .superRefine((value, ctx) => {
    if (value.recommendation && !value.options.some((o) => o.id === value.recommendation))
      ctx.addIssue({ code: "custom", message: "recommendation must be one of the options" });
  });

export const handoffSubmitInputSchema = z.strictObject({
  done: z.string().min(1).max(4_000),
  remaining: z.string().max(4_000),
  checks: z
    .array(
      z.strictObject({
        name: labelSchema,
        result: z.enum(["pass", "fail", "not-run"]),
      }),
    )
    .max(50),
});

export const knowledgeSearchInputSchema = z.strictObject({
  query: z.string().min(1).max(200),
  kinds: z.array(artifactKindSchema).max(5).optional(),
  statuses: z.array(artifactStatusSchema).max(5).optional(),
  limit: z.number().int().min(1).max(20).optional(),
  offset: z.number().int().min(0).max(200).optional(),
});
export type KnowledgeSearchInput = z.infer<typeof knowledgeSearchInputSchema>;

export const knowledgeGetInputSchema = z.strictObject({
  artifactId: idSchema,
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  level: z.enum(["l0", "l1", "l2"]).default("l1"),
});
export type KnowledgeGetInput = z.infer<typeof knowledgeGetInputSchema>;

export const knowledgeOutlineInputSchema = z.strictObject({
  artifactId: idSchema, version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
});
export const knowledgeReadInputSchema = z.strictObject({
  ...knowledgeOutlineInputSchema.shape,
  ref: z.string().min(1).max(32).optional(),
  pages: z.strictObject({ from: z.number().int().min(1).max(100000), to: z.number().int().min(1).max(100000) }).optional(),
  offset: z.number().int().min(0).max(2_000_000).optional(),
  maxChars: z.number().int().min(1).max(12000).optional(),
}).superRefine((value, ctx) => {
  if ([value.ref, value.pages, value.offset].filter((part) => part !== undefined).length > 1 ||
      (value.pages && (value.pages.to < value.pages.from || value.pages.to - value.pages.from >= 20)))
    ctx.addIssue({ code: "custom", message: "Select one section, offset or range of at most 20 pages" });
});
export const knowledgeFindInputSchema = z.strictObject({
  artifactId: idSchema, query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(20).optional(),
});

export const requestCreateInputSchema = z.strictObject({
  kind: requestKindSchema,
  targetTeamId: idSchema,
  subject: labelSchema,
  ask: z.string().min(1).max(2000),
  responseMode: z.enum(["async", "blocking"]).default("async"),
  neededBy: timestampSchema.optional(),
  expectedResponse: z.strictObject({
    form: z.enum(["answer", "artifact", "verdict", "decision"]),
    format: z.string().max(200),
    acceptance: z.array(z.string().min(1).max(500)).max(8),
  }),
  contextRefs: z.array(artifactRefSchema).max(20).default([]),
  excerpt: z.string().max(1000).optional(),
});
export type RequestCreateInput = z.infer<typeof requestCreateInputSchema>;
export const requestReplyInputSchema = z.strictObject({
  requestId: idSchema,
  action: z.enum(["message", "accept", "request-changes"]),
  message: z.string().max(2000).optional(),
}).superRefine((value, ctx) => {
  if (value.action !== "accept" && !value.message?.trim())
    ctx.addIssue({ code: "custom", path: ["message"], message: "message is required" });
});
export type RequestReplyInput = z.infer<typeof requestReplyInputSchema>;
export const requestGetInputSchema = z.strictObject({ requestId: idSchema });
export const projectBriefingInputSchema = z.strictObject({});
export const skillGetInputSchema = z.strictObject({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/) });
export type SkillGetInput = z.infer<typeof skillGetInputSchema>;

const targetAgentSchema = z.union([idSchema, agentSelectorSchema]);
const estimateTokensSchema = z.number().int().positive().default(1000);
export const reviewVerdictSchema = z.strictObject({ verdict: z.enum(["approved", "changes-requested"]), notes: z.string().max(4000) });
export const taskResultInputSchema = z.strictObject({ result: z.json().optional(),
  verdict: reviewVerdictSchema.shape.verdict.optional(), notes: reviewVerdictSchema.shape.notes.optional() }).refine(
    (input) => input.result === undefined ? input.verdict !== undefined && input.notes !== undefined
      : input.verdict === undefined && input.notes === undefined, "Report either a result or a verdict with notes");
export const COLLABORATION_TOOLS = {
  "agent.directory": z.strictObject({}),
  "task.create": z.strictObject({ target: targetAgentSchema, title: labelSchema, goal: textSchema.max(500),
    brief: textSchema.max(32000).optional(), acceptance: z.array(textSchema.max(500)).max(20).default([]),
    estimateTokens: estimateTokensSchema, parent: z.boolean().default(true), force: z.boolean().default(false) }),
  "task.depend": z.strictObject({ taskId: idSchema, dependsOn: idSchema }),
  "task.comment": z.strictObject({ taskId: idSchema, text: textSchema.max(4000), mention: idSchema.optional() }),
  "task.request-review": z.strictObject({ reviewer: targetAgentSchema, artifacts: z.array(artifactRefSchema).min(1).max(20),
    notes: z.string().max(4000).default(""), estimateTokens: estimateTokensSchema }),
  "task.block": z.strictObject({ reason: textSchema.max(4000) }),
  "agent.propose": z.strictObject({ config: agentConfigSchema, reason: textSchema.max(4000) }),
  "task.result": taskResultInputSchema,
} as const;

export const MCP_TOOLS = {
  ...COLLABORATION_TOOLS,
  "skill.get": skillGetInputSchema,
  "project.briefing": projectBriefingInputSchema,
  "task.propose": taskProposeInputSchema,
  "task.progress": taskProgressInputSchema,
  "criterion.report": criterionReportInputSchema,
  "output.register": outputRegisterInputSchema,
  "decision.request": decisionRequestInputSchema,
  "handoff.submit": handoffSubmitInputSchema,
  "knowledge.search": knowledgeSearchInputSchema,
  "knowledge.get": knowledgeGetInputSchema,
  "knowledge.outline": knowledgeOutlineInputSchema,
  "knowledge.read": knowledgeReadInputSchema,
  "knowledge.find": knowledgeFindInputSchema,
  "request.create": requestCreateInputSchema,
  "request.reply": requestReplyInputSchema,
  "request.get": requestGetInputSchema,
  "notify.send-internal": notifySendInternalInputSchema,
} as const;
export type McpToolName = keyof typeof MCP_TOOLS;
export const MCP_TOOL_NAMES = Object.keys(MCP_TOOLS) as McpToolName[];

/** A plan with no TEST-like task must say why (V1 rule kept): used by the Host after parsing. */
export function planNeedsTestingReason(input: TaskProposeInput): boolean {
  const hasTest = input.tasks.some((task) =>
    task.requiredCapabilities.some((c) => c.startsWith("test.")),
  );
  return !hasTest && !input.testingReason?.trim();
}
