import { z } from "zod";
import { idSchema, labelSchema, revisionSchema, timestampSchema } from "./base.js";

/**
 * U1 (docs/architecture/17 §5): agents are project-scoped and configured in the database.
 * The physical table stays `seats`; on the wire and in the UI the entity is an "agent".
 * Every config change creates an immutable Agent Revision; attempts pin the revision they ran with.
 */

/** How the agent is executed. `api-agent` is accepted by the contract but rejected by the Host until U3. */
export const agentAdapterSchema = z.enum(["claude-code", "codex", "opencode", "api-agent", "fake"]);
export type AgentAdapter = z.infer<typeof agentAdapterSchema>;
/** `read-only` arrives with the U3 runtime work; the U1 Host maps only these two. */
export const agentPermissionSchema = z.enum(["workspace-write", "autonomous"]);
export const agentEffortSchema = z.enum(["low", "medium", "high", "xhigh"]);
export const agentStatusSchema = z.enum(["active", "paused", "archived", "pending-approval"]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export const agentAutonomySchema = z.enum(["L0", "L1", "L2", "L3", "L4"]);

/** Same grammar as workflow `requiredCapabilities`, so v1 stages keep selecting agents by tag. */
export const agentTagSchema = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,39}$/);
/** Syntax only (`knowledge.search`, `knowledge.*`, `ext.playwright.*`). The Host checks that the tool exists. */
export const toolPatternSchema = z.string().max(120)
  .regex(/^[a-z][a-z0-9-]*(?:\.(?:[a-z0-9][a-z0-9_-]*))*(?:\.\*)?$/);
const modelNameSchema = z.string().min(1).max(256).regex(/^[^\s\p{Cc}]+$/u);
const uniqueBy = <T>(key: (value: T) => string) => (values: T[]) => new Set(values.map(key)).size === values.length;

export const agentSkillRefSchema = z.strictObject({
  skillId: idSchema,
  /** A pinned version, or "latest" (resolved and pinned per attempt). */
  version: z.union([revisionSchema, z.literal("latest")]),
});
/** `ask` (approval before the call) arrives in U2; U1 stores allow/deny only. */
export const agentToolGrantSchema = z.strictObject({ tool: toolPatternSchema, mode: z.enum(["allow", "deny"]) });

export const agentConfigSchema = z.strictObject({
  name: labelSchema.max(80),
  /** Free text; permissions never come from the role name. */
  role: labelSchema,
  description: z.string().max(2_000).default(""),
  goals: z.array(z.string().trim().min(1).max(500)).max(12).default([]),
  /** Markdown system instructions (the old pack "profile"). */
  instructions: z.string().max(65_536).default(""),
  workRules: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  /** Selector tags (old pack "capabilities"). */
  tags: z.array(agentTagSchema).max(16).refine(uniqueBy((t: string) => t), "duplicate tag").default([]),
  runtime: z.strictObject({
    adapter: agentAdapterSchema,
    /** null = the Host default model for the adapter. */
    model: modelNameSchema.nullable().default(null),
    effort: agentEffortSchema.nullable().default(null),
    permission: agentPermissionSchema.default("workspace-write"),
    maxConcurrent: z.number().int().min(1).max(8).default(1),
    timeoutMinutes: z.number().int().min(1).max(720).default(60),
  }),
  skills: z.array(agentSkillRefSchema).max(40).refine(uniqueBy((s: { skillId: string }) => s.skillId), "duplicate skill").default([]),
  /** null = every built-in Factory tool and no external tool (the legacy default for packs without `tools`). */
  tools: z.array(agentToolGrantSchema).max(64).refine(uniqueBy((t: { tool: string }) => t.tool), "duplicate tool").nullable().default(null),
  delegation: z.strictObject({
    canAssign: z.enum(["none", "relations", "team", "project"]).default("none"),
    canProposeAgents: z.boolean().default(false),
    maxDepth: z.number().int().min(0).max(3).default(1),
    maxOpenSubtasks: z.number().int().min(0).max(20).default(5),
  }).prefault({}),
  autonomy: agentAutonomySchema.nullable().default(null),
  budget: z.strictObject({
    perTaskTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    monthlyTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  }).prefault({}),
});
/** Parsed (defaults applied). */
export type AgentConfig = z.infer<typeof agentConfigSchema>;
/** What a client may send (defaults optional). */
export type AgentConfigInput = z.input<typeof agentConfigSchema>;

export const agentRelationKindSchema = z.enum(["manages", "reviews", "collaborates", "approves"]);
export type AgentRelationKind = z.infer<typeof agentRelationKindSchema>;
export const agentRelationSchema = z.strictObject({
  from: idSchema, to: idSchema, kind: agentRelationKindSchema,
}).refine((r) => r.from !== r.to, "an agent cannot relate to itself");
export type AgentRelation = z.infer<typeof agentRelationSchema>;

/** Who should do a piece of work (17 §5.5). Replaces the keyword rules of the old `pickSeat`. */
export const agentSelectorSchema = z.union([
  z.strictObject({ agent: idSchema }),
  z.strictObject({ team: idSchema, pick: z.enum(["least-busy", "round-robin"]).default("least-busy") }),
  z.strictObject({ role: labelSchema }),
  z.strictObject({ tags: z.array(agentTagSchema).min(1).max(8) }),
]);
export type AgentSelector = z.infer<typeof agentSelectorSchema>;

// ---- Read models (GET responses; the UI validates them) -----------------------------------------

export const agentSummarySchema = z.strictObject({
  id: idSchema,
  projectId: idSchema,
  /** Row revision (status, lead flag, config pointer). Use it as expectedRevision for agent commands. */
  revision: revisionSchema,
  /** Current Agent Revision number. */
  configRevision: revisionSchema,
  status: agentStatusSchema,
  isLead: z.boolean(),
  name: labelSchema,
  role: labelSchema,
  adapter: agentAdapterSchema,
  model: z.string().nullable(),
  teamIds: z.array(idSchema),
  template: z.strictObject({ id: idSchema, revision: revisionSchema, latestRevision: revisionSchema }).nullable(),
  /** Live attempts right now. */
  live: z.number().int().min(0),
});
export type AgentSummary = z.infer<typeof agentSummarySchema>;

export const agentDetailSchema = agentSummarySchema.safeExtend({
  config: agentConfigSchema,
  revisions: z.array(z.strictObject({
    revision: revisionSchema, createdAt: timestampSchema, actorId: z.string().max(200), note: z.string().max(500).nullable(),
  })).max(200),
});
export type AgentDetail = z.infer<typeof agentDetailSchema>;

export const agentRevisionViewSchema = z.strictObject({
  agentId: idSchema, revision: revisionSchema, createdAt: timestampSchema, actorId: z.string().max(200),
  note: z.string().max(500).nullable(), config: agentConfigSchema,
});

export const projectTeamSchema = z.strictObject({
  id: idSchema, projectId: idSchema, revision: revisionSchema, name: labelSchema, description: z.string().max(2_000),
  leadAgentId: idSchema.nullable(), memberIds: z.array(idSchema).max(200),
});
export type ProjectTeam = z.infer<typeof projectTeamSchema>;

export const projectAgentsResponseSchema = z.strictObject({
  agents: z.array(agentSummarySchema).max(500),
  teams: z.array(projectTeamSchema).max(100),
  relations: z.array(agentRelationSchema).max(2_000),
  /** Bumped by every relations.set; use as expectedRevision. 0 before the first set. */
  relationsRevision: z.number().int().min(0),
});
export type ProjectAgentsResponse = z.infer<typeof projectAgentsResponseSchema>;

// ---- Library: skills and agent templates --------------------------------------------------------

export const skillNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const skillSummarySchema = z.strictObject({
  id: idSchema, name: skillNameSchema, description: z.string().max(1_024), latestVersion: revisionSchema,
  trust: z.enum(["instructions", "assets", "scripts"]), source: z.string().max(300).nullable(), updatedAt: timestampSchema,
});
export type SkillSummary = z.infer<typeof skillSummarySchema>;
export const skillVersionSchema = z.strictObject({
  skillId: idSchema, version: revisionSchema, name: skillNameSchema, description: z.string().max(1_024),
  content: z.string().max(65_536), sha256: z.string().regex(/^[a-f0-9]{64}$/), createdAt: timestampSchema,
});
export type SkillVersion = z.infer<typeof skillVersionSchema>;

export const agentTemplateSummarySchema = z.strictObject({
  id: idSchema, name: labelSchema, role: labelSchema, description: z.string().max(2_000), latestRevision: revisionSchema,
  source: z.strictObject({ packKey: z.string().max(40), packVersion: z.string().max(40) }).nullable(), updatedAt: timestampSchema,
});
export type AgentTemplateSummary = z.infer<typeof agentTemplateSummarySchema>;

export const libraryResponseSchema = z.strictObject({
  skills: z.array(skillSummarySchema).max(2_000),
  templates: z.array(agentTemplateSummarySchema).max(2_000),
});
export type LibraryResponse = z.infer<typeof libraryResponseSchema>;

// ---- Command payloads (registered in commands.ts) ----------------------------------------------

const change = { expectedRevision: revisionSchema };
export const agentsCreatePayloadSchema = z.strictObject({
  agentId: idSchema,
  config: agentConfigSchema,
  /** Team ids (kind "group") of the same project to join. */
  teamIds: z.array(idSchema).max(20).default([]),
  isLead: z.boolean().default(false),
  /** Fork from a template revision: the config above is stored as sent; the link is kept only when `link` is true. */
  template: z.strictObject({ id: idSchema, revision: revisionSchema, link: z.boolean() }).optional(),
});
export const agentsUpdatePayloadSchema = z.strictObject({
  agentId: idSchema, ...change, config: agentConfigSchema, note: z.string().trim().min(1).max(500).optional(),
});
export const agentsClonePayloadSchema = z.strictObject({
  sourceAgentId: idSchema, agentId: idSchema, name: labelSchema.max(80),
});
export const agentsSetStatusPayloadSchema = z.strictObject({
  agentId: idSchema, ...change, status: z.enum(["active", "paused", "archived"]),
});
export const agentsSetLeadPayloadSchema = z.strictObject({ agentId: idSchema, ...change });
export const agentsRollbackPayloadSchema = z.strictObject({ agentId: idSchema, ...change, toRevision: revisionSchema });
/** Deletes an agent that never ran an attempt and owns no task; otherwise the Host refuses (archive instead). */
export const agentsDeletePayloadSchema = z.strictObject({ agentId: idSchema, ...change });
export const agentTeamsCreatePayloadSchema = z.strictObject({
  teamId: idSchema, name: labelSchema.max(80), description: z.string().max(2_000).default(""),
  leadAgentId: idSchema.nullable().default(null), memberIds: z.array(idSchema).max(200).default([]),
});
export const agentTeamsUpdatePayloadSchema = z.strictObject({
  teamId: idSchema, ...change, name: labelSchema.max(80).optional(), description: z.string().max(2_000).optional(),
  leadAgentId: idSchema.nullable().optional(), memberIds: z.array(idSchema).max(200).optional(),
});
export const agentTeamsDeletePayloadSchema = z.strictObject({ teamId: idSchema, ...change });
/** Replaces the whole relation set of the project (small graphs; simple optimistic concurrency). */
export const relationsSetPayloadSchema = z.strictObject({
  expectedRevision: z.number().int().min(0), relations: z.array(agentRelationSchema).max(2_000),
});

export const agentTemplateDetailSchema = z.strictObject({
  template: agentTemplateSummarySchema,
  revision: revisionSchema,
  config: agentConfigSchema,
});
export type AgentTemplateDetail = z.infer<typeof agentTemplateDetailSchema>;
