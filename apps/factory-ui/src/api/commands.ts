import { API_VERSION, commandSchema, type Command } from '@factory/contracts';

type Of<T extends Command['type']> = Extract<Command, { type: T }>;
function build<T extends Command['type']>(type: T, projectId: string, payload: Of<T>['payload']): Of<T> {
  return commandSchema.parse({ apiVersion: API_VERSION, commandId: crypto.randomUUID(), projectId, type, payload }) as Of<T>;
}

export function projectsCreate({ name, root }: { name: string; root: string }) {
  return build('projects.create', crypto.randomUUID(), { name, workspace: { kind: 'directory', root } });
}
export function conversationsCreate({ projectId, seatId, title }: { projectId: string; seatId: string; title: string }) {
  return build('conversations.create', projectId, { conversationId: crypto.randomUUID(), agentId: seatId, title, workItemId: null });
}
export function chatSend({ projectId, conversationId, conversationRevision, text, intent }: {
  projectId: string; conversationId: string; conversationRevision: number; text: string; intent: 'discuss' | 'delegate';
}) {
  return build('chat.send', projectId, { conversationId, expectedRevision: conversationRevision, messageId: crypto.randomUUID(), text, intent, attachmentIds: [], context: [], draftRevision: null });
}
export function tasksTransition({ projectId, ...payload }: Of<'tasks.transition'>['payload'] & { projectId: string }) {
  return build('tasks.transition', projectId, payload);
}
export function budgetsSet({ projectId, ...payload }: Of<'budgets.set'>['payload'] & { projectId: string }) {
  return build('budgets.set', projectId, payload);
}
