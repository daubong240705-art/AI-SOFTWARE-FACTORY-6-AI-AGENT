import { z } from "zod";
import { agentConfigSchema, agentSelectorSchema } from "./agents.js";
import { API_VERSION, idSchema, labelSchema, revisionSchema, timestampSchema } from "./base.js";
import { flowRunStateSchema } from "./flow-api.js";
import { flowNodeIdSchema } from "./flow.js";

export const insightsDaysSchema = z.number().int().min(1).max(90);
export const insightEvidenceSchema = z.array(z.string().min(1).max(100)).max(10);
export const insightMetricSchema = z.strictObject({
  value: z.number().nonnegative().nullable(), samples: z.number().int().nonnegative(), evidence: insightEvidenceSchema,
});
const metric = insightMetricSchema;
const timings = z.strictObject({ medianMs: metric, p90Ms: metric });
const tokens = z.strictObject({ knownTokens: metric, estimatedTokens: metric, unknownCount: metric });
const runCounts = z.partialRecord(flowRunStateSchema, metric);

export const nodeInsightsSchema = z.strictObject({
  nodeId: flowNodeIdSchema, title: labelSchema, titles: z.array(labelSchema), executions: metric, failed: metric, skipped: metric,
  failureRate: metric, retries: metric, averageRetries: metric, reworkIterations: metric, averageIterations: metric, timeouts: metric,
  wait: timings, run: timings, approvals: z.strictObject({ approved: metric, rejected: metric, timeout: metric, rejectionRate: metric }),
  reviewFailures: metric, reviewFailureRate: metric, cost: tokens,
});

export const flowInsightsSchema = z.strictObject({
  flowId: idSchema, title: labelSchema, totalRuns: metric, runsByState: runCounts,
  runsByVersion: z.array(z.strictObject({ version: revisionSchema.nullable(), totalRuns: metric, runsByState: runCounts })),
  successRate: metric, totalDuration: timings, medianNodeRunMs: metric, nodes: z.array(nodeInsightsSchema), cost: tokens,
});

export const agentInsightsSchema = z.strictObject({
  agentId: idSchema, name: labelSchema, attempts: metric, failureRate: metric, medianQueueWaitMs: metric, busyShare: metric, cost: tokens,
});

export const improvementPatchItemSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("set-timeout"), nodeId: flowNodeIdSchema, timeoutMinutes: z.number().int().min(1).max(10080) }),
  z.strictObject({ op: z.literal("set-retry"), nodeId: flowNodeIdSchema, max: z.number().int().min(0).max(5),
    backoffSeconds: z.number().int().min(1).max(3600) }),
  z.strictObject({ op: z.literal("set-on-error"), nodeId: flowNodeIdSchema, onError: z.enum(["fail", "continue", "port"]) }),
  z.strictObject({ op: z.literal("change-agent"), nodeId: flowNodeIdSchema, agentId: idSchema }),
  z.strictObject({ op: z.literal("add-review"), nodeId: flowNodeIdSchema, reviewer: agentSelectorSchema }),
  z.strictObject({ op: z.literal("change-model"), agentId: idSchema, expectedRevision: revisionSchema,
    model: agentConfigSchema.shape.runtime.shape.model.unwrap() }),
]);

export const findingCodeSchema = z.enum([
  "node-failure-rate", "node-retry-heavy", "node-timeout", "rework-loops", "approval-rejections", "slow-node", "queue-wait",
  "cost-hotspot", "unknown-cost",
]);
const findingId = z.string().min(1).max(120);
export const findingSchema = z.strictObject({
  id: findingId, code: findingCodeSchema, severity: z.enum(["info", "warning", "high"]),
  nodeId: flowNodeIdSchema.optional(), agentId: idSchema.optional(), message: z.string().min(1).max(500),
  metrics: z.record(z.string(), metric), evidence: insightEvidenceSchema, suggestion: improvementPatchItemSchema.optional(),
});

const envelope = { apiVersion: z.literal(API_VERSION), ok: z.literal(true) };
const window = { projectId: idSchema, days: insightsDaysSchema, from: timestampSchema, until: timestampSchema };
export const flowInsightsResponseSchema = z.strictObject({ ...envelope, ...window, flow: flowInsightsSchema, findings: z.array(findingSchema) });
export const projectInsightsResponseSchema = z.strictObject({ ...envelope, ...window,
  flows: z.array(z.strictObject({ flow: flowInsightsSchema, findings: z.array(findingSchema) })),
  agents: z.array(agentInsightsSchema), findings: z.array(findingSchema),
});

export const improvementProposalSchema = z.strictObject({
  projectId: idSchema, id: idSchema, flowId: idSchema, baseVersion: revisionSchema.nullable(), baseDraftRevision: revisionSchema,
  state: z.enum(["generating", "ready", "applied", "discarded", "failed"]), source: z.enum(["rules", "ai"]),
  findings: z.array(findingSchema), patch: z.array(improvementPatchItemSchema), setupProposalId: idSchema.nullable(),
  revision: revisionSchema, createdAt: timestampSchema, updatedAt: timestampSchema,
});
export const improvementProposalsResponseSchema = z.strictObject({ ...envelope, proposals: z.array(improvementProposalSchema) });
export const improvementProposalResponseSchema = z.strictObject({ ...envelope, proposal: improvementProposalSchema });
export const insightsProposePayloadSchema = z.strictObject({
  proposalId: idSchema, flowId: idSchema, days: insightsDaysSchema, findingIds: z.array(findingId).min(1).optional(), useAi: z.boolean(),
});
export const insightsApplyPayloadSchema = z.strictObject({ proposalId: idSchema, expectedRevision: revisionSchema });
export const insightsDiscardPayloadSchema = insightsApplyPayloadSchema;

export type InsightMetric = z.infer<typeof insightMetricSchema>;
export type NodeInsights = z.infer<typeof nodeInsightsSchema>;
export type FlowInsights = z.infer<typeof flowInsightsSchema>;
export type AgentInsights = z.infer<typeof agentInsightsSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type ImprovementPatchItem = z.infer<typeof improvementPatchItemSchema>;
export type ImprovementProposal = z.infer<typeof improvementProposalSchema>;
