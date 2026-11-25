import { seatSchema, successResponseSchema, textSchema, usageSchema } from '@factory/contracts';

const object = successResponseSchema.pick({ ok: true }).omit({ ok: true });
const text = textSchema.min(0);
const enumeration = <T extends string>(values: readonly T[]) => text.refine(value => values.includes(value as T)).transform(value => value as T);
// Which runtimes the Host runs. An older Host does not say, so OpenCode stays offered there.
const runtimeFactFields = {
  opencode: seatSchema.shape.isLead.catch(true),
  defaultCli: enumeration(['codex', 'claude'] as const).nullable().catch(null),
  leadCli: seatSchema.shape.isLead.catch(false),
};
export const runtimeFactsModel = object.extend(runtimeFactFields).strip().catch({ opencode: true, defaultCli: null, leadCli: false });
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
  ...runtimeFactFields,
}).strip();
export type AgentClis = ReturnType<typeof agentClisModel.parse>;
export type AgentCli = AgentClis['clis'][number];
