import { groupDetailSchema, groupsResponseSchema, successResponseSchema } from '@factory/contracts';

const ok = successResponseSchema.pick({ ok: true, apiVersion: true });
export const groupModels = { list: ok.extend(groupsResponseSchema.shape), detail: ok.extend(groupDetailSchema.shape) };
