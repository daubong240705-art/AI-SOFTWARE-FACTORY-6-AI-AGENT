import { z } from "zod";
import { artifactKindSchema, artifactRefSchema } from "./knowledge.js";
import { taskStateSchema } from "./work.js";

const count = z.number().int().nonnegative();
const line = z.string().max(400);
export const dossierRiskSchema = z.strictObject({ ref: artifactRefSchema, title: line, because: line });
export const dossierSchema = z.strictObject({
  goal: z.strictObject({ name: line, workspaceKind: z.enum(["git", "directory", "artifact"]), requirements: z.array(artifactRefSchema).max(5) }),
  stage: z.strictObject({ tasks: z.record(taskStateSchema, count), awaitingGo: count, pendingApprovals: count }),
  canonical: z.array(z.strictObject({ kind: artifactKindSchema, items: z.array(z.strictObject({
    ref: artifactRefSchema, title: line, l0: line,
  })).max(30) })).max(13),
  decisions: z.array(line).max(20),
  openQuestions: z.array(line).max(10),
  openRequests: z.array(z.strictObject({ code: line, kind: line, subject: line, state: taskStateSchema,
    triageState: line, targetTeamName: line, waitingCount: count })).max(20),
  risks: z.array(dossierRiskSchema).max(20),
  teams: z.array(z.strictObject({ teamName: line, priority: count, maxConcurrent: count,
    state: z.enum(["active", "paused", "ended"]) })).max(100),
  nextSteps: z.array(z.strictObject({ code: line, title: line, state: taskStateSchema })).max(10),
}).superRefine((value, ctx) => {
  if (value.canonical.reduce((n, group) => n + group.items.length, 0) > 30)
    ctx.addIssue({ code: "custom", message: "At most 30 canonical artifacts" });
});
export type ProjectDossier = z.infer<typeof dossierSchema>;

const change = z.strictObject({ count, examples: z.array(line).max(10) });
export const resumeBriefingSchema = z.strictObject({
  baseline: z.strictObject({ since: z.iso.datetime({ offset: true }), dossierRef: artifactRefSchema.nullable() }),
  changes: z.strictObject({ artifactsRegistered: change, artifactsSuperseded: change, artifactsApproved: change,
    decisionsApplied: change, requestsOpened: change, requestsClosed: change, tasksDone: change, tasksFailed: change }),
  freshness: z.strictObject({ stale: z.array(dossierRiskSchema).max(20),
    awaitingReview: z.array(z.strictObject({ ref: artifactRefSchema, title: line, ageDays: count })).max(20),
    unapprovedDossier: z.boolean() }),
  teams: z.array(z.strictObject({ teamName: line, packKey: line.nullable(), packVersion: line.nullable(),
    engagementState: z.enum(["active", "paused", "ended"]) })).max(100),
  suggestions: z.array(line).max(8), limits: z.array(line).max(8),
});
export type ResumeBriefing = z.infer<typeof resumeBriefingSchema>;
