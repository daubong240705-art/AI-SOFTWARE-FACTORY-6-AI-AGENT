import { API_VERSION, approvalSchema, type Approval, type AttemptState } from '@factory/contracts';

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
const approvalFields = object({ id: identifier, projectId: identifier, revision: integer(1), kind: enumeration(['question', 'review', 'start-gate'] as const), taskId: nullable(identifier), subject: string(500, 1), summary: string(4000), options: array(object({ id: string(500, 1), label: string(500, 1), consequence: string(1000) })), recommendation: nullable(string(500)), impactIfWaiting: string(1000), context: object({ refs: array(object({ artifactId: identifier, version: integer(1) })), digest: hash }), approver: enumeration(['operator', 'project-lead'] as const), requestedAt: timestamp, expiresAt: timestamp, state: enumeration(['requested', 'pending', 'approved', 'rejected', 'changes-requested', 'superseded', 'expired', 'withdrawn', 'applied'] as const), outcome: nullable(object({ optionId: string(500, 1), actorId: identifier, decidedAt: timestamp, comment: string(4000) })), appliedByCommandId: nullable(identifier) });
const approval: Reader<Approval> = v => { const result = approvalSchema.safeParse(approvalFields(v)); return result.success ? result.data : invalid(); };
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
export const readModels = { attempts: envelope(object({ attempts: array(attempt) })), events: envelope(object({ events: array((v) => { const r = record(v); if (!Object.hasOwn(r, 'body')) invalid(); return event(v); }) })), patch: envelope(patch), artifacts: envelope(object({ items: array(artifact) })), content: envelope(content), approvals: envelope(object({ approvals: array(approval) })) };
export type Attempt = ReturnType<typeof attempt>;
export type AttemptEvent = ReturnType<typeof event>;
export type AttemptPatch = ReturnType<typeof patch>;
export type TaskArtifact = ReturnType<typeof artifact>;
export type ArtifactContent = ReturnType<typeof content>;
