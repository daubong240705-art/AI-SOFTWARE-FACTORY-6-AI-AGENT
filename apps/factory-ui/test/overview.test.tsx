import { chooseOption } from './select-helpers';
﻿import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Command } from '@factory/contracts';
import { Overview } from '../src/screens/Overview';
import type { Inbox } from '../src/api/client';
import type { Store } from '../src/state/store';
import { i18n } from '../src/i18n';
import { conversation, deferred, envelope, id, otherId, project, receipt, seat } from './fixtures';
import { globalInbox } from './inbox-fixtures';
import { setupUI } from './ui-fixtures';

const stores: Store[] = [];
afterEach(() => { cleanup(); stores.splice(0).forEach(store => store.dispose()); });
async function overview(options: { operatorName?: string; empty?: boolean; inbox?: Inbox; createConversation?: boolean } = {}) {
  const fixture = setupUI(); stores.push(fixture.store);
  fixture.api.listProjects.mockResolvedValue({ ...envelope, projects: options.empty ? [] : [project, { ...project, id: otherId, name: 'Second project' }] });
  fixture.api.getGlobalInbox.mockResolvedValue({ ...envelope, ...(options.inbox ?? globalInbox) });
  if (!options.createConversation) fixture.api.listConversations.mockResolvedValue({ ...envelope, conversations: [conversation] });
  const onProject = vi.fn(); const onAttention = vi.fn(); const onCreate = vi.fn();
  await fixture.store.boot(); await fixture.store.loadProjects();
  const view = render(<Overview store={fixture.store} {...(options.operatorName ? { operatorName: options.operatorName } : {})} onProject={onProject} onAttention={onAttention} onCreate={onCreate} />);
  return { ...fixture, ...view, onProject, onAttention, onCreate };
}
function message() { return screen.getByRole('textbox', { name: 'Message for Lead' }) as HTMLTextAreaElement; }
function sendButton() { return screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement; }
function write(text = 'Please help with the project') { fireEvent.change(message(), { target: { value: text } }); }

it('greets a known operator with an accented name and otherwise uses a neutral greeting', async () => {
  const view = await overview({ operatorName: 'Alex' });
  const heading = screen.getByRole('heading', { level: 1, name: 'Hello, Alex' });
  expect(heading.querySelector('em')?.textContent).toBe('Alex');
  view.unmount(); await overview();
  expect(screen.getByRole('heading', { level: 1, name: 'Hello' })).toBeTruthy();
});

it.each(['en', 'vi'] as const)('uses localized waiting summary in %s and hides it at zero', async locale => {
  i18n.setLocale(locale); const view = await overview();
  expect(screen.getByText(locale === 'en' ? '3 waiting for you' : '3 việc đang chờ bạn')).toBeTruthy();
  view.unmount();
  await overview({ inbox: { approvals: [], startGates: [], counts: { approvals: 0, startGates: 0, total: 0 } } });
  expect(screen.queryByText(/waiting for you|việc đang chờ bạn/)).toBeNull();
  expect(screen.queryByRole('heading', { name: /Activity|Hoạt động/ })).toBeNull();
});

it.each(['', '   \n  '])('empty or whitespace text %j cannot send by button, form or Ctrl+Enter', async text => {
  const { api, onProject } = await overview(); write(text);
  expect(sendButton().disabled).toBe(true); fireEvent.click(sendButton());
  fireEvent.submit(screen.getByRole('form', { name: 'Ask or delegate to Lead' }));
  fireEvent.keyDown(message(), { key: 'Enter', ctrlKey: true });
  expect(api.sendCommand).not.toHaveBeenCalled(); expect(onProject).not.toHaveBeenCalled();
});

it('links an overlong-text error to the composer and enables sending at the 32000 character limit', async () => {
  const { api } = await overview(); write('a'.repeat(32_001));
  expect(message().getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(message().getAttribute('aria-describedby')!)).toBe(screen.getByRole('alert'));
  expect(sendButton().disabled).toBe(true); fireEvent.keyDown(message(), { key: 'Enter', ctrlKey: true });
  expect(api.sendCommand).not.toHaveBeenCalled();
  write('a'.repeat(32_000)); expect(sendButton().disabled).toBe(false); expect(screen.queryByRole('alert')).toBeNull();
});

it.each([['Ask', 'discuss'], ['Delegate', 'delegate']] as const)('%s maps to %s and Ctrl+Enter sends through the existing Lead conversation', async (label, intent) => {
  const { store, api, onProject } = await overview(); const select = vi.spyOn(store, 'selectProject');
  fireEvent.click(screen.getByRole('button', { name: label })); write('Question for Lead');
  expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(message(), { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(onProject).toHaveBeenCalledExactlyOnceWith(id));
  expect(select).toHaveBeenCalledExactlyOnceWith(id);
  expect(api.sendCommand).toHaveBeenCalledOnce();
  expect(api.sendCommand.mock.calls[0]?.[0]).toMatchObject({ type: 'chat.send', projectId: id,
    payload: { conversationId: conversation.id, expectedRevision: conversation.revision, text: 'Question for Lead', intent } });
  expect(api.listMessages.mock.calls[0]?.slice(0, 2)).toEqual([id, conversation.id]); expect(api.getBudget).toHaveBeenCalledWith(id);
  expect(message().value).toBe('');
});

it('project selection changes the command project and preserves the default Delegate intent', async () => {
  const { store, api, onProject } = await overview(); const selectProject = vi.spyOn(store, 'selectProject');
  await chooseOption('Project', 'Second project');
  write(); fireEvent.click(sendButton());
  await waitFor(() => expect(onProject).toHaveBeenCalledExactlyOnceWith(otherId));
  expect(selectProject).toHaveBeenCalledExactlyOnceWith(otherId);
  expect(api.sendCommand.mock.calls[0]?.[0]).toMatchObject({ projectId: otherId, payload: { intent: 'delegate' } });
});

it('creates an absent Lead conversation before sending and ignores other seats and task conversations', async () => {
  const { api, onProject } = await overview({ createConversation: true });
  const unrelated = [{ ...conversation, id: otherId, agentId: otherId }, { ...conversation, id: otherId, workItemId: id }];
  api.listConversations.mockResolvedValue({ ...envelope, conversations: unrelated });
  api.sendCommand.mockImplementation(async (command: Command) => {
    if (command.type === 'conversations.create') api.listConversations.mockResolvedValue({ ...envelope, conversations: [...unrelated, { ...conversation, id: command.payload.conversationId }] });
    return { ...envelope, receipt };
  });
  write(); fireEvent.click(sendButton()); await waitFor(() => expect(onProject).toHaveBeenCalledWith(id));
  expect(api.sendCommand.mock.calls.map(call => call[0].type)).toEqual(['conversations.create', 'chat.send']);
  expect(api.sendCommand.mock.calls[0]?.[0].payload).toMatchObject({ agentId: seat.id, title: 'Lead', workItemId: null });
  expect(api.sendCommand.mock.calls[1]?.[0].payload.conversationId).toBe(api.sendCommand.mock.calls[0]?.[0].payload.conversationId);
});

it('Enter and IME composition do not submit the composer', async () => {
  const { api } = await overview(); write();
  fireEvent.keyDown(message(), { key: 'Enter' });
  fireEvent.compositionStart(message()); fireEvent.keyDown(message(), { key: 'Enter', ctrlKey: true }); fireEvent.compositionEnd(message());
  fireEvent.keyDown(message(), { key: 'Enter', ctrlKey: true, isComposing: true });
  expect(api.sendCommand).not.toHaveBeenCalled();
});

it('blocks duplicate submissions while busy and retains command identity on retry', async () => {
  const { api, onProject } = await overview(); const pending = deferred<unknown>(); api.sendCommand.mockReturnValueOnce(pending.promise);
  write(); fireEvent.click(sendButton()); await waitFor(() => expect(api.sendCommand).toHaveBeenCalledOnce());
  expect(message().disabled).toBe(true); expect(sendButton().disabled).toBe(true);
  fireEvent.keyDown(message(), { key: 'Enter', ctrlKey: true }); expect(api.sendCommand).toHaveBeenCalledOnce();
  await act(async () => pending.reject(new Error('Internal failure')));
  expect(message().value).toBe('Please help with the project'); expect(onProject).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(onProject).toHaveBeenCalledWith(id));
  expect(api.sendCommand.mock.calls[1]?.[0]).toEqual(api.sendCommand.mock.calls[0]?.[0]);
});

it('no projects offers a single sentence and a working create action', async () => {
  const { onCreate } = await overview({ empty: true });
  expect(screen.getByText('No projects yet.')).toBeTruthy(); expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Create project' })); expect(onCreate).toHaveBeenCalledOnce();
});

it('shows at most five real inbox rows with project tiles, relative times and View all', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-08T00:00:00.000Z'));
  const approvals = Array.from({ length: 7 }, (_, index) => ({ ...globalInbox.approvals[0]!, id: id.slice(0, -1) + index, subject: 'Review ' + (index + 1) }));
  const { onAttention } = await overview({ inbox: { approvals, startGates: [], counts: { approvals: 7, startGates: 0, total: 7 } } });
  const card = screen.getByRole('complementary', { name: 'Needs attention' });
  expect(within(card).getAllByRole('button')).toHaveLength(6);
  expect(within(card).queryByText('Review 6')).toBeNull(); expect(card.querySelectorAll('.project-tile')).toHaveLength(5);
  expect(card.querySelector('time')?.textContent).toBe('1 day ago');
  fireEvent.click(within(card).getByRole('button', { name: /Review 3/ }));
  expect(onAttention).toHaveBeenCalledWith(expect.objectContaining({ projectId: id, selection: { kind: 'approval', id: approvals[2]!.id } }));
  fireEvent.click(within(card).getByRole('button', { name: 'View all' })); expect(onAttention.mock.calls.at(-1)).toEqual([]);
});

