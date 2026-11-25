import { successResponseSchema, textSchema, idSchema, usageSchema, ruleActionSchema, ruleConditionSchema, monitorCreateSchema } from '@factory/contracts';

// Reuse the contract's Zod primitives without adding a schema-library dependency.
const o = successResponseSchema.pick({ ok: true, apiVersion: true }).omit({ ok: true, apiVersion: true });
const ok = successResponseSchema.pick({ ok: true, apiVersion: true });
const s = textSchema.min(0);
const n = usageSchema.shape.inputTokens;
const number = monitorCreateSchema.shape.threshold;
const date = s.refine(v => /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)));
const maybeDate = date.nullable().optional().transform(v => v ?? null);
const en = <T extends string>(values: readonly T[]) => s.refine(v => values.includes(v as T)).transform(v => v as T);
const automationState = en(['active', 'paused', 'quarantined', 'unknown'] as const).catch('unknown');
const rule = o.extend({ id: idSchema, name: s.min(1), eventType: s.min(1), state: automationState,
  revision: n.positive().optional().catch(undefined), condition: ruleConditionSchema.optional().catch(undefined),
  action: ruleActionSchema.optional().catch(undefined),
  firesInWindow: n.optional(), lastFiredAt: maybeDate,
}).strip();
const monitor = o.extend({ id: idSchema, name: s.min(1), state: en(['active', 'paused', 'unknown'] as const).catch('unknown'),
  revision: n.positive().optional().catch(undefined), kind: monitorCreateSchema.shape.kind.optional().catch(undefined),
  params: monitorCreateSchema.shape.params.optional().catch(undefined), comparator: monitorCreateSchema.shape.comparator.catch(undefined),
  threshold: number.min(0).optional().catch(undefined),
  status: en(['ok', 'tripped', 'unknown'] as const).catch('unknown'), lastCheckedAt: maybeDate,
}).strip();
const routeBreaker = o.extend({ key: s.min(1), state: en(['closed', 'open', 'half-open'] as const), openedAt: maybeDate }).strip();
const teamBreaker = o.extend({ teamId: idSchema, state: en(['closed', 'open'] as const), openedAt: maybeDate }).strip();
const fire = o.extend({ eventSequence: n, status: s, firedAt: date, instanceId: idSchema.nullable().optional() }).strip();
const monitorEvent = o.extend({ seq: n, from: s, to: s, at: date }).strip();

// A malformed row is dropped independently; absent collections mean an empty list.
export const m5ReadModels = {
  rules: ok.extend({ items: rule.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)) }).strip(),
  monitors: ok.extend({ items: monitor.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)) }).strip(),
  breakers: o.extend({
    routes: routeBreaker.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
    teams: teamBreaker.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
  }).strip(),
  fires: ok.extend({ items: fire.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)) }).strip(),
  monitorEvents: ok.extend({ items: monitorEvent.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)) }).strip(),
};
export type AutomationRule = ReturnType<typeof rule.parse>;
export type Monitor = ReturnType<typeof monitor.parse>;
export type RouteBreaker = ReturnType<typeof routeBreaker.parse>;
export type TeamBreaker = ReturnType<typeof teamBreaker.parse>;
