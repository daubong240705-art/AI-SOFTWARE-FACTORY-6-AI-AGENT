import { z } from "zod";
import {
  API_VERSION,
  idSchema,
  timestampSchema,
  cursorSchema,
  entityRefSchema,
  receiptSchema,
  freshnessSchema,
} from "./base.js";
import { messageSchema, runSchema } from "./models.js";
import type { Cursor } from "./base.js";

const eventPayloadSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("artifact.status-changed"), artifactId: idSchema,
    version: z.number().int().positive(), to: z.enum(["draft","in-review","reviewed","approved","superseded","rejected","withdrawn"]) }),
  z.strictObject({ type: z.literal("task.status-changed"), taskId: idSchema,
    to: z.enum(["draft","proposed","accepted","ready","awaiting-go","active","in-review","done","failed","cancelled","declined","superseded"]) }),
  z.strictObject({
    type: z.literal("entity.changed"),
    entity: entityRefSchema,
  }),
  z.strictObject({
    type: z.literal("message.appended"),
    message: messageSchema,
  }),
  z.strictObject({ type: z.literal("run.changed"), run: runSchema }),
  z.strictObject({
    type: z.literal("command.receipted"),
    receipt: receiptSchema,
  }),
]);
export const eventSchema = z
  .strictObject({
    apiVersion: z.literal(API_VERSION),
    eventId: idSchema,
    projectId: idSchema,
    occurredAt: timestampSchema,
    cursor: cursorSchema,
    previousCursor: cursorSchema,
    causationId: idSchema,
    rootCausationId: idSchema,
    payload: eventPayloadSchema,
  })
  .superRefine((event, ctx) => {
    if (
      event.cursor.epoch !== event.previousCursor.epoch ||
      BigInt(event.cursor.sequence) !==
        BigInt(event.previousCursor.sequence) + 1n
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Project event sequence must advance exactly once in the same epoch",
      });
    const payload = event.payload;
    const nestedProject =
      payload.type === "message.appended"
        ? payload.message.projectId
        : payload.type === "run.changed"
          ? payload.run.projectId
          : payload.type === "command.receipted"
            ? payload.receipt.projectId
            : event.projectId;
    if (nestedProject !== event.projectId)
      ctx.addIssue({
        code: "custom",
        message: "Nested event project scope mismatch",
      });
  });
export const streamResetSchema = z.strictObject({
  apiVersion: z.literal(API_VERSION),
  projectId: idSchema,
  type: z.literal("snapshot-required"),
  reason: z.enum(["expired", "epoch-changed", "gap"]),
});
export const streamRequestSchema = z.strictObject({
  projectId: idSchema,
  after: cursorSchema,
});
export const pageRequestSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(50),
  // Opaque, server-issued, binds project/filter/sort + snapshot; never a SQL fragment.
  continuation: z.string().min(1).max(2048).optional(),
});
export const snapshotMetaSchema = z.strictObject({
  apiVersion: z.literal(API_VERSION),
  projectId: idSchema,
  cursor: cursorSchema,
  freshness: freshnessSchema,
});
export type FactoryEvent = z.infer<typeof eventSchema>;
export type StreamDisposition = "apply" | "duplicate" | "snapshot-required";
/** Called only after eventSchema.parse. Persist cursor atomically with projection updates. */
export function classifyEvent(
  projectId: string,
  current: Cursor,
  event: FactoryEvent,
): StreamDisposition {
  if (projectId !== event.projectId || current.epoch !== event.cursor.epoch)
    return "snapshot-required";
  if (BigInt(event.cursor.sequence) <= BigInt(current.sequence))
    return "duplicate";
  return event.previousCursor.sequence === current.sequence
    ? "apply"
    : "snapshot-required";
}
