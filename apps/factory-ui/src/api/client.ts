import { officeReadModel } from './officeModels';
import { m3Models } from './m3Models';
import { agentClisModel } from './agentRuntime';
import { packDetailModel, mcpServersModel } from './agentProfileModels';
import { automationErrorKey } from './automationErrors';
import { settingsErrorKey } from './settingsErrors';
import { knowledgeErrorKey } from './knowledgeErrors';
import { settingsReadModels } from './settingsModels';
import { notificationReadModels } from './notificationModels';
import { activityReadModel } from './activityModels';
import { extractionModels, mediaTypeForFile } from './documents';
import { systemModels } from './systemModels';
import { folderBrowseModel } from './folderModels';
import { modelSettingsResponse } from './modelSettings';
export type { FolderListing } from './folderModels';
export type { SystemHealth, SystemCapabilities, SystemBackup } from './systemModels';
export type { AutonomyResponse, AutonomyTeam, StandingApproval, StandingApprovalsResponse } from './settingsModels';
import { workflowErrorKey } from './workflowErrors';
import { commandSchema, successResponseSchema, failureResponseSchema, projectSchema,
  conversationSchema, messageSchema, taskSchema, teamSchema, seatSchema, engagementSchema, idSchema,
  textSchema, usageSchema, budgetSchema, type ApiError, type Command } from '@factory/contracts';
import { readModels, m5ReadModels, type KnowledgePage } from './readModels';
import { codeReadModels } from './codeModels';
export type { KnowledgeResult, KnowledgeItem, KnowledgeArtifact, KnowledgeFilters, KnowledgePage, KnowledgeGroup, KnowledgeGroups, KnowledgeGroupKey } from './readModels';
export type DocumentUploadMeta = { kind: NonNullable<KnowledgePage['kinds']>[number]; title?: string; artifactId?: string; note?: string };
export type { Attempt, AttemptEvent, AttemptPatch, TaskArtifact, ArtifactContent, Inbox, Effect } from './readModels';
export type { WorkflowInstance, WorkflowDetail, WorkflowStage, WorkflowGraph, WorkflowDefinition, Schedule, AutomationRule, Monitor, RouteBreaker, TeamBreaker } from './readModels';

// Extend exported strict contract objects to validate the Host's HTTP envelopes without
// importing their private schema-library dependency into this package.
const ok = successResponseSchema.pick({ ok: true, apiVersion: true });
const object = ok.omit({ ok: true, apiVersion: true });
const auth = ok.extend({ csrfToken: textSchema });
const projects = ok.extend({ projects: projectSchema.array() });
// The Host adds fields to this response over time (M3 added `engagements`): unknown fields are ignored, known ones stay strict.
const team = ok.extend({ team: teamSchema, seats: seatSchema.array(), engagement: engagementSchema }).loose();
const tasks = ok.extend({ items: taskSchema.array() });
const conversations = ok.extend({ conversations: conversationSchema.array() });
type TurnState = 'queued' | 'running' | 'done' | 'failed' | 'unknown' | 'budget-blocked';
const messages = ok.extend({ messages: object.extend({ ordinal: usageSchema.shape.inputTokens.positive(), message: messageSchema }).array(),
  turns: object.extend({ id: idSchema, state: textSchema.refine((value) => ['queued', 'running', 'done', 'failed', 'unknown', 'budget-blocked'].includes(value)).transform((value) => value as TurnState), errorKind: textSchema.min(0).nullable() }).array() });
const count = usageSchema.shape.inputTokens;
const budgetFields = { used: count, limit: count.positive(),
  verdict: textSchema.refine((value) => ['ok', 'warn', 'exceeded'].includes(value)).transform((value) => value as 'ok' | 'warn' | 'exceeded'),
  source: textSchema.refine((value) => ['explicit', 'default'].includes(value)).transform((value) => value as 'explicit' | 'default') };
const budget = ok.extend({ budget: object.extend({
  day: object.extend({ date: budgetSchema.shape.scopeRef.refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value), ...budgetFields }),
  tasks: object.extend({ taskId: idSchema, code: taskSchema.shape.code, ...budgetFields }).array(),
  // Added by the Host in M5 (P3a): project-wide and per-engagement budgets. Optional so older Hosts still parse.
  project: object.extend({ used: count, limit: count.positive().nullable(), verdict: budgetFields.verdict, source: budgetFields.source }).optional(),
  engagements: object.extend({ engagementId: idSchema, used: count, limit: count.positive(), verdict: budgetFields.verdict }).array().optional(),
}) });

export type ApiClientErrorKind = 'network' | 'bad-response' | 'api';
const safeMessages: Record<ApiError['code'], string> = {
  validation: 'Invalid request.', conflict: 'The resource changed.', 'needs-auth': 'Authentication required.',
  'permission-configuration': 'Permission configuration required.', 'resource-exhausted': 'Resources temporarily unavailable.',
  'runtime-unavailable': 'Runtime unavailable.', 'outcome-unknown': 'Command outcome unknown.', 'not-found': 'Resource not found.',
  forbidden: 'Request forbidden.', unsupported: 'Command unsupported.', internal: 'Internal server error.',
};
export class ApiClientError extends Error {
  readonly code: ApiError['code'] | undefined;
  readonly nextAction: ApiError['nextAction'] | undefined;
  readonly correlationId: string | undefined;
  readonly currentRevision: number | undefined;
  readonly detailKey: string | undefined;
  constructor(readonly kind: ApiClientErrorKind, readonly status?: number, error?: ApiError, includeHostMessage = false) {
    // Never echo transport errors or server text: either can contain credentials or request content.
    super(error ? safeMessages[error.code] : kind === 'network' ? 'Cannot reach the Host.' : 'Invalid Host response.');
    this.name = 'ApiClientError';
    this.code = error?.code;
    this.nextAction = error?.nextAction;
    this.correlationId = error?.correlationId;
    this.currentRevision = error?.currentRevision;
    this.detailKey = includeHostMessage && error ? workflowErrorKey(error.message) ?? settingsErrorKey(error.message) ?? automationErrorKey(error.message) ?? knowledgeErrorKey(error.message) : undefined;
  }
}
export class DocumentUploadError extends ApiClientError {
  constructor(readonly reason: 'quota' | 'version', status: number, error: ApiError) { super('api', status, error); }
}

export function createApiClient({ baseUrl = '', fetchImpl = globalThis.fetch, onUnauthorized }: {
  baseUrl?: string; fetchImpl?: typeof fetch; onUnauthorized?: () => void;
} = {}) {
  let csrfToken: string | null = null;
  const base = baseUrl.replace(/\/$/, '');
  async function request<T>(path: string, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, body?: unknown, commandDetails = false, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      if (csrfToken) headers['x-csrf-token'] = csrfToken;
    }
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers,
        credentials: 'same-origin', cache: 'no-store', ...(signal ? { signal } : {}), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new ApiClientError('network'); }
    if (response.status === 401) {
      csrfToken = null;
      try { onUnauthorized?.(); } catch { /* Observers cannot replace a safe API error. */ }
    }
    let raw: unknown;
    try { raw = await response.json(); } catch { throw new ApiClientError('bad-response', response.status); }
    const failure = failureResponseSchema.safeParse(raw);
    if (failure.success) throw new ApiClientError('api', response.status, failure.data.error, commandDetails);
    // Command rejections can arrive inside a valid receipt, including HTTP 409.
    if (commandDetails) {
      const receipt = successResponseSchema.safeParse(raw);
      if (receipt.success && receipt.data.receipt.error) throw new ApiClientError('api', response.status, receipt.data.receipt.error, true);
    }
    const parsed = schema.safeParse(raw);
    if (!response.ok || !parsed.success) throw new ApiClientError('bad-response', response.status);
    return parsed.data;
  }
  const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`;
  const extractionPath = (id: string, artifactId: string, version: number) => `${projectPath(id)}/knowledge/artifacts/${encodeURIComponent(artifactId)}/versions/${encodeURIComponent(version)}/extraction`;
  const knowledgeQuery = (options: KnowledgePage, query?: string) => {
    const params = new URLSearchParams();
    if (query !== undefined) params.set('q', query);
    for (const kind of options.kinds ?? []) params.append('kind', kind);
    for (const status of options.statuses ?? []) params.append('status', status);
    for (const origin of options.origins ?? []) params.append('origin', origin);
    if (options.group !== undefined) params.set('group', options.group);
    if (options.media !== undefined) params.set('media', options.media);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    return params.size ? `?${params}` : '';
  };
  return {
    listNotifications: (id: string, state: 'unread' | 'read' | 'dismissed' | 'all' = 'all') => request(`${projectPath(id)}/notifications?state=${state}`, notificationReadModels.notifications),
    listIntegration: (id: string) => request(`${projectPath(id)}/integration`, notificationReadModels.integration),
    getOrgActivity: () => request('/org/activity', activityReadModel),
    getProjectInteractions: (id: string, limit = 120) => request(`${projectPath(id)}/interactions?limit=${limit}`, officeReadModel),
    listTeams: () => request('/teams', m3Models.teams),
    listPacks: () => request('/packs', m3Models.packs),
    getPack: (key: string) => request(`/packs/${encodeURIComponent(key)}`, packDetailModel),
    listMcpServers: () => request('/mcp-servers', mcpServersModel),
    systemHealth: () => request('/health', systemModels.health),
    systemCapabilities: () => request('/system/capabilities', systemModels.capabilities),
    getAgentClis: () => request('/system/agent-clis', agentClisModel),
    systemBackups: () => request('/system/backups', systemModels.backups),
    getModelSettings: () => request('/system/models', modelSettingsResponse),
    browseFolders: (path?: string, signal?: AbortSignal) => request(`/system/browse${path ? `?${new URLSearchParams({ path })}` : ''}`, folderBrowseModel, undefined, false, signal),
    getTeamQueue: (id: string) => request(`/teams/${encodeURIComponent(id)}/queue`, m3Models.queue),
    listRequests: (id: string, filters: { state?: string; team?: string } = {}) => {
      const params = new URLSearchParams({ limit: '100', ...filters });
      return request(`${projectPath(id)}/requests?${params}`, m3Models.requests);
    },
    getRequest: (id: string, taskId: string) => request(`${projectPath(id)}/requests/${encodeURIComponent(taskId)}`, m3Models.request),
    getDossier: (id: string) => request(`${projectPath(id)}/dossier`, m3Models.dossier),
    getBriefing: (id: string, since?: string) => request(`${projectPath(id)}/briefing${since ? `?since=${encodeURIComponent(since)}` : ''}`, m3Models.briefing),
    getTaskContext: (id: string, taskId: string) => request(`${projectPath(id)}/tasks/${encodeURIComponent(taskId)}/context`, m3Models.context),
    get csrfToken() { return csrfToken; },
    health: () => request('/health', ok),
    async bootstrap(token: string) { const result = await request('/auth/bootstrap', auth, { token }); csrfToken = result.csrfToken; return result; },
    async session() { const result = await request('/auth/session', auth); csrfToken = result.csrfToken; return result; },
    async logout() { const result = await request('/auth/logout', ok, {}); csrfToken = null; return result; },
    listProjects: () => request('/projects', projects),
    getTeam: (id: string) => request(`${projectPath(id)}/team`, team),
    listTasks: (id: string) => request(`${projectPath(id)}/tasks`, tasks),
    listAttempts: (id: string, taskId: string) => request(`${projectPath(id)}/tasks/${encodeURIComponent(taskId)}/attempts`, readModels.attempts),
    listAttemptEvents: (id: string, attemptId: string, options: { afterSeq?: number; limit?: number } = {}) => {
      const query = new URLSearchParams();
      if (options.afterSeq !== undefined) query.set('afterSeq', String(options.afterSeq));
      if (options.limit !== undefined) query.set('limit', String(options.limit));
      return request(`${projectPath(id)}/attempts/${encodeURIComponent(attemptId)}/events${query.size ? `?${query}` : ''}`, readModels.events);
    },
    async getAttemptPatch(id: string, attemptId: string) {
      try { return await request(`${projectPath(id)}/attempts/${encodeURIComponent(attemptId)}/patch`, readModels.patch); }
      catch (error) { if (error instanceof ApiClientError && error.status === 404) return null; throw error; }
    },
    listTaskArtifacts: (id: string, taskId: string) => request(`${projectPath(id)}/tasks/${encodeURIComponent(taskId)}/artifacts`, readModels.artifacts),
    getArtifactContent: (id: string, artifactId: string, version: number) => request(`${projectPath(id)}/artifacts/${encodeURIComponent(artifactId)}/versions/${encodeURIComponent(version)}/content`, readModels.content),
    searchKnowledge: (id: string, options: KnowledgePage & { query: string }) => request(`${projectPath(id)}/knowledge/search${knowledgeQuery(options, options.query)}`, readModels.knowledgeSearch),
    listKnowledgeArtifacts: (id: string, options: KnowledgePage = {}) => request(`${projectPath(id)}/knowledge/artifacts${knowledgeQuery(options)}`, readModels.knowledgeList),
    listDocuments: (id: string, options: KnowledgePage = {}) => request(`${projectPath(id)}/knowledge/artifacts${knowledgeQuery(options)}`, readModels.knowledgeList),
    knowledgeGroups: (id: string) => request(`${projectPath(id)}/knowledge/groups`, readModels.knowledgeGroups),
    getKnowledgeArtifact: (id: string, artifactId: string) => request(`${projectPath(id)}/knowledge/artifacts/${encodeURIComponent(artifactId)}`, readModels.knowledgeArtifact),
    getExtraction: (id: string, artifactId: string, version: number) => request(extractionPath(id, artifactId, version), extractionModels.detail),
    getExtractionText: (id: string, artifactId: string, version: number, from = 0, limit = 8000) => request(`${extractionPath(id, artifactId, version)}/text?${new URLSearchParams({ from: String(from), limit: String(Math.min(20000, limit)) })}`, extractionModels.text),
    retryExtraction: (id: string, artifactId: string, version: number) => request(`${extractionPath(id, artifactId, version)}/retry`, ok, {}),
    rawDocumentUrl: (id: string, artifactId: string, version: number, options: { download?: boolean } = {}) => `${base}${projectPath(id)}/knowledge/artifacts/${encodeURIComponent(artifactId)}/versions/${encodeURIComponent(version)}/raw${options.download ? '?download=1' : ''}`,
    fetchRawDocument: async (id: string, artifactId: string, version: number) => {
      let response: Response;
      try { response = await fetchImpl(`${base}${projectPath(id)}/knowledge/artifacts/${encodeURIComponent(artifactId)}/versions/${encodeURIComponent(version)}/raw`, { credentials: 'same-origin', cache: 'no-store' }); }
      catch { throw new ApiClientError('network'); }
      if (!response.ok) {
        try { const raw: unknown = await response.json(); const failure = failureResponseSchema.safeParse(raw); if (failure.success) throw new ApiClientError('api', response.status, failure.data.error); }
        catch (error) { if (error instanceof ApiClientError) throw error; }
        throw new ApiClientError('bad-response', response.status);
      }
      return response.arrayBuffer();
    },
    uploadDocument: (id: string, file: File, meta: DocumentUploadMeta, onProgress?: (progress: number) => void) => new Promise<import('./readModels').KnowledgeItem>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const params = new URLSearchParams({ filename: file.name, kind: String(meta.kind) });
      params.set('mediaType', mediaTypeForFile(file.name) ?? file.type);
      if (meta.title) params.set('title', meta.title);
      if (meta.artifactId) params.set('artifactId', meta.artifactId);
      if (meta.note) params.set('note', meta.note);
      xhr.open('POST', `${base}${projectPath(id)}/documents?${params}`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('content-type', 'application/octet-stream');
      if (csrfToken) xhr.setRequestHeader('x-csrf-token', csrfToken);
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(event.loaded / event.total * 100); };
      xhr.timeout = 120_000;
      xhr.ontimeout = () => reject(new ApiClientError('network'));
      xhr.onerror = () => reject(new ApiClientError('network'));
      xhr.onabort = () => reject(new ApiClientError('network'));
      xhr.onload = () => {
        let raw: unknown;
        try { raw = JSON.parse(xhr.responseText); } catch { reject(new ApiClientError('bad-response', xhr.status)); return; }
        const failure = failureResponseSchema.safeParse(raw);
        if (failure.success) {
          if (xhr.status === 409) reject(new DocumentUploadError(failure.data.error.message === 'Document quota exceeded.' ? 'quota' : 'version', xhr.status, failure.data.error));
          else reject(new ApiClientError('api', xhr.status, failure.data.error));
          return;
        }
        const parsed = readModels.uploadedArtifact.safeParse(raw);
        if (!parsed.success || xhr.status < 200 || xhr.status >= 300) { reject(new ApiClientError('bad-response', xhr.status)); return; }
        resolve(parsed.data.artifact);
      };
      xhr.send(file);
    }),
    listTaskApprovals: (id: string, taskId: string) => request(`${projectPath(id)}/tasks/${encodeURIComponent(taskId)}/approvals`, readModels.approvals),
    listWorkflows: (id: string) => request(`${projectPath(id)}/workflows`, m5ReadModels.workflows),
    getWorkflow: (id: string, instanceId: string) => request(`${projectPath(id)}/workflows/${encodeURIComponent(instanceId)}`, m5ReadModels.workflow),
    getWorkflowDefinitions: (id: string) => request(`${projectPath(id)}/workflow-definitions`, m5ReadModels.workflowDefinitions),
    listSchedules: (id: string) => request(`${projectPath(id)}/schedules`, m5ReadModels.schedules),
    listRules: (id: string) => request(`${projectPath(id)}/rules`, m5ReadModels.rules),
    listMonitors: (id: string) => request(`${projectPath(id)}/monitors`, m5ReadModels.monitors),
    listBreakers: (id: string) => request(`${projectPath(id)}/breakers`, m5ReadModels.breakers),
    listScheduleOccurrences: (id: string, scheduleId: string) => request(`${projectPath(id)}/schedules/${encodeURIComponent(scheduleId)}/occurrences`, m5ReadModels.occurrences),
    listRuleFires: (id: string, ruleId: string) => request(`${projectPath(id)}/rules/${encodeURIComponent(ruleId)}/fires`, m5ReadModels.fires),
    listMonitorEvents: (id: string, monitorId: string) => request(`${projectPath(id)}/monitors/${encodeURIComponent(monitorId)}/events`, m5ReadModels.monitorEvents),
    async getInbox(id: string) {
      const inbox = await request(`${projectPath(id)}/inbox`, readModels.inbox);
      return { ...inbox, startGates: inbox.startGates.map(item => ({ ...item, projectId: id })), requests: (inbox.requests ?? []).map(item => ({ ...item, projectId: id })), stalledWorkflows: (inbox.stalledWorkflows ?? []).map(item => ({ ...item, projectId: id })) };
    },
    async getGlobalInbox() {
      const inbox = await request('/inbox', readModels.globalInbox);
      // Older Hosts omit the project on global stalled-workflow rows. Resolve ownership
      // using scoped inboxes, without guessing or dropping rows from the global count.
      if (!(inbox.stalledWorkflows ?? []).some(item => !item.projectId)) return inbox;
      const owners = await request('/projects', projects);
      const scoped = await Promise.all(owners.projects.map(async project => ({ project, inbox: await request(`${projectPath(project.id)}/inbox`, readModels.inbox) })));
      return { ...inbox, stalledWorkflows: (inbox.stalledWorkflows ?? []).map(item => {
        const owner = scoped.find(entry => entry.inbox.stalledWorkflows?.some(row => row.instanceId === item.instanceId));
        if (!owner) throw new ApiClientError('bad-response');
        return { ...item, projectId: owner.project.id, projectName: owner.project.name };
      }) };
    },
    getApproval: (id: string, approvalId: string) => request(`${projectPath(id)}/approvals/${encodeURIComponent(approvalId)}`, readModels.approval),
    // Remote names feed push commands: keep the strict contract (envelope, name pattern, size bounds).
    getEffectRemotes: () => request('/effects/remotes', readModels.remotes),
    listProjectEffects: (id: string) => request(`${projectPath(id)}/effects`, codeReadModels.effects),
    listAttemptEffects: (id: string, attemptId: string) => request(`${projectPath(id)}/attempts/${encodeURIComponent(attemptId)}/effects`, readModels.effects),
    pushAttempt: (id: string, attemptId: string, remote: string) => request(`${projectPath(id)}/attempts/${encodeURIComponent(attemptId)}/push`, readModels.effect, { remote }),
    reconcileEffect: (id: string, effectId: string) => request(`${projectPath(id)}/effects/${encodeURIComponent(effectId)}/reconcile`, readModels.effect, {}),
    listConversations: (id: string) => request(`${projectPath(id)}/conversations`, conversations),
    listMessages: (id: string, cid: string, options: { afterOrdinal?: number; limit?: number } = {}) => {
      const query = new URLSearchParams();
      if (options.afterOrdinal !== undefined) query.set('afterOrdinal', String(options.afterOrdinal));
      if (options.limit !== undefined) query.set('limit', String(options.limit));
      return request(`${projectPath(id)}/conversations/${encodeURIComponent(cid)}/messages${query.size ? `?${query}` : ''}`, messages);
    },
    getBudget: (id: string) => request(`${projectPath(id)}/budget`, budget),
    getAutonomy: (id: string) => request(`${projectPath(id)}/autonomy`, settingsReadModels.autonomy),
    listStandingApprovals: (id: string) => request(`${projectPath(id)}/standing-approvals`, settingsReadModels.standingApprovals),
    sendCommand: (command: Command) => {
      // Validate without replacing/mutating the caller's object or generating a new identity.
      if (!commandSchema.safeParse(command).success) throw new ApiClientError('bad-response');
      return request('/commands', successResponseSchema, command, command.type === 'seats.set-runtime' || /^(workflows|schedules|rules|monitors|autonomy|standing-approvals|notifications|integration|artifacts|models)\./.test(command.type));
    },
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;
export type TeamResponse = Awaited<ReturnType<ApiClient['getTeam']>>;
export type MessagesResponse = Awaited<ReturnType<ApiClient['listMessages']>>;
export type BudgetResponse = Awaited<ReturnType<ApiClient['getBudget']>>;
