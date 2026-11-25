import { z } from "zod";
import { idSchema, labelSchema, revisionSchema, timestampSchema } from "./base.js";
import { agentAdapterSchema, agentEffortSchema } from "./agents.js";

/**
 * GitLab-like groups (see docs/architecture.md). Groups nest up to GROUP_MAX_DEPTH levels; a project belongs
 * to at most one group. Groups share CONFIGURATION (templates, skills, default model/runtime, budget), never runtime
 * state: agents, sessions, memory and workspaces stay per project.
 * Group commands are global and use SYSTEM_SCOPE_ID as `projectId` (like the library).
 */
export const SYSTEM_SCOPE_ID = "00000000-0000-4000-8000-000000000000";
export const GROUP_MAX_DEPTH = 5;

/** URL segment, like GitLab paths: lowercase letters, digits, dash, dot, underscore. */
export const groupSlugSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9._-]{0,48}[a-z0-9])?$/);

export const groupSettingsSchema = z.strictObject({
  /** Default for agents of projects below whose config has `runtime.model = null`. */
  defaultModel: z.string().min(1).max(256).regex(/^[^\s\p{Cc}]+$/u).nullable().default(null),
  /** Suggested adapter for agents created in projects below (UI default). */
  defaultAdapter: agentAdapterSchema.nullable().default(null),
  defaultEffort: agentEffortSchema.nullable().default(null),
  /** Rolling 30-day token cap for all projects in the subtree; new work is refused when reached. */
  budgetTokens30d: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().default(null),
});
export type GroupSettings = z.infer<typeof groupSettingsSchema>;

export const groupSummarySchema = z.strictObject({
  id: idSchema,
  revision: revisionSchema,
  parentId: idSchema.nullable(),
  slug: groupSlugSchema,
  name: labelSchema.max(80),
  description: z.string().max(2_000),
  /** Full slug path, e.g. "khach-hang-a/website". */
  path: z.string().max(260),
  depth: z.number().int().min(1).max(GROUP_MAX_DEPTH),
  archived: z.boolean(),
  /** Direct projects (not archived). */
  projectCount: z.number().int().min(0),
  updatedAt: timestampSchema,
});
export type GroupSummary = z.infer<typeof groupSummarySchema>;

export const groupsResponseSchema = z.strictObject({
  groups: z.array(groupSummarySchema).max(2_000),
  /** projectId -> groupId for every non-archived project that is in a group. */
  membership: z.record(idSchema, idSchema),
});
export type GroupsResponse = z.infer<typeof groupsResponseSchema>;

const settingSourceSchema = z.union([z.literal("default"), z.strictObject({ groupId: idSchema })]);
export const groupDetailSchema = z.strictObject({
  group: groupSummarySchema,
  /** Settings stored on this group (null fields = inherit). Row revision for groups.set-settings (0 = never set). */
  settings: groupSettingsSchema,
  settingsRevision: z.number().int().min(0),
  /** Resolved values for this group, with where each came from. */
  effective: z.strictObject({
    defaultModel: z.strictObject({ value: z.string().nullable(), source: settingSourceSchema }),
    defaultAdapter: z.strictObject({ value: agentAdapterSchema.nullable(), source: settingSourceSchema }),
    defaultEffort: z.strictObject({ value: agentEffortSchema.nullable(), source: settingSourceSchema }),
    budgetTokens30d: z.strictObject({ value: z.number().int().nullable(), source: settingSourceSchema }),
  }),
  ancestors: z.array(z.strictObject({ id: idSchema, slug: groupSlugSchema, name: labelSchema })).max(GROUP_MAX_DEPTH),
  children: z.array(groupSummarySchema).max(500),
  projects: z.array(z.strictObject({ id: idSchema, name: labelSchema, disposition: z.enum(["active", "parked", "archived"]) })).max(1_000),
  /** Aggregated over the whole subtree (all descendant groups and their projects). */
  rollup: z.strictObject({
    projects: z.number().int().min(0),
    tasksByState: z.record(z.string(), z.number().int().min(0)),
    pendingApprovals: z.number().int().min(0),
    activeFlowRuns: z.number().int().min(0),
    liveAttempts: z.number().int().min(0),
    /** null when any usage in the window is unreported (cost is unknown, never 0). */
    tokens30d: z.number().int().min(0).nullable(),
    budgetTokens30d: z.number().int().nullable(),
  }),
});
export type GroupDetail = z.infer<typeof groupDetailSchema>;

// ---- Command payloads ----------------------------------------------------------------------------
const change = { expectedRevision: revisionSchema };
export const groupsCreatePayloadSchema = z.strictObject({
  groupId: idSchema, parentId: idSchema.nullable(), slug: groupSlugSchema, name: labelSchema.max(80),
  description: z.string().max(2_000).default(""),
});
export const groupsUpdatePayloadSchema = z.strictObject({
  groupId: idSchema, ...change, slug: groupSlugSchema.optional(), name: labelSchema.max(80).optional(),
  description: z.string().max(2_000).optional(),
});
/** Moves a group with its subtree; refused when it would create a cycle or exceed GROUP_MAX_DEPTH. */
export const groupsMovePayloadSchema = z.strictObject({ groupId: idSchema, ...change, parentId: idSchema.nullable() });
export const groupsArchivePayloadSchema = z.strictObject({ groupId: idSchema, ...change, archived: z.boolean() });
/** Only an empty group (no child group, no project, no scoped template/skill) can be deleted. */
export const groupsDeletePayloadSchema = z.strictObject({ groupId: idSchema, ...change });
export const groupsSetSettingsPayloadSchema = z.strictObject({
  groupId: idSchema, expectedRevision: z.number().int().min(0), settings: groupSettingsSchema,
});
/** Project-scoped (real projectId): move the project into a group, or to the root with null. */
export const projectsSetGroupPayloadSchema = z.strictObject({ ...change, groupId: idSchema.nullable() });
