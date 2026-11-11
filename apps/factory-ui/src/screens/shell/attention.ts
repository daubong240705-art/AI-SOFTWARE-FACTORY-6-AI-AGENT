import type { Inbox } from '../../api/client';
import type { InboxSelection } from '../Inbox';

export type AttentionItem = { key: string; projectId: string; projectName?: string | undefined; title: string; at?: string | undefined; selection: InboxSelection };
export function attentionItems(inbox: Inbox): AttentionItem[] {
  return [
    ...inbox.approvals.map(item => ({ key: `approval:${item.id}`, projectId: item.projectId, projectName: item.projectName, title: item.subject, at: item.requestedAt,
      selection: { kind: item.kind === 'start-gate' ? 'task' as const : 'approval' as const, id: item.kind === 'start-gate' ? item.taskId! : item.id } })),
    ...inbox.startGates.filter(item => !inbox.approvals.some(approval => approval.kind === 'start-gate' && approval.taskId === item.taskId)).map(item => ({ key: `gate:${item.taskId}`, projectId: item.projectId, projectName: item.projectName, title: item.title, selection: { kind: 'task' as const, id: item.taskId } })),
    ...(inbox.requests ?? []).flatMap(item => item.projectId ? [{ key: `request:${item.taskId}`, projectId: item.projectId, projectName: item.projectName, title: item.subject, at: item.createdAt, selection: { kind: 'request' as const, id: item.taskId } }] : []),
  ];
}
