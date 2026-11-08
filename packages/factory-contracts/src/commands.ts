import { z } from "zod";
import {
  API_VERSION,
  idSchema,
  revisionSchema,
  labelSchema,
  textSchema,
  versionedRefSchema,
  linuxPathSchema,
  sha256Schema,
} from "./base.js";
import { artifactRefSchema, artifactStatusSchema } from "./knowledge.js";
import { capabilityIdSchema } from "./nodes.js";
import {
  DEFAULT_PLACEMENT,
  DEFAULT_SIDE_EFFECT,
  placementSchema,
  reviewPolicySchema,
  sideEffectSchema,
  taskStateSchema,
} from "./work.js";

const command = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.strictObject({
    apiVersion: z.literal(API_VERSION),
    commandId: idSchema,
    projectId: idSchema,
    type: z.literal(type),
    payload,
  });
const change = { expectedRevision: revisionSchema };
// No actor, credentials, effective grant, status category or windowId supplied by the browser.
export const commandSchema = z.discriminatedUnion("type", [
  command(
    "projects.create",
    z.strictObject({
      name: labelSchema,
      workspace: z.strictObject({
        kind: z.enum(["git", "directory", "artifact"]),
        root: linuxPathSchema,
      }),
    }),
  ),
  command("projects.update", z.strictObject({ ...change, name: labelSchema })),
  command(
    "agents.configure",
    z.strictObject({
      agentId: idSchema,
      expectedRevision: revisionSchema.nullable(),
      name: labelSchema,
      role: labelSchema,
      connectionId: idSchema,
      modelId: z.string().min(1).max(256),
      executionProfile: versionedRefSchema,
      skillRevisions: z.array(versionedRefSchema).max(100),
      toolRevisions: z.array(versionedRefSchema).max(100),
    }),
  ),
  command(
    "conversations.create",
    z.strictObject({
      conversationId: idSchema,
      agentId: idSchema,
      title: labelSchema,
      workItemId: idSchema.nullable(),
    }),
  ),
  command(
    "chat.send",
    z.strictObject({
      conversationId: idSchema,
      expectedRevision: revisionSchema,
      messageId: idSchema,
      text: textSchema,
      attachmentIds: z.array(idSchema).max(20),
      intent: z.enum(["discuss", "delegate"]),
      context: z.array(versionedRefSchema).max(100),
      // Host clears only this exact draft revision; a newer draft must survive send acknowledgement.
      draftRevision: revisionSchema.nullable(),
    }),
  ),
  command(
    "drafts.save",
    z.strictObject({
      conversationId: idSchema,
      expectedRevision: revisionSchema.nullable(),
      text: z.string().max(32_000),
      attachmentIds: z.array(idSchema).max(20),
    }),
  ),
  command(
    "work.create",
    z.strictObject({
      workItemId: idSchema,
      title: labelSchema,
      brief: textSchema,
      parentId: idSchema.nullable(),
      workflow: versionedRefSchema,
      statusId: idSchema,
      inputs: z.array(versionedRefSchema).max(100),
      completionContract: versionedRefSchema,
    }),
  ),
  command(
    "work.assign",
    z.strictObject({
      ...change,
      workItemId: idSchema,
      agentId: idSchema.nullable(),
    }),
  ),
  command(
    "work.transition",
    z.strictObject({ ...change, workItemId: idSchema, statusId: idSchema }),
  ),
  command(
    "decisions.answer",
    z.strictObject({
      ...change,
      decisionId: idSchema,
      context: z.array(versionedRefSchema).min(1).max(100),
      answer: textSchema,
    }),
  ),
  command(
    "reviews.submit",
    z.strictObject({
      ...change,
      reviewId: idSchema,
      output: versionedRefSchema,
      verdict: z.enum(["accepted", "changes-requested"]),
      comment: z.string().max(32_000),
    }),
  ),
  command("runs.cancel", z.strictObject({ ...change, runId: idSchema })),
  command("runs.reconcile", z.strictObject({ ...change, runId: idSchema })),
  command(
    "outputs.register",
    z.strictObject({
      outputId: idSchema,
      expectedRevision: revisionSchema.nullable(),
      workItemId: idSchema,
      runId: idSchema,
      title: labelSchema,
      assetId: idSchema,
      evidenceIds: z.array(idSchema).max(100),
    }),
  ),
  // ---- Added in contracts 0.2.0 (M0-lite). Additive: the commands above are unchanged. -----------
  command(
    "engagements.create",
    z.strictObject({
      engagementId: idSchema,
      teamId: idSchema,
      priority: z.number().int().min(0).max(100),
      maxConcurrent: z.number().int().min(1).max(32),
    }),
  ),
  command("teams.create-from-pack", z.strictObject({
    teamId: idSchema, packKey: labelSchema, packVersion: labelSchema,
  })),
  command("teams.set-lifecycle", z.strictObject({
    ...change, teamId: idSchema, lifecycle: z.enum(["active", "paused", "archived"]),
  })),
  command("engagements.update", z.strictObject({
    ...change, engagementId: idSchema,
    priority: z.number().int().min(0).max(100).optional(),
    maxConcurrent: z.number().int().min(1).max(32).optional(),
    state: z.enum(["active", "paused", "ended"]).optional(),
  })),
  // Seats remain elastic; dedicated node assignment arrives in M4.
  command("seats.update", z.strictObject({
    ...change, seatId: idSchema, slots: z.number().int().min(1).max(8).optional(),
  })),
  command(
    "tasks.create",
    z.strictObject({
      taskId: idSchema,
      code: z.string().regex(/^[A-Z]{2,6}-\d{3,6}$/),
      title: labelSchema,
      goal: z.string().min(1).max(500),
      brief: textSchema,
      parentTaskId: idSchema.nullable(),
      engagementId: idSchema.nullable(),
      ownerSeatId: idSchema.nullable(),
      requiredCapabilities: z.array(capabilityIdSchema).max(30),
      // E-06: when omitted the most restrictive classification applies.
      placement: placementSchema.default(DEFAULT_PLACEMENT),
      sideEffect: sideEffectSchema.default(DEFAULT_SIDE_EFFECT),
      reviewPolicy: reviewPolicySchema.default("human-final"),
      requiresGo: z.boolean().default(true), // C-04: the Execution Gate is on unless turned off
      acceptance: z.array(z.string().min(1).max(500)).max(30),
      inputs: z.array(artifactRefSchema).max(100),
      dependsOn: z.array(idSchema).max(50),
    }),
  ),
  command(
    "tasks.transition",
    z.strictObject({ ...change, taskId: idSchema, to: taskStateSchema }),
  ),
  // Releases a task waiting at the Execution Gate. The browser never states who it is.
  command("tasks.release", z.strictObject({ ...change, taskId: idSchema })),
  command(
    "approvals.decide",
    z.strictObject({
      ...change,
      approvalId: idSchema,
      // Digest the person saw. If the context changed meanwhile the Host rejects with a conflict.
      contextDigest: sha256Schema,
      optionId: labelSchema,
      comment: z.string().max(32_000),
    }),
  ),
  command(
    "budgets.set",
    z.strictObject({
      budgetId: idSchema,
      expectedRevision: revisionSchema.nullable(),
      scope: z.enum(["task", "day"]),
      scopeRef: z.string().min(1).max(64),
      limitTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      warnAtPercent: z.number().int().min(1).max(99),
    }),
  ),
  command("artifacts.transition", z.strictObject({
    artifactId: idSchema, version: revisionSchema, to: artifactStatusSchema, comment: z.string().max(4_000),
  })),
  command("dossier.refresh", z.strictObject({})),
  command("artifacts.share", z.strictObject({
    artifactId: idSchema, version: revisionSchema, visibility: z.enum(["team-draft", "project", "shared"]),
  })),
  command("artifacts.clear-stale", z.strictObject({
    artifactId: idSchema, version: revisionSchema, becauseArtifactId: idSchema, becauseVersion: revisionSchema,
  })),
  command("requests.triage", z.strictObject({
    requestTaskId: idSchema,
    decision: z.enum(["accept", "need-info", "decline", "redirect", "merge"]),
    reason: z.string().min(1).max(1000),
    ownerSeatId: idSchema.optional(),
    redirectTeamId: idSchema.optional(),
    mergeIntoTaskId: idSchema.optional(),
  })),
  command("requests.message", z.strictObject({ requestTaskId: idSchema, text: z.string().min(1).max(2000) })),
]);
export type Command = z.infer<typeof commandSchema>;
export type CommandType = Command["type"];
export const FOUNDATION_COMMANDS = commandSchema.options.map(
  (schema) => schema.shape.type.value,
);
// A supported contract is not an installed handler. Host advertises the implemented subset.
export const hostCapabilitiesSchema = z.strictObject({
  apiVersion: z.literal(API_VERSION),
  hostId: idSchema,
  commands: z.array(z.enum(FOUNDATION_COMMANDS)),
});
