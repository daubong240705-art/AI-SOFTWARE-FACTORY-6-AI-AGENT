import { successResponseSchema, textSchema, idSchema, usageSchema, seatSchema, taskSchema, artifactStatusSchema } from '@factory/contracts';
import { seatRuntimeFields } from './agentRuntime';

const o = successResponseSchema.pick({ ok: true, apiVersion: true }).omit({ ok: true, apiVersion: true });
const s = textSchema.min(0);
const n = usageSchema.shape.inputTokens;
const date = s.refine(v => /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)));
const en = <T extends string>(values: readonly T[]) => s.refine(v => values.includes(v as T)).transform(v => v as T);
const bool = seatSchema.shape.isLead;
const ref = o.extend({ artifactId: idSchema, version: n.positive() }).loose();
export const triageStates = ['submitted', 'need-info', 'accepted', 'declined', 'redirected', 'merged'] as const;
export const requestStates = [...new Set([...triageStates, ...taskSchema.shape.state.options])];
const seat = o.extend({ id: idSchema, name: s, role: s, slots: n.positive(), revision: n.positive(), isLead: bool, live: n, capabilities: s.array().optional(), tools: s.array().optional(), ...seatRuntimeFields }).loose();
const engagement = o.extend({ projectId: idSchema, projectName: s, engagementId: idSchema, priority: n.max(100), maxConcurrent: n.positive().max(32), state: en(['active', 'paused', 'ended'] as const), revision: n.positive(), live: n }).loose();
const team = o.extend({ id: idSchema, name: s, charter: s, packKey: s.nullable(), packVersion: s.nullable(), lifecycle: en(['active', 'paused', 'archived'] as const), revision: n.positive(), seats: seat.array(), engagements: engagement.array() }).loose();
const pack = o.extend({ key: s, version: s, name: s, description: s.catch(''), seatCount: n.catch(0), seats: o.extend({ name: s }).loose().array().catch([]),
  produces: s.array().catch([]), workflows: o.loose().or(s).array().catch([]),
}).loose();
const queue = o.extend({ projectId: idSchema, projectName: s, taskId: idSchema, code: s, title: s, state: taskSchema.shape.state, engagementPriority: n, queuedAt: date.nullable(), seatName: s.nullable(), liveAttemptState: s.nullable() }).loose();
export const requestItemSchema = o.extend({ taskId: idSchema, code: s, kind: en(['clarify','consult','produce','review','decision','notify'] as const), subject: s, taskState: taskSchema.shape.state, triageState: en(triageStates), targetTeamName: s, hop: n, rounds: n, waiting: n, requesterCode: s, createdAt: date, projectId: idSchema.optional(), projectName: s.optional() }).loose();
const request = o.extend({ requestId: idSchema, code: s, kind: s, subject: s, state: taskSchema.shape.state, triageState: en(triageStates), rounds: n, hop: n, followers: n, waiting: n,
  thread: o.extend({ seq: n.positive(), author: s, text: s, at: date }).loose().array(), deliverables: o.extend({ artifactId: idSchema, version: n.positive(), title: s, status: artifactStatusSchema }).loose().array() }).loose();
const dossier = o.extend({ ref, status: artifactStatusSchema, createdAt: date, markdown: s, state: en(['current', 'outdated'] as const) }).loose();
const change = o.extend({ count: n, examples: s.array() }).loose();
export const changeKeys = ['artifactsRegistered','artifactsSuperseded','artifactsApproved','decisionsApplied','requestsOpened','requestsClosed','tasksDone','tasksFailed'] as const;
const changes = { artifactsRegistered: change, artifactsSuperseded: change, artifactsApproved: change, decisionsApplied: change, requestsOpened: change, requestsClosed: change, tasksDone: change, tasksFailed: change };
const briefing = o.extend({ baseline: o.extend({ since: date, dossierRef: ref.nullable() }).loose(), changes: o.extend(changes).loose(), freshness: o.extend({ stale: o.extend({ ref, title: s, because: s }).loose().array(), awaitingReview: o.extend({ ref, title: s, ageDays: n }).loose().array(), unapprovedDossier: bool }).loose(), teams: o.extend({ teamName: s, packKey: s.nullable(), packVersion: s.nullable(), engagementState: en(['active','paused','ended'] as const) }).loose().array(), suggestions: s.array(), limits: s.array() }).loose();
const context = o.extend({ attemptId: idSchema, epoch: n.positive(), builtAt: date, tokens: n, maxTokens: n, l0: n, l1: n, omitted: n, pack: o.extend({ omitted: o.extend({ ref, reason: en(['over-budget','no-access','not-found'] as const) }).loose().array() }).loose(), instructions: o.extend({ packDigest: s.regex(/^[a-f\d]{64}$/i), profilePath: s, skillsCount: n, bytes: n }).loose().nullable() }).loose();
const ok = successResponseSchema.pick({ ok: true, apiVersion: true });
export const m3Models = {
  teams: o.extend({ teams: team.array() }).loose(), packs: o.extend({ packs: pack.array() }).loose(), queue: o.extend({ items: queue.array() }).loose(),
  requests: ok.extend({ items: requestItemSchema.array() }).loose(), request: ok.extend({ request }).loose(), dossier: ok.extend({ dossier: dossier.nullable() }).loose(), briefing: ok.extend(briefing.shape).loose(), context: ok.extend({ packs: context.array().max(20) }).loose(),
};
export type OrgTeam = ReturnType<typeof team.parse>;
export type RequestItem = ReturnType<typeof requestItemSchema.parse>;
export type RequestDetail = ReturnType<typeof request.parse>;
export type Dossier = ReturnType<typeof dossier.parse>;
export type Briefing = ReturnType<typeof briefing.parse>;
export type TaskContext = ReturnType<typeof context.parse>;
