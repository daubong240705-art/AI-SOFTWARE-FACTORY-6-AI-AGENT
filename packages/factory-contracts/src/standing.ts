import { z } from "zod";
import { idSchema, revisionSchema, timestampSchema } from "./base.js";

export const STANDING_ACTION_KINDS = ["notify.send-internal", "deploy.staging", "artifact.publish-to-project"] as const;
/** Architecture 04 section 10.4: these always require individual Operator approval. */
export const STANDING_FORBIDDEN = ["deploy.production", "spend-money", "publish-external", "delete-data"] as const;
export const STANDING_MAX_DAYS = 30;
export const STANDING_DEFAULT_LIMIT_PER_DAY = 5;
export const STANDING_EXPIRY_WARNING_DAYS = 3;
export const standingActionKindSchema = z.enum(STANDING_ACTION_KINDS, { error: (issue) =>
  (STANDING_FORBIDDEN as readonly unknown[]).includes(issue.input)
    ? `STANDING_FORBIDDEN: ${String(issue.input)} always requires individual Operator approval; it can never be standing`
    : "Unsupported standing action kind" });
export const standingScopeSchema = z.strictObject({ kind: z.enum(["project", "team"]), ref: idSchema });
export const standingCreateSchema = z.strictObject({
  standingId: idSchema, actionKind: standingActionKindSchema, scope: standingScopeSchema,
  limitPerDay: z.number().int().min(1).max(50).default(STANDING_DEFAULT_LIMIT_PER_DAY),
  maxTokensPerUse: z.number().int().positive().optional(), expiresAt: timestampSchema,
});
export const standingRevokeSchema = z.strictObject({ standingId: idSchema, expectedRevision: revisionSchema });
export const notifySendInternalInputSchema = z.strictObject({ title: z.string().min(1).max(200), body: z.string().max(1000) });
export type StandingActionKind = (typeof STANDING_ACTION_KINDS)[number];
export type StandingScope = z.infer<typeof standingScopeSchema>;
