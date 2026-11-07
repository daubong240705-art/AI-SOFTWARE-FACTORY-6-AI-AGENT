import { expect, it } from 'vitest';
import { commandSchema, idSchema } from '@factory/contracts';
import { budgetsSet, chatSend, conversationsCreate, projectsCreate, tasksTransition, tasksCreate, nextTaskCode } from '../src/api/commands';
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
it.each([
  [[], 'TSK-001'],
  [['TSK-001', 'TSK-003'], 'TSK-004'],
  [['UI-999', 'TSK-002'], 'TSK-003'],
  [['TSK-999'], 'TSK-1000'],
  [['TSK-1000', 'TSK-999'], 'TSK-1001'],
  [['UI-001', 'TSK-invalid'], 'TSK-001'],
] as const)('generates next code from %j', (codes, expected) => {
  expect(nextTaskCode(codes.map((code) => ({ code })))).toBe(expected);
});
it('supports a custom task code prefix', () => {
  expect(nextTaskCode([{ code: 'UI-011' }, { code: 'TSK-100' }], 'UI')).toBe('UI-012');
});
it('creates a valid task with conservative contract defaults', () => {
  const command = tasksCreate({ projectId: id, code: 'TSK-001', title: 'Task', goal: 'Goal', acceptance: ['Pass'] });
  expect(commandSchema.safeParse(command).success).toBe(true);
  expect(command.payload).toMatchObject({ brief: 'Goal', parentTaskId: null, engagementId: null, ownerSeatId: null,
    inputs: [], dependsOn: [], requiredCapabilities: [], placement: 'node-bound', sideEffect: 'external-irreversible', reviewPolicy: 'human-final', requiresGo: true });
  expect(idSchema.safeParse(command.payload.taskId).success).toBe(true);
});
it('preserves optional brief and required capabilities', () => {
  expect(tasksCreate({ projectId: id, code: 'TSK-001', title: 'Task', goal: 'Goal', brief: 'Details', acceptance: ['Pass'], requiredCapabilities: ['runtime.node'] }).payload).toMatchObject({ brief: 'Details', requiredCapabilities: ['runtime.node'] });
});
it.each([{ title: '' }, { goal: 'x'.repeat(501) }, { code: 'invalid' }, { acceptance: ['x'.repeat(501)] }])('rejects invalid task input %j', (patch) => {
  expect(() => tasksCreate({ projectId: id, code: 'TSK-001', title: 'Task', goal: 'Goal', acceptance: ['Pass'], ...patch })).toThrow();
});
