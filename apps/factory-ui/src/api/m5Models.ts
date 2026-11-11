import { successResponseSchema, textSchema, idSchema, usageSchema, seatSchema } from '@factory/contracts';

// Reuse the contract's Zod primitives without adding a schema-library dependency.
const o = successResponseSchema.pick({ ok: true, apiVersion: true }).omit({ ok: true, apiVersion: true });
const ok = successResponseSchema.pick({ ok: true, apiVersion: true });
const s = textSchema.min(0);
const n = usageSchema.shape.inputTokens;
const date = s.refine(v => /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)));
const maybeDate = date.nullable().optional().transform(v => v ?? null);
const en = <T extends string>(values: readonly T[]) => s.refine(v => values.includes(v as T)).transform(v => v as T);
const automationState = en(['active', 'paused', 'quarantined', 'unknown'] as const).catch('unknown');
const workflow = o.extend({
  id: idSchema, key: s, title: s,
  state: en(['draft', 'active', 'awaiting-approval', 'paused', 'resuming', 'completed', 'failed', 'cancelled', 'superseded', 'stalled', 'unknown'] as const).catch('unknown'),
  createdAt: date, startedAt: maybeDate, endedAt: maybeDate,
}).strip();
const task = o.extend({ taskId: idSchema, code: s, state: s }).strip();
const stage = o.extend({
  key: s.min(1), phase: s.optional().default(''),
  state: en(['pending', 'ready', 'active', 'done', 'failed', 'blocked', 'skipped', 'cancelled', 'unknown'] as const).catch('unknown'),
  loopCount: n.optional(), iteration: n.optional(), blockedReason: s.nullable().optional(),
  tasks: task.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
}).strip();
const detail = workflow.extend({ lastProgressAt: maybeDate,
  stages: stage.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
}).strip();
const schedule = o.extend({ id: idSchema, name: s.min(1), kind: en(['cron', 'once', 'interval'] as const), expr: s,
  timezone: s.optional(), state: automationState, enabled: seatSchema.shape.isLead.optional(),
  nextRunAt: maybeDate, lastRunAt: maybeDate, lastStatus: s.nullable().optional(),
}).strip();
const rule = o.extend({ id: idSchema, name: s.min(1), eventType: s.min(1), state: automationState,
  firesInWindow: n.optional(), lastFiredAt: maybeDate,
}).strip();
const monitor = o.extend({ id: idSchema, name: s.min(1), state: en(['active', 'paused', 'unknown'] as const).catch('unknown'),
  status: en(['ok', 'tripped', 'unknown'] as const).catch('unknown'), lastCheckedAt: maybeDate,
}).strip();
const routeBreaker = o.extend({ key: s.min(1), state: en(['closed', 'open', 'half-open'] as const), openedAt: maybeDate }).strip();
const teamBreaker = o.extend({ teamId: idSchema, state: en(['closed', 'open'] as const), openedAt: maybeDate }).strip();
const occurrence = o.extend({ scheduledFor: date, trigger: s, status: s, firedAt: date, instanceId: idSchema.nullable().optional() }).strip();
const fire = o.extend({ eventSequence: n, status: s, firedAt: date, instanceId: idSchema.nullable().optional() }).strip();
const monitorEvent = o.extend({ seq: n, from: s, to: s, at: date }).strip();

// A malformed row is dropped independently; absent collections mean an empty list.
// Workflows and breakers deliberately match the Host's unwrapped response shapes.
export const m5ReadModels = {
  workflows: o.extend({ instances: workflow.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)) }).strip(),
  workflow: o.extend({ instance: detail }).strip(),
  schedules: ok.extend({ items: schedule.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)) }).strip(),
  rules: ok.extend({ items: rule.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)) }).strip(),
  monitors: ok.extend({ items: monitor.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)) }).strip(),
  breakers: o.extend({
    routes: routeBreaker.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
    teams: teamBreaker.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
  }).strip(),
  occurrences: ok.extend({ items: occurrence.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)) }).strip(),
  fires: ok.extend({ items: fire.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)) }).strip(),
  monitorEvents: ok.extend({ items: monitorEvent.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)) }).strip(),
};
export type WorkflowInstance = ReturnType<typeof workflow.parse>;
export type WorkflowStage = ReturnType<typeof stage.parse>;
export type WorkflowDetail = ReturnType<typeof detail.parse>;
export type Schedule = ReturnType<typeof schedule.parse>;
export type AutomationRule = ReturnType<typeof rule.parse>;
export type Monitor = ReturnType<typeof monitor.parse>;
export type RouteBreaker = ReturnType<typeof routeBreaker.parse>;
export type TeamBreaker = ReturnType<typeof teamBreaker.parse>;
