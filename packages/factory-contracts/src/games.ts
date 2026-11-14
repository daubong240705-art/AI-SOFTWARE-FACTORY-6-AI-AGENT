import { z } from "zod";
import { idSchema, timestampSchema } from "./base.js";
import { workflowInstanceStateSchema, workflowKeySchema } from "./workflow.js";
import { taskStateSchema } from "./work.js";

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

export const gameSummarySchema = z.strictObject({
  projectId: idSchema,
  name: z.string(),
  gameId: z.string(), // Existing game workflows may use any workspace folder name.
  workflow: z.strictObject({
    instanceId: idSchema, state: workflowInstanceStateSchema,
    currentStage: workflowKeySchema.nullable(), loops: z.number().int().nonnegative(),
  }).nullable(),
  release: z.strictObject({
    version: z.number().int().positive().nullable(), state: releaseStateSchema,
    playUrl: z.url().nullable(), createdAt: timestampSchema,
  }).nullable(),
  updatedAt: timestampSchema,
});
export const gamesResponseSchema = z.strictObject({ games: z.array(gameSummarySchema) });

const reportCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const gameReportTokensSchema = z.strictObject({
  input: reportCount.nullable(), cachedInput: reportCount.nullable(),
  output: reportCount.nullable(), reasoning: reportCount.nullable(),
});
export const gameReportSchema = z.strictObject({
  stages: z.array(z.strictObject({
    key: workflowKeySchema, title: z.string(),
    iterations: z.array(z.strictObject({
      iteration: z.number().int().positive(), taskCode: z.string(), state: taskStateSchema,
      startedAt: timestampSchema.nullable(), endedAt: timestampSchema.nullable(),
      durationMs: reportCount.nullable(), attempts: reportCount,
      tokens: gameReportTokensSchema.nullable(),
    })),
  })),
  totals: z.strictObject({ durationMs: reportCount, attempts: reportCount, tokens: gameReportTokensSchema.nullable() }),
  qaRounds: z.array(z.strictObject({
    iteration: z.number().int().positive(), taskCode: z.string(),
    verdict: z.enum(["passed", "changes-requested", "running"]),
    criteria: z.array(z.strictObject({ criterion: z.string(), passed: z.boolean().nullable(), evidence: z.string().max(300).nullable() })),
  })),
});
export const gameReportResponseSchema = gameReportSchema;
export type GameSummary = z.infer<typeof gameSummarySchema>;
export type GamesResponse = z.infer<typeof gamesResponseSchema>;
export type GameReport = z.infer<typeof gameReportSchema>;
export type GameReportResponse = GameReport;
