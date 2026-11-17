import { z } from "zod";

const count = z.number().int().nonnegative();
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value =>
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
export const portalGameIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/);
export const portalVersionSchema = z.object({
  version, commitSha: z.string().nullable(), createdAt: z.string(), sizeBytes: count.optional(),
});
export const portalGameSchema = z.object({
  id: portalGameIdSchema, name: z.string(), description: z.string(), category: z.string(),
  minPlayers: count, maxPlayers: count, bot: z.boolean(), enabled: z.boolean(),
  currentVersion: version.nullable(), updatedAt: z.string(),
  versions: z.array(portalVersionSchema.extend({ sizeBytes: count })),
});
export const portalGamesResponseSchema = z.object({ games: z.array(portalGameSchema) });
export const portalEnableResponseSchema = z.object({ ok: z.literal(true), enabled: z.boolean() });
export const portalVersionsResponseSchema = z.object({ currentVersion: version.nullable(), versions: z.array(portalVersionSchema) });
export const portalRollbackResponseSchema = z.object({ ok: z.literal(true) });
export const portalPublishResponseSchema = z.object({ gameId: portalGameIdSchema, version, playPath: z.string() });

export const portalStatsQuerySchema = z.strictObject({
  game: portalGameIdSchema.optional(), from: date.optional(), to: date.optional(),
}).refine(q => !q.from || !q.to || (q.to >= q.from && Date.parse(q.to) - Date.parse(q.from) < 92 * 86400000),
  "Expected a range of at most 92 days");
export const portalStatsGameSchema = z.object({
  id: portalGameIdSchema, name: z.string(), enabled: z.boolean(), currentVersion: version.nullable(),
  matches: count, draws: count, botWins: count, humanWins: count,
  players: z.object({ registered: count, guests: count }),
  avgDurationSec: z.number().nonnegative().nullable(), avgMoves: z.number().nonnegative().nullable(),
  perDay: z.array(z.object({ date, matches: count })),
  perVersion: z.array(z.object({ version, matches: count })),
});
export const portalStatsResponseSchema = z.object({
  from: date, to: date, utcOffsetMinutes: z.number().int().min(-840).max(840),
  totals: z.object({ matches: count, players: count, registeredPlayers: count, guestPlayers: count, newUsers: count }),
  live: z.object({ rooms: count, playingRooms: count, waitingRooms: count, onlineUsers: count,
    byGame: z.record(z.string(), z.object({ rooms: count, playing: count })) }),
  games: z.array(portalStatsGameSchema),
});
export const portalAuditQuerySchema = z.strictObject({ game: portalGameIdSchema.optional(), limit: z.coerce.number().int().min(1).max(200).optional() });
export const portalAuditEntrySchema = z.object({
  at: z.string(), actor: z.string(), action: z.string(), gameId: portalGameIdSchema, from: z.json(), to: z.json(),
});
export const portalAuditResponseSchema = z.object({ entries: z.array(portalAuditEntrySchema) });

export const portalResponseSchema = z.object({ projectId: z.string().nullable(), configured: z.boolean() });
export const portalJoinedGamesResponseSchema = z.object({ games: z.array(portalGameSchema.extend({ projectId: z.string().nullable(), last7Days: count })) });
export const portalActionSchema = z.object({
  id: z.string(), projectId: z.string(), approvalId: z.string(),
  action: z.enum(["publish", "enable", "disable", "set-version"]), gameId: portalGameIdSchema,
  targetProjectId: z.string().nullable(), version: version.nullable(), reason: z.string(),
  state: z.enum(["proposed", "rejected", "running", "done", "failed", "unknown"]),
  resultJson: z.json().nullable(), error: z.string().nullable(), createdAt: z.string(), decidedAt: z.string().nullable(), completedAt: z.string().nullable(),
});
export const portalActionsResponseSchema = z.object({ actions: z.array(portalActionSchema) });
export const portalActionResponseSchema = z.object({ action: portalActionSchema });
const actionBase = { game: portalGameIdSchema, reason: z.string().trim().max(1000).optional() };
export const portalActionRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("publish"), ...actionBase }),
  z.strictObject({ action: z.literal("enable"), ...actionBase }),
  z.strictObject({ action: z.literal("disable"), ...actionBase }),
  z.strictObject({ action: z.literal("set-version"), ...actionBase, version }),
]);
export const portalBlockSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("stats"), game: portalGameIdSchema.nullable(), period: z.enum(["day", "week", "month"]) }),
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({ action: z.literal("audit"), game: portalGameIdSchema.nullable() }),
  ...portalActionRequestSchema.options,
]);
export type PortalActionRequest = z.infer<typeof portalActionRequestSchema>;
export type PortalAction = z.infer<typeof portalActionSchema>;
export type PortalBlock = z.infer<typeof portalBlockSchema>;
export type PortalGame = z.infer<typeof portalGameSchema>;
export type PortalStats = z.infer<typeof portalStatsResponseSchema>;
