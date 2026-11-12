import { seatSchema, successResponseSchema, textSchema, usageSchema } from '@factory/contracts';

const object = successResponseSchema.pick({ ok: true }).omit({ ok: true });
const text = textSchema.min(0);
const optionalText = text.nullable().catch(null);
const flag = seatSchema.shape.isLead.optional().catch(undefined);
const envelope = object.extend({ ok: seatSchema.shape.isLead, apiVersion: usageSchema.shape.inputTokens.or(text).catch('') }).loose();
export const systemModels = {
  health: envelope,
  capabilities: envelope.extend({
    commands: text.array().catch([]), capabilities: text.array().catch([]),
    host: object.extend({ startedAt: optionalText, nodeVersion: optionalText, platform: optionalText }).loose().optional().catch(undefined),
    features: object.extend({ multiTeam: flag, dispatch: flag, documentExtraction: flag }).loose().optional().catch(undefined),
  }).loose(),
  backups: envelope.extend({ backup: object.extend({
    lastSuccessAt: optionalText, lastError: optionalText, lastErrorAt: optionalText,
    count: usageSchema.shape.inputTokens.catch(0), lastFile: optionalText,
  }).loose().nullable() }).loose(),
};
export type SystemHealth = ReturnType<typeof systemModels.health.parse>;
export type SystemCapabilities = ReturnType<typeof systemModels.capabilities.parse>;
export type SystemBackup = ReturnType<typeof systemModels.backups.parse>;
