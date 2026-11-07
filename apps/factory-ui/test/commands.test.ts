import { expect, it } from 'vitest';
import { commandSchema, idSchema } from '@factory/contracts';
import { budgetsSet, chatSend, conversationsCreate, projectsCreate, tasksTransition } from '../src/api/commands';
import { id } from './fixtures';
const builders = [
  () => projectsCreate({ name: 'Demo', root: '/work' }),
  () => conversationsCreate({ projectId: id, seatId: id, title: 'Lead' }),
  () => chatSend({ projectId: id, conversationId: id, conversationRevision: 2, text: 'Discuss', intent: 'discuss' }),
  () => tasksTransition({ projectId: id, taskId: id, expectedRevision: 1, to: 'accepted' }),
  () => budgetsSet({ projectId: id, budgetId: id, expectedRevision: null, scope: 'day', scopeRef: '2026-11-07', limitTokens: 100, warnAtPercent: 80 }),
];
it.each(builders.map((builder, index) => [index, builder] as const))('builder %i passes the contract', (_index, builder) => { expect(commandSchema.safeParse(builder()).success).toBe(true); });
it('new command and entity IDs are unique UUIDs', () => {
  const a = projectsCreate({ name: 'A', root: '/work' }); const b = projectsCreate({ name: 'B', root: '/work' });
  const c = conversationsCreate({ projectId: id, seatId: id, title: 'C' });
  const ids = [a.commandId, a.projectId, b.commandId, b.projectId, c.commandId, c.payload.conversationId];
  expect(new Set(ids).size).toBe(ids.length); ids.forEach((value) => expect(idSchema.safeParse(value).success).toBe(true));
});
it('chat maps revisions and fills immutable protocol defaults', () => {
  const command = chatSend({ projectId: id, conversationId: id, conversationRevision: 3, text: 'Hello', intent: 'delegate' });
  expect(command.payload).toMatchObject({ expectedRevision: 3, attachmentIds: [], context: [], draftRevision: null, intent: 'delegate' });
  expect(idSchema.safeParse(command.payload.messageId).success).toBe(true);
});
it('conversation maps seat to the Host agent identity', () => {
  expect(conversationsCreate({ projectId: id, seatId: id, title: 'Lead' }).payload).toMatchObject({ agentId: id, workItemId: null });
});
it('invalid builder input is rejected before returning', () => {
  expect(() => projectsCreate({ name: '', root: 'C:\\work' })).toThrow();
});
