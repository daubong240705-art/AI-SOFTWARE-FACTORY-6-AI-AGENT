import { setupProposalViewSchema, successResponseSchema } from '@factory/contracts';

const envelope = successResponseSchema.pick({ ok: true, apiVersion: true });
export const setupModels = {
  list: envelope.extend({ proposals: setupProposalViewSchema.array().max(100) }),
  detail: envelope.extend({ proposal: setupProposalViewSchema }),
};
