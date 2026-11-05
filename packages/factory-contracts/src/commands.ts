import { z } from "zod";
import {
  API_VERSION,
  idSchema,
  revisionSchema,
  labelSchema,
  textSchema,
  versionedRefSchema,
  linuxPathSchema,
} from "./base.js";

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
