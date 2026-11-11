import { requestItemSchema, type RequestItem } from './m3Models';
import { API_VERSION, approvalSchema, artifactKindSchema, artifactStatusSchema, type Approval, type AttemptState } from '@factory/contracts';

type Reader<T> = (value: unknown) => T;
const invalid = (): never => { throw new Error('Invalid read model'); };
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid();
const string = (max = 500, min = 0): Reader<string> => v => typeof v === 'string' && v.length >= min && v.length <= max ? v : invalid();
const integer = (min = 0): Reader<number> => v => typeof v === 'number' && Number.isSafeInteger(v) && v >= min ? v : invalid();
const nullable = <T,>(read: Reader<T>): Reader<T | null> => v => v === null ? null : read(v);
const array = <T,>(read: Reader<T>): Reader<T[]> => v => Array.isArray(v) && v.length <= 5000 ? v.map(read) : invalid();
const enumeration = <T extends string>(values: readonly T[]): Reader<T> => v => typeof v === 'string' && values.includes(v as T) ? v as T : invalid();
const identifier: Reader<string> = v => { const s = string(500, 1)(v); return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(s) ? s : invalid(); };
const timestamp: Reader<string> = v => { const s = string(100, 1)(v); return /^\d{4}-\d{2}-\d{2}T/.test(s) && Number.isFinite(Date.parse(s)) ? s : invalid(); };
const hash: Reader<string> = v => { const s = string(64, 64)(v); return /^[a-f\d]{64}$/i.test(s) ? s : invalid(); };
function object<S extends Record<string, Reader<unknown>>>(shape: S): Reader<{ [K in keyof S]: ReturnType<S[K]> }> {
  return value => {
    const input = record(value);
    const output: Record<string, unknown> = {};
    for (const [key, read] of Object.entries(shape)) output[key] = read(input[key]);
    return output as { [K in keyof S]: ReturnType<S[K]> };
  };
}
const states: readonly AttemptState[] = ['queued', 'leased', 'preparing', 'running', 'waiting-input', 'parked', 'stopping', 'stopped', 'submitting', 'succeeded', 'failed', 'lease-expired', 'unknown', 'reconciling', 'requeued'];
const attempt = object({ id: identifier, taskId: identifier, epoch: integer(1), revision: integer(1), state: enumeration(states), outcome: enumeration(['known', 'unknown'] as const), runtime: enumeration(['fake', 'native-opencode', 'api-agent', 'acp'] as const), seatId: nullable(identifier), seatName: nullable(string()), startedAt: nullable(timestamp), endedAt: nullable(timestamp) });
const event = object({ seq: integer(1), at: timestamp, kind: enumeration(['progress', 'output', 'evidence', 'question', 'usage', 'state'] as const), body: (v: unknown): unknown => v });
const patch = object({ patch: string(8_388_608), sha256: hash, bytes: integer() });
const content = object({ mediaType: string(128, 1), sizeBytes: integer(), contentHash: hash, text: string(8_388_608) });
const version = object({ version: integer(1), status: enumeration(['draft', 'in-review', 'reviewed', 'approved', 'superseded', 'rejected', 'withdrawn'] as const), mediaType: string(128, 1), sizeBytes: integer(), contentHash: hash, abstractL0: string(500), abstractL1: nullable(string(6000)), producedByAttemptId: nullable(identifier), supersedesVersion: nullable(integer(1)), createdAt: timestamp });
const artifact = object({ artifactId: identifier, kind: enumeration(['research-report', 'requirements', 'adr', 'data-model', 'api-contract', 'ui-spec', 'design-asset', 'media', 'code-ref', 'dataset', 'dossier', 'plan', 'other'] as const), title: string(500, 1), versions: array(version) });
const approvalFields = object({ id: identifier, projectId: identifier, revision: integer(1), kind: enumeration(['question', 'review', 'start-gate'] as const), taskId: nullable(identifier), subject: string(500, 1), summary: string(4000), options: array(object({ id: string(500, 1), label: string(500, 1), consequence: string(1000) })), recommendation: nullable(string(500)), impactIfWaiting: string(1000), context: object({ refs: array(object({ artifactId: identifier, version: integer(1) })), digest: hash }), approver: enumeration(['operator', 'project-lead'] as const), requestedAt: timestamp, expiresAt: timestamp, state: enumeration(['requested', 'pending', 'approved', 'rejected', 'changes-requested', 'superseded', 'expired', 'withdrawn', 'applied'] as const), outcome: nullable(object({ optionId: string(500, 1), actorId: identifier, decidedAt: timestamp, comment: string(32000) })), appliedByCommandId: nullable(identifier) });
const approval: Reader<Approval> = v => { const result = approvalSchema.safeParse(approvalFields(v)); return result.success ? result.data : invalid(); };
const name: Reader<string> = v => { const s = string(40, 1)(v); return /^[a-z0-9][a-z0-9-]{0,39}$/.test(s) ? s : invalid(); };
const effect = object({ id: identifier, attemptId: identifier, kind: enumeration(['git.push-branch'] as const), remote: name, branch: string(160, 1), state: enumeration(['pending', 'done', 'failed', 'unknown'] as const), error: nullable(enumeration(['auth', 'rejected', 'network', 'timeout', 'other', 'not-pushed'] as const)), createdAt: timestamp, completedAt: nullable(timestamp) });
const counts = object({ approvals: integer(), startGates: integer(), total: integer(), requests: (v: unknown) => v === undefined ? undefined : integer()(v) });
const gateFields = { taskId: identifier, code: string(40, 1), title: string(160, 1), projectId: identifier };
const optional = <T,>(read: Reader<T>): Reader<T | undefined> => v => v === undefined ? undefined : read(v);
const optionalArray = <T,>(read: Reader<T>): Reader<T[]> => v => v === undefined ? [] : array(read)(v);
const projectFields = { projectId: optional(identifier), projectName: optional(string(160, 1)) };
const inboxPatch = object({ ...projectFields, projectId: identifier, id: identifier, instanceId: identifier, instanceTitle: string(500), ops: array(string(1000, 1)), reason: string(4000), createdAt: timestamp });
const monitor = object({ ...projectFields, projectId: identifier, monitorId: identifier, name: string(500, 1), kind: string(100, 1), value: nullable((v: unknown): number => typeof v === 'number' && Number.isFinite(v) ? v : invalid()), since: nullable(timestamp) });
const stalledWorkflow = object({ ...projectFields, instanceId: identifier, title: string(500), reason: nullable(string(4000)), since: optional(nullable(timestamp)) });
const quarantinedRule = object({ ...projectFields, projectId: identifier, ruleId: identifier, name: string(500, 1), since: optional(nullable(timestamp)) });
const teamBreaker = object({ ...projectFields, projectId: identifier, teamId: identifier, title: string(500), reason: nullable(string(4000)), openedAt: nullable(timestamp), failures: integer() });
const integrationConflict = object({ ...projectFields, projectId: identifier, taskId: identifier, code: string(40, 1), title: string(500), branch: string(500, 1), since: optional(nullable(timestamp)) });
export type InboxPatch = ReturnType<typeof inboxPatch>;
type InboxExtras = { patches: InboxPatch[]; monitors: ReturnType<typeof monitor>[]; stalledWorkflows: ReturnType<typeof stalledWorkflow>[]; quarantinedRules: ReturnType<typeof quarantinedRule>[]; teamBreakers: ReturnType<typeof teamBreaker>[]; integrationConflicts: ReturnType<typeof integrationConflict>[] };
export const knowledgeKinds = artifactKindSchema.options;
export const knowledgeStatuses = artifactStatusSchema.options;
export const knowledgeVisibilities = ['team-draft', 'project', 'shared'] as const;
const knowledgeArray = <T,>(read: Reader<T>): Reader<T[]> => v => Array.isArray(v) && v.length <= 200 ? v.map(read) : invalid();
const knowledgeFields = { artifactId: identifier, version: integer(1), kind: enumeration(knowledgeKinds), title: string(500, 1), status: enumeration(knowledgeStatuses), visibility: enumeration(knowledgeVisibilities), abstractL0: string(6000), projectId: identifier };
const knowledgeResult = object({ ...knowledgeFields, snippet: string(1000), rank: (v: unknown): number => typeof v === 'number' && Number.isFinite(v) ? v : invalid() });
const knowledgeItem = object({ ...knowledgeFields, mediaType: string(128, 1), sizeBytes: integer(), createdAt: timestamp, versionCount: integer(1) });
const knowledgeVersion = object({ version: integer(1), status: enumeration(knowledgeStatuses), visibility: enumeration(knowledgeVisibilities), mediaType: string(128, 1), sizeBytes: integer(), abstractL0: string(6000), abstractL1: nullable(string(6000)), producedByAttemptId: nullable(identifier), supersedesVersion: nullable(integer(1)), createdAt: timestamp });
const knowledgeRef = object({ artifactId: identifier, version: integer(1), title: string(500, 1) });
const knowledgeArtifact = object({ artifactId: identifier, kind: enumeration(knowledgeKinds), title: string(500, 1), versions: knowledgeArray(knowledgeVersion), inputs: knowledgeArray(knowledgeRef), dependants: knowledgeArray(knowledgeRef) });
export type KnowledgeResult = ReturnType<typeof knowledgeResult>;
export type KnowledgeItem = ReturnType<typeof knowledgeItem>;
export type KnowledgeArtifact = ReturnType<typeof knowledgeArtifact>;
export type KnowledgeFilters = { kinds?: Array<typeof knowledgeKinds[number]>; statuses?: Array<typeof knowledgeStatuses[number]> };
export type KnowledgePage = KnowledgeFilters & { limit?: number; offset?: number };
export type Inbox = Partial<InboxExtras> & { requests?: RequestItem[] | undefined; approvals: Array<Approval & { projectName?: string }>; startGates: Array<{ taskId: string; code: string; title: string; projectId: string; projectName?: string }>; counts: { approvals: number; startGates: number; total: number; requests?: number | undefined } };
function inbox(global: boolean): Reader<Inbox> {
  return object({ requests: (v: unknown) => v === undefined ? [] : array((item: unknown) => requestItemSchema.parse(item))(v), approvals: array(v => ({ ...approval(v), ...(global ? { projectName: string(160, 1)(record(v).projectName) } : {}) })),
    startGates: array(global ? object({ ...gateFields, projectName: string(160, 1) }) : object({ ...gateFields, projectId: (v: unknown) => v === undefined ? '' : identifier(v) })),
    patches: optionalArray(inboxPatch), monitors: optionalArray(monitor), stalledWorkflows: optionalArray(stalledWorkflow), quarantinedRules: optionalArray(quarantinedRule), teamBreakers: optionalArray(teamBreaker), integrationConflicts: optionalArray(integrationConflict), counts });
}
function envelope<T>(read: Reader<T>) {
  return { safeParse(value: unknown): { success: true; data: T & { ok: true; apiVersion: typeof API_VERSION } } | { success: false } {
    try {
      const input = record(value);
      if (input.ok !== true || input.apiVersion !== API_VERSION) return { success: false };
      return { success: true, data: { ok: true, apiVersion: API_VERSION, ...read(input) } };
    } catch { return { success: false }; }
  } };
}
// These adapters deliberately copy only validated fields; unknown event bodies stay opaque.
export const readModels = { attempts: envelope(object({ attempts: array(attempt) })), events: envelope(object({ events: array((v) => { const r = record(v); if (!Object.hasOwn(r, 'body')) invalid(); return event(v); }) })), patch: envelope(patch), artifacts: envelope(object({ items: array(artifact) })), content: envelope(content), approvals: envelope(object({ approvals: array(approval) })),
  approval: envelope(object({ approval })), inbox: envelope(inbox(false)), globalInbox: envelope(inbox(true)), remotes: envelope(object({ remotes: array(name) })), effects: envelope(object({ effects: array(effect) })), effect: envelope(object({ effect })),
  knowledgeSearch: envelope(object({ results: knowledgeArray(knowledgeResult) })), knowledgeList: envelope(object({ items: knowledgeArray(knowledgeItem) })), knowledgeArtifact: envelope(object({ artifact: knowledgeArtifact })) };

export { m5ReadModels } from './m5Models';
export type { WorkflowInstance, WorkflowDetail, WorkflowStage, Schedule, AutomationRule, Monitor, RouteBreaker, TeamBreaker } from './m5Models';
export type Effect = ReturnType<typeof effect>;
export type Attempt = ReturnType<typeof attempt>;
export type AttemptEvent = ReturnType<typeof event>;
export type AttemptPatch = ReturnType<typeof patch>;
export type TaskArtifact = ReturnType<typeof artifact>;
export type ArtifactContent = ReturnType<typeof content>;

export type { OrgTeam, RequestItem, RequestDetail, Dossier, Briefing, TaskContext } from './m3Models';
