import { successResponseSchema, textSchema, idSchema, usageSchema, costSchema, seatSchema, attemptSchema } from '@factory/contracts';

// Use the same Zod primitives as the other tolerant UI read models.
const ok = successResponseSchema.pick({ ok: true, apiVersion: true });
const object = ok.omit({ ok: true, apiVersion: true });
const text = textSchema.min(0);
const count = usageSchema.shape.inputTokens;
const date = text.refine(value => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)));
const maybeDate = date.nullable().optional().catch(null).transform(value => value ?? null);
const enumeration = <T extends string>(values: readonly T[]) => text.transform(value => values.find(item => item === value) ?? 'unknown').catch('unknown');
// Progress may contain a fractional percentage; token counters are integer-only.
const percent = costSchema.options[1].shape.amount.max(100).nullable().catch(null);
const progress = object.extend({ message: text, percent, at: date }).strip();
const run = object.extend({
  projectId: idSchema, projectName: text, taskId: idSchema, code: text, title: text,
  attemptId: idSchema, attemptState: attemptSchema.shape.state.catch('unknown'),
  nodeId: text.min(1).nullable().optional().transform(value => value ?? null), startedAt: maybeDate,
  progress: progress.nullable().optional().catch(null).transform(value => value ?? null),
}).strip();
const need = object.extend({ approvalId: idSchema, kind: enumeration(['question', 'review', 'start-gate'] as const).catch('unknown'), taskId: idSchema, code: text }).strip();
const finished = object.extend({ code: text, outcome: enumeration(['succeeded', 'failed'] as const).catch('unknown'), at: maybeDate }).strip();
const seat = object.extend({
  id: idSchema, name: text.min(1), role: text, isLead: seatSchema.shape.isLead, slots: count,
  status: text.transform(value => (['waiting', 'problem', 'working', 'queued', 'done', 'idle'] as const).find(item => item === value) ?? 'idle').catch('idle'),
  runs: run.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
  queued: count.optional().default(0),
  needsYou: need.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
  lastFinished: finished.nullable().optional().catch(null).transform(value => value ?? null),
}).strip();
const team = object.extend({
  id: idSchema, name: text.min(1), lifecycle: enumeration(['active', 'paused', 'archived'] as const).catch('unknown'),
  counts: object.extend({ working: count, waiting: count, problem: count, queued: count, idle: count }).strip(),
  seats: seat.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
}).strip();
const node = object.extend({
  id: text.min(1), name: text.min(1), platform: enumeration(['linux', 'win32', 'darwin', 'windows'] as const).catch('unknown'),
  trust: enumeration(['personal-trusted', 'server-sandboxed', 'shared-compute', 'quarantined'] as const),
  state: enumeration(['online', 'busy', 'draining', 'offline', 'lost', 'quarantined'] as const),
  slots: object.extend({ total: count, used: count }).strip(), lastHeartbeatAt: maybeDate,
}).strip();

export const activityReadModel = ok.extend({
  generatedAt: date,
  nodes: node.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
  teams: team.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
}).strip();
export type OrgActivity = ReturnType<typeof activityReadModel.parse>;
export const activitySeatModel = seat;
export type ActivityTeam = OrgActivity['teams'][number];
export type ActivitySeat = ActivityTeam['seats'][number];
export type ActivityRun = ActivitySeat['runs'][number];
export type ActivityNode = OrgActivity['nodes'][number];
export type ActivityStatus = ActivitySeat['status'];
