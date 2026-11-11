import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectChat } from '../src/screens/ProjectChat';
import { ProjectView } from '../src/screens/ProjectView';
import * as commands from '../src/api/commands';
import { ApiClientError, type MessagesResponse } from '../src/api/client';
import { i18n } from '../src/i18n';
import type { Store } from '../src/state/store';
import { projectSchema } from '@factory/contracts';
import { setupUI } from './ui-fixtures';
import { budget, conversation, deferred, envelope, id, message, otherId, project, receipt, seat, team, engagement } from './fixtures';

const stores: Store[] = [];
beforeEach(() => { i18n.setLocale('en'); });
afterEach(() => { cleanup(); stores.forEach((store) => store.dispose()); stores.length = 0; vi.restoreAllMocks(); i18n.setLocale('en'); });
const error = (code: 'conflict' | 'internal' = 'internal') => new ApiClientError('api', code === 'conflict' ? 409 : 500, { code, message: 'Ignored', correlationId: id, nextAction: 'refresh' });
function fixture() { const value = setupUI(); stores.push(value.store); return value; }
function item(text = 'Hello', speaker: 'user' | 'agent' | 'system' = 'user', ordinal = 1) {
  return { ordinal, message: { ...message, id: crypto.randomUUID(), text, speaker, agentId: speaker === 'agent' ? id : null } };
}
async function chat(options: { messages?: MessagesResponse['messages']; turns?: MessagesResponse['turns']; authenticated?: boolean } = {}) {
  const value = fixture();
  value.api.listConversations.mockResolvedValue({ ...envelope, conversations: [conversation] });
  value.api.listMessages.mockResolvedValue({ ...envelope, messages: options.messages ?? [], turns: options.turns ?? [] });
  if (options.authenticated !== false) await value.store.boot();
  await value.store.selectProject(id);
  const rendered = render(<ProjectChat store={value.store} projectId={id} />);
  await act(async () => {});
  return { ...value, ...rendered };
}
function type(text = 'Please help') { fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: text } }); }
function send() { fireEvent.click(screen.getByRole('button', { name: 'Send' })); }
function text() { return (screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value; }

it('shows the empty conversation card', async () => {
  const { store } = fixture(); await store.boot(); await store.selectProject(id);
  render(<ProjectChat store={store} projectId={id} />);
  expect(screen.getByText('No conversations yet.')).toBeTruthy(); expect(screen.getByRole('button', { name: 'Start chat with Lead' })).toBeTruthy();
});
it('creates the conversation using the Lead seat and reloads', async () => {
  const { store, api } = fixture(); api.getTeam.mockResolvedValue({ ...envelope, team, engagement, seats: [{ ...seat, id: otherId }] });
  await store.boot(); await store.selectProject(id); const load = vi.spyOn(store, 'loadConversations');
  api.sendCommand.mockImplementation(async () => { api.listConversations.mockResolvedValue({ ...envelope, conversations: [conversation] }); return { ...envelope, receipt }; });
  render(<ProjectChat store={store} projectId={id} />); fireEvent.click(screen.getByRole('button', { name: 'Start chat with Lead' }));
  await screen.findByRole('textbox', { name: 'Message' });
  expect(api.sendCommand.mock.calls[0]?.[0]).toMatchObject({ type: 'conversations.create', projectId: id, payload: { agentId: otherId, title: 'Lead' } }); expect(load).toHaveBeenCalledOnce();
});
it('disables starting a conversation until the team has loaded', async () => {
  const { store, api } = fixture(); await store.boot(); const pending = deferred<unknown>(); api.getTeam.mockReturnValue(pending.promise);
  let loading!: Promise<void>; act(() => { loading = store.selectProject(id); }); render(<ProjectChat store={store} projectId={id} />);
  expect((screen.getByRole('button', { name: 'Start chat with Lead' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { pending.resolve({ ...envelope, team, engagement, seats: [seat] }); await loading; });
  expect((screen.getByRole('button', { name: 'Start chat with Lead' }) as HTMLButtonElement).disabled).toBe(false);
});
it('shows an alert when the team has no Lead seat', async () => {
  const { store, api } = fixture(); api.getTeam.mockResolvedValue({ ...envelope, team, engagement, seats: [{ ...seat, isLead: false }] }); await store.boot(); await store.selectProject(id);
  render(<ProjectChat store={store} projectId={id} />); expect(screen.getByRole('alert').textContent).toContain('No Lead seat'); expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
});
it('retries a failed conversation creation using the same command', async () => {
  const { store, api } = fixture(); await store.boot(); await store.selectProject(id); api.sendCommand.mockRejectedValueOnce(error());
  render(<ProjectChat store={store} projectId={id} />); fireEvent.click(screen.getByRole('button', { name: 'Start chat with Lead' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' })); await waitFor(() => expect(api.sendCommand).toHaveBeenCalledTimes(2));
  expect(api.sendCommand.mock.calls[1]?.[0]).toBe(api.sendCommand.mock.calls[0]?.[0]);
});
it('uses the first conversation and loads its messages on mount', async () => {
  const { store, api } = await chat(); expect(screen.getByRole('heading', { name: 'Discuss' })).toBeTruthy(); expect(api.listMessages).toHaveBeenCalledWith(id, id, { afterOrdinal: 0, limit: 100 });
  api.listConversations.mockResolvedValue({ ...envelope, conversations: [{ ...conversation, id: otherId, title: 'Second' }, conversation] });
  await act(async () => { await store.loadConversations(); }); await waitFor(() => expect(api.listMessages).toHaveBeenCalledWith(id, otherId, { afterOrdinal: 0, limit: 100 })); expect(screen.getByRole('heading', { name: 'Second' })).toBeTruthy();
});
it('shows the translated empty message state', async () => { await chat(); expect(within(screen.getByRole('log')).getByText('No messages yet.')).toBeTruthy(); });
it('renders markup as plain text without creating elements', async () => {
  const malicious = '<img src=x onerror=alert(1)>\n<script>alert(1)</script>';
  await chat({ messages: [item(malicious)] }); const log = screen.getByRole('log'); expect(log.textContent).toContain(malicious); expect(log.querySelector('img, script')).toBeNull(); expect(log.querySelector('.plain-text')).toBeTruthy();
});
it.each([['user', 'You'], ['agent', 'Lead'], ['system', 'System']] as const)('labels %s speakers as %s', async (speaker, label) => {
  await chat({ messages: [item('Message content', speaker)] }); expect(within(screen.getByRole('log')).getByText(label)).toBeTruthy(); expect(document.querySelector(`.speaker-${speaker}`)).toBeTruthy();
});
it('renders locale-formatted semantic time elements', async () => {
  await chat({ messages: [item()] }); const time = screen.getByRole('log').querySelector('time'); expect(time?.dateTime).toBe(message.createdAt); expect(time?.textContent).toBe(new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(message.createdAt)));
});
it('keeps a politely announced and named conversation log', async () => { await chat(); expect(screen.getByRole('log', { name: 'Conversation messages' }).getAttribute('aria-live')).toBe('polite'); });
it.each(['queued', 'running', 'failed', 'unknown', 'budget-blocked', 'done'] as const)('announces last user turn %s', async (state) => {
  const user = item(); await chat({ messages: [user], turns: [{ id: user.message.id, state, errorKind: null }] });
  if (state === 'done') expect(screen.queryByRole('status')).toBeNull();
  else expect(screen.getByRole('status').textContent).toBe(state === 'queued' || state === 'running' ? 'Lead is working on it…' : state === 'budget-blocked' ? 'Budget limit reached for today.' : 'You can send your message again.');
});
it('ignores older running turns after the last user turn has completed', async () => {
  const first = item('Earlier'); const last = item('Latest', 'user', 2);
  await chat({ messages: [first, last], turns: [{ id: first.message.id, state: 'running', errorKind: null }, { id: last.message.id, state: 'done', errorKind: null }] }); expect(screen.queryByRole('status')).toBeNull();
});
it('ignores an older turn when the newest user message has no turn yet', async () => {
  const first = item('Earlier'); await chat({ messages: [first, item('Latest', 'user', 2)], turns: [{ id: first.message.id, state: 'failed', errorKind: null }] }); expect(screen.queryByRole('status')).toBeNull();
});
it('keeps the composer usable while Lead is running', async () => {
  const user = item(); await chat({ messages: [user], turns: [{ id: user.message.id, state: 'running', errorKind: null }] }); type(); expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false);
});
it.each([['ok', 'OK'], ['warn', 'Close to the limit'], ['exceeded', 'Limit reached']] as const)('shows the %s budget verdict as text', async (verdict, label) => {
  const { api, store } = await chat(); api.getBudget.mockResolvedValue({ ...envelope, budget: { ...budget, day: { ...budget.day, used: 900, verdict } } }); await act(async () => { await store.loadBudget(); }); expect(screen.getByText(label)).toBeTruthy();
});
it('exposes meter bounds, current value, name and numeric text', async () => {
  await chat(); const meter = screen.getByRole('meter', { name: 'TOKEN BUDGET' }); expect(meter.getAttribute('aria-valuemin')).toBe('0'); expect(meter.getAttribute('aria-valuemax')).toBe('1000'); expect(meter.getAttribute('aria-valuenow')).toBe('0'); expect(screen.getByText('0 / 1,000 tokens')).toBeTruthy();
});
it('clamps an exceeded meter to its maximum while preserving actual usage text', async () => {
  const { api, store } = await chat(); api.getBudget.mockResolvedValue({ ...envelope, budget: { ...budget, day: { ...budget.day, used: 1200, verdict: 'exceeded' } } }); await act(async () => { await store.loadBudget(); }); expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('1000'); expect(screen.getByText('1,200 / 1,000 tokens')).toBeTruthy();
});
it('formats budget numbers in Vietnamese and renders chat without missing labels', async () => {
  await chat({ messages: [item()] }); const warn = vi.spyOn(console, 'warn'); act(() => i18n.setLocale('vi'));
  expect(screen.getByText('0 / 1.000 token')).toBeTruthy(); expect(screen.getByRole('textbox', { name: 'Tin nhắn' })).toBeTruthy(); expect(warn).not.toHaveBeenCalled();
});
it('defaults to the discuss intent', async () => { await chat(); expect((screen.getByRole('radio', { name: 'Discuss' }) as HTMLInputElement).checked).toBe(true); });
it('sends delegate intent when selected and resets intent after success', async () => {
  const { api } = await chat(); type(); fireEvent.click(screen.getByRole('radio', { name: 'Delegate: let the Lead propose tasks' })); send();
  expect(api.sendCommand.mock.calls[0]?.[0]).toMatchObject({ type: 'chat.send', payload: { intent: 'delegate' } }); await waitFor(() => expect(text()).toBe('')); expect((screen.getByRole('radio', { name: 'Discuss' }) as HTMLInputElement).checked).toBe(true);
});
it('links the delegate radio to its explanation', async () => {
  await chat(); const radio = screen.getByRole('radio', { name: 'Delegate: let the Lead propose tasks' }); expect(document.getElementById(radio.getAttribute('aria-describedby')!)?.textContent).toContain('propose tasks for your review');
});
it('sends Enter with the latest conversation revision', async () => {
  const { api, store } = await chat(); api.listConversations.mockResolvedValue({ ...envelope, conversations: [{ ...conversation, revision: 7 }] }); await act(async () => { await store.loadConversations(); }); type('Line one\nLine two'); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(api.sendCommand.mock.calls[0]?.[0]).toMatchObject({ type: 'chat.send', projectId: id, payload: { conversationId: id, expectedRevision: 7, text: 'Line one\nLine two', intent: 'discuss' } }); await act(async () => {});
});
it('allows Shift+Enter without sending or cancelling newline input', async () => {
  const { api } = await chat(); type(); expect(fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true })).toBe(true); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Please help\n' } }); expect(text()).toBe('Please help\n'); expect(api.sendCommand).not.toHaveBeenCalled();
});
it('never sends during compositionstart/end and resumes afterwards', async () => {
  const { api } = await chat(); type(); const input = screen.getByRole('textbox'); fireEvent.compositionStart(input); fireEvent.keyDown(input, { key: 'Enter' }); expect(api.sendCommand).not.toHaveBeenCalled(); fireEvent.compositionEnd(input); fireEvent.keyDown(input, { key: 'Enter' }); expect(api.sendCommand).toHaveBeenCalledOnce(); await act(async () => {});
});
it('never sends Enter with native isComposing', async () => { const { api } = await chat(); type(); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', isComposing: true }); expect(api.sendCommand).not.toHaveBeenCalled(); });
it('never sends the legacy IME keyCode 229', async () => { const { api } = await chat(); type(); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', keyCode: 229 }); expect(api.sendCommand).not.toHaveBeenCalled(); });
it.each(['', '  \n\t'])('disables empty or whitespace-only input %j', async (value) => {
  const { api } = await chat(); type(value); expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }); expect(api.sendCommand).not.toHaveBeenCalled();
});
it('disables send when the session is not authenticated', async () => { const { api } = await chat({ authenticated: false }); type(); expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true); send(); expect(api.sendCommand).not.toHaveBeenCalled(); });
it('refuses 32,001 characters without truncation and exposes linked validation', async () => {
  const { api } = await chat(); type('a'.repeat(32_001)); expect(text()).toHaveLength(32_001); expect(screen.getByText('32,001 / 32,000 characters')).toBeTruthy(); expect(screen.getByText('Messages must be 32,000 characters or fewer.')).toBeTruthy(); const input = screen.getByRole('textbox'); expect(input.getAttribute('aria-invalid')).toBe('true'); expect(input.getAttribute('aria-describedby')).toContain('-limit'); fireEvent.keyDown(input, { key: 'Enter' }); expect(api.sendCommand).not.toHaveBeenCalled();
});
it('accepts exactly 32,000 characters', async () => { const { api } = await chat(); type('a'.repeat(32_000)); send(); expect(api.sendCommand).toHaveBeenCalledOnce(); await act(async () => {}); });
it('builds one command and sends once for duplicate clicks while in flight', async () => {
  const { api } = await chat(); const pending = deferred<unknown>(); api.sendCommand.mockReturnValue(pending.promise); const builder = vi.spyOn(commands, 'chatSend'); type(); send(); send(); fireEvent.submit(screen.getByRole('textbox').closest('form')!);
  expect(builder).toHaveBeenCalledOnce(); expect(api.sendCommand).toHaveBeenCalledOnce(); expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true); await act(async () => { pending.resolve({ ...envelope, receipt }); });
});
it('keeps text until acknowledgement then clears it', async () => {
  const { api } = await chat(); const pending = deferred<unknown>(); api.sendCommand.mockReturnValue(pending.promise); type('Keep until success'); send(); expect(text()).toBe('Keep until success'); await act(async () => { pending.resolve({ ...envelope, receipt }); }); expect(text()).toBe('');
});
it('preserves newer edits made while a send is in flight', async () => {
  const { api } = await chat(); const pending = deferred<unknown>(); api.sendCommand.mockReturnValue(pending.promise); type('First draft'); send(); type('New draft'); await act(async () => { pending.resolve({ ...envelope, receipt }); }); expect(text()).toBe('New draft');
});
it('keeps failed text and shows the Reference', async () => { const { api } = await chat(); api.sendCommand.mockRejectedValueOnce(error()); type('Keep me'); send(); expect((await screen.findByRole('alert')).textContent).toContain(`Reference: ${id}`); expect(text()).toBe('Keep me'); });
it('retries the exact command object and commandId', async () => {
  const { api, store } = await chat(); api.sendCommand.mockRejectedValueOnce(error()); const retry = vi.spyOn(store, 'retry'); type(); send(); fireEvent.click(await screen.findByRole('button', { name: 'Retry' })); await waitFor(() => expect(api.sendCommand).toHaveBeenCalledTimes(2)); const original = api.sendCommand.mock.calls[0]?.[0]; expect(api.sendCommand.mock.calls[1]?.[0]).toBe(original); expect(retry).toHaveBeenCalledWith(original.commandId); await waitFor(() => expect(text()).toBe(''));
});
it('reloads conversations on a stale-revision conflict', async () => { const { api, store } = await chat(); api.sendCommand.mockRejectedValueOnce(error('conflict')); const load = vi.spyOn(store, 'loadConversations'); type(); send(); await waitFor(() => expect(load).toHaveBeenCalledOnce()); expect(text()).toBe('Please help'); });
it('reloads messages and budget after success without stream events', async () => {
  const { store } = await chat(); const messages = vi.spyOn(store, 'loadMessages'); const budgetLoad = vi.spyOn(store, 'loadBudget'); type(); send(); await waitFor(() => expect(budgetLoad).toHaveBeenCalledOnce()); expect(messages).toHaveBeenCalledExactlyOnceWith(id);
});
it('retains draft and intent when switching tabs', async () => {
  const { store, unmount } = await chat(); unmount(); render(<ProjectView store={store} project={projectSchema.parse(project)} />); fireEvent.click(screen.getByRole('button', { name: 'Ask Lead' })); await act(async () => {}); type('Draft across tabs'); fireEvent.click(screen.getByRole('radio', { name: 'Delegate: let the Lead propose tasks' })); fireEvent.click(screen.getByRole('tab', { name: 'Board' })); fireEvent.click(screen.getByRole('button', { name: /Close chat/ })); fireEvent.click(screen.getByRole('button', { name: 'Ask Lead' })); await act(async () => {}); expect(text()).toBe('Draft across tabs'); expect((screen.getByRole('radio', { name: 'Delegate: let the Lead propose tasks' }) as HTMLInputElement).checked).toBe(true);
});
it('keeps drafts separate per conversation', async () => {
  const { api, store } = await chat(); type('First draft'); api.listConversations.mockResolvedValue({ ...envelope, conversations: [{ ...conversation, id: otherId }] }); await act(async () => { await store.loadConversations(); }); expect(text()).toBe(''); type('Second draft'); api.listConversations.mockResolvedValue({ ...envelope, conversations: [conversation] }); await act(async () => { await store.loadConversations(); }); expect(text()).toBe('First draft');
});
it('scrolls to new messages only when already near the bottom', async () => {
  const { api, store } = await chat({ messages: [item()] }); const log = screen.getByRole('log'); Object.defineProperties(log, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } }); log.scrollTop = 790; fireEvent.scroll(log); api.listMessages.mockResolvedValue({ ...envelope, messages: [item(), item('New', 'agent', 2)], turns: [] }); await act(async () => { await store.loadMessages(id); }); expect(log.scrollTop).toBe(1000); expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
});
it('preserves scroll position away from the bottom and offers Jump to latest', async () => {
  const { api, store } = await chat({ messages: [item()] }); const log = screen.getByRole('log'); Object.defineProperties(log, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } }); log.scrollTop = 100; fireEvent.scroll(log); api.listMessages.mockResolvedValue({ ...envelope, messages: [item(), item('New', 'agent', 2)], turns: [] }); await act(async () => { await store.loadMessages(id); }); expect(log.scrollTop).toBe(100); fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' })); expect(log.scrollTop).toBe(1000); expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
});
it('has named controls and unique ids in chat', async () => {
  await chat(); expect(screen.getByRole('textbox', { name: 'Message' })).toBeTruthy(); expect(screen.getByRole('group', { name: 'Intent' })).toBeTruthy(); for (const control of [...screen.getAllByRole('button'), ...screen.getAllByRole('radio')]) expect((control.textContent || (control as HTMLInputElement).labels?.[0]?.textContent || '').trim()).toBeTruthy(); const ids = [...document.querySelectorAll('[id]')].map((node) => node.id); expect(new Set(ids).size).toBe(ids.length);
});
