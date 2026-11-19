import {
  skillDetailSchema, skillVersionSchema,
  agentDetailSchema, agentRevisionViewSchema, agentTemplateDetailSchema,
  libraryResponseSchema, projectAgentsResponseSchema, successResponseSchema,
} from '@factory/contracts';

const ok = successResponseSchema.pick({ ok: true, apiVersion: true });
export const agentModels = {
  project: ok.extend(projectAgentsResponseSchema.shape),
  detail: ok.extend(agentDetailSchema.shape),
  revision: ok.extend(agentRevisionViewSchema.shape),
  library: ok.extend(libraryResponseSchema.shape),
  skill: ok.extend(skillDetailSchema.shape),
  skillVersion: ok.extend(skillVersionSchema.shape),
  template: ok.extend(agentTemplateDetailSchema.shape),
};
export type AgentProjectResponse = ReturnType<typeof projectAgentsResponseSchema.parse>;
export type AgentDetail = ReturnType<typeof agentDetailSchema.parse>;
export type AgentLibrary = ReturnType<typeof libraryResponseSchema.parse>;
