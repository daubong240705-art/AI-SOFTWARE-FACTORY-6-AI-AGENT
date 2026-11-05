import { z } from "zod";
import {
  idSchema,
  revisionSchema,
  labelSchema,
  timestampSchema,
  textSchema,
  versionedRefSchema,
  freshnessSchema,
  linuxPathSchema,
} from "./base.js";

export const readinessSchema = z.strictObject({
  state: z.enum(["unconfigured", "needs-auth", "ready", "offline", "unknown"]),
  reason: z.string().max(2000).optional(),
  freshness: freshnessSchema,
});
export const agentActivitySchema = z.strictObject({
  state: z.enum(["idle", "working", "waiting", "blocked", "unknown"]),
  activeRunIds: z.array(idSchema).max(64),
  activeJobIds: z.array(idSchema).max(64),
  reason: z.string().max(2000).optional(),
  freshness: freshnessSchema,
});
export const agentSchema = z.strictObject({
  id: idSchema,
  projectId: idSchema,
  revision: revisionSchema,
  name: labelSchema,
  role: labelSchema,
  connectionId: idSchema,
  modelId: z.string().min(1).max(256),
  executionProfile: versionedRefSchema,
  skillRevisions: z.array(versionedRefSchema).max(100),
  toolRevisions: z.array(versionedRefSchema).max(100),
  archived: z.boolean(),
});
export const projectSchema = z.strictObject({
  id: idSchema,
  revision: revisionSchema,
  name: labelSchema,
  workspace: z.strictObject({
    kind: z.enum(["git", "directory", "artifact"]),
    root: linuxPathSchema,
  }),
  leadAgentId: idSchema.nullable(),
  disposition: z.enum(["active", "parked", "archived"]),
});
export const workCategorySchema = z.enum([
  "backlog",
  "planned",
  "active",
  "review",
  "done",
]);
export const workItemSchema = z.strictObject({
  id: idSchema,
  projectId: idSchema,
  revision: revisionSchema,
  title: labelSchema,
  brief: textSchema,
  parentId: idSchema.nullable(),
  workflow: versionedRefSchema,
  statusId: idSchema,
  category: workCategorySchema,
  disposition: z.enum(["active", "parked", "archived"]),
  assigneeId: idSchema.nullable(),
  inputs: z.array(versionedRefSchema).max(100),
  completionContract: versionedRefSchema,
  blockers: z
    .array(
      z.strictObject({
        code: labelSchema,
        summary: z.string().min(1).max(1000),
      }),
    )
    .max(30),
});
export const runStateSchema = z.enum([
  "queued",
  "starting",
  "running",
  "waiting-input",
  "stopping",
  "succeeded",
  "failed",
  "interrupted",
]);
export const attemptIdentitySchema = z.strictObject({
  projectId: idSchema,
  runId: idSchema,
  assignmentId: idSchema,
  epoch: revisionSchema,
  leaseId: idSchema,
});
export const runtimeSessionSchema = z.strictObject({
  connectionId: idSchema,
  adapterId: labelSchema,
  opaqueId: z.string().min(1).max(1024),
});
export const runSchema = z
  .strictObject({
    id: idSchema,
    projectId: idSchema,
    revision: revisionSchema,
    agentId: idSchema,
    conversationId: idSchema,
    workItemId: idSchema.nullable(),
    attempt: attemptIdentitySchema,
    state: runStateSchema,
    outcome: z.enum(["known", "unknown"]),
    session: runtimeSessionSchema.nullable(),
    profile: versionedRefSchema,
  })
  .refine(
    (run) =>
      run.id === run.attempt.runId && run.projectId === run.attempt.projectId,
    "Attempt identity must belong to this run/project",
  );
export const conversationSchema = z.strictObject({
  id: idSchema,
  projectId: idSchema,
  revision: revisionSchema,
  agentId: idSchema,
  workItemId: idSchema.nullable(),
  title: labelSchema,
});
export const messageSchema = z
  .strictObject({
    id: idSchema,
    projectId: idSchema,
    conversationId: idSchema,
    revision: revisionSchema,
    createdAt: timestampSchema,
    speaker: z.enum(["user", "agent", "system"]),
    agentId: idSchema.nullable(),
    text: textSchema,
    attachmentIds: z.array(idSchema).max(20),
    runId: idSchema.nullable(),
  })
  .refine(
    (value) =>
      value.speaker === "agent"
        ? value.agentId !== null
        : value.agentId === null,
    "Only agent messages carry an agent identity",
  );
export const draftSchema = z.strictObject({
  projectId: idSchema,
  conversationId: idSchema,
  revision: revisionSchema,
  text: z.string().max(32_000),
  attachmentIds: z.array(idSchema).max(20),
  updatedAt: timestampSchema,
});
export const decisionSchema = z.strictObject({
  id: idSchema,
  projectId: idSchema,
  revision: revisionSchema,
  conversationId: idSchema,
  workItemId: idSchema.nullable(),
  question: textSchema,
  context: z.array(versionedRefSchema).min(1).max(100),
  state: z.enum(["pending", "answered", "superseded"]),
});
export const reviewSchema = z.strictObject({
  id: idSchema,
  projectId: idSchema,
  revision: revisionSchema,
  output: versionedRefSchema,
  policy: z.enum(["human-final", "automatic", "hybrid"]),
  state: z.enum(["pending", "accepted", "changes-requested", "superseded"]),
});
export const outputSchema = z.strictObject({
  id: idSchema,
  projectId: idSchema,
  revision: revisionSchema,
  workItemId: idSchema,
  runId: idSchema,
  title: labelSchema,
  mediaType: z.string().min(1).max(128),
  assetId: idSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  evidenceIds: z.array(idSchema).max(100),
});
export type Agent = z.infer<typeof agentSchema>;
export type Run = z.infer<typeof runSchema>;
export type AttemptIdentity = z.infer<typeof attemptIdentitySchema>;
export type RuntimeSession = z.infer<typeof runtimeSessionSchema>;
export type Project = z.infer<typeof projectSchema>;
export type WorkItem = z.infer<typeof workItemSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Draft = z.infer<typeof draftSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type Output = z.infer<typeof outputSchema>;
