import { monitorCreateSchema, monitorPatchSchema } from "./automation.js";
import { notificationIdPayloadSchema } from "./notifications.js";
import { standingCreateSchema, standingRevokeSchema } from "./standing.js";
import { ruleInputSchema, rulePatchSchema } from "./rules.js";
import { autonomyLevelSchema } from "./autonomy.js";
import { modelSettingsSetSchema } from "./model-settings.js";
import { z } from "zod";
import {
  groupsCreatePayloadSchema, groupsUpdatePayloadSchema, groupsMovePayloadSchema, groupsArchivePayloadSchema,
  groupsDeletePayloadSchema, groupsSetSettingsPayloadSchema, projectsSetGroupPayloadSchema,
} from "./groups.js";
import {
  flowsCreatePayloadSchema, flowsSaveDraftPayloadSchema, flowsPublishPayloadSchema, flowsArchivePayloadSchema, flowsImportV1PayloadSchema,
  flowRunsStartPayloadSchema, flowRunsPausePayloadSchema, flowRunsResumePayloadSchema, flowRunsCancelPayloadSchema, flowRunsRetryNodePayloadSchema,
} from "./flow-api.js";
import {
  agentsCreatePayloadSchema, agentsUpdatePayloadSchema, agentsClonePayloadSchema, agentsSetStatusPayloadSchema,
  agentsSetLeadPayloadSchema, agentsRollbackPayloadSchema, agentsDeletePayloadSchema, agentTeamsCreatePayloadSchema,
  agentTeamsUpdatePayloadSchema, agentTeamsDeletePayloadSchema, relationsSetPayloadSchema,
  skillsCreatePayloadSchema, skillsUpdatePayloadSchema, skillsDeletePayloadSchema, templatesCreatePayloadSchema,
  templatesUpdatePayloadSchema, templatesDeletePayloadSchema, agentsUpgradeFromTemplatePayloadSchema, agentsSaveAsTemplatePayloadSchema,
} from "./agents.js";
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
  command("integration.retry", z.strictObject({ taskId: idSchema })),
  command("integration.skip", z.strictObject({ taskId: idSchema })),
  command("standing-approvals.create", standingCreateSchema),
  command("standing-approvals.revoke", standingRevokeSchema),
  command("notifications.mark-read", notificationIdPayloadSchema),
  command("notifications.dismiss", notificationIdPayloadSchema),
  command("autonomy.set", z.strictObject({ subject: z.enum(["project", "team"]), subjectRef: idSchema,
    level: autonomyLevelSchema, expectedRevision: revisionSchema.nullable() })),
  command("rules.create", ruleInputSchema.safeExtend({ ruleId: idSchema })),
  command("rules.update", z.strictObject({ ruleId: idSchema, ...change, patch: rulePatchSchema })),
  command("rules.pause", z.strictObject({ ruleId: idSchema, ...change })),
  command("rules.resume", z.strictObject({ ruleId: idSchema, ...change })),
  command("rules.delete", z.strictObject({ ruleId: idSchema, ...change })),
  command("monitors.create", monitorCreateSchema.safeExtend({ monitorId: idSchema })),
  command("monitors.update", z.strictObject({ monitorId: idSchema, ...change, patch: monitorPatchSchema })),
  command("monitors.pause", z.strictObject({ monitorId: idSchema, ...change })),
  command("monitors.resume", z.strictObject({ monitorId: idSchema, ...change })),
  command("monitors.delete", z.strictObject({ monitorId: idSchema, ...change })),
  command(
    "projects.create",
    z.strictObject({
      name: labelSchema,
      workspace: z.strictObject({
        kind: z.enum(["git", "directory", "artifact"]),
        root: linuxPathSchema,
      }),
      /** U1: a pack key whose seats become the project's first agents. Omitted = the project starts with no agents. */
      teamTemplate: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
      /** U9: the group the project is created in (root when omitted). */
      groupId: idSchema.optional(),
    }),
  ),
  command("projects.update", z.strictObject({ ...change, name: labelSchema })),
  command("projects.archive", z.strictObject({ ...change, confirmName: z.string().max(160) })),
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
  // U1 (doc 17 §5.7): project-scoped agents, teams and relations configured in the database.
  command("agents.create", agentsCreatePayloadSchema),
  command("agents.update", agentsUpdatePayloadSchema),
  command("agents.clone", agentsClonePayloadSchema),
  command("agents.set-status", agentsSetStatusPayloadSchema),
  command("agents.set-lead", agentsSetLeadPayloadSchema),
  command("agents.rollback", agentsRollbackPayloadSchema),
  command("agents.delete", agentsDeletePayloadSchema),
  command("teams.create", agentTeamsCreatePayloadSchema),
  command("teams.update", agentTeamsUpdatePayloadSchema),
  command("teams.delete", agentTeamsDeletePayloadSchema),
  command("relations.set", relationsSetPayloadSchema),
  // U2: library (projectId = LIBRARY_SCOPE_ID) and template links (project-scoped).
  command("skills.create", skillsCreatePayloadSchema),
  command("skills.update", skillsUpdatePayloadSchema),
  command("skills.delete", skillsDeletePayloadSchema),
  command("templates.create", templatesCreatePayloadSchema),
  command("templates.update", templatesUpdatePayloadSchema),
  command("templates.delete", templatesDeletePayloadSchema),
  command("agents.upgrade-from-template", agentsUpgradeFromTemplatePayloadSchema),
  command("agents.save-as-template", agentsSaveAsTemplatePayloadSchema),
  // U4: Workflow v2 (doc 17 §8).
  command("flows.create", flowsCreatePayloadSchema),
  command("flows.save-draft", flowsSaveDraftPayloadSchema),
  command("flows.publish", flowsPublishPayloadSchema),
  command("flows.archive", flowsArchivePayloadSchema),
  command("flows.import-v1", flowsImportV1PayloadSchema),
  command("flow-runs.start", flowRunsStartPayloadSchema),
  command("flow-runs.pause", flowRunsPausePayloadSchema),
  command("flow-runs.resume", flowRunsResumePayloadSchema),
  command("flow-runs.cancel", flowRunsCancelPayloadSchema),
  command("flow-runs.retry-node", flowRunsRetryNodePayloadSchema),
  // U9: GitLab-like groups (projectId = SYSTEM_SCOPE_ID) and project placement (project-scoped).
  command("groups.create", groupsCreatePayloadSchema),
  command("groups.update", groupsUpdatePayloadSchema),
  command("groups.move", groupsMovePayloadSchema),
  command("groups.archive", groupsArchivePayloadSchema),
  command("groups.delete", groupsDeletePayloadSchema),
  command("groups.set-settings", groupsSetSettingsPayloadSchema),
  command("projects.set-group", projectsSetGroupPayloadSchema),
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
      scope: z.enum(["task", "day", "project", "engagement"]),
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
  command("models.set", modelSettingsSetSchema),
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
