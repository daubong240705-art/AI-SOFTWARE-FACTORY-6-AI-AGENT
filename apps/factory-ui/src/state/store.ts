import type { OrgTeam, RequestItem, RequestDetail, Dossier, Briefing, TaskContext } from '../api/m3Models';
import type { PackDetail, McpServer } from '../api/agentProfileModels';
import { useSyncExternalStore } from 'react';
import type { Approval, Command, Conversation, FactoryEvent, Project, Task } from '@factory/contracts';
import { ApiClientError, DocumentUploadError, createApiClient, type ApiClient, type ArtifactContent, type Attempt, type AttemptEvent, type AttemptPatch, type TaskArtifact, type BudgetResponse, type MessagesResponse, type TeamResponse } from '../api/client';
import { openProjectEvents, type ProjectEventsOptions, type StreamStatus } from '../api/events';
import type { Inbox, Effect } from '../api/client';
import type { CodeEffect } from '../api/codeModels';
import type { DocumentUploadMeta, KnowledgeArtifact, KnowledgeFilters, KnowledgeItem, KnowledgeResult } from '../api/client';
import { emptyM5, type M5State } from './m5';
import { emptySettings, type SettingsState } from './settings';
import { notifyCommandSuccess, notifyEffectReconciled } from './toasts';
import { emptyActivity, type ActivityState } from './activity';
import { createExtractionPolling } from './extractionPolling';
import { toast } from 'sonner';
import { i18n } from '../i18n';
import { settingsPendingKey, type SettingsCommand } from './settingsCommands';
import { knowledgePendingKey, type KnowledgeCommand } from './knowledgeCommands';
import { emptyNotifications, emptyIntegration, notificationPendingKey, integrationPendingKey, type NotificationCommand, type IntegrationCommand } from './notifications';
import type { NotificationsResponse, IntegrationResponse } from '../api/notificationModels';
import { notificationsMarkRead } from '../api/commands';
import { emptySystem, systemAreas, type SystemArea, type SystemState } from './system';

type AutomationCommand = Extract<Command, { type: `schedules.${string}` | `rules.${string}` | `monitors.${string}` }>;

export type DocumentUploadState = { busy: boolean; progress: number; error: { status: number; code: string } | null };
export type KnowledgeState = { query: string; filters: KnowledgeFilters; results: KnowledgeResult[]; list: KnowledgeItem[]; detail: Record<string, KnowledgeArtifact>; loading: Record<string, boolean>; errors: Record<string, StoreError | undefined>; hasMore: boolean; upload: DocumentUploadState };
const emptyUpload = (): DocumentUploadState => ({ busy: false, progress: 0, error: null });
const emptyKnowledge = (): KnowledgeState => ({ query: '', filters: {}, results: [], list: [], detail: {}, loading: {}, errors: {}, hasMore: false, upload: emptyUpload() });

export type StoreError = { kind: string; message: string; correlationId?: string; code?: string; detailKey?: string };
export type PendingCommand = { command: Command; status: 'pending' | 'failed'; error?: StoreError };
export type TaskDetailState = { loading: boolean; error?: StoreError | undefined; attempts: Attempt[]; events: Record<string, AttemptEvent[]>; artifacts: TaskArtifact[]; approvals: Approval[]; patches: Record<string, AttemptPatch | null>; effects: Record<string, Effect[]> };
const emptyDetail = (): TaskDetailState => ({ loading: false, attempts: [], events: {}, artifacts: [], approvals: [], patches: {}, effects: {} });
const emptyInbox = (): Inbox => ({ approvals: [], startGates: [], requests: [], patches: [], monitors: [], stalledWorkflows: [], quarantinedRules: [], teamBreakers: [], integrationConflicts: [], counts: { approvals: 0, startGates: 0, total: 0 } });
export type M3State = { teams: OrgTeam[]; packs: Awaited<ReturnType<ApiClient['listPacks']>>['packs']; queues: Record<string, Awaited<ReturnType<ApiClient['getTeamQueue']>>['items']>; disabled: boolean; requestTargets: RequestItem[]; requests: RequestItem[]; requestDetails: Record<string, RequestDetail>; dossier: Dossier | null; briefing: Briefing | null; contexts: Record<string, TaskContext[]> };
const emptyM3 = (): M3State => ({ teams: [], packs: [], queues: {}, disabled: false, requestTargets: [], requests: [], requestDetails: {}, dossier: null, briefing: null, contexts: {} });
export type StoreState = {
  system: SystemState;
  packDetails: Record<string, PackDetail>;
  mcpServers: McpServer[] | null;
  notifications: NotificationsResponse;
  integration: IntegrationResponse;
  projectEffects: CodeEffect[] | null;
  notificationProgress: { done: number; total: number } | null;
  activity: ActivityState;
  settings: SettingsState;
  m5: M5State;
  m3: M3State;
  session: 'unknown' | 'anonymous' | 'authenticated'; projects: Project[]; selectedProjectId: string | null;
  team: TeamResponse | null; tasks: Task[]; conversations: Conversation[];
  messages: Record<string, MessagesResponse['messages']>; turns: Record<string, MessagesResponse['turns']>;
  budget: BudgetResponse['budget'] | null; stream: StreamStatus;
  errors: Record<string, StoreError | undefined>; loading: Record<string, boolean>;
  pending: Record<string, PendingCommand | undefined>;
  details: Record<string, TaskDetailState>; artifactContents: Record<string, ArtifactContent>;
  liveAttempts: Record<string, Attempt>;
  knowledge: KnowledgeState;
  inbox: Inbox; globalInbox: Inbox; remotes: string[] | null; approvals: Record<string, Approval>; announcement: number;
};
export type StoreOptions = {
  api?: ApiClient; baseUrl?: string; debounceMs?: number;
  openEvents?: (options: ProjectEventsOptions) => { close(): void };
  timer?: { setTimeout: (callback: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void };
};
const projectState = () => ({ notifications: emptyNotifications(), integration: emptyIntegration(), projectEffects: null, notificationProgress: null, activity: emptyActivity(), settings: emptySettings(), m5: emptyM5(), m3: emptyM3(), knowledge: emptyKnowledge(), team: null, tasks: [], conversations: [], messages: {}, turns: {}, budget: null, details: {}, artifactContents: {}, liveAttempts: {}, inbox: emptyInbox(), approvals: {}, stream: 'closed' as const });
const errorDetails = (error: unknown): StoreError => error instanceof ApiClientError
  ? { kind: error.kind, message: error.message, ...(error.code ? { code: error.code } : {}), ...(error.correlationId ? { correlationId: error.correlationId } : {}), ...(error.detailKey ? { detailKey: error.detailKey } : {}) }
  : { kind: 'unexpected', message: 'The operation could not be completed.' };

export function createStore(options: StoreOptions = {}) {
  let state: StoreState = { system: emptySystem(), packDetails: {}, mcpServers: null, session: 'unknown', projects: [], selectedProjectId: null, ...projectState(), globalInbox: emptyInbox(), remotes: null, announcement: 0, errors: {}, loading: {}, pending: {} };
  const listeners = new Set<() => void>();
  const submittedCommands = new Set<string>();
  const update = (patch: Partial<StoreState>) => { state = { ...state, ...patch }; listeners.forEach((listener) => listener()); extractionPolling.sync(); };
  let generation = 0;
  let authGeneration = 0;
  let stream: { close(): void } | undefined;
  const timer = options.timer ?? { setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms), clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  type Job = { run: () => Promise<void>; promise?: Promise<void>; dirty: boolean; timer?: unknown };
  const jobs = new Map<string, Job>();
  const openM3 = new Map<string, () => Promise<void>>();
  const openM5 = new Map<string, () => Promise<void>>();
  const openTasks = new Set<string>();
  const openKnowledge = new Set<string>();
  let knowledgeOpen = false;
  let knowledgeRevision = 0;
  const openTaskCounts = new Map<string, number>();
  let inboxTimer: unknown;
  let remotesPromise: Promise<void> | undefined;
  let watching = false;
  const clearInboxTimer = () => { if (inboxTimer !== undefined) timer.clearTimeout(inboxTimer); inboxTimer = undefined; };
  function scheduleInbox() {
    clearInboxTimer();
    if (state.session !== 'authenticated' || (typeof document !== 'undefined' && document.hidden)) return;
    inboxTimer = timer.setTimeout(() => { inboxTimer = undefined; void loadGlobalInbox(); scheduleInbox(); }, 60_000);
  }
  function focusInbox() { if (state.session === 'authenticated') { void loadGlobalInbox(); void loadInbox(); } }
  function visibilityInbox() { if (!document.hidden) focusInbox(); scheduleInbox(); }
  function watchInbox() {
    if (!watching) { if (typeof window !== 'undefined') window.addEventListener('focus', focusInbox); if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibilityInbox); watching = true; }
    scheduleInbox();
  }
  function unwatchInbox() { clearInboxTimer(); if (typeof window !== 'undefined') window.removeEventListener('focus', focusInbox); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibilityInbox); watching = false; }
  const contentCache = new Map<string, { taskId: string; attemptId?: string }>();
  const stop = () => {
    generation++;
    stream?.close(); stream = undefined;
    for (const job of jobs.values()) if (job.timer !== undefined) timer.clearTimeout(job.timer);
    jobs.clear(); openM3.clear(); openM5.clear();
    openTasks.clear(); openTaskCounts.clear(); contentCache.clear(); openKnowledge.clear(); knowledgeOpen = false; knowledgeRevision++;
    extractionPolling.stop();
  };
  const anonymous = () => {
    authGeneration++;
    submittedCommands.clear();
    unwatchInbox(); remotesPromise = undefined;
    stop();
    update({ system: emptySystem(), packDetails: {}, mcpServers: null, session: 'anonymous', selectedProjectId: null, projects: [], ...projectState(), globalInbox: emptyInbox(), remotes: null, announcement: 0, loading: {}, errors: {}, pending: {} });
  };
  // Handle authentication failures inside the guarded action, where obsolete requests
  // can be discarded before they affect a newly selected project or session.
  const api = options.api ?? createApiClient({ baseUrl: options.baseUrl ?? (import.meta.env.DEV ? '/api' : '') });
  const active = (scope: number) => scope === generation;
  function failed(area: string, error: unknown) {
    if (error instanceof ApiClientError && error.status === 401) anonymous();
    update({ errors: { ...state.errors, [area]: errorDetails(error) } });
  }
  async function guarded(area: string, scope: number, work: () => Promise<Partial<StoreState>>, valid = () => true) {
    const current = () => active(scope) && valid();
    if (!current()) return;
    const knowledgeArea = area === 'knowledge' || area.startsWith('knowledge-detail:');
    const knowledgeActivity = (loading: boolean, error?: StoreError) => {
      if (knowledgeArea) update({ knowledge: { ...state.knowledge, loading: { ...state.knowledge.loading, [area]: loading }, errors: { ...state.knowledge.errors, [area]: error } } });
    };
    knowledgeActivity(true);
    update({ loading: { ...state.loading, [area]: true }, errors: { ...state.errors, [area]: undefined } });
    const detailId = area.startsWith('detail:') ? area.slice(7) : null;
    if (detailId) update({ details: { ...state.details, [detailId]: { ...(state.details[detailId] ?? emptyDetail()), loading: true, error: undefined } } });
    try { const patch = await work(); if (current()) update(patch); }
    catch (error) { if (current()) { failed(area, error); if (current()) knowledgeActivity(false, errorDetails(error)); if (active(scope) && detailId) update({ details: { ...state.details, [detailId]: { ...(state.details[detailId] ?? emptyDetail()), error: errorDetails(error) } } }); } }
    finally { if (current()) { if (knowledgeArea) update({ knowledge: { ...state.knowledge, loading: { ...state.knowledge.loading, [area]: false } } }); update({ loading: { ...state.loading, [area]: false } }); if (detailId && state.details[detailId]) update({ details: { ...state.details, [detailId]: { ...state.details[detailId], loading: false } } }); } }
  }
  // All reads of a collection share one queue, including initial loads and snapshot recovery.
  function enqueue(area: string, scope: number, work: () => Promise<Partial<StoreState>>, debounce = false, valid = () => true): Promise<void> {
    if (!active(scope)) return Promise.resolve();
    let job = jobs.get(area);
    if (!job) { job = { run: () => guarded(area, scope, work, valid), dirty: false }; jobs.set(area, job); }
    job.run = () => guarded(area, scope, work, valid);
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
  function m3Patch(patch: Partial<M3State>): Partial<StoreState> {
    return { get m3() { return { ...state.m3, ...patch, queues: { ...state.m3.queues, ...patch.queues }, contexts: { ...state.m3.contexts, ...patch.contexts }, requestDetails: { ...state.m3.requestDetails, ...patch.requestDetails } }; } };
  }
  const m3Revisions = new Map<string, number>();
  function readM3(area: string, work: (projectId: string) => Promise<Partial<M3State>>) {
    const id = state.selectedProjectId;
    if (state.session !== 'authenticated' || (!id && area !== 'teams')) return Promise.resolve();
    const revision = (m3Revisions.get(area) ?? 0) + 1; m3Revisions.set(area, revision); jobs.delete(area);
    return enqueue(area, generation, async () => {
      try { return m3Patch(await work(id ?? '')); }
      catch (error) {
        if (area === 'teams' && error instanceof ApiClientError && (error.code === 'unsupported' || error.status === 404 || error.status === 501 || (error.kind === 'bad-response' && error.status !== 401))) return m3Patch({ disabled: true });
        throw error;
      }
    }, false, () => m3Revisions.get(area) === revision);
  }
  const loadTeams = () => readM3('teams', async () => { const [teams, packs] = await Promise.all([api.listTeams(), api.listPacks()]); return { teams: teams.teams, packs: packs.packs }; });
  function loadPack(key: string, retry = false) {
    const area = `pack:${key}`;
    if (state.session !== 'authenticated' || state.loading[area] || (!retry && (state.packDetails[key] || state.errors[area]))) return Promise.resolve();
    return enqueue(area, generation, async () => {
      const pack = await api.getPack(key);
      return { get packDetails() { return { ...state.packDetails, [key]: pack }; } };
    });
  }
  function loadMcpServers(retry = false) {
    if (state.session !== 'authenticated' || state.loading.mcpServers || (!retry && (state.mcpServers || state.errors.mcpServers))) return Promise.resolve();
    return enqueue('mcpServers', generation, async () => ({ mcpServers: (await api.listMcpServers()).servers }));
  }
  const loadActivity = () => state.session !== 'authenticated' ? Promise.resolve()
    : enqueue('activity', generation, async () => ({ activity: await api.getOrgActivity() }));
  async function loadSystem(area?: SystemArea) {
    if (state.session !== 'authenticated') return;
    const reads = {
      health: async () => ({ health: await api.systemHealth() }),
      capabilities: async () => ({ capabilities: await api.systemCapabilities() }),
      backups: async () => ({ backups: await api.systemBackups() }),
      servers: async () => ({ servers: (await api.listMcpServers()).servers }),
      packs: async () => ({ packs: (await api.listPacks()).packs }),
    };
    await Promise.all((area ? [area] : systemAreas).map(key => state.loading[`system:${key}`] ? Promise.resolve() : enqueue(`system:${key}`, generation, async () => {
      const patch = await reads[key]();
      return { get system() { return { ...state.system, ...patch }; } };
    })));
  }
  const loadQueue = (teamId: string) => readM3(`queue:${teamId}`, async () => ({ queues: { ...state.m3.queues, [teamId]: (await api.getTeamQueue(teamId)).items } }));
  const loadRequests = (filters: { state?: string; team?: string } = {}) => readM3('requests', async id => ({ requests: (await api.listRequests(id, filters)).items }));
  const loadRequestTargets = () => readM3('request-targets', async id => ({ requestTargets: (await api.listRequests(id)).items }));
  const loadRequest = (taskId: string) => readM3(`request:${taskId}`, async id => ({ requestDetails: { ...state.m3.requestDetails, [taskId]: (await api.getRequest(id, taskId)).request } }));
  const loadDossier = () => readM3('dossier', async id => ({ dossier: (await api.getDossier(id)).dossier }));
  const loadBriefing = (since?: string) => readM3('briefing', async id => { const result = await api.getBriefing(id, since); return { briefing: result }; });
  const loadContext = (taskId: string) => readM3(`context:${taskId}`, async id => ({ contexts: { ...state.m3.contexts, [taskId]: (await api.getTaskContext(id, taskId)).packs } }));
  const loadProjects = (debounce = false) => enqueue('projects', generation, async () => ({ projects: (await api.listProjects()).projects }), debounce);
  function readSettings(area: string, work: (id: string) => Promise<Partial<SettingsState>>) {
    const id = state.selectedProjectId;
    if (!id || state.session !== 'authenticated') return Promise.resolve();
    return enqueue(area, generation, async () => {
      const patch = await work(id);
      return { get settings() { return { ...state.settings, ...patch }; } };
    });
  }
  const loadAutonomy = () => readSettings('autonomy', async id => ({ autonomy: await api.getAutonomy(id) }));
  const loadStandingApprovals = () => readSettings('standingApprovals', async id => ({ standingApprovals: await api.listStandingApprovals(id) }));
  const loadSettings = async () => { await Promise.all([loadAutonomy(), loadStandingApprovals()]); };
  function loadNotifications(debounce = false) {
    const id = state.selectedProjectId;
    if (!id || state.session !== 'authenticated') return Promise.resolve();
    return enqueue('notifications', generation, async () => {
      // The Host caps each list at 100. Include unread rows even when newer read
      // or dismissed rows would otherwise hide them from the unread tab.
      const [all, unread] = await Promise.all([api.listNotifications(id), api.listNotifications(id, 'unread')]);
      const items = new Map(all.items.map(item => [item.id, item]));
      for (const item of unread.items) items.set(item.id, item);
      return { notifications: { items: [...items.values()], unread: unread.unread } };
    }, debounce);
  }
  function loadIntegration(debounce = false) {
    const id = state.selectedProjectId;
    if (!id || state.session !== 'authenticated') return Promise.resolve();
    return enqueue('integration', generation, async () => ({ integration: await api.listIntegration(id) }), debounce);
  }
  function readM5(area: string, work: (id: string) => Promise<Partial<M5State>>) {
    const id = state.selectedProjectId;
    if (!id || state.session !== 'authenticated') return Promise.resolve();
    return enqueue(area, generation, async () => {
      const patch = await work(id);
      return { get m5() { return { ...state.m5, ...patch,
        workflowDetails: { ...state.m5.workflowDetails, ...patch.workflowDetails },
        occurrences: { ...state.m5.occurrences, ...patch.occurrences }, fires: { ...state.m5.fires, ...patch.fires }, monitorEvents: { ...state.m5.monitorEvents, ...patch.monitorEvents },
      }; } };
    });
  }
  const loadWorkflow = (instanceId: string) => readM5(`workflow:${instanceId}`, async id => ({ workflowDetails: { [instanceId]: (await api.getWorkflow(id, instanceId)).instance } }));
  const loadWorkflowDefinitions = () => readM5('workflow-definitions', async id => ({ workflowDefinitions: (await api.getWorkflowDefinitions(id)).items }));
  async function loadWorkflows() {
    const scope = generation;
    await readM5('workflows', async id => ({ workflows: (await api.listWorkflows(id)).instances }));
    if (active(scope) && !state.errors.workflows) await Promise.all(state.m5.workflows.map(item => loadWorkflow(item.id)));
  }
  const loadSchedules = () => readM5('schedules', async id => ({ schedules: (await api.listSchedules(id)).items }));
  const loadRules = () => readM5('rules', async id => ({ rules: (await api.listRules(id)).items }));
  const loadMonitors = () => readM5('monitors', async id => ({ monitors: (await api.listMonitors(id)).items }));
  const loadBreakers = () => readM5('breakers', async id => ({ breakers: await api.listBreakers(id) }));
  const loadAutomation = async () => { await Promise.all([loadSchedules(), loadRules(), loadMonitors(), loadBreakers()]); };
  const loadScheduleOccurrences = (scheduleId: string) => readM5(`occurrences:${scheduleId}`, async id => ({ occurrences: { [scheduleId]: (await api.listScheduleOccurrences(id, scheduleId)).items } }));
  const loadRuleFires = (ruleId: string) => readM5(`fires:${ruleId}`, async id => ({ fires: { [ruleId]: (await api.listRuleFires(id, ruleId)).items } }));
  const loadMonitorEvents = (monitorId: string) => readM5(`monitor-events:${monitorId}`, async id => ({ monitorEvents: { [monitorId]: (await api.listMonitorEvents(id, monitorId)).items } }));
  function knowledgePatch(patch: Partial<KnowledgeState>): Partial<StoreState> {
    // Resolve at publication so list and detail responses completing together merge.
    return { get knowledge() { return { ...state.knowledge, ...patch, detail: { ...state.knowledge.detail, ...patch.detail } }; } };
  }
  function cancelKnowledgeSearch() {
    knowledgeRevision++;
    const job = jobs.get('knowledge');
    if (job?.timer !== undefined) timer.clearTimeout(job.timer);
    if (job) job.dirty = false;
    jobs.delete('knowledge');
    if (state.session === 'authenticated') update({ knowledge: { ...state.knowledge, loading: { ...state.knowledge.loading, knowledge: false } }, loading: { ...state.loading, knowledge: false } });
  }
  const extractionPolling = createExtractionPolling({ timer,
    pending: () => state.session === 'authenticated' && [
      ...(knowledgeOpen ? state.knowledge.query ? state.knowledge.results : state.knowledge.list : []),
      ...[...openKnowledge].flatMap(id => state.knowledge.detail[id]?.versions ?? []),
    ].some(version => version.extraction?.status === 'pending' || version.extraction?.status === 'running'),
    refresh: async () => { await Promise.all([
      ...(knowledgeOpen ? [readKnowledge(false, false, true)] : []),
      ...[...openKnowledge].map(id => loadKnowledgeDetail(id)),
    ]); },
  });
  function readKnowledge(more = false, debounce = false, preservePages = false) {
    const id = state.selectedProjectId; const revision = knowledgeRevision;
    if (!id || state.session !== 'authenticated') return Promise.resolve();
    const { query, filters } = state.knowledge;
    const offset = more ? (query ? state.knowledge.results.length : state.knowledge.list.length) : 0;
    if (offset >= 500 || (more && (!state.knowledge.hasMore || state.knowledge.loading.knowledge))) return Promise.resolve();
    return enqueue('knowledge', generation, async () => {
      if (debounce && !knowledgeOpen) return {};
      const page = { ...filters, offset, limit: Math.min(50, 500 - offset) };
      if (preservePages) {
        const length = Math.max(50, query ? state.knowledge.results.length : state.knowledge.list.length);
        const results: KnowledgeResult[] = []; const list: KnowledgeItem[] = [];
        let received = 0;
        for (let start = 0; start < length; start += 50) {
          if (revision !== knowledgeRevision || !knowledgeOpen || (typeof document !== 'undefined' && document.hidden)) return {};
          if (query) { const data = await api.searchKnowledge(id, { ...page, query, offset: start }); results.push(...data.results); received = data.results.length; }
          else { const data = await api.listDocuments(id, { ...page, offset: start }); list.push(...data.items); received = data.items.length; }
          if (received < 50) break;
        }
        const count = query ? results.length : list.length;
        return knowledgePatch({ ...(query ? { results } : { list }), hasMore: received === 50 && count < 500 });
      }
      if (query) {
        const result = await api.searchKnowledge(id, { ...page, query });
        return knowledgePatch({ results: [...(more ? state.knowledge.results : []), ...result.results].slice(0, 500), hasMore: result.results.length === page.limit && offset + result.results.length < 500 });
      }
      const result = await api.listDocuments(id, page);
      return knowledgePatch({ list: [...(more ? state.knowledge.list : []), ...result.items].slice(0, 500), hasMore: result.items.length === page.limit && offset + result.items.length < 500 });
    }, debounce, () => revision === knowledgeRevision);
  }
  function searchKnowledge(query: string, filters: KnowledgeFilters = {}) {
    if (!state.selectedProjectId || state.session !== 'authenticated') return Promise.resolve();
    cancelKnowledgeSearch();
    update({ knowledge: { ...state.knowledge, query: query.trim(), filters: { ...(filters.kinds ? { kinds: [...filters.kinds] } : {}), ...(filters.statuses ? { statuses: [...filters.statuses] } : {}), ...(filters.origins ? { origins: [...filters.origins] } : {}) }, results: [], list: [], hasMore: false } });
    return readKnowledge();
  }
  function loadKnowledgeDetail(artifactId: string, debounce = false) {
    const id = state.selectedProjectId;
    if (!id || state.session !== 'authenticated') return Promise.resolve();
    return enqueue(`knowledge-detail:${artifactId}`, generation, async () => {
      if (!openKnowledge.has(artifactId)) return {};
      const result = await api.getKnowledgeArtifact(id, artifactId);
      return knowledgePatch({ detail: { [artifactId]: result.artifact } });
    }, debounce, () => openKnowledge.has(artifactId));
  }
  async function retryExtraction(artifactId: string, version: number) {
    const id = state.selectedProjectId; const scope = generation;
    if (!id || state.session !== 'authenticated') return;
    try { await api.retryExtraction(id, artifactId, version); }
    catch (error) { if (active(scope) && error instanceof ApiClientError && error.status === 401) anonymous(); throw error; }
    if (active(scope)) await Promise.all([
      ...(knowledgeOpen ? [readKnowledge(false, false, true)] : []),
      ...(openKnowledge.has(artifactId) ? [loadKnowledgeDetail(artifactId)] : []),
    ]);
  }
  async function uploadDocument(file: File, meta: DocumentUploadMeta) {
    const id = state.selectedProjectId; const scope = generation;
    if (!id || state.session !== 'authenticated' || state.knowledge.upload.busy) return;
    const publish = (upload: DocumentUploadState) => { if (active(scope)) update(knowledgePatch({ upload })); };
    publish({ busy: true, progress: 0, error: null });
    try {
      const artifact = await api.uploadDocument(id, file, meta, progress => publish({ busy: true, progress, error: null }));
      if (!active(scope)) return;
      publish({ busy: false, progress: 100, error: null });
      void readKnowledge();
      if (openKnowledge.has(artifact.artifactId)) void loadKnowledgeDetail(artifact.artifactId);
      return artifact;
    } catch (error) {
      if (active(scope)) {
        if (error instanceof ApiClientError && error.status === 401) { anonymous(); return; }
        publish({ busy: false, progress: 0, error: { status: error instanceof ApiClientError ? error.status ?? 0 : 0, code: error instanceof DocumentUploadError ? error.reason : error instanceof ApiClientError ? error.code ?? error.kind : 'unexpected' } });
      }
    }
  }
  function loadInbox(debounce = false) {
    const id = state.selectedProjectId;
    if (!id || state.session !== 'authenticated') return Promise.resolve();
    return enqueue('inbox', generation, async () => ({ inbox: await api.getInbox(id) }), debounce);
  }
  function loadGlobalInbox(debounce = false) {
    if (state.session !== 'authenticated') return Promise.resolve();
    return enqueue('globalInbox', generation, async () => ({ globalInbox: await api.getGlobalInbox() }), debounce);
  }
  function loadApproval(approvalId: string) {
    const id = state.selectedProjectId;
    if (!id) return Promise.resolve();
    return enqueue(`approval:${approvalId}`, generation, async () => { const result = await api.getApproval(id, approvalId); return { approvals: { ...state.approvals, [approvalId]: result.approval } }; });
  }
  function loadRemotes(refresh = false): Promise<void> {
    if (state.session !== 'authenticated' || (!refresh && state.remotes !== null)) return Promise.resolve();
    if (remotesPromise) return remotesPromise;
    const scope = authGeneration;
    update({ loading: { ...state.loading, remotes: true }, errors: { ...state.errors, remotes: undefined } });
    remotesPromise = (async () => {
      try { const result = await api.getEffectRemotes(); if (scope === authGeneration) update({ remotes: result.remotes }); }
      catch (error) { if (scope === authGeneration) failed('remotes', error); }
      finally { if (scope === authGeneration) { update({ loading: { ...state.loading, remotes: false } }); remotesPromise = undefined; } }
    })();
    return remotesPromise;
  }
  function loadEffects(taskId?: string, attemptId?: string, debounce = false) {
    const id = state.selectedProjectId;
    if (!id || state.session !== 'authenticated') return Promise.resolve();
    if (!taskId && !attemptId) return enqueue('effects', generation, async () => ({ projectEffects: (await api.listProjectEffects(id)).effects }));
    if (!taskId || !attemptId) return Promise.resolve();
    return enqueue(`effects:${taskId}:${attemptId}`, generation, async () => {
      if (debounce && !openTasks.has(taskId)) return {};
      const result = await api.listAttemptEffects(id, attemptId);
      return detailPatch(taskId, { effects: { ...state.details[taskId]?.effects, [attemptId]: result.effects } });
    }, debounce);
  }
  async function refreshCode() {
    await Promise.all([loadIntegration(), loadEffects(), loadRemotes(true)]);
  }
  async function reconcileProjectEffect(effectId: string) {
    const id = state.selectedProjectId; const scope = generation; const area = `reconcile:${effectId}`;
    const effect = state.projectEffects?.find(item => item.id === effectId);
    if (!id || state.session !== 'authenticated' || state.loading[area] || !effect || (effect.state !== 'unknown' && effect.outcome !== 'unknown' && effect.outcome !== 'outcome-unknown')) return;
    update({ loading: { ...state.loading, [area]: true }, errors: { ...state.errors, [area]: undefined } });
    try {
      const result = await api.reconcileEffect(id, effectId);
      if (!active(scope)) return;
      const patch = { ...effect, ...result.effect, outcome: result.effect.state === 'unknown' ? 'unknown' : 'known' };
      update({ projectEffects: state.projectEffects?.map(item => item.id === effectId ? patch : item) ?? null });
      for (const [taskId, detail] of Object.entries(state.details)) {
        const previous = detail.effects[effect.attemptId];
        if (previous?.some(item => item.id === effectId)) update(detailPatch(taskId, { effects: { ...detail.effects, [effect.attemptId]: previous.map(item => item.id === effectId ? result.effect : item) } }));
      }
      notifyEffectReconciled(effectId);
      return result.effect;
    } catch (error) { if (active(scope)) failed(area, error); }
    finally {
      if (active(scope)) { await refreshCode(); if (active(scope)) update({ loading: { ...state.loading, [area]: false } }); }
    }
  }
  async function mutateEffect(taskId: string, attemptId: string, remoteOrId: string, reconcile: boolean) {
    const id = state.selectedProjectId; const scope = generation; const area = `push:${taskId}:${attemptId}`;
    if (!id || state.session !== 'authenticated' || state.loading[area]) return;
    update({ loading: { ...state.loading, [area]: true }, errors: { ...state.errors, [area]: undefined } });
    try {
      const { effect } = await (reconcile ? api.reconcileEffect(id, remoteOrId) : api.pushAttempt(id, attemptId, remoteOrId));
      if (!active(scope)) return;
      const previous = state.details[taskId]?.effects[attemptId] ?? [];
      update(detailPatch(taskId, { effects: { ...state.details[taskId]?.effects, [attemptId]: [...previous.filter(item => item.id !== effect.id), effect] } }));
      return effect;
    } catch (error) { if (active(scope)) { failed(area, error); if (active(scope) && error instanceof ApiClientError && error.code === 'conflict') await loadEffects(taskId, attemptId); } }
    finally {
      if (active(scope) && state.projectEffects !== null) await refreshCode();
      if (active(scope)) update({ loading: { ...state.loading, [area]: false } });
    }
  }
  function loadArea(area: 'team' | 'tasks' | 'conversations' | 'budget', debounce = false) {
    const id = state.selectedProjectId;
    if (!id) return Promise.resolve();
    return enqueue(area, generation, async () => {
      switch (area) {
        case 'team': return { team: await api.getTeam(id) };
        case 'tasks': {
          const tasks = (await api.listTasks(id)).items;
          const summaries = await Promise.all(tasks.filter(task => task.state === 'active').map(async task => {
            const attempts = (await api.listAttempts(id, task.id)).attempts;
            return [task.id, [...attempts].sort((a, b) => b.epoch - a.epoch)[0]] as const;
          }));
          const liveAttempts: Record<string, Attempt> = {};
          for (const [taskId, attempt] of summaries) if (attempt) liveAttempts[taskId] = attempt;
          return { tasks, liveAttempts };
        }
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
  function detailPatch(taskId: string, patch: Partial<TaskDetailState>): Partial<StoreState> {
    // Resolve the base when guarded publishes the result: independent event/effect
    // responses may finish in the same microtask turn.
    return { get details() { const current = state.details[taskId] ?? emptyDetail(); return { ...state.details, [taskId]: { ...current, ...patch, events: { ...current.events, ...patch.events }, effects: { ...current.effects, ...patch.effects } } }; } };
  }
  function loadAttemptEvents(taskId: string, attemptId: string) {
    const id = state.selectedProjectId;
    const scope = generation;
    if (!id) return Promise.resolve();
    return enqueue(`attempt-events:${taskId}:${attemptId}`, scope, async () => {
      const events = new Map<number, AttemptEvent>();
      let afterSeq = 0;
      while (events.size < 2000 && active(scope)) {
        const limit = Math.min(500, 2000 - events.size);
        const page = await api.listAttemptEvents(id, attemptId, { afterSeq, limit });
        for (const event of page.events) if (event.seq > afterSeq && events.size < 2000) events.set(event.seq, event);
        const last = Math.max(afterSeq, ...page.events.map(event => event.seq));
        if (page.events.length < limit || last <= afterSeq) break;
        afterSeq = last;
      }
      return detailPatch(taskId, { events: { ...state.details[taskId]?.events, [attemptId]: [...events.values()].sort((a, b) => a.seq - b.seq) } });
    });
  }
  async function loadTaskDetail(taskId: string, debounce = false) {
    const id = state.selectedProjectId;
    const scope = generation;
    if (!id) return;
    await enqueue(`detail:${taskId}`, scope, async () => {
      if (debounce && !openTasks.has(taskId)) return {};
      const [attempts, artifacts, approvals] = await Promise.all([api.listAttempts(id, taskId), api.listTaskArtifacts(id, taskId), api.listTaskApprovals(id, taskId)]);
      const sorted = [...attempts.attempts].sort((a, b) => b.epoch - a.epoch);
      if (active(scope) && openTasks.has(taskId)) {
        const ids = new Set([sorted[0]?.id, ...Object.keys(state.details[taskId]?.events ?? {})]);
        for (const attemptId of ids) if (attemptId) { void loadAttemptEvents(taskId, attemptId); void loadEffects(taskId, attemptId); }
      }
      const patches = { ...state.details[taskId]?.patches };
      for (const [attemptId, patch] of Object.entries(patches)) if (patch === null) { delete patches[attemptId]; if (active(scope)) contentCache.delete(`patch:${attemptId}`); }
      return detailPatch(taskId, { attempts: sorted, artifacts: artifacts.items, approvals: approvals.approvals, patches });
    }, debounce);
  }
  // Patches and artifact text share a 20-entry in-memory LRU. Eviction removes rendered data too.
  function cacheEntry(key: string, entry: { taskId: string; attemptId?: string }): Partial<StoreState> {
    contentCache.delete(key); contentCache.set(key, entry);
    const details = { ...state.details };
    const artifactContents = { ...state.artifactContents };
    while (contentCache.size > 20) {
      const oldest = contentCache.entries().next().value;
      if (!oldest) break;
      const [oldKey, old] = oldest; contentCache.delete(oldKey);
      if (old.attemptId && details[old.taskId]) {
        const detail = details[old.taskId]!; const patches = { ...detail.patches }; delete patches[old.attemptId]; details[old.taskId] = { ...detail, patches };
      } else delete artifactContents[oldKey];
    }
    return { details, artifactContents };
  }
  function loadPatch(taskId: string, attemptId: string) {
    const id = state.selectedProjectId; const scope = generation; const key = `patch:${attemptId}`;
    if (!id) return Promise.resolve();
    if (Object.hasOwn(state.details[taskId]?.patches ?? {}, attemptId)) { cacheEntry(key, { taskId, attemptId }); return Promise.resolve(); }
    return enqueue(key, scope, async () => {
      if (Object.hasOwn(state.details[taskId]?.patches ?? {}, attemptId)) return {};
      const patch = await api.getAttemptPatch(id, attemptId);
      if (!active(scope)) return {};
      const cached = cacheEntry(key, { taskId, attemptId });
      return { ...cached, details: { ...cached.details, [taskId]: { ...(cached.details?.[taskId] ?? emptyDetail()), patches: { ...cached.details?.[taskId]?.patches, [attemptId]: patch } } } };
    });
  }
  function loadArtifactContent(taskId: string, artifactId: string, version: number) {
    const id = state.selectedProjectId; const scope = generation; const key = `${artifactId}:${version}`;
    if (!id) return Promise.resolve();
    if (state.artifactContents[key]) { cacheEntry(key, { taskId }); return Promise.resolve(); }
    return enqueue(`content:${key}`, scope, async () => {
      if (state.artifactContents[key]) return {};
      const content = await api.getArtifactContent(id, artifactId, version);
      if (!active(scope)) return {};
      const cached = cacheEntry(key, { taskId });
      return { ...cached, artifactContents: { ...cached.artifactContents, [key]: content } };
    });
  }
  async function refresh() {
    void loadNotifications(); void loadIntegration();
    for (const read of openM5.values()) void read();
    for (const read of openM3.values()) void read();
    if (knowledgeOpen) void readKnowledge();
    for (const id of openKnowledge) void loadKnowledgeDetail(id);
    await Promise.all([loadProjects(), loadInbox(), loadGlobalInbox(), loadArea('team'), loadArea('tasks'), loadArea('conversations'), loadArea('budget'),
      ...Object.keys(state.messages).map((id) => loadMessages(id))]);
    await Promise.all([...openTasks].map(id => loadTaskDetail(id)));
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
    const activityRead = openM3.get('activity');
    if (activityRead) {
      const key = 'refresh:activity';
      const previous = jobs.get(key); if (previous?.timer !== undefined) timer.clearTimeout(previous.timer);
      const job: Job = { run: activityRead, dirty: false }; jobs.set(key, job);
      job.timer = timer.setTimeout(() => { if (openM3.has('activity')) void activityRead(); }, 1000);
    }
    const payload = event.payload;
    if (['entity.changed', 'workflow.state-changed', 'monitor.changed', 'task.status-changed', 'artifact.status-changed'].includes(payload.type)) {
      for (const [area, read] of openM5) {
        const key = `refresh:${area}`;
        const previous = jobs.get(key); if (previous?.timer !== undefined) timer.clearTimeout(previous.timer);
        const job: Job = { run: read, dirty: false }; jobs.set(key, job);
        job.timer = timer.setTimeout(() => { if (openM5.has(area)) void read(); }, options.debounceMs ?? 150);
      }
    }
    if (payload.type === 'entity.changed' || payload.type === 'artifact.status-changed' || payload.type === 'task.status-changed') {
      for (const [area, read] of openM3) {
        if (area === 'activity') continue;
        const key = `refresh:${area}`;
        const previous = jobs.get(key); if (previous?.timer !== undefined) timer.clearTimeout(previous.timer);
        const job: Job = { run: read, dirty: false }; jobs.set(key, job);
        job.timer = timer.setTimeout(() => { if (openM3.has(area)) void read(); }, options.debounceMs ?? 150);
      }
    }
    if (payload.type === 'message.appended') void loadMessages(payload.message.conversationId, true);
    else if (payload.type === 'command.receipted') void loadArea('budget', true);
    else if (payload.type === 'entity.changed') {
      if (String(payload.entity.kind) === 'notification') void loadNotifications(true);
      if (payload.entity.kind === 'task') void loadIntegration(true);
      if (payload.entity.kind === 'artifact-version') {
        if (knowledgeOpen) void readKnowledge(false, true);
        for (const id of openKnowledge) void loadKnowledgeDetail(id, true);
      }
      if (payload.entity.kind === 'task' || payload.entity.kind === 'approval') { void loadInbox(true); void loadGlobalInbox(true); }
      if (payload.entity.kind === 'effect') for (const taskId of openTasks) for (const attempt of state.details[taskId]?.attempts ?? []) void loadEffects(taskId, attempt.id, true);
      if (['task', 'attempt', 'artifact-version', 'approval'].includes(payload.entity.kind)) {
        for (const taskId of openTasks) void loadTaskDetail(taskId, true);
      }
      switch (payload.entity.kind) {
        case 'task': case 'attempt': void loadArea('tasks', true); break;
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
    try { await work(); if (scope === authGeneration) { update({ session: 'authenticated' }); watchInbox(); await Promise.all([loadGlobalInbox(), loadRemotes()]); } }
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
    // Retried command identities stay quiet, even if their original receipt was lost.
    const firstSubmission = !submittedCommands.has(command.commandId);
    submittedCommands.add(command.commandId);
    const approvalKind = command.type === 'approvals.decide'
      ? (state.approvals[command.payload.approvalId]
        ?? state.inbox.approvals.find(item => item.id === command.payload.approvalId)
        ?? state.globalInbox.approvals.find(item => item.id === command.payload.approvalId))?.kind
      : undefined;
    update({ pending: { ...state.pending, [command.commandId]: { command, status: 'pending' } }, errors: { ...state.errors, command: undefined } });
    try {
      const response = await api.sendCommand(command);
      if (active(scope)) {
        const pending = { ...state.pending }; delete pending[command.commandId]; update({ pending });
        if (firstSubmission && active(scope) && (response.receipt.state === 'accepted' || response.receipt.state === 'completed')) notifyCommandSuccess(command, approvalKind);
        void loadGlobalInbox(); void loadInbox(); return response;
      }
      return undefined;
    } catch (error) {
      if (active(scope)) {
        if (error instanceof ApiClientError && error.code === 'unsupported' && /^(teams|seats|engagements)\./.test(command.type)) update(m3Patch({ disabled: true }));
        failed('command', error);
        if (active(scope)) update({ pending: { ...state.pending, [command.commandId]: { command, status: 'failed', error: errorDetails(error) } } });
      }
      return undefined;
    }
  }
  async function sendAutomation(command: AutomationCommand) {
    const area = command.type.split('.')[0] as 'schedules' | 'rules' | 'monitors';
    const payload = command.payload;
    const id = command.type.endsWith('.create') ? 'new'
      : 'scheduleId' in payload ? payload.scheduleId : 'ruleId' in payload ? payload.ruleId : payload.monitorId;
    return sendCollectionCommand(command, `automation:${area}:${id}`, ({ schedules: loadSchedules, rules: loadRules, monitors: loadMonitors })[area], 'automationWrite.conflict');
  }
  function sendSettings(command: SettingsCommand) {
    return sendCollectionCommand(command, settingsPendingKey(command), loadSettings, 'settingsWrite.conflict');
  }
  function sendKnowledge(command: KnowledgeCommand) {
    return sendCollectionCommand(command, knowledgePendingKey(command.payload.artifactId, command.payload.version), async () => {
      await Promise.all([
        readKnowledge(false, false, knowledgeOpen),
        ...[...openKnowledge].map(id => loadKnowledgeDetail(id)),
        ...['dossier', 'briefing'].flatMap(area => {
          const reload = openM3.get(area);
          return reload ? [reload()] : [];
        }),
      ]);
    }, 'knowledgeWrite.changed', false, true);
  }
  function sendNotification(command: NotificationCommand, quietConflict = false) {
    return sendCollectionCommand(command, notificationPendingKey(command.payload.notificationId), loadNotifications, 'notificationsUi.conflict', quietConflict);
  }
  function sendIntegration(command: IntegrationCommand) {
    return sendCollectionCommand(command, integrationPendingKey(command.payload.taskId), async () => {
      await Promise.all([refreshCode(), loadInbox(), loadGlobalInbox()]);
    }, 'integrationUi.conflict');
  }
  async function markAllNotificationsRead() {
    const projectId = state.selectedProjectId; const scope = generation;
    if (!projectId || state.session !== 'authenticated' || state.notificationProgress) return;
    const total = state.notifications.unread;
    if (!total || state.notifications.items.some(item => state.loading[notificationPendingKey(item.id)])) return;
    update({ notificationProgress: { done: 0, total } });
    let done = 0;
    try {
      // Re-read after each command so unread batches beyond the Host's first
      // page are processed too. Bound the run to the count present at the click.
      while (done < total) {
        if (!active(scope)) return;
        const item = state.notifications.items.find(item => item.state === 'unread');
        if (!item || !await sendNotification(notificationsMarkRead({ projectId, notificationId: item.id }), true)) break;
        if (!active(scope)) return;
        done++; update({ notificationProgress: { done, total } });
        if (state.errors.notifications) break;
      }
      if (active(scope)) {
        if (done === total || !state.notifications.unread) toast.success(i18n.t('notificationsUi.allRead'));
        else toast.error(i18n.t('notificationsUi.batchFailed').replace('{done}', String(done)).replace('{total}', String(total)));
      }
    } finally { if (active(scope)) update({ notificationProgress: null }); }
  }
  async function sendCollectionCommand(command: Command, key: string, reload: () => Promise<void>, conflictKey: string, quietConflict = false, recoverNotFound = false) {
    const scope = generation;
    if (state.loading[key] || state.session !== 'authenticated' || command.projectId !== state.selectedProjectId) return;
    update({ loading: { ...state.loading, [key]: true }, errors: { ...state.errors, [key]: undefined } });
    try {
      const response = await send(command);
      if (!active(scope)) return;
      const error = state.pending[command.commandId]?.error;
      if (error) update({ errors: { ...state.errors, [key]: error } });
      const changed = error?.code === 'conflict' || (recoverNotFound && error?.code === 'not-found');
      if (response || changed) {
        await reload();
        if (!active(scope)) return;
        if (changed && !quietConflict) toast.info(i18n.t(conflictKey));
      }
      return response || (recoverNotFound && changed ? true : undefined);
    } finally {
      if (active(scope)) update({ loading: { ...state.loading, [key]: false } });
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
    loadWorkflows, loadWorkflow, loadWorkflowDefinitions, loadAutomation, loadSchedules, loadRules, loadMonitors, loadBreakers,
    loadScheduleOccurrences, loadRuleFires, loadMonitorEvents, sendAutomation,
    loadAutonomy, loadStandingApprovals, loadSettings, sendSettings,
    loadNotifications: () => loadNotifications(), loadIntegration: () => loadIntegration(), sendNotification, sendIntegration, markAllNotificationsRead,
    watchM5: (area: 'workflows' | 'automation' | 'settings', read: () => Promise<void>) => { openM5.set(area, read); void read(); return () => { openM5.delete(area); }; },
    refreshM3: (area: string) => openM3.get(area)?.() ?? Promise.resolve(),
    loadTeams, loadPack, loadMcpServers, loadQueue, loadRequests, loadRequestTargets, loadRequest, loadDossier, loadBriefing, loadContext,
    loadActivity, loadSystem,
    watchActivity: () => {
      openM3.set('activity', loadActivity); void loadActivity();
      return () => {
        openM3.delete('activity');
        const job = jobs.get('refresh:activity');
        if (job?.timer !== undefined) timer.clearTimeout(job.timer);
        jobs.delete('refresh:activity');
      };
    },
    watchM3: (area: string, read: () => Promise<void>) => { openM3.set(area, read); void read(); return () => { openM3.delete(area); }; },
    sendKnowledge,
    searchKnowledge, loadKnowledgeList: (filters: KnowledgeFilters = {}) => searchKnowledge('', filters),
    loadKnowledgeMore: () => readKnowledge(true), cancelKnowledgeSearch,
    openKnowledgeList: () => { knowledgeOpen = true; extractionPolling.sync(); },
    closeKnowledgeList: () => { knowledgeOpen = false; cancelKnowledgeSearch(); extractionPolling.sync(); },
    openKnowledgeArtifact: (id: string) => { openKnowledge.add(id); extractionPolling.sync(); return loadKnowledgeDetail(id); },
    closeKnowledgeArtifact: (id: string) => { openKnowledge.delete(id); extractionPolling.sync(); },
    knowledgeTimer: timer,
    uploadDocument,
    resetDocumentUpload: () => { if (!state.knowledge.upload.busy) update(knowledgePatch({ upload: emptyUpload() })); },
    rawDocumentUrl: api.rawDocumentUrl,
    fetchRawDocument: api.fetchRawDocument,
    getExtraction: api.getExtraction,
    getExtractionText: api.getExtractionText,
    retryExtraction,
    loadConversations: () => loadArea('conversations'),
    loadTasks: () => loadArea('tasks'),
    loadBudget: () => loadArea('budget'),
    loadInbox: () => loadInbox(), loadGlobalInbox: () => loadGlobalInbox(), loadRemotes, loadApproval, loadEffects, refreshCode, reconcileProjectEffect,
    push: (taskId: string, attemptId: string, remote: string) => mutateEffect(taskId, attemptId, remote, false),
    reconcile: (taskId: string, attemptId: string, effectId: string) => mutateEffect(taskId, attemptId, effectId, true),
    announceDecision: () => update({ announcement: state.announcement + 1 }),
    async selectProject(id: string) {
      stop(); const scope = generation;
      update({ selectedProjectId: id, ...projectState(), errors: {}, loading: {}, pending: {} });
      connect(id, scope);
      await Promise.all([loadNotifications(), loadIntegration(), loadInbox(), loadGlobalInbox(), loadArea('team'), loadArea('tasks'), loadArea('conversations'), loadArea('budget')]);
    },
    loadMessages: (id: string) => loadMessages(id), send,
    openTask(taskId: string) { openTaskCounts.set(taskId, (openTaskCounts.get(taskId) ?? 0) + 1); openTasks.add(taskId); return loadTaskDetail(taskId); },
    closeTask(taskId: string) {
      const remaining = (openTaskCounts.get(taskId) ?? 1) - 1;
      if (remaining > 0) { openTaskCounts.set(taskId, remaining); return; }
      openTaskCounts.delete(taskId);
      openTasks.delete(taskId);
      const job = jobs.get(`detail:${taskId}`);
      if (job?.timer !== undefined) { timer.clearTimeout(job.timer); delete job.timer; }
      for (const [area, effectJob] of jobs) if (area.startsWith(`effects:${taskId}:`) && effectJob.timer !== undefined) { timer.clearTimeout(effectJob.timer); delete effectJob.timer; }
    },
    loadTaskDetail: (taskId: string) => loadTaskDetail(taskId), loadAttemptEvents, loadPatch, loadArtifactContent,
    retry: (commandId: string) => { const pending = state.pending[commandId]; return pending?.status === 'failed' ? send(pending.command) : Promise.resolve(undefined); },
    applyEvent,
    dispose: () => { authGeneration++; unwatchInbox(); stop(); listeners.clear(); submittedCommands.clear(); },
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
