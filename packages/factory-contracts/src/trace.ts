import { z } from "zod";
import { API_VERSION, idSchema, timestampSchema } from "./base.js";

const count = z.number().int().nonnegative();
const text = z.string().min(1);
const envelope = { ok: z.literal(true), apiVersion: z.literal(API_VERSION) };

export const spanKindSchema = z.enum(["request", "flow-run", "node-run", "task", "attempt", "tool-call", "effect", "approval", "artifact"]);
export const toolCallStatusSchema = z.enum(["ok", "error", "denied", "ask-pending"]);
export const traceSpanSchema = z.strictObject({
  id: idSchema, traceId: idSchema, parentId: idSchema.nullable(), kind: spanKindSchema, ref: text,
  title: text, status: text, startedAt: timestampSchema, endedAt: timestampSchema.nullable(),
  tokens: count.nullable(), detail: z.record(z.string(), z.unknown()),
});
export const traceTokenTotalsSchema = z.strictObject({ known: count, unknownSpans: count, estimated: count });
export const traceSchema = z.strictObject({ traceId: idSchema, spans: z.array(traceSpanSchema), summary: traceTokenTotalsSchema });
export const traceResponseSchema = z.strictObject({ ...envelope, ...traceSchema.shape });
export const tracesResponseSchema = z.strictObject({ ...envelope, traces: z.array(traceSpanSchema) });
export const artifactTraceResponseSchema = z.strictObject({ ...envelope, ...traceSchema.shape, artifactId: idSchema, version: count.positive() });

const agent = z.strictObject({ id: idSchema, name: text });
const named = z.strictObject({ id: idSchema, title: text });
const toolCall = z.strictObject({ id: idSchema, attemptId: idSchema, agentId: idSchema.nullable(), name: text,
  status: toolCallStatusSchema, durationMs: count, argsBytes: count, resultBytes: count, createdAt: timestampSchema });
const breakdown = z.strictObject({ ...traceTokenTotalsSchema.shape, agent: agent.nullable(), provider: text, model: text });
export const monitorResponseSchema = z.strictObject({ ...envelope,
  liveAttempts: z.array(z.strictObject({ id: idSchema, traceId: idSchema.nullable(), status: text, agent: agent.nullable(), task: named,
    startedAt: timestampSchema.nullable(), elapsedMs: count, lastProgress: z.strictObject({ at: timestampSchema, message: text,
      percent: z.number().min(0).max(100).nullable() }).nullable() })),
  activeFlowRuns: z.array(z.strictObject({ id: idSchema, traceId: idSchema.nullable(), title: text, status: text,
    startedAt: timestampSchema.nullable(), progress: z.strictObject({ completed: count, total: count }) })),
  recentToolCalls: z.array(toolCall), recentFailures: z.array(traceSpanSchema),
  today: z.strictObject({ date: z.iso.date(), ...traceTokenTotalsSchema.shape, byAgentAndModel: z.array(breakdown) }),
});

export type TraceSpan = z.infer<typeof traceSpanSchema>;
export type Trace = z.infer<typeof traceSchema>;
export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>;
export type TraceTokenTotals = z.infer<typeof traceTokenTotalsSchema>;
