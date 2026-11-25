import { z } from "zod";
import { idSchema, labelSchema, revisionSchema, timestampSchema } from "./base.js";
import { flowDefinitionSchema, flowNodeIdSchema } from "./flow.js";

/**
 * U4 (docs/architecture/17 §8): commands and read models of the Workflow v2 engine.
 * Command names avoid the v1 `workflows.*` and the attempt-level `runs.*` families.
 */

import { flowRunStateSchema } from "./lead-cards.js";
export { flowRunStateSchema };
export type FlowRunState = z.infer<typeof flowRunStateSchema>;
export const FLOW_RUN_TRANSITIONS: Readonly<Record<FlowRunState, readonly FlowRunState[]>> = {
  queued: ["running", "cancelled"],
  running: ["waiting", "paused", "stalled", "succeeded", "failed", "cancelled"],
  waiting: ["running", "paused", "stalled", "succeeded", "failed", "cancelled"],
  paused: ["running", "cancelled"],
  stalled: ["running", "paused", "cancelled", "failed"],
  succeeded: [], failed: ["running"], cancelled: [],
};
export const isTerminalFlowRunState = (state: FlowRunState): boolean =>
  state === "succeeded" || state === "failed" || state === "cancelled";

export const flowNodeRunStateSchema = z.enum(["pending", "ready", "running", "waiting", "succeeded", "failed", "skipped", "cancelled"]);
export type FlowNodeRunState = z.infer<typeof flowNodeRunStateSchema>;

/** Small JSON value; large outputs are artifacts referenced by id. */
export const flowJsonSchema: z.ZodType<unknown> = z.unknown().refine((value) => {
  try { return JSON.stringify(value).length <= 65_536; } catch { return false; }
}, "value must be JSON of at most 64 KiB");

export const flowIssueSchema = z.strictObject({
  code: z.string().max(40), message: z.string().max(500),
  node: z.string().max(40).optional(), edge: z.string().max(64).optional(),
});

// ---- Read models -----------------------------------------------------------------------------------

export const flowSummarySchema = z.strictObject({
  id: idSchema, projectId: idSchema, key: z.string().max(40), title: labelSchema,
  /** Row revision (draft saves, publish, archive). Use as expectedRevision. */
  revision: revisionSchema,
  publishedVersion: revisionSchema.nullable(),
  /** True when the draft differs from the latest published version. */
  draftChanged: z.boolean(),
  archived: z.boolean(),
  updatedAt: timestampSchema,
  /** Converted from a v1 pack workflow (pack key) or null. */
  source: z.string().max(80).nullable(),
});
export type FlowSummary = z.infer<typeof flowSummarySchema>;

export const flowVersionSchema = z.strictObject({
  version: revisionSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/), publishedAt: timestampSchema, actorId: z.string().max(200),
});

export const flowDetailSchema = z.strictObject({
  flow: flowSummarySchema,
  draft: flowDefinitionSchema,
  /** Publish validation of the draft against the project's agents ([] = publishable). */
  issues: z.array(flowIssueSchema).max(500),
  versions: z.array(flowVersionSchema).max(500),
});
export type FlowDetail = z.infer<typeof flowDetailSchema>;

export const flowRunSummarySchema = z.strictObject({
  id: idSchema, projectId: idSchema, flowId: idSchema, flowTitle: labelSchema,
  /** null for a test run of the draft. */
  version: revisionSchema.nullable(),
  test: z.boolean(),
  state: flowRunStateSchema,
  stateReason: z.string().max(500).nullable(),
  revision: revisionSchema,
  trigger: z.string().max(40),
  createdAt: timestampSchema, startedAt: timestampSchema.nullable(), endedAt: timestampSchema.nullable(),
});
export type FlowRunSummary = z.infer<typeof flowRunSummarySchema>;

export const flowNodeRunSchema = z.strictObject({
  nodeId: flowNodeIdSchema,
  iteration: z.number().int().min(1),
  attemptNo: z.number().int().min(1),
  state: flowNodeRunStateSchema,
  /** Output port taken when the node finished (e.g. "out", "approved", a condition rule port). */
  port: z.string().max(24).nullable(),
  startedAt: timestampSchema.nullable(), endedAt: timestampSchema.nullable(),
  error: z.string().max(2_000).nullable(),
  taskId: idSchema.nullable(), approvalId: idSchema.nullable(), childRunId: idSchema.nullable(),
  output: flowJsonSchema.nullable(),
  /** Output came from pinned test data, not a real execution. */
  pinned: z.boolean(),
});
export type FlowNodeRun = z.infer<typeof flowNodeRunSchema>;

export const flowRunDetailSchema = z.strictObject({
  run: flowRunSummarySchema,
  definition: flowDefinitionSchema,
  inputs: z.record(z.string(), flowJsonSchema),
  nodeRuns: z.array(flowNodeRunSchema).max(2_000),
});
export type FlowRunDetail = z.infer<typeof flowRunDetailSchema>;

export const projectFlowsResponseSchema = z.strictObject({
  flows: z.array(flowSummarySchema).max(500),
  runs: z.array(flowRunSummarySchema).max(200),
});

// ---- Command payloads ----------------------------------------------------------------------------

const change = { expectedRevision: revisionSchema };
export const flowsCreatePayloadSchema = z.strictObject({ flowId: idSchema, definition: flowDefinitionSchema });
/** Saves the draft as is (drafts may be invalid); `issues` in the detail tell what blocks publishing. */
export const flowsSaveDraftPayloadSchema = z.strictObject({ flowId: idSchema, ...change, definition: flowDefinitionSchema });
/** Validates the draft (§8.7) and freezes it as the next immutable version. */
export const flowsPublishPayloadSchema = z.strictObject({ flowId: idSchema, ...change });
export const flowsArchivePayloadSchema = z.strictObject({ flowId: idSchema, ...change, archived: z.boolean() });
/** Converts a v1 pack workflow definition (by pack key + definition key) into a new v2 flow draft. */
export const flowsImportV1PayloadSchema = z.strictObject({
  flowId: idSchema, packKey: z.string().regex(/^[a-z0-9-]{2,40}$/), definitionKey: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/),
});
export const flowRunsStartPayloadSchema = z.strictObject({
  runId: idSchema, flowId: idSchema,
  /** "draft" = test run of the current draft (must pass validation). */
  version: z.union([z.literal("published"), z.literal("draft"), revisionSchema]).default("published"),
  test: z.boolean().default(false),
  inputs: z.record(z.string(), z.union([z.string().max(20_000), z.number().finite(), z.boolean()])).default({}),
  /** Test runs only: node outputs to use instead of executing those nodes (agent nodes then create no task). */
  pinned: z.record(flowNodeIdSchema, flowJsonSchema).default({}),
  /** Test runs only: every agent node without a pinned output runs on the fake runtime (zero tokens). */
  mockAgents: z.boolean().default(false),
});
export const flowRunsPausePayloadSchema = z.strictObject({ runId: idSchema, ...change, stopRunning: z.boolean().default(false) });
export const flowRunsResumePayloadSchema = z.strictObject({ runId: idSchema, ...change });
export const flowRunsCancelPayloadSchema = z.strictObject({ runId: idSchema, ...change, reason: z.string().trim().min(1).max(500) });
/** Re-runs a failed (or succeeded) node: a new node run iteration; downstream nodes go back to pending. */
export const flowRunsRetryNodePayloadSchema = z.strictObject({ runId: idSchema, ...change, nodeId: flowNodeIdSchema });
