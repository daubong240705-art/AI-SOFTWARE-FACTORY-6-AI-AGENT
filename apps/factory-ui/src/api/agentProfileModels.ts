import { seatSchema, successResponseSchema, textSchema, usageSchema } from '@factory/contracts';

const object = successResponseSchema.pick({ ok: true }).omit({ ok: true });
const text = textSchema.min(0);
const strings = text.array().catch([]);
const seat = object.extend({
  name: text, role: text.catch(''), runtime: text.catch(''),
  slots: usageSchema.shape.inputTokens.catch(0), isLead: seatSchema.shape.isLead.catch(false),
  capabilities: strings, tools: strings, profile: text.catch(''),
}).loose();
const skill = object.extend({ name: text, description: text.catch(''), content: text.catch('') }).loose();
export const packDetailModel = object.extend({
  key: text, version: text, name: text, description: text.catch(''), digest: text,
  seats: seat.array(), skills: skill.array().catch([]),
  workflows: object.extend({ key: text, revision: usageSchema.shape.inputTokens, title: text }).loose().array().catch([]),
}).loose();
export const mcpServersModel = object.extend({ servers: object.extend({
  name: text, state: text.catch('unknown'), tools: usageSchema.shape.inputTokens.catch(0),
}).loose().array() }).loose();
export type PackDetail = ReturnType<typeof packDetailModel.parse>;
export type PackSeat = PackDetail['seats'][number];
export type McpServer = ReturnType<typeof mcpServersModel.parse>['servers'][number];
