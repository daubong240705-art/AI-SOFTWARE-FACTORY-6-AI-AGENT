import { commandSchema, successResponseSchema, failureResponseSchema, projectSchema,
  conversationSchema, messageSchema, taskSchema, teamSchema, seatSchema, engagementSchema, idSchema,
  textSchema, usageSchema, budgetSchema, type ApiError, type Command } from '@factory/contracts';
import { readModels } from './readModels';
export type { Attempt, AttemptEvent, AttemptPatch, TaskArtifact, ArtifactContent, Inbox, Effect } from './readModels';

// Extend exported strict contract objects to validate the Host's HTTP envelopes without
// importing their private schema-library dependency into this package.
const ok = successResponseSchema.pick({ ok: true, apiVersion: true });
const object = ok.omit({ ok: true, apiVersion: true });
const auth = ok.extend({ csrfToken: textSchema });
const projects = ok.extend({ projects: projectSchema.array() });
const team = ok.extend({ team: teamSchema, seats: seatSchema.array(), engagement: engagementSchema });
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
  constructor(readonly kind: ApiClientErrorKind, readonly status?: number, error?: ApiError) {
    // Never echo transport errors or server text: either can contain credentials or request content.
    super(error ? safeMessages[error.code] : kind === 'network' ? 'Cannot reach the Host.' : 'Invalid Host response.');
    this.name = 'ApiClientError';
    this.code = error?.code;
    this.nextAction = error?.nextAction;
    this.correlationId = error?.correlationId;
    this.currentRevision = error?.currentRevision;
  }
}

export function createApiClient({ baseUrl = '', fetchImpl = globalThis.fetch, onUnauthorized }: {
  baseUrl?: string; fetchImpl?: typeof fetch; onUnauthorized?: () => void;
} = {}) {
  let csrfToken: string | null = null;
  const base = baseUrl.replace(/\/$/, '');
  async function request<T>(path: string, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      if (csrfToken) headers['x-csrf-token'] = csrfToken;
    }
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers,
        credentials: 'same-origin', cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new ApiClientError('network'); }
    if (response.status === 401) {
      csrfToken = null;
      try { onUnauthorized?.(); } catch { /* Observers cannot replace a safe API error. */ }
    }
    let raw: unknown;
    try { raw = await response.json(); } catch { throw new ApiClientError('bad-response', response.status); }
    const failure = failureResponseSchema.safeParse(raw);
    if (failure.success) throw new ApiClientError('api', response.status, failure.data.error);
    const parsed = schema.safeParse(raw);
    if (!response.ok || !parsed.success) throw new ApiClientError('bad-response', response.status);
    return parsed.data;
  }
  const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`;
  return {
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
    listTaskApprovals: (id: string, taskId: string) => request(`${projectPath(id)}/tasks/${encodeURIComponent(taskId)}/approvals`, readModels.approvals),
    getInbox: (id: string) => request(`${projectPath(id)}/inbox`, readModels.inbox),
    getGlobalInbox: () => request('/inbox', readModels.globalInbox),
    getApproval: (id: string, approvalId: string) => request(`${projectPath(id)}/approvals/${encodeURIComponent(approvalId)}`, readModels.approval),
    getEffectRemotes: () => request('/effects/remotes', readModels.remotes),
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
    sendCommand: (command: Command) => {
      // Validate without replacing/mutating the caller's object or generating a new identity.
      if (!commandSchema.safeParse(command).success) throw new ApiClientError('bad-response');
      return request('/commands', successResponseSchema, command);
    },
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;
export type TeamResponse = Awaited<ReturnType<ApiClient['getTeam']>>;
export type MessagesResponse = Awaited<ReturnType<ApiClient['listMessages']>>;
export type BudgetResponse = Awaited<ReturnType<ApiClient['getBudget']>>;
