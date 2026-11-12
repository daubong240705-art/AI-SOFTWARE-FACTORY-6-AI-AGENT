import { successResponseSchema, textSchema, idSchema, usageSchema, seatSchema, workflowDefinitionSchema,
  scheduleActionSchema, ruleConditionSchema, monitorCreateSchema } from '@factory/contracts';

// Reuse the contract's Zod primitives without adding a schema-library dependency.
const o = successResponseSchema.pick({ ok: true, apiVersion: true }).omit({ ok: true, apiVersion: true });
const ok = successResponseSchema.pick({ ok: true, apiVersion: true });
const s = textSchema.min(0);
const n = usageSchema.shape.inputTokens;
const number = workflowDefinitionSchema.shape.parameters.element.options[2].shape.default;
const date = s.refine(v => /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)));
const maybeDate = date.nullable().optional().transform(v => v ?? null);
const en = <T extends string>(values: readonly T[]) => s.refine(v => values.includes(v as T)).transform(v => v as T);
const automationState = en(['active', 'paused', 'quarantined', 'unknown'] as const).catch('unknown');
const workflow = o.extend({
  id: idSchema, key: s, title: s,
  revision: n.positive().optional().catch(undefined),
  state: en(['draft', 'proposed', 'active', 'awaiting-approval', 'paused', 'suspended', 'resuming', 'completed', 'failed', 'cancelled', 'superseded', 'stalled', 'unknown'] as const).catch('unknown'),
  createdAt: date, startedAt: maybeDate, endedAt: maybeDate,
}).strip();
const task = o.extend({ taskId: idSchema, code: s, state: s }).strip();
const graphInput = o.extend({ kind: s, required: seatSchema.shape.isLead.optional().default(false) }).strip();
const graphOutput = o.extend({ kind: s, mustReach: en(['draft', 'reviewed', 'approved', 'unknown'] as const).catch('unknown') }).strip();
const graphStage = o.extend({ key: s.min(1), title: s.optional().default(''), phase: s.optional().default(''),
  optional: seatSchema.shape.isLead.optional().default(false), parallelGroup: s.nullable().optional().default(null),
  placement: en(['portable', 'node-bound', 'unknown'] as const).catch('unknown'), sideEffect: en(['none', 'artifact', 'code', 'external', 'unknown'] as const).catch('unknown'),
  requiredCapabilities: s.array().optional().default([]).transform(items => items.filter((item): item is string => typeof item === 'string')),
  teamHint: s.nullable().optional().default(null), inputs: graphInput.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
  outputs: graphOutput.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
}).strip();
const graphEdge = o.extend({ from: s.min(1), to: s.min(1),
  type: en(['finish-to-start', 'artifact-approved', 'informs', 'rework', 'unknown'] as const).catch('unknown'),
  artifact: s.nullable().optional().default(null), maxLoops: n.nullable().optional().default(null), hasCondition: seatSchema.shape.isLead.optional().default(false),
}).strip();
const graphJoin = o.extend({ group: s.min(1), policy: en(['all', 'any', 'quorum', 'unknown'] as const).catch('unknown'), n: n.nullable().optional().default(null) }).strip();
const graphGate = o.extend({ before: s.min(1), kind: en(['execution-gate', 'irreversible-action', 'review', 'unknown'] as const).catch('unknown'),
  approver: en(['operator', 'project-lead', 'unknown'] as const).catch('unknown'), hasCondition: seatSchema.shape.isLead.optional().default(false) }).strip();
const workflowGraph = o.extend({ stages: graphStage.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
  edges: graphEdge.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
  joins: graphJoin.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
  gates: graphGate.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
}).strip();
const stage = o.extend({
  key: s.min(1), phase: s.optional().default(''),
  state: en(['pending', 'ready', 'active', 'done', 'failed', 'blocked', 'skipped', 'cancelled', 'unknown'] as const).catch('unknown'),
  loopCount: n.optional(), iteration: n.optional(), blockedReason: s.nullable().optional(),
  engagementId: idSchema.nullable().optional().catch(undefined),
  tasks: task.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
}).strip();
const detail = workflow.extend({ lastProgressAt: maybeDate,
  stages: stage.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
  graph: workflowGraph.nullable().optional().catch(null).default(null),
  phases: s.array().optional().catch([]).default([]), definitionTitle: s.optional().catch(undefined),
}).strip();
const workflowParameter = o.extend({ name: s.min(1), type: en(['bool', 'boolean', 'number', 'string', 'enum', 'unknown'] as const).catch('unknown'),
  default: s.or(number).or(seatSchema.shape.isLead).nullable().optional().default(null), options: s.array().nullable().optional().default(null),
  min: number.nullable().optional().default(null), max: number.nullable().optional().default(null), label: s.nullable().optional().default(null), }).strip();
const workflowDefinition = o.extend({ key: s.min(1), packKey: s.optional().default(''), packVersion: s.optional().default(''), revision: n.optional().default(1),
  title: s, domain: s.nullable().optional().default(null), parameters: workflowParameter.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)),
  phases: s.array().optional().default([]), graph: workflowGraph.optional().default({ stages: [], edges: [], joins: [], gates: [] }), }).strip();
const schedule = o.extend({ id: idSchema, name: s.min(1), kind: en(['cron', 'once', 'interval'] as const), expr: s,
  revision: n.positive().optional().catch(undefined),
  action: o.extend({ definitionKey: s, packKey: s.nullable().optional(), autoStart: seatSchema.shape.isLead.optional(),
    params: scheduleActionSchema.shape.params, title: scheduleActionSchema.shape.title,
    paramKeys: s.array().optional().default([]) }).strip().optional().catch(undefined),
  timezone: s.optional(), state: automationState, enabled: seatSchema.shape.isLead.optional(),
  nextRunAt: maybeDate, lastRunAt: maybeDate, lastStatus: s.nullable().optional(),
}).strip();
const rule = o.extend({ id: idSchema, name: s.min(1), eventType: s.min(1), state: automationState,
  revision: n.positive().optional().catch(undefined), condition: ruleConditionSchema.optional().catch(undefined),
  action: o.extend({ definitionKey: s, packKey: s.nullable().optional(), params: scheduleActionSchema.shape.params,
    title: scheduleActionSchema.shape.title, paramKeys: s.array().optional().default([]) }).strip().optional().catch(undefined),
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
const occurrence = o.extend({ scheduledFor: date, trigger: s, status: s, firedAt: date, instanceId: idSchema.nullable().optional() }).strip();
const fire = o.extend({ eventSequence: n, status: s, firedAt: date, instanceId: idSchema.nullable().optional() }).strip();
const monitorEvent = o.extend({ seq: n, from: s, to: s, at: date }).strip();

// A malformed row is dropped independently; absent collections mean an empty list.
// Workflows and breakers deliberately match the Host's unwrapped response shapes.
export const m5ReadModels = {
  workflows: o.extend({ instances: workflow.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)) }).strip(),
  workflow: o.extend({ instance: detail }).strip(),
  workflowDefinitions: o.extend({ items: workflowDefinition.nullable().catch(null).array().optional().default([]).transform(items => items.filter(item => item !== null)) }).strip(),
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
export type WorkflowGraph = ReturnType<typeof workflowGraph.parse>;
export type WorkflowDefinition = ReturnType<typeof workflowDefinition.parse>;
export type Schedule = ReturnType<typeof schedule.parse>;
export type AutomationRule = ReturnType<typeof rule.parse>;
export type Monitor = ReturnType<typeof monitor.parse>;
export type RouteBreaker = ReturnType<typeof routeBreaker.parse>;
export type TeamBreaker = ReturnType<typeof teamBreaker.parse>;
