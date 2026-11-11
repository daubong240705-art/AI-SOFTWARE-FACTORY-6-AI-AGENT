import { m5ReadModels } from '../src/api/readModels';
import { envelope, id, otherId } from './fixtures';

export const workflow = m5ReadModels.workflows.parse({ instances: [{ id, key: 'delivery', title: 'Ship release', state: 'active', createdAt: '2026-11-07T00:00:00.000Z' }] }).instances[0]!;
export const workflowDetail = m5ReadModels.workflow.parse({ instance: { ...workflow, lastProgressAt: '2026-11-08T00:00:00.000Z', stages: [
  { key: 'z-research', phase: 'prepare', state: 'done', loopCount: 0, iteration: 1, tasks: [{ taskId: id, code: 'UI-001', state: 'done' }] },
  { key: 'a-build', phase: 'deliver', state: 'active', loopCount: 2, iteration: 3, tasks: [{ taskId: otherId, code: 'UI-002', state: 'active' }] },
] } }).instance;
export const schedule = m5ReadModels.schedules.parse({ ...envelope, items: [{ id, name: 'Daily release', kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Ho_Chi_Minh', state: 'quarantined', enabled: false, nextRunAt: null, lastRunAt: '2026-11-07T00:00:00.000Z', lastStatus: 'failed' }] }).items[0]!;
export const rule = m5ReadModels.rules.parse({ ...envelope, items: [{ id, name: 'On completed task', eventType: 'task.status-changed', state: 'quarantined', firesInWindow: 4, lastFiredAt: '2026-11-07T00:00:00.000Z' }] }).items[0]!;
export const healthyMonitor = m5ReadModels.monitors.parse({ ...envelope, items: [{ id, name: 'Disk space', state: 'active', status: 'ok' }] }).items[0]!;
export const unhealthyMonitor = m5ReadModels.monitors.parse({ ...envelope, items: [{ id: otherId, name: 'Approval age', state: 'active', status: 'tripped' }] }).items[0]!;
export const breakers = m5ReadModels.breakers.parse({ routes: [{ key: 'api/route', state: 'half-open', openedAt: '2026-11-07T00:00:00.000Z' }], teams: [{ teamId: id, state: 'open' }] });
