import { modelNameSchema, modelSettingsSetSchema, seatSchema, successResponseSchema, textSchema } from '@factory/contracts';

const envelope = successResponseSchema.pick({ ok: true, apiVersion: true });
const object = envelope.omit({ ok: true, apiVersion: true });
const optionalText = textSchema.optional().catch(undefined);
const optionalFlag = seatSchema.shape.isLead.optional().catch(undefined);
const entry = object.extend({
  id: modelNameSchema, name: optionalText, provider: optionalText,
  vision: optionalFlag, reasoning: optionalFlag,
}).strip();

// Settings stay suitable for a revision-checked write; optional gateway metadata
// tolerates older Hosts and individual malformed catalog entries.
export const modelSettingsResponse = envelope.extend({
  settings: modelSettingsSetSchema.omit({ expectedRevision: true }).extend({
    // A Host started without an agent runtime has no agent models yet (the write schema needs 1..8, a read does not).
    agentModels: modelNameSchema.array().max(8).catch([]),
    revision: modelSettingsSetSchema.shape.expectedRevision,
    source: textSchema.transform(value => value === 'database' || value === 'environment' ? value : 'unknown' as const),
  }).strip(),
  gateway: object.extend({ configured: seatSchema.shape.isLead, keyPresent: seatSchema.shape.isLead }).strip(),
  available: modelNameSchema.nullable().catch(null).array().transform(items => items.filter(item => item !== null)).nullable().catch(null),
  catalog: entry.nullable().catch(null).array().transform(items => items.filter(item => item !== null)).nullable().catch(null),
  efforts: textSchema.array().catch(['low', 'medium', 'high', 'xhigh']),
}).strip();

export type ModelSettingsResponse = ReturnType<typeof modelSettingsResponse.parse>;
export type ModelSettings = ModelSettingsResponse['settings'];
export type CatalogModel = NonNullable<ModelSettingsResponse['catalog']>[number];
export const modelSettingsPendingKey = 'models:set';
