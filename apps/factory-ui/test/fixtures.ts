import { API_VERSION, type FactoryEvent } from '@factory/contracts';
export const id = '12345678-1234-4234-8234-123456789012';
export const otherId = '12345678-1234-4234-8234-123456789013';
export const envelope = { ok: true, apiVersion: API_VERSION };
export const project = { id, revision: 1, name: 'Project', workspace: { kind: 'directory', root: '/work' }, leadAgentId: null, disposition: 'active' };
export const team = { id, revision: 1, name: 'Team', charter: '', pack: null, lifecycle: 'active' };
export const seat = { id, teamId: id, revision: 1, name: 'Lead', role: 'Lead', profile: { id, revision: 1 }, runtime: 'claude-code', slots: 1, nodePolicy: 'elastic', dedicatedNodeId: null, isLead: true };
export const engagement = { id, projectId: id, teamId: id, revision: 1, priority: 1, maxConcurrent: 1, state: 'active', createdAt: '2026-11-07T00:00:00.000Z' };
export const conversation = { id, projectId: id, revision: 1, agentId: id, workItemId: null, title: 'Discuss' };
export const message = { id, projectId: id, conversationId: id, revision: 1, createdAt: '2026-11-07T00:00:00.000Z', speaker: 'user', agentId: null, text: 'Hello', attachmentIds: [], runId: null };
export const task = { id, projectId: id, revision: 1, code: 'UI-001', title: 'Core', goal: 'Build core', brief: 'Build it', parentTaskId: null, engagementId: null, ownerSeatId: null, origin: { kind: 'operator' }, state: 'proposed', holds: [], disposition: 'active', requiredCapabilities: [], placement: 'portable', sideEffect: 'none', reviewPolicy: 'human-final', gate: { requiresGo: true }, acceptance: [], inputs: [], dependsOn: [] };
export const budget = { day: { date: '2026-11-07', used: 0, limit: 1000, verdict: 'ok', source: 'default' }, tasks: [] };
export const receipt = { commandId: id, projectId: id, state: 'completed', effects: [] };
export const failure = { apiVersion: 1, ok: false, error: { code: 'conflict', message: 'The resource changed.', nextAction: 'refresh', correlationId: id, currentRevision: 2 } };
export function event(payload: FactoryEvent['payload'] = { type: 'entity.changed', entity: { kind: 'task', id, revision: 1 } }, projectId = id): FactoryEvent {
  return { apiVersion: 1, eventId: id, projectId, occurredAt: '2026-11-07T00:00:00.000Z', cursor: { epoch: id, sequence: '1' }, previousCursor: { epoch: id, sequence: '0' }, causationId: id, rootCausationId: id, payload };
}
export function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
