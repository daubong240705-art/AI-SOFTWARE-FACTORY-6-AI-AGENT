import type { BudgetResponse } from '../src/api/client';
import { settingsReadModels } from '../src/api/settingsModels';
import { envelope, id, otherId } from './fixtures';

export const autonomy = settingsReadModels.autonomy.parse({
  ...envelope, project: { level: 3, source: 'explicit', revision: 2 },
  teams: [{ teamId: id, level: 4, source: 'explicit', effectiveLevel: 3 }, { teamId: otherId, level: 2, source: 'default', effectiveLevel: 2 }],
  defaults: { project: 3, team: 2 },
});
export const standingApproval = {
  id, actionKind: 'notify.send-internal', scope: { kind: 'project', ref: id },
  limitPerDay: 10, maxTokensPerUse: 2000, state: 'active',
  createdAt: '2026-11-07T00:00:00.000Z', expiresAt: '2026-12-01T00:00:00.000Z', revokedAt: null,
  usedToday: 3, remainingToday: 7,
};
export const standingApprovals = settingsReadModels.standingApprovals.parse({
  items: [
    { ...standingApproval, id: otherId, state: 'revoked', actionKind: 'deploy.staging' },
    standingApproval,
    { ...standingApproval, id: '33333333-3333-4333-8333-333333333333', state: 'expired', actionKind: 'artifact.publish-to-project' },
  ], level: { level: 3, source: 'explicit' },
});
export const settingsBudget: BudgetResponse['budget'] = {
  day: { date: '2026-11-11', used: 920, limit: 1000, verdict: 'warn', source: 'default' },
  project: { used: 1800, limit: null, verdict: 'ok', source: 'default' },
  engagements: [{ engagementId: id, used: 1200, limit: 1000, verdict: 'exceeded' }],
  tasks: [
    { taskId: id, code: 'UI-001', used: 100, limit: 1000, verdict: 'ok', source: 'default' },
    { taskId: otherId, code: 'UI-002', used: 920, limit: 1000, verdict: 'warn', source: 'explicit' },
    { taskId: '33333333-3333-4333-8333-333333333333', code: 'UI-003', used: 1200, limit: 1000, verdict: 'exceeded', source: 'explicit' },
  ],
};
