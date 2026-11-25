import { attemptInstructionsSchema, groupDetailSchema, seatSchema, successResponseSchema, textSchema, usageSchema } from '@factory/contracts';

const object = successResponseSchema.pick({ ok: true }).omit({ ok: true });
const text = textSchema.min(0);
const optionalText = text.nullable().catch(null);
const flag = seatSchema.shape.isLead.optional().catch(undefined);
const envelope = object.extend({ ok: seatSchema.shape.isLead, apiVersion: usageSchema.shape.inputTokens.or(text).catch('') }).loose();
const doctorText = attemptInstructionsSchema.shape.profilePath;
const doctorCheck = object.extend({
  id: doctorText,
  level: doctorText.refine((value): value is 'required' | 'optional' | 'warning' => value === 'required' || value === 'optional' || value === 'warning'),
  status: doctorText.refine((value): value is 'pass' | 'fail' | 'skip' => value === 'pass' || value === 'fail' || value === 'skip'),
  summary: doctorText,
  fix: doctorText.optional(),
  detail: doctorText.optional(),
}).strip();
export const systemModels = {
  doctor: object.extend({
    ok: successResponseSchema.shape.ok,
    apiVersion: groupDetailSchema.shape.rollup.shape.budgetTokens30d.unwrap(),
    report: object.extend({ ok: seatSchema.shape.isLead, checks: doctorCheck.array() }).strip(),
  }).strip(),
  health: envelope,
  capabilities: envelope.extend({
    commands: text.array().catch([]), capabilities: text.array().catch([]),
    host: object.extend({ startedAt: optionalText, nodeVersion: optionalText, platform: optionalText }).loose().optional().catch(undefined),
    features: object.extend({ dispatch: flag, documentExtraction: flag, localCli: flag }).loose().optional().catch(undefined),
  }).loose(),
  backups: envelope.extend({ backup: object.extend({
    lastSuccessAt: optionalText, lastError: optionalText, lastErrorAt: optionalText,
    count: usageSchema.shape.inputTokens.catch(0), lastFile: optionalText,
  }).loose().nullable() }).loose(),
};
export type SystemHealth = ReturnType<typeof systemModels.health.parse>;
export type SystemCapabilities = ReturnType<typeof systemModels.capabilities.parse>;
export type SystemBackup = ReturnType<typeof systemModels.backups.parse>;
export type DoctorReport = ReturnType<typeof systemModels.doctor.parse>['report'];
export type DoctorCheck = DoctorReport['checks'][number];
