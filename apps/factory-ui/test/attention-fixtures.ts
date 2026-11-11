import type { Inbox } from '../src/api/client';
import { requestItemSchema } from '../src/api/m3Models';
import { id, otherId } from './fixtures';
import { gate, review, question } from './inbox-fixtures';
import { requestItem } from './m3-fixtures';

export const since = '2026-11-08T00:00:00.000Z';
const project = { projectId: id, projectName: 'Project' };
export const allKinds: Inbox = {
  approvals: [{ ...review, ...project }, { ...question, ...project }],
  startGates: [{ ...gate, ...project }],
  requests: [requestItemSchema.parse({ ...requestItem, ...project })],
  patches: [{ ...project, id, instanceId: otherId, instanceTitle: 'Delivery workflow', reason: 'Add a verification stage', ops: ['Add stage verify', 'Connect build to verify'], createdAt: since }],
  monitors: [{ ...project, monitorId: id, name: 'Error rate', kind: 'error-rate', value: 12, since }],
  stalledWorkflows: [{ ...project, instanceId: id, title: 'Delivery stalled', reason: 'Waiting for a missing artifact', since }],
  quarantinedRules: [{ ...project, ruleId: id, name: 'Retry rule', since }],
  teamBreakers: [{ ...project, teamId: id, title: 'Research paused', reason: 'Three consecutive failures', openedAt: since, failures: 3 }],
  integrationConflicts: [{ ...project, taskId: id, code: 'UI-001', title: 'Merge failed', branch: 'factory/integration', since }],
  counts: { approvals: 2, startGates: 1, requests: 1, total: 10 },
};
export function kindMix(mask: number): Inbox {
  return {
    approvals: allKinds.approvals?.filter((_, index) => (mask & (1 << index)) !== 0) ?? [],
    startGates: mask & 4 ? allKinds.startGates ?? [] : [], requests: mask & 8 ? allKinds.requests ?? [] : [],
    patches: mask & 16 ? allKinds.patches ?? [] : [], monitors: mask & 32 ? allKinds.monitors ?? [] : [],
    stalledWorkflows: mask & 64 ? allKinds.stalledWorkflows ?? [] : [], quarantinedRules: mask & 128 ? allKinds.quarantinedRules ?? [] : [],
    teamBreakers: mask & 256 ? allKinds.teamBreakers ?? [] : [], integrationConflicts: mask & 512 ? allKinds.integrationConflicts ?? [] : [],
    counts: { approvals: 0, startGates: 0, total: 0 },
  };
}
