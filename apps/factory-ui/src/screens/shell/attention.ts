import type { Inbox } from '../../api/client';

export type AttentionKind = 'review' | 'question' | 'start-gate' | 'request' | 'plan-patch' | 'stalled-workflow' | 'team-breaker' | 'integration-conflict' | 'quarantined-rule' | 'monitor';
export type AttentionItem = { key: string; kind: AttentionKind; projectId: string; projectName?: string | undefined; code?: string | undefined; title: string; since: string; expiresAt?: string; actionable: boolean; selection?: { kind: 'approval' | 'task' | 'request'; id: string } };
const dateValue = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? value : '9999-12-31T23:59:59.999Z';
const oldest = (a: AttentionItem, b: AttentionItem) => Date.parse(dateValue(a.since)) - Date.parse(dateValue(b.since)) || a.key.localeCompare(b.key);
const actionableOrder = (a: AttentionItem, b: AttentionItem) => {
  const ae = a.expiresAt ? Date.parse(a.expiresAt) : Number.POSITIVE_INFINITY;
  const be = b.expiresAt ? Date.parse(b.expiresAt) : Number.POSITIVE_INFINITY;
  return ae - be || oldest(a, b);
};
export function attentionItems(inbox: Inbox): AttentionItem[] {
  const rows: AttentionItem[] = [];
  for (const item of inbox.approvals) {
    const kind = item.kind === 'start-gate' ? 'start-gate' : item.kind;
    rows.push({ key: `approval:${item.id}`, kind, projectId: item.projectId, projectName: item.projectName, title: item.subject, since: item.requestedAt, expiresAt: item.expiresAt, actionable: true, selection: { kind: kind === 'start-gate' ? 'task' : 'approval', id: kind === 'start-gate' ? (item.taskId ?? item.id) : item.id } });
  }
  for (const item of inbox.startGates) rows.push({ key: `gate:${item.taskId}`, kind: 'start-gate', projectId: item.projectId, projectName: item.projectName, code: item.code, title: item.title, since: '9999-12-31T23:59:59.999Z', actionable: true, selection: { kind: 'task', id: item.taskId } });
  for (const item of inbox.requests ?? []) if (item.projectId) rows.push({ key: `request:${item.taskId}`, kind: 'request', projectId: item.projectId, projectName: item.projectName, code: item.code, title: item.subject, since: item.createdAt, actionable: true, selection: { kind: 'request', id: item.taskId } });
  for (const item of inbox.patches ?? []) if (item.projectId) rows.push({ key: `patch:${item.id}`, kind: 'plan-patch', projectId: item.projectId, projectName: item.projectName, title: item.reason || item.instanceTitle, since: item.createdAt, actionable: true });
  for (const item of inbox.monitors ?? []) if (item.projectId) rows.push({ key: `monitor:${item.monitorId}`, kind: 'monitor', projectId: item.projectId, projectName: item.projectName, title: item.name, since: item.since ?? '9999-12-31T23:59:59.999Z', actionable: false });
  for (const item of inbox.stalledWorkflows ?? []) if (item.projectId) rows.push({ key: `workflow:${item.instanceId}`, kind: 'stalled-workflow', projectId: item.projectId, projectName: item.projectName, title: item.reason || item.title, since: item.since ?? '9999-12-31T23:59:59.999Z', actionable: false });
  for (const item of inbox.quarantinedRules ?? []) if (item.projectId) rows.push({ key: `rule:${item.ruleId}`, kind: 'quarantined-rule', projectId: item.projectId, projectName: item.projectName, title: item.name, since: item.since ?? '9999-12-31T23:59:59.999Z', actionable: false });
  for (const item of inbox.teamBreakers ?? []) if (item.projectId) rows.push({ key: `breaker:${item.teamId}`, kind: 'team-breaker', projectId: item.projectId, projectName: item.projectName, title: item.title, since: item.openedAt ?? '9999-12-31T23:59:59.999Z', actionable: false });
  for (const item of inbox.integrationConflicts ?? []) if (item.projectId) rows.push({ key: `conflict:${item.taskId}`, kind: 'integration-conflict', projectId: item.projectId, projectName: item.projectName, code: item.code, title: item.title, since: item.since ?? '9999-12-31T23:59:59.999Z', actionable: false });
  return rows.sort((a, b) => a.actionable === b.actionable ? (a.actionable ? actionableOrder(a, b) : oldest(a, b)) : a.actionable ? -1 : 1);
}
