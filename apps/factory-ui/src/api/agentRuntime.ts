import { seatSchema, successResponseSchema, textSchema, usageSchema } from '@factory/contracts';

const object = successResponseSchema.pick({ ok: true }).omit({ ok: true });
const text = textSchema.min(0);
const enumeration = <T extends string>(values: readonly T[]) => text.refine(value => values.includes(value as T)).transform(value => value as T);
export const runtimeConfigModel = object.extend({
  revision: usageSchema.shape.inputTokens.positive(),
  runtime: enumeration(['native-opencode', 'acp'] as const),
  cli: enumeration(['codex', 'claude'] as const).nullable().catch(null),
  model: text.nullable().catch(null),
  effort: enumeration(['low', 'medium', 'high', 'xhigh'] as const).nullable().catch(null),
  permission: enumeration(['autonomous', 'workspace-write'] as const).catch('autonomous'),
}).strip().nullable().catch(null);
export const seatRuntimeFields = {
  runtime: enumeration(['native-opencode', 'api-agent', 'acp', 'fake'] as const).nullable().catch(null),
  runtimeConfig: runtimeConfigModel,
};
const cli = object.extend({
  cli: enumeration(['codex', 'claude'] as const),
  installed: seatSchema.shape.isLead.catch(false), version: text.nullable().catch(null),
  login: enumeration(['ok', 'missing', 'unknown'] as const).catch('unknown'),
}).strip();
export const agentClisModel = object.extend({
  apiVersion: usageSchema.shape.inputTokens.or(text).catch(''),
  ok: seatSchema.shape.isLead,
  enabled: seatSchema.shape.isLead.catch(false),
  clis: cli.nullable().catch(null).array().catch([]).transform(items => items.filter(item => item !== null)),
}).strip();
export type AgentClis = ReturnType<typeof agentClisModel.parse>;
export type AgentCli = AgentClis['clis'][number];
export type RuntimeConfig = NonNullable<ReturnType<typeof runtimeConfigModel.parse>>;
export const seatRuntimePendingKey = (seatId: string) => `seat-runtime:${seatId}`;
