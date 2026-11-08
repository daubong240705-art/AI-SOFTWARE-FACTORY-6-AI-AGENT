import { vi } from 'vitest';
import { createStore, type StoreOptions } from '../src/state/store';
import type { ApiClient } from '../src/api/client';
import type { ProjectEventsOptions } from '../src/api/events';
import { envelope, project, team, engagement, seat, budget, receipt } from './fixtures';
import type { Approval } from '@factory/contracts';
import type { Attempt, AttemptEvent, TaskArtifact } from '../src/api/client';
import { id, otherId } from './fixtures';

export const attempt: Attempt = { id: otherId, taskId: id, epoch: 1, revision: 2, state: 'running', outcome: 'known', runtime: 'fake', seatId: id, seatName: 'Lead', startedAt: '2026-11-07T00:00:00.000Z', endedAt: null };
export const progress: AttemptEvent = { seq: 1, at: '2026-11-07T00:00:00.000Z', kind: 'progress', body: { message: 'Building safely', percent: 35 } };
export const patch = { patch: 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+<img src=x onerror=alert(1)>\n', sha256: 'a'.repeat(64), bytes: 100 };
export const artifact: TaskArtifact = { artifactId: id, kind: 'code-ref', title: 'Code patch', versions: [{ version: 1, status: 'in-review', mediaType: 'text/x-patch', sizeBytes: 100, contentHash: 'a'.repeat(64), abstractL0: 'Changes', abstractL1: null, producedByAttemptId: otherId, supersedesVersion: null, createdAt: '2026-11-07T00:00:00.000Z' }] };
export const approval: Approval = { id, projectId: id, revision: 1, kind: 'question', taskId: id, subject: 'Choose', summary: 'A choice', options: [{ id: 'yes', label: 'Yes', consequence: 'Continue' }], recommendation: 'yes', impactIfWaiting: 'Wait', context: { refs: [], digest: 'a'.repeat(64) }, approver: 'operator', requestedAt: '2026-11-07T00:00:00.000Z', expiresAt: '2026-11-08T00:00:00.000Z', state: 'pending', outcome: null, appliedByCommandId: null };

export function setupUI(options: Pick<StoreOptions, 'timer' | 'debounceMs'> = {}) {
  const api = {
    csrfToken: null,
    health: vi.fn().mockResolvedValue(envelope),
    session: vi.fn().mockResolvedValue({ ...envelope, csrfToken: 'fixture-csrf' }),
    bootstrap: vi.fn().mockResolvedValue({ ...envelope, csrfToken: 'fixture-csrf' }),
    logout: vi.fn().mockResolvedValue(envelope),
    listProjects: vi.fn().mockResolvedValue({ ...envelope, projects: [project] }),
    getTeam: vi.fn().mockResolvedValue({ ...envelope, team, engagement, seats: [seat] }),
    listTasks: vi.fn().mockResolvedValue({ ...envelope, items: [] }),
    listAttempts: vi.fn().mockResolvedValue({ ...envelope, attempts: [] }),
    listAttemptEvents: vi.fn().mockResolvedValue({ ...envelope, events: [] }),
    getAttemptPatch: vi.fn().mockResolvedValue(null),
    listTaskArtifacts: vi.fn().mockResolvedValue({ ...envelope, items: [] }),
    searchKnowledge: vi.fn().mockResolvedValue({ ...envelope, results: [] }),
    listKnowledgeArtifacts: vi.fn().mockResolvedValue({ ...envelope, items: [] }),
    getKnowledgeArtifact: vi.fn().mockRejectedValue(new Error('Not found')),
    getArtifactContent: vi.fn().mockResolvedValue({ ...envelope, mediaType: 'text/plain', text: 'Artifact text', sizeBytes: 13, contentHash: 'a'.repeat(64) }),
    listTaskApprovals: vi.fn().mockResolvedValue({ ...envelope, approvals: [] }),
    getInbox: vi.fn().mockResolvedValue({ ...envelope, approvals: [], startGates: [], counts: { approvals: 0, startGates: 0, total: 0 } }),
    getGlobalInbox: vi.fn().mockResolvedValue({ ...envelope, approvals: [], startGates: [], counts: { approvals: 0, startGates: 0, total: 0 } }),
    getApproval: vi.fn().mockResolvedValue({ ...envelope, approval }),
    getEffectRemotes: vi.fn().mockResolvedValue({ ...envelope, remotes: [] }),
    listAttemptEffects: vi.fn().mockResolvedValue({ ...envelope, effects: [] }),
    pushAttempt: vi.fn(), reconcileEffect: vi.fn(),
    listConversations: vi.fn().mockResolvedValue({ ...envelope, conversations: [] }),
    listMessages: vi.fn().mockResolvedValue({ ...envelope, messages: [], turns: [] }),
    getBudget: vi.fn().mockResolvedValue({ ...envelope, budget }),
    sendCommand: vi.fn().mockResolvedValue({ ...envelope, receipt }),
  };
  const connections: ProjectEventsOptions[] = [];
  const store = createStore({ ...options, api: api as ApiClient, openEvents(options) {
    connections.push(options);
    options.onStatus?.('connecting', { lastEventId: null, invalidMessages: 0 });
    return { close: vi.fn() };
  } });
  return { store, api, connections };
}
