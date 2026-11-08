import type { Approval } from '@factory/contracts';
import type { Effect, Inbox } from '../src/api/client';
import { approval } from './ui-fixtures';
import { id, otherId, envelope } from './fixtures';

export const review: Approval = { ...approval, kind: 'review', subject: 'Review patch', expiresAt: '2099-11-14T00:00:00.000Z', options: [{ id: 'accept', label: 'Accept', consequence: 'Accept the result' }, { id: 'request-changes', label: 'Request changes', consequence: 'Return for changes' }], recommendation: 'accept' };
export const question: Approval = { ...approval, id: otherId, subject: 'Which colour?', expiresAt: '2099-11-14T00:00:00.000Z' };
export const gate = { taskId: id, code: 'UI-001', title: 'Start the task', projectId: id };
export const inbox: Inbox = { approvals: [review, question], startGates: [gate], counts: { approvals: 2, startGates: 1, total: 3 } };
export const globalInbox: Inbox = { ...inbox, approvals: inbox.approvals.map(item => ({ ...item, projectName: 'Project' })), startGates: [{ ...gate, projectName: 'Project' }] };
export const effect: Effect = { id, attemptId: otherId, kind: 'git.push-branch', remote: 'origin', branch: 'factory/task-e1', state: 'done', error: null, createdAt: '2026-11-08T00:00:00.000Z', completedAt: '2026-11-08T00:00:01.000Z' };
export const emptyInbox = { ...envelope, approvals: [], startGates: [], counts: { approvals: 0, startGates: 0, total: 0 } };
