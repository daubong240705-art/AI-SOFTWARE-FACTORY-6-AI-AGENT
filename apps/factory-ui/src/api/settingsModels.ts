import { successResponseSchema, textSchema, idSchema, usageSchema } from '@factory/contracts';

const ok = successResponseSchema.pick({ ok: true, apiVersion: true });
const object = ok.omit({ ok: true, apiVersion: true });
const text = textSchema.min(0);
const count = usageSchema.shape.inputTokens;
const date = text.refine(value => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)));
const enumeration = <T extends string>(values: readonly T[]) => text.transform(value => values.find(item => item === value) ?? 'unknown').catch('unknown');
const level = count.transform(value => value <= 4 ? value : 'unknown' as const).catch('unknown');
const source = enumeration(['explicit', 'default'] as const);
const autonomyTeam = object.extend({ teamId: idSchema, level, source, effectiveLevel: level }).strip();
const autonomy = object.extend({
  project: object.extend({ level, source, revision: count.nullable().optional().transform(value => value ?? null) }).strip(),
  teams: autonomyTeam.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
  defaults: object.extend({ project: level, team: level }).strip(),
}).strip();
const actionKind = enumeration(['notify.send-internal', 'deploy.staging', 'artifact.publish-to-project'] as const);
const state = enumeration(['active', 'revoked', 'expired'] as const);
const approval = object.extend({
  id: idSchema, actionKind, scope: object.extend({ kind: enumeration(['project', 'team'] as const), ref: text.min(1) }).strip(),
  limitPerDay: count, maxTokensPerUse: count.nullable(), state, createdAt: date, expiresAt: date, revokedAt: date.nullable(),
  usedToday: count, remainingToday: count,
}).strip();
const standingApprovals = object.extend({
  items: approval.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
  level: object.extend({ level, source }).strip(),
}).strip();

export const settingsReadModels = { autonomy: ok.extend(autonomy.shape).strip(), standingApprovals };
export type AutonomyResponse = ReturnType<typeof settingsReadModels.autonomy.parse>;
export type StandingApprovalsResponse = ReturnType<typeof settingsReadModels.standingApprovals.parse>;
export type AutonomyTeam = AutonomyResponse['teams'][number];
export type StandingApproval = StandingApprovalsResponse['items'][number];
