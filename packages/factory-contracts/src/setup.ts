import { z } from "zod";
import { agentConfigSchema, agentRelationKindSchema } from "./agents.js";
import { idSchema, labelSchema, revisionSchema } from "./base.js";
import { flowDefinitionSchema } from "./flow.js";

const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const request = z.string().trim().min(1).max(4_000);

export const setupProposalSchema = z.strictObject({
  summary: z.string().trim().min(1).max(2_000),
  agents: z.array(z.strictObject({ key, config: agentConfigSchema })).max(100),
  teams: z.array(z.strictObject({ name: labelSchema.max(80), description: z.string().max(2_000),
    memberKeys: z.array(key).max(200), leadKey: key.optional() })).max(100),
  relations: z.array(z.strictObject({ fromKey: key, toKey: key, kind: agentRelationKindSchema })).max(2_000),
  // Within a proposal, { role: "setup:<key>" } selects a proposed agent by local key.
  flows: z.array(flowDefinitionSchema).max(10),
  notes: z.array(z.string().max(2_000)).max(50),
});
export type SetupProposal = z.infer<typeof setupProposalSchema>;

export const setupProposePayloadSchema = z.discriminatedUnion("mode", [
  z.strictObject({ proposalId: idSchema, request, mode: z.literal("project") }),
  z.strictObject({ proposalId: idSchema, request, mode: z.literal("flow"), flowId: idSchema.optional() }),
]);
export const setupApplyPayloadSchema = z.strictObject({
  proposalId: idSchema, expectedRevision: revisionSchema, edited: setupProposalSchema.optional(),
});
export const setupDiscardPayloadSchema = z.strictObject({ proposalId: idSchema, expectedRevision: revisionSchema.optional() });

export const setupIssueSchema = z.strictObject({ path: z.string().max(256), message: z.string().max(500) });
export type SetupIssue = z.infer<typeof setupIssueSchema>;
export const setupProposalViewSchema = z.strictObject({
  id: idSchema, revision: revisionSchema,
  state: z.enum(["generating", "ready", "invalid", "applied", "discarded", "failed"]),
  request,
  proposal: setupProposalSchema.optional(),
  issues: z.array(setupIssueSchema).max(50),
  applied: z.strictObject({ agentIds: z.array(idSchema), teamIds: z.array(idSchema), flowIds: z.array(idSchema) }).optional(),
  tokens: z.number().int().nonnegative().nullable(),
});
export type SetupProposalView = z.infer<typeof setupProposalViewSchema>;
