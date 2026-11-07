import { useSyncExternalStore } from 'react';
import type { Command, Conversation, FactoryEvent, Project, Task } from '@factory/contracts';
import { ApiClientError, createApiClient, type ApiClient, type BudgetResponse, type MessagesResponse, type TeamResponse } from '../api/client';
import { openProjectEvents, type ProjectEventsOptions, type StreamStatus } from '../api/events';

export type StoreError = { kind: string; message: string; correlationId?: string; code?: string };
export type PendingCommand = { command: Command; status: 'pending' | 'failed'; error?: StoreError };
export type StoreState = {
  session: 'unknown' | 'anonymous' | 'authenticated'; projects: Project[]; selectedProjectId: string | null;
  team: TeamResponse | null; tasks: Task[]; conversations: Conversation[];
  messages: Record<string, MessagesResponse['messages']>; turns: Record<string, MessagesResponse['turns']>;
  budget: BudgetResponse['budget'] | null; stream: StreamStatus;
  errors: Record<string, StoreError | undefined>; loading: Record<string, boolean>;
  pending: Record<string, PendingCommand | undefined>;
};
export type StoreOptions = {
  api?: ApiClient; baseUrl?: string; debounceMs?: number;
  openEvents?: (options: ProjectEventsOptions) => { close(): void };
  timer?: { setTimeout: (callback: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void };
};
const projectState = () => ({ team: null, tasks: [], conversations: [], messages: {}, turns: {}, budget: null, stream: 'closed' as const });
const errorDetails = (error: unknown): StoreError => error instanceof ApiClientError
  ? { kind: error.kind, message: error.message, ...(error.code ? { code: error.code } : {}), ...(error.correlationId ? { correlationId: error.correlationId } : {}) }
  : { kind: 'unexpected', message: 'The operation could not be completed.' };

export function createStore(options: StoreOptions = {}) {
  let state: StoreState = { session: 'unknown', projects: [], selectedProjectId: null, ...projectState(), errors: {}, loading: {}, pending: {} };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<StoreState>) => { state = { ...state, ...patch }; listeners.forEach((listener) => listener()); };
  let generation = 0;
  let authGeneration = 0;
  let stream: { close(): void } | undefined;
  const timer = options.timer ?? { setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms), clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  type Job = { run: () => Promise<void>; promise?: Promise<void>; dirty: boolean; timer?: unknown };
  const jobs = new Map<string, Job>();
  const stop = () => {
    generation++;
    stream?.close(); stream = undefined;
    for (const job of jobs.values()) if (job.timer !== undefined) timer.clearTimeout(job.timer);
    jobs.clear();
  };
  const anonymous = () => {
    authGeneration++;
    stop();
    update({ session: 'anonymous', selectedProjectId: null, projects: [], ...projectState(), loading: {}, errors: {}, pending: {} });
  };
  // Handle authentication failures inside the guarded action, where obsolete requests
  // can be discarded before they affect a newly selected project or session.
  const api = options.api ?? createApiClient({ baseUrl: options.baseUrl ?? (import.meta.env.DEV ? '/api' : '') });
  const active = (scope: number) => scope === generation;
  function failed(area: string, error: unknown) {
    if (error instanceof ApiClientError && error.status === 401) anonymous();
    update({ errors: { ...state.errors, [area]: errorDetails(error) } });
  }
  async function guarded(area: string, scope: number, work: () => Promise<Partial<StoreState>>) {
    if (!active(scope)) return;
    update({ loading: { ...state.loading, [area]: true }, errors: { ...state.errors, [area]: undefined } });
    try { const patch = await work(); if (active(scope)) update(patch); }
    catch (error) { if (active(scope)) failed(area, error); }
    finally { if (active(scope)) update({ loading: { ...state.loading, [area]: false } }); }
  }
  // All reads of a collection share one queue, including initial loads and snapshot recovery.
  function enqueue(area: string, scope: number, work: () => Promise<Partial<StoreState>>, debounce = false): Promise<void> {
    if (!active(scope)) return Promise.resolve();
    let job = jobs.get(area);
    if (!job) { job = { run: () => guarded(area, scope, work), dirty: false }; jobs.set(area, job); }
    job.run = () => guarded(area, scope, work);
    const current = job;
    if (current.promise) { current.dirty = true; return current.promise; }
    const launch = () => {
      if (current.timer !== undefined) { timer.clearTimeout(current.timer); delete current.timer; }
      const promise = (async () => {
        do { current.dirty = false; await current.run(); } while (current.dirty && active(scope));
      })();
      current.promise = promise;
      void promise.finally(() => { delete current.promise; });
      return promise;
    };
    if (debounce) {
      if (current.timer !== undefined) timer.clearTimeout(current.timer);
      current.timer = timer.setTimeout(() => { void launch(); }, options.debounceMs ?? 150);
      return Promise.resolve();
    }
    return launch();
  }
  const loadProjects = (debounce = false) => enqueue('projects', generation, async () => ({ projects: (await api.listProjects()).projects }), debounce);
  function loadArea(area: 'team' | 'tasks' | 'conversations' | 'budget', debounce = false) {
    const id = state.selectedProjectId;
    if (!id) return Promise.resolve();
    return enqueue(area, generation, async () => {
      switch (area) {
        case 'team': return { team: await api.getTeam(id) };
        case 'tasks': return { tasks: (await api.listTasks(id)).items };
        case 'conversations': return { conversations: (await api.listConversations(id)).conversations };
        case 'budget': return { budget: (await api.getBudget(id)).budget };
      }
    }, debounce);
  }
  function loadMessages(conversationId: string, debounce = false) {
    const id = state.selectedProjectId;
    if (!id) return Promise.resolve();
    return enqueue(`messages:${conversationId}`, generation, async () => {
      const messages = new Map<string, MessagesResponse['messages'][number]>();
      const turns = new Map<string, MessagesResponse['turns'][number]>();
      let afterOrdinal = 0;
      while (true) {
        const page = await api.listMessages(id, conversationId, { afterOrdinal, limit: 100 });
        for (const item of page.messages) messages.set(item.message.id, item);
        for (const turn of page.turns) turns.set(turn.id, turn);
        const last = page.messages.at(-1)?.ordinal ?? afterOrdinal;
        if (page.messages.length < 100 || last <= afterOrdinal) break;
        afterOrdinal = last;
      }
      return { messages: { ...state.messages, [conversationId]: [...messages.values()].sort((a, b) => a.ordinal - b.ordinal) },
        turns: { ...state.turns, [conversationId]: [...turns.values()] } };
    }, debounce);
  }
  async function refresh() {
    await Promise.all([loadProjects(), loadArea('team'), loadArea('tasks'), loadArea('conversations'), loadArea('budget'),
      ...Object.keys(state.messages).map((id) => loadMessages(id))]);
  }
  function connect(id: string, scope: number) {
    if (!active(scope) || state.selectedProjectId !== id) return;
    stream = (options.openEvents ?? openProjectEvents)({ projectId: id, baseUrl: options.baseUrl ?? (import.meta.env.DEV ? '/api' : ''),
      onEvent: (event) => { if (active(scope)) applyEvent(event); },
      onStatus: (status) => { if (active(scope)) update({ stream: status }); },
      onSnapshotRequired: () => {
        if (!active(scope)) return;
        stream?.close(); stream = undefined;
        void refresh().then(() => { if (active(scope)) connect(id, scope); });
      },
    });
  }
  function applyEvent(event: FactoryEvent) {
    if (event.projectId !== state.selectedProjectId) return;
    const payload = event.payload;
    if (payload.type === 'message.appended') void loadMessages(payload.message.conversationId, true);
    else if (payload.type === 'command.receipted') void loadArea('budget', true);
    else if (payload.type === 'entity.changed') {
      switch (payload.entity.kind) {
        case 'task': void loadArea('tasks', true); break;
        case 'project': void loadProjects(true); break;
        case 'team': case 'seat': case 'engagement': void loadArea('team', true); break;
        case 'conversation': void loadArea('conversations', true); break;
        case 'budget': void loadArea('budget', true); break;
      }
    }
  }
  async function authAction(work: () => Promise<unknown>) {
    const scope = ++authGeneration;
    update({ loading: { ...state.loading, session: true }, errors: { ...state.errors, session: undefined } });
    try { await work(); if (scope === authGeneration) update({ session: 'authenticated' }); }
    catch (error) {
      if (scope === authGeneration) {
        if (!(error instanceof ApiClientError && error.status === 401)) anonymous();
        failed('session', error);
      }
    }
    finally { if (scope === authGeneration) update({ loading: { ...state.loading, session: false } }); }
  }
  async function send(command: Command) {
    if (state.pending[command.commandId]?.status === 'pending') return;
    const scope = generation;
    update({ pending: { ...state.pending, [command.commandId]: { command, status: 'pending' } }, errors: { ...state.errors, command: undefined } });
    try {
      const response = await api.sendCommand(command);
      if (active(scope)) { const pending = { ...state.pending }; delete pending[command.commandId]; update({ pending }); }
      return response;
    } catch (error) {
      if (active(scope)) {
        failed('command', error);
        if (active(scope)) update({ pending: { ...state.pending, [command.commandId]: { command, status: 'failed', error: errorDetails(error) } } });
      }
      return undefined;
    }
  }
  const store = {
    getState: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    boot: () => authAction(() => api.session()),
    signIn: (token: string) => authAction(() => api.bootstrap(token)),
    async signOut() {
      authGeneration++;
      try { await api.logout(); } catch (error) { anonymous(); failed('session', error); return; }
      anonymous();
    },
    loadProjects: () => loadProjects(),
    async selectProject(id: string) {
      stop(); const scope = generation;
      update({ selectedProjectId: id, ...projectState(), errors: {}, loading: {}, pending: {} });
      connect(id, scope);
      await Promise.all([loadArea('team'), loadArea('tasks'), loadArea('conversations'), loadArea('budget')]);
    },
    loadMessages: (id: string) => loadMessages(id), send,
    retry: (commandId: string) => { const pending = state.pending[commandId]; return pending?.status === 'failed' ? send(pending.command) : Promise.resolve(undefined); },
    applyEvent,
    dispose: () => { stop(); listeners.clear(); },
    useStoreSelector<T>(selector: (state: StoreState) => T): T {
      // Subscribe to the stable state object so selectors may safely return new objects.
      return selector(useSyncExternalStore(store.subscribe, store.getState, store.getState));
    },
  };
  return store;
}
export type Store = ReturnType<typeof createStore>;
export const defaultStore = createStore();
export function useStoreSelector<T>(selector: (state: StoreState) => T): T { return defaultStore.useStoreSelector(selector); }
