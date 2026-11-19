import {
  apiErrorSchema, failureResponseSchema, flowDetailSchema, flowIssueSchema, flowRunDetailSchema,
  projectFlowsResponseSchema, receiptSchema, successResponseSchema,
} from '@factory/contracts';

const ok = successResponseSchema.pick({ ok: true, apiVersion: true });
const issues = flowIssueSchema.array().max(500);
const error = apiErrorSchema.extend({ details: ok.pick({}).extend({ issues: issues.optional() }).strip().optional() });

export const flowModels = {
  list: ok.extend(projectFlowsResponseSchema.shape),
  detail: ok.extend(flowDetailSchema.shape),
  run: ok.extend(flowRunDetailSchema.shape),
  failure: failureResponseSchema.extend({ error }),
  receipt: successResponseSchema.extend({ receipt: receiptSchema.safeExtend({ error: error.optional() }) }),
};
export type FlowIssue = ReturnType<typeof flowIssueSchema.parse>;
