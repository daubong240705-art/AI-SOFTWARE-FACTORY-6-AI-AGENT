import { z } from "zod";

// Wire protocol version; unrelated to the legacy product's V1 version.
export const API_VERSION = 1 as const;
export const idSchema = z.uuid().toLowerCase();
export const revisionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
export const timestampSchema = z.iso.datetime();
export const labelSchema = z.string().trim().min(1).max(160);
export const textSchema = z.string().min(1).max(32_000);
export const entityKindSchema = z.enum([
  "project",
  "agent",
  "work",
  "conversation",
  "message",
  "draft",
  "run",
  "decision",
  "review",
  "output",
  "preferences",
]);
export const entityRefSchema = z.strictObject({
  kind: entityKindSchema,
  id: idSchema,
  revision: revisionSchema,
});
export const versionedRefSchema = z.strictObject({
  id: idSchema,
  revision: revisionSchema,
});
export const linuxPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (path) =>
      path.startsWith("/") &&
      !path.includes("\0") &&
      !path.includes("\\") &&
      !path.split("/").some((part) => part === ".." || part === "."),
    "Expected an absolute Linux path without traversal; Host must resolve symlinks and authorize scope",
  );
export const cursorSchema = z.strictObject({
  epoch: idSchema,
  // Decimal string preserves precision in JSON. Sequence is project-stream local.
  sequence: z
    .string()
    .regex(/^(0|[1-9][0-9]{0,18})$/)
    .refine(
      (value) => value.length < 19 || value <= "9223372036854775807",
      "Sequence exceeds SQLite signed 64-bit integer range",
    ),
});
export const freshnessSchema = z
  .strictObject({
    observedAt: timestampSchema,
    staleAfter: timestampSchema,
  })
  .refine(
    (value) => Date.parse(value.staleAfter) >= Date.parse(value.observedAt),
    "staleAfter precedes observation",
  );
export const errorCodeSchema = z.enum([
  "validation",
  "conflict",
  "needs-auth",
  "permission-configuration",
  "resource-exhausted",
  "runtime-unavailable",
  "outcome-unknown",
  "not-found",
  "forbidden",
  "unsupported",
  "internal",
]);
export const apiErrorSchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string().min(1).max(2000),
  correlationId: idSchema,
  // A display hint, never authorization to replay an external side effect.
  nextAction: z.enum([
    "correct-input",
    "refresh",
    "authenticate",
    "configure",
    "wait",
    "reconcile",
    "contact-host",
  ]),
  currentRevision: revisionSchema.optional(),
  fields: z
    .array(
      z.strictObject({
        path: z.string().max(256),
        message: z.string().max(500),
      }),
    )
    .max(50)
    .optional(),
});
export const failureResponseSchema = z.strictObject({
  apiVersion: z.literal(API_VERSION),
  ok: z.literal(false),
  commandId: idSchema.optional(),
  error: apiErrorSchema,
});
export const receiptSchema = z
  .strictObject({
    commandId: idSchema,
    projectId: idSchema,
    state: z.enum(["accepted", "completed", "rejected", "outcome-unknown"]),
    effects: z.array(entityRefSchema).max(100),
    error: apiErrorSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const needsError =
      value.state === "rejected" || value.state === "outcome-unknown";
    if (needsError !== Boolean(value.error))
      ctx.addIssue({
        code: "custom",
        message: "Only rejected/unknown receipts require an error",
      });
    if (
      value.state === "outcome-unknown" &&
      value.error?.code !== "outcome-unknown"
    )
      ctx.addIssue({
        code: "custom",
        message: "Unknown outcome requires reconciliation error",
      });
    if (value.state !== "completed" && value.effects.length > 0)
      ctx.addIssue({
        code: "custom",
        message: "Effects list contains only committed completed results",
      });
  });
export const successResponseSchema = z.strictObject({
  apiVersion: z.literal(API_VERSION),
  ok: z.literal(true),
  receipt: receiptSchema,
});
export const commandResponseSchema = z.union([
  successResponseSchema,
  failureResponseSchema,
]);
export type Cursor = z.infer<typeof cursorSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type CommandReceipt = z.infer<typeof receiptSchema>;
export type CommandResponse = z.infer<typeof commandResponseSchema>;
export type EntityRef = z.infer<typeof entityRefSchema>;
export type VersionedRef = z.infer<typeof versionedRefSchema>;
