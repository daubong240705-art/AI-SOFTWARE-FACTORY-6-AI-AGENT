import { officeReadModel } from './officeModels';
import { m3Models } from './m3Models';
import { agentModels } from './agentModels';
import { groupModels } from './groupModels';
import { integrationModels } from './integrationModels';
import { flowModels, type FlowIssue } from './flowModels';
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
import { commandSchema, successResponseSchema, failureResponseSchema, projectSchema,
  conversationSchema, messageSchema, taskSchema, teamSchema, seatSchema, engagementSchema, idSchema,
  textSchema, usageSchema, budgetSchema, type ApiError, type Command } from '@factory/contracts';
import { readModels, m5ReadModels, type KnowledgePage } from './readModels';
import { codeReadModels } from './codeModels';
export type { KnowledgeResult, KnowledgeItem, KnowledgeArtifact, KnowledgeFilters, KnowledgePage, KnowledgeGroup, KnowledgeGroups, KnowledgeGroupKey } from './readModels';
export type DocumentUploadMeta = { kind: NonNullable<KnowledgePage['kinds']>[number]; title?: string; artifactId?: string; note?: string };
export type { Attempt, AttemptEvent, AttemptPatch, TaskArtifact, ArtifactContent, Inbox, Effect } from './readModels';
export type { AutomationRule, Monitor, RouteBreaker, TeamBreaker } from './readModels';

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
    this.detailKey = includeHostMessage && error ? settingsErrorKey(error.message) ?? automationErrorKey(error.message) ?? knowledgeErrorKey(error.message) : undefined;
  }
}

const integrationErrors = {
  'Integration already exists': 'duplicate', 'Integration config is too large': 'tooLarge',
  'Credential is not available in this scope': 'credentialScope', 'Connection check already running': 'alreadyChecking',
  'Credential is in use': 'credentialInUse', 'Integration scope group not found': 'groupMissing',
} as const;

class IntegrationCommandError extends ApiClientError {
  override readonly detailKey: string | undefined;
  constructor(status: number, error: ApiError) {
    super('api', status, error);
    this.detailKey = Object.hasOwn(integrationErrors, error.message) ? integrationErrors[error.message as keyof typeof integrationErrors] : undefined;
  }
}
export class DocumentUploadError extends ApiClientError {
  constructor(readonly reason: 'quota' | 'version', status: number, error: ApiError) { super('api', status, error); }
}

export class AgentCommandError extends ApiClientError {
  readonly inputMessage: string | undefined;
  constructor(status: number, error: ApiError) {
    super('api', status, error);
    this.inputMessage = error.nextAction === 'correct-input' ? error.message : undefined;
  }
}

export class FlowCommandError extends ApiClientError {
  constructor(status: number, error: ApiError, readonly issues: FlowIssue[]) {
    super('api', status, error);
  }
}

export function createApiClient({ baseUrl = '', fetchImpl = globalThis.fetch, onUnauthorized }: {
  baseUrl?: string; fetchImpl?: typeof fetch; onUnauthorized?: () => void;
} = {}) {
  let csrfToken: string | null = null;
  const base = baseUrl.replace(/\/$/, '');
  async function request<T>(path: string, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, body?: unknown, commandDetails: boolean | 'agents' | 'integrations' = false, signal?: AbortSignal, flowErrors = false): Promise<T> {
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
    if (flowErrors) {
      const failure = flowModels.failure.safeParse(raw);
      const receipt = flowModels.receipt.safeParse(raw);
      const error = failure.success ? failure.data.error : receipt.success ? receipt.data.receipt.error : undefined;
      if (error) throw new FlowCommandError(response.status, error, error.details?.issues ?? []);
    }
    const commandError = (error: ApiError) => commandDetails === 'agents'
      ? new AgentCommandError(response.status, error)
      : commandDetails === 'integrations' ? new IntegrationCommandError(response.status, error)
      : new ApiClientError('api', response.status, error, commandDetails);
    const failure = failureResponseSchema.safeParse(raw);
    if (failure.success) throw commandError(failure.data.error);
    // Command rejections can arrive inside a valid receipt, including HTTP 409.
    if (commandDetails) {
      const receipt = successResponseSchema.safeParse(raw);
      if (receipt.success && receipt.data.receipt.error) throw commandError(receipt.data.receipt.error);
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
    getOrgActivity: (signal?: AbortSignal) => request('/org/activity', activityReadModel, undefined, false, signal),
    getProjectInteractions: (id: string, limit = 120, signal?: AbortSignal) => request(`${projectPath(id)}/interactions?limit=${limit}`, officeReadModel, undefined, false, signal),
    listProjectAgents: (id: string, signal?: AbortSignal) => request(`${projectPath(id)}/agents`, agentModels.project, undefined, false, signal),
    listProjectFlows: (id: string, signal?: AbortSignal) => request(`${projectPath(id)}/flows`, flowModels.list, undefined, false, signal),
    getFlow: (id: string, flowId: string, signal?: AbortSignal) => request(`${projectPath(id)}/flows/${encodeURIComponent(flowId)}`, flowModels.detail, undefined, false, signal),
    getFlowRun: (id: string, runId: string, signal?: AbortSignal) => request(`${projectPath(id)}/flow-runs/${encodeURIComponent(runId)}`, flowModels.run, undefined, false, signal),
    sendFlowCommand: async (command: Command) => {
      const parsed = commandSchema.safeParse(command);
      if (!parsed.success) throw new ApiClientError('bad-response');
      if (!csrfToken) csrfToken = (await request('/auth/session', auth)).csrfToken;
      return request('/commands', successResponseSchema, parsed.data, true, undefined, true);
    },
    getAgent: (id: string, agentId: string, signal?: AbortSignal) => request(`${projectPath(id)}/agents/${encodeURIComponent(agentId)}`, agentModels.detail, undefined, false, signal),
    getAgentRevision: (id: string, agentId: string, revision: number, signal?: AbortSignal) => request(`${projectPath(id)}/agents/${encodeURIComponent(agentId)}/revisions/${encodeURIComponent(revision)}`, agentModels.revision, undefined, false, signal),
    getAgentLibrary: (signal?: AbortSignal) => request('/library', agentModels.library, undefined, false, signal),
    getScopedLibrary: (scope: { groupId: string } | { projectId: string }, signal?: AbortSignal) =>
      request(`/library?${new URLSearchParams(scope)}`, agentModels.library, undefined, false, signal),
    listGroups: (signal?: AbortSignal) => request('/groups', groupModels.list, undefined, false, signal),
    getGroup: (id: string, signal?: AbortSignal) => request(`/groups/${encodeURIComponent(id)}`, groupModels.detail, undefined, false, signal),
    listIntegrations: (groupId?: string, signal?: AbortSignal) => request(`/integrations${groupId ? `?${new URLSearchParams({ groupId })}` : ''}`, integrationModels.list, undefined, false, signal),
    getIntegration: (id: string, signal?: AbortSignal) => request(`/integrations/${encodeURIComponent(id)}`, integrationModels.detail, undefined, false, signal),
    listCredentials: (signal?: AbortSignal) => request('/credentials', integrationModels.credentials, undefined, false, signal),
    listHttpEffects: (id: string, signal?: AbortSignal) => request(`${projectPath(id)}/http-effects`, integrationModels.effects, undefined, false, signal),
    reconcileHttpEffect: async (projectId: string, id: string, resolution: 'done' | 'failed') => {
      if (!csrfToken) csrfToken = (await request('/auth/session', auth)).csrfToken;
      return request(`${projectPath(projectId)}/http-effects/${encodeURIComponent(id)}/reconcile`, integrationModels.reconciled, { resolution });
    },
    sendIntegrationCommand: async (command: Command) => {
      if (!commandSchema.safeParse(command).success) throw new ApiClientError('bad-response');
      if (!csrfToken) csrfToken = (await request('/auth/session', auth)).csrfToken;
      return request('/commands', successResponseSchema, command, 'integrations');
    },
    getSkill: (id: string, signal?: AbortSignal) => request(`/library/skills/${encodeURIComponent(id)}`, agentModels.skill, undefined, false, signal),
    getSkillVersion: (id: string, version: number | 'latest', signal?: AbortSignal) => request(`/library/skills/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}`, agentModels.skillVersion, undefined, false, signal),
    getAgentTemplate: (id: string, signal?: AbortSignal) => request(`/library/templates/${encodeURIComponent(id)}`, agentModels.template, undefined, false, signal),
    getAgentTemplateRevision: (id: string, revision: number, signal?: AbortSignal) => request(`/library/templates/${encodeURIComponent(id)}?revision=${encodeURIComponent(revision)}`, agentModels.template, undefined, false, signal),
    sendAgentCommand: async (command: Command) => {
      if (!commandSchema.safeParse(command).success) throw new ApiClientError('bad-response');
      if (!csrfToken) csrfToken = (await request('/auth/session', auth)).csrfToken;
      return request('/commands', successResponseSchema, command, 'agents');
    },
    listPacks: () => request('/packs', m3Models.packs),
    getPack: (key: string) => request(`/packs/${encodeURIComponent(key)}`, packDetailModel),
    listMcpServers: () => request('/mcp-servers', mcpServersModel),
    systemHealth: () => request('/health', systemModels.health),
    systemCapabilities: () => request('/system/capabilities', systemModels.capabilities),
    systemDoctor: (checkModel = false, signal?: AbortSignal) => request(`/system/doctor${checkModel ? '?model=1' : ''}`, systemModels.doctor, undefined, false, signal),
    getAgentClis: () => request('/system/agent-clis', agentClisModel),
    systemBackups: () => request('/system/backups', systemModels.backups),
    getModelSettings: () => request('/system/models', modelSettingsResponse),
    browseFolders: (path?: string, signal?: AbortSignal) => request(`/system/browse${path ? `?${new URLSearchParams({ path })}` : ''}`, folderBrowseModel, undefined, false, signal),
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
    listProjects: (signal?: AbortSignal) => request('/projects', projects, undefined, false, signal),
    getProject: (id: string, signal?: AbortSignal) => request(projectPath(id), ok.extend({ project: projectSchema }), undefined, false, signal),
    getTeam: (id: string, signal?: AbortSignal) => request(`${projectPath(id)}/team`, team, undefined, false, signal),
    listTasks: (id: string, signal?: AbortSignal) => request(`${projectPath(id)}/tasks`, tasks, undefined, false, signal),
    listAttempts: (id: string, taskId: string, signal?: AbortSignal) => request(`${projectPath(id)}/tasks/${encodeURIComponent(taskId)}/attempts`, readModels.attempts, undefined, false, signal),
    listProjectAttempts: (id: string, options: { since?: string; limit?: number } = {}) => {
      const query = new URLSearchParams();
      if (options.since !== undefined) query.set('since', options.since);
      if (options.limit !== undefined) query.set('limit', String(options.limit));
      return request(`${projectPath(id)}/attempts${query.size ? `?${query}` : ''}`, readModels.projectAttempts);
    },
    listAttemptEvents: (id: string, attemptId: string, options: { afterSeq?: number; limit?: number } = {}, signal?: AbortSignal) => {
      const query = new URLSearchParams();
      if (options.afterSeq !== undefined) query.set('afterSeq', String(options.afterSeq));
      if (options.limit !== undefined) query.set('limit', String(options.limit));
      return request(`${projectPath(id)}/attempts/${encodeURIComponent(attemptId)}/events${query.size ? `?${query}` : ''}`, readModels.events, undefined, false, signal);
    },
    async getAttemptPatch(id: string, attemptId: string) {
      try { return await request(`${projectPath(id)}/attempts/${encodeURIComponent(attemptId)}/patch`, readModels.patch); }
      catch (error) { if (error instanceof ApiClientError && error.status === 404) return null; throw error; }
    },
    listTaskArtifacts: (id: string, taskId: string, signal?: AbortSignal) => request(`${projectPath(id)}/tasks/${encodeURIComponent(taskId)}/artifacts`, readModels.artifacts, undefined, false, signal),
    getArtifactContent: (id: string, artifactId: string, version: number, signal?: AbortSignal) => request(`${projectPath(id)}/artifacts/${encodeURIComponent(artifactId)}/versions/${encodeURIComponent(version)}/content`, readModels.content, undefined, false, signal),
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
    listTaskApprovals: (id: string, taskId: string, signal?: AbortSignal) => request(`${projectPath(id)}/tasks/${encodeURIComponent(taskId)}/approvals`, readModels.approvals, undefined, false, signal),
    listRules: (id: string) => request(`${projectPath(id)}/rules`, m5ReadModels.rules),
    listMonitors: (id: string) => request(`${projectPath(id)}/monitors`, m5ReadModels.monitors),
    listBreakers: (id: string) => request(`${projectPath(id)}/breakers`, m5ReadModels.breakers),
    listRuleFires: (id: string, ruleId: string) => request(`${projectPath(id)}/rules/${encodeURIComponent(ruleId)}/fires`, m5ReadModels.fires),
    listMonitorEvents: (id: string, monitorId: string) => request(`${projectPath(id)}/monitors/${encodeURIComponent(monitorId)}/events`, m5ReadModels.monitorEvents),
    async getInbox(id: string) {
      const inbox = await request(`${projectPath(id)}/inbox`, readModels.inbox);
      return { ...inbox, startGates: inbox.startGates.map(item => ({ ...item, projectId: id })), requests: (inbox.requests ?? []).map(item => ({ ...item, projectId: id })) };
    },
    getGlobalInbox: () => request('/inbox', readModels.globalInbox),
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
      return request('/commands', successResponseSchema, command, command.type === 'projects.create' || /^(rules|monitors|autonomy|standing-approvals|notifications|integration|artifacts|models)\./.test(command.type));
    },
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;
export type TeamResponse = Awaited<ReturnType<ApiClient['getTeam']>>;
export type MessagesResponse = Awaited<ReturnType<ApiClient['listMessages']>>;
export type BudgetResponse = Awaited<ReturnType<ApiClient['getBudget']>>;
