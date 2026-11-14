import { z } from "zod";
import { idSchema, timestampSchema } from "./base.js";

const gameIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/);

export const newGameRequestSchema = z.strictObject({
  name: z.string().min(2).max(60),
  gameId: gameIdSchema,
  request: z.string().min(1).max(500),
});
export type NewGameRequest = z.infer<typeof newGameRequestSchema>;

export const newGameResponseSchema = z.strictObject({
  projectId: idSchema,
  workflowInstanceId: idSchema,
  gameId: gameIdSchema,
});
export type NewGameResponse = z.infer<typeof newGameResponseSchema>;

export const releaseKindSchema = z.enum(["publish", "rollback"]);
export const releaseStateSchema = z.enum(["pending", "done", "failed", "unknown"]);
export const releaseViewSchema = z.strictObject({
  id: idSchema,
  kind: releaseKindSchema,
  gameId: gameIdSchema,
  commitSha: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/).nullable(),
  state: releaseStateSchema,
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  playUrl: z.url().nullable(),
  error: z.string().max(500).nullable(),
  createdAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
  logTail: z.string().max(12000).optional(),
});
export type ReleaseKind = z.infer<typeof releaseKindSchema>;
export type ReleaseState = z.infer<typeof releaseStateSchema>;
export type ReleaseView = z.infer<typeof releaseViewSchema>;

export const releasesResponseSchema = z.strictObject({
  enabled: z.boolean(),
  canPublish: z.strictObject({ allowed: z.boolean(), reason: z.string().max(500).nullable() }),
  releases: z.array(releaseViewSchema).max(50),
});
export type ReleasesResponse = z.infer<typeof releasesResponseSchema>;
export const rollbackRequestSchema = z.strictObject({
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
