import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createStore, type Store } from '../src/state/store';
import { ApiClientError, createApiClient, type ApiClient, type MessagesResponse, type TeamResponse } from '../src/api/client';
import type { ProjectEventsOptions } from '../src/api/events';
import { projectsCreate } from '../src/api/commands';
import { deferred, envelope, event, failure, id, otherId, project, team, engagement, budget, message, receipt, response, conversation, task } from './fixtures';
import { messageSchema } from '@factory/contracts';

const stores: Store[] = [];
afterEach(() => { stores.forEach((store) => store.dispose()); stores.length = 0; vi.useRealTimers(); });
function setup() {
  const api = {
    listTeams: vi.fn().mockResolvedValue({ teams: [] }), listPacks: vi.fn().mockResolvedValue({ packs: [] }), getTeamQueue: vi.fn().mockResolvedValue({ items: [] }),
    listRequests: vi.fn().mockResolvedValue({ ...envelope, items: [] }), getRequest: vi.fn(), getDossier: vi.fn().mockResolvedValue({ ...envelope, dossier: null }), getBriefing: vi.fn(), getTaskContext: vi.fn().mockResolvedValue({ ...envelope, packs: [] }),
    csrfToken: null,
    health: vi.fn().mockResolvedValue(envelope), bootstrap: vi.fn().mockResolvedValue({ ...envelope, csrfToken: 'csrf' }),
    session: vi.fn().mockResolvedValue({ ...envelope, csrfToken: 'csrf' }), logout: vi.fn().mockResolvedValue(envelope),
    listProjects: vi.fn().mockResolvedValue({ ...envelope, projects: [project] }),
    getTeam: vi.fn().mockResolvedValue({ ...envelope, team, seats: [], engagement }),
    listTasks: vi.fn().mockResolvedValue({ ...envelope, items: [task] }),
    listAttempts: vi.fn().mockResolvedValue({ ...envelope, attempts: [] }),
    listAttemptEvents: vi.fn().mockResolvedValue({ ...envelope, events: [] }),
    getAttemptPatch: vi.fn().mockResolvedValue(null),
    listTaskArtifacts: vi.fn().mockResolvedValue({ ...envelope, items: [] }),
    searchKnowledge: vi.fn(), listKnowledgeArtifacts: vi.fn(), getKnowledgeArtifact: vi.fn(),
    getArtifactContent: vi.fn().mockResolvedValue({ ...envelope, mediaType: 'text/plain', text: '', sizeBytes: 0, contentHash: 'a'.repeat(64) }),
    listTaskApprovals: vi.fn().mockResolvedValue({ ...envelope, approvals: [] }),
    getInbox: vi.fn().mockResolvedValue({ ...envelope, approvals: [], startGates: [], counts: { approvals: 0, startGates: 0, total: 0 } }),
    getGlobalInbox: vi.fn().mockResolvedValue({ ...envelope, approvals: [], startGates: [], counts: { approvals: 0, startGates: 0, total: 0 } }),
    getApproval: vi.fn(), getEffectRemotes: vi.fn().mockResolvedValue({ ...envelope, remotes: [] }),
    listAttemptEffects: vi.fn().mockResolvedValue({ ...envelope, effects: [] }), pushAttempt: vi.fn(), reconcileEffect: vi.fn(),
    listConversations: vi.fn().mockResolvedValue({ ...envelope, conversations: [conversation] }),
    listMessages: vi.fn().mockResolvedValue({ ...envelope, messages: [{ ordinal: 1, message }], turns: [{ id, state: 'done', errorKind: null }] }),
    getBudget: vi.fn().mockResolvedValue({ ...envelope, budget }),
    sendCommand: vi.fn().mockResolvedValue({ ...envelope, receipt }),
  };
  const connections: Array<{ options: ProjectEventsOptions; close: ReturnType<typeof vi.fn> }> = [];
  const openEvents = vi.fn((options: ProjectEventsOptions) => { const close = vi.fn(); connections.push({ options, close }); options.onStatus?.('connecting', { lastEventId: null, invalidMessages: 0 }); return { close }; });
  const store = createStore({ api: api as ApiClient, openEvents }); stores.push(store);
  return { api, store, connections, openEvents };
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
it('boot authenticates via session without retaining csrf in state', async () => {
  const { api, store } = setup(); await store.boot();
  expect(api.session).toHaveBeenCalledOnce(); expect(store.getState().session).toBe('authenticated'); expect(JSON.stringify(store.getState())).not.toContain('csrf');
});
it('boot becomes anonymous on 401', async () => {
  const { api, store } = setup(); api.session.mockRejectedValue(new ApiClientError('api', 401, { code: 'needs-auth', message: 'Auth', correlationId: id, nextAction: 'authenticate' }));
  await store.boot(); expect(store.getState().session).toBe('anonymous'); expect(store.getState().loading.session).toBeFalsy();
});
it('signIn passes the token only to the client and authenticates', async () => {
  const { api, store } = setup(); await store.signIn('private-bootstrap');
  expect(api.bootstrap).toHaveBeenCalledWith('private-bootstrap'); expect(store.getState().session).toBe('authenticated'); expect(JSON.stringify(store.getState())).not.toContain('private-bootstrap');
});
it('failed signIn does not expose a token from a transport error', async () => {
  const { api, store } = setup(); api.bootstrap.mockRejectedValue(new Error('private-bootstrap'));
  await store.signIn('private-bootstrap'); expect(store.getState().session).toBe('anonymous'); expect(JSON.stringify(store.getState())).not.toContain('private-bootstrap');
});
it('a late boot response cannot overwrite a completed sign-out', async () => {
  const { api, store } = setup(); const pending = deferred<unknown>(); api.session.mockReturnValueOnce(pending.promise);
  const booting = store.boot(); await store.signOut(); pending.resolve({ ...envelope, csrfToken: 'csrf' }); await booting;
  expect(store.getState().session).toBe('anonymous');
});
it('a late failed sign-in cannot overwrite a newer successful sign-in', async () => {
  const { api, store } = setup(); const pending = deferred<unknown>(); api.bootstrap.mockReturnValueOnce(pending.promise);
  const old = store.signIn('old-token'); await store.signIn('new-token'); pending.reject(new ApiClientError('api', 401)); await old;
  expect(store.getState().session).toBe('authenticated'); expect(store.getState().errors.session).toBeUndefined();
});
it('signOut clears selected data, pending commands and the stream', async () => {
  const { api, store, connections } = setup(); await store.boot(); await store.selectProject(id); await store.signOut();
  expect(api.logout).toHaveBeenCalledOnce(); expect(connections[0]!.close).toHaveBeenCalledOnce(); expect(store.getState()).toMatchObject({ session: 'anonymous', selectedProjectId: null, tasks: [], messages: {}, pending: {}, stream: 'closed' });
});
it('loadProjects publishes validated projects', async () => {
  const { store } = setup(); await store.loadProjects(); expect(store.getState().projects).toEqual([project]);
});
it('selectProject starts all four reads in parallel and opens the stream', async () => {
  const { api, store, connections } = setup(); const pending = deferred<TeamResponse>(); api.getTeam.mockReturnValue(pending.promise);
  const selecting = store.selectProject(id);
  expect(api.getTeam).toHaveBeenCalledWith(id); expect(api.listTasks).toHaveBeenCalledWith(id); expect(api.listConversations).toHaveBeenCalledWith(id); expect(api.getBudget).toHaveBeenCalledWith(id);
  expect(connections[0]!.options.projectId).toBe(id); expect(store.getState().loading.team).toBe(true);
  pending.resolve({ ...envelope, team, seats: [], engagement } as TeamResponse); await selecting;
  expect(store.getState()).toMatchObject({ tasks: [task], conversations: [conversation], budget, team: { team }, loading: { team: false, tasks: false } });
});
it('project changes discard stale successes, errors and stream callbacks', async () => {
  const { api, store, connections } = setup(); const oldTeam = deferred<TeamResponse>(); api.getTeam.mockReturnValueOnce(oldTeam.promise);
  const old = store.selectProject(id); await store.selectProject(otherId);
  oldTeam.resolve({ ...envelope, team: { ...team, name: 'Stale' }, seats: [], engagement } as TeamResponse); await old;
  connections[0]!.options.onStatus?.('open', { lastEventId: null, invalidMessages: 0 });
  expect(store.getState().team?.team.name).toBe('Team'); expect(store.getState().stream).toBe('connecting'); expect(connections[0]!.close).toHaveBeenCalledOnce();
});
it('stale unauthorized responses cannot clear a new selection', async () => {
  const { api, store } = setup(); const oldTeam = deferred<TeamResponse>(); api.getTeam.mockReturnValueOnce(oldTeam.promise);
  const old = store.selectProject(id); await store.selectProject(otherId); oldTeam.reject(new ApiClientError('api', 401)); await old;
  expect(store.getState().selectedProjectId).toBe(otherId);
});
it.each([
  ['task', 'listTasks'], ['project', 'listProjects'], ['team', 'getTeam'], ['seat', 'getTeam'], ['engagement', 'getTeam'], ['conversation', 'listConversations'], ['budget', 'getBudget'],
] as const)('%s events debounce the matching %s read', async (kind, method) => {
  vi.useFakeTimers(); const { api, store } = setup(); await store.selectProject(id); const before = api[method].mock.calls.length;
  const update = event({ type: 'entity.changed', entity: { kind, id, revision: 2 } });
  store.applyEvent(update); store.applyEvent(update); store.applyEvent(update);
  expect(api[method]).toHaveBeenCalledTimes(before); await vi.advanceTimersByTimeAsync(149); expect(api[method]).toHaveBeenCalledTimes(before);
  await vi.advanceTimersByTimeAsync(1); expect(api[method]).toHaveBeenCalledTimes(before + 1);
});
it('message appended refreshes only that conversation', async () => {
  vi.useFakeTimers(); const { api, store } = setup(); await store.selectProject(id);
  store.applyEvent(event({ type: 'message.appended', message: messageSchema.parse(message) })); await vi.advanceTimersByTimeAsync(150);
  expect(api.listMessages).toHaveBeenCalledWith(id, id, { afterOrdinal: 0, limit: 100 }); expect(api.listTasks).toHaveBeenCalledOnce();
});
it('command receipted refreshes budget', async () => {
  vi.useFakeTimers(); const { api, store } = setup(); await store.selectProject(id);
  store.applyEvent(event({ type: 'command.receipted', receipt: { ...receipt, state: 'completed' } })); await vi.advanceTimersByTimeAsync(150);
  expect(api.getBudget).toHaveBeenCalledTimes(2);
});
it('events for a different project do nothing', async () => {
  vi.useFakeTimers(); const { api, store } = setup(); await store.selectProject(id); store.applyEvent(event(undefined, otherId)); await vi.runAllTimersAsync();
  expect(api.listTasks).toHaveBeenCalledOnce();
});
it('a collection never overlaps and dirty events rerun once', async () => {
  vi.useFakeTimers(); const { api, store } = setup(); await store.selectProject(id);
  const pending = deferred<{ apiVersion: 1; ok: true; items: [] }>(); api.listTasks.mockReturnValueOnce(pending.promise);
  store.applyEvent(event()); await vi.advanceTimersByTimeAsync(150); expect(api.listTasks).toHaveBeenCalledTimes(2);
  store.applyEvent(event()); store.applyEvent(event()); await vi.advanceTimersByTimeAsync(500); expect(api.listTasks).toHaveBeenCalledTimes(2);
  pending.resolve({ apiVersion: 1, ok: true, items: [] }); await flush(); expect(api.listTasks).toHaveBeenCalledTimes(3);
});
it('events during initial loading use the same in-flight queue', async () => {
  vi.useFakeTimers(); const { api, store } = setup(); const pending = deferred<{ apiVersion: 1; ok: true; items: [] }>(); api.listTasks.mockReturnValueOnce(pending.promise);
  const selecting = store.selectProject(id); store.applyEvent(event()); await vi.advanceTimersByTimeAsync(150); expect(api.listTasks).toHaveBeenCalledOnce();
  pending.resolve({ apiVersion: 1, ok: true, items: [] }); await selecting; expect(api.listTasks).toHaveBeenCalledTimes(2);
});
it('snapshot-required refreshes all loaded areas and reopens after reads finish', async () => {
  const { api, store, connections, openEvents } = setup(); await store.selectProject(id); await store.loadMessages(id);
  const pending = deferred<TeamResponse>(); api.getTeam.mockReturnValueOnce(pending.promise);
  connections[0]!.options.onSnapshotRequired('gap'); await flush(); expect(openEvents).toHaveBeenCalledOnce(); expect(connections[0]!.close).toHaveBeenCalledOnce();
  expect(api.listProjects).toHaveBeenCalledOnce(); expect(api.listTasks).toHaveBeenCalledTimes(2); expect(api.listConversations).toHaveBeenCalledTimes(2); expect(api.getBudget).toHaveBeenCalledTimes(2); expect(api.listMessages).toHaveBeenCalledTimes(2);
  pending.resolve({ ...envelope, team, seats: [], engagement } as TeamResponse); await flush(); expect(openEvents).toHaveBeenCalledTimes(2);
});
it('snapshot recovery does not reopen an obsolete project', async () => {
  const { api, store, connections, openEvents } = setup(); await store.selectProject(id); const pending = deferred<TeamResponse>(); api.getTeam.mockReturnValueOnce(pending.promise);
  connections[0]!.options.onSnapshotRequired('expired'); await store.selectProject(otherId); pending.resolve({ ...envelope, team, seats: [], engagement } as TeamResponse); await flush();
  expect(openEvents).toHaveBeenCalledTimes(2); expect(store.getState().selectedProjectId).toBe(otherId);
});
it('401 closes the stream, resets session and preserves correlationId', async () => {
  const { api, store, connections } = setup(); await store.boot(); await store.selectProject(id);
  api.listMessages.mockRejectedValue(new ApiClientError('api', 401, { code: 'needs-auth', message: 'Auth', nextAction: 'authenticate', correlationId: id }));
  await store.loadMessages(id); expect(store.getState().session).toBe('anonymous'); expect(connections[0]!.close).toHaveBeenCalledOnce(); expect(store.getState().errors[`messages:${id}`]?.correlationId).toBe(id);
});
it('send failure retains the same command object and retry is idempotent', async () => {
  const { api, store } = setup(); const command = projectsCreate({ name: 'A', root: '/work' }); api.sendCommand.mockRejectedValueOnce(new ApiClientError('network'));
  await store.send(command); expect(store.getState().pending[command.commandId]?.command).toBe(command); expect(store.getState().pending[command.commandId]?.status).toBe('failed');
  await store.retry(command.commandId); expect(api.sendCommand.mock.calls[0]![0]).toBe(command); expect(api.sendCommand.mock.calls[1]![0]).toBe(command); expect(store.getState().pending[command.commandId]).toBeUndefined();
});
it('send sets pending before completion and suppresses duplicate concurrent sends', async () => {
  const { api, store } = setup(); const pending = deferred<unknown>(); api.sendCommand.mockReturnValue(pending.promise); const command = projectsCreate({ name: 'A', root: '/work' });
  const sending = store.send(command); expect(store.getState().pending[command.commandId]?.status).toBe('pending'); await store.send(command); expect(api.sendCommand).toHaveBeenCalledOnce(); pending.resolve({ ...envelope, receipt }); await sending;
});
it('command errors carry correlationId', async () => {
  const { api, store } = setup(); api.sendCommand.mockRejectedValue(new ApiClientError('api', 409, { code: 'conflict', message: 'Changed', correlationId: id, nextAction: 'refresh' }));
  await store.send(projectsCreate({ name: 'A', root: '/work' })); expect(store.getState().errors.command?.correlationId).toBe(id);
});
it('messages are ordered by ordinal and turns are retained by conversation', async () => {
  const { api, store } = setup(); await store.selectProject(id); api.listMessages.mockResolvedValue({ ...envelope, messages: [{ ordinal: 2, message: { ...message, id: otherId } }, { ordinal: 1, message }], turns: [{ id, state: 'running', errorKind: null }] });
  await store.loadMessages(id); expect(store.getState().messages[id]?.map((item) => item.ordinal)).toEqual([1, 2]); expect(store.getState().turns[id]).toEqual([{ id, state: 'running', errorKind: null }]);
});
it('messages paginate so an event can refresh conversations longer than 100 messages', async () => {
  const { api, store } = setup(); await store.selectProject(id);
  const page = Array.from({ length: 100 }, (_, index) => ({ ordinal: index + 1, message: { ...message, id: crypto.randomUUID() } }));
  api.listMessages.mockResolvedValueOnce({ ...envelope, messages: page, turns: [] }).mockResolvedValueOnce({ ...envelope, messages: [{ ordinal: 101, message }], turns: [] });
  await store.loadMessages(id); expect(api.listMessages).toHaveBeenLastCalledWith(id, id, { afterOrdinal: 100, limit: 100 }); expect(store.getState().messages[id]).toHaveLength(101);
});
it('useStoreSelector reacts to changes, including object-valued selectors', async () => {
  const { store } = setup(); const hook = renderHook(() => store.useStoreSelector((state) => ({ session: state.session })));
  expect(hook.result.current.session).toBe('unknown'); await act(() => store.boot()); expect(hook.result.current.session).toBe('authenticated');
});
it('unsubscribe and dispose stop notifying observers', async () => {
  const { store } = setup(); const observer = vi.fn(); const unsubscribe = store.subscribe(observer); unsubscribe(); await store.boot(); expect(observer).not.toHaveBeenCalled();
});
it('Host validation errors reach the store only as a safe bad-response error', async () => {
  const api = createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, projects: [{ ...project, revision: 'bad' }] })) });
  const store = createStore({ api }); stores.push(store); await store.loadProjects(); expect(store.getState().projects).toEqual([]); expect(store.getState().errors.projects?.kind).toBe('bad-response');
});
it('HTTP failure fields survive the client-store boundary', async () => {
  const api = createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(failure, 409)) }); const store = createStore({ api }); stores.push(store);
  await store.loadProjects(); expect(store.getState().errors.projects).toMatchObject({ correlationId: id, code: 'conflict' });
});
it('real client 401 handling makes the store anonymous and preserves the error reference', async () => {
  const authFailure = { ...failure, error: { ...failure.error, code: 'needs-auth', nextAction: 'authenticate' } };
  const api = createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(authFailure, 401)) });
  const store = createStore({ api }); stores.push(store); await store.boot();
  expect(store.getState()).toMatchObject({ session: 'anonymous', errors: { session: { correlationId: id, code: 'needs-auth' } } });
});
it('an injectable timer receives the default debounce interval', async () => {
  const { api } = setup(); const timer = { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() };
  const store = createStore({ api: api as ApiClient, timer, openEvents: () => ({ close() {} }) }); stores.push(store); await store.selectProject(id); store.applyEvent(event()); expect(timer.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 150);
});
it('a stale message load cannot replace messages from the newly selected project', async () => {
  const { api, store } = setup(); await store.selectProject(id); const pending = deferred<MessagesResponse>(); api.listMessages.mockReturnValueOnce(pending.promise);
  const loading = store.loadMessages(id); await store.selectProject(otherId); pending.resolve({ ...envelope, messages: [{ ordinal: 1, message }], turns: [] } as MessagesResponse); await loading;
  expect(store.getState().messages).toEqual({});
});
