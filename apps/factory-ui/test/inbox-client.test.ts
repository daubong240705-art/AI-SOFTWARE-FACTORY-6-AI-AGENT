import { expect, it, vi } from 'vitest';
import { createApiClient, type ApiClient } from '../src/api/client';
import { envelope, failure, id, otherId, response } from './fixtures';
import { review, inbox, globalInbox, effect } from './inbox-fixtures';

type Route = { name: string; invoke: (api: ApiClient) => Promise<unknown>; body: Record<string, unknown>; field: string; path: string; post?: object };
const routes: Route[] = [
  { name: 'project inbox', invoke: api => api.getInbox(id), body: { ...envelope, ...inbox }, field: 'approvals', path: `/projects/${id}/inbox` },
  { name: 'global inbox', invoke: api => api.getGlobalInbox(), body: { ...envelope, ...globalInbox }, field: 'startGates', path: '/inbox' },
  { name: 'fresh approval', invoke: api => api.getApproval(id, otherId), body: { ...envelope, approval: review }, field: 'approval', path: `/projects/${id}/approvals/${otherId}` },
  { name: 'remotes', invoke: api => api.getEffectRemotes(), body: { ...envelope, remotes: ['origin'] }, field: 'remotes', path: '/effects/remotes' },
  { name: 'effects', invoke: api => api.listAttemptEffects(id, otherId), body: { ...envelope, effects: [effect] }, field: 'effects', path: `/projects/${id}/attempts/${otherId}/effects` },
  { name: 'push', invoke: api => api.pushAttempt(id, otherId, 'origin'), body: { ...envelope, effect }, field: 'effect', path: `/projects/${id}/attempts/${otherId}/push`, post: { remote: 'origin' } },
  { name: 'reconcile', invoke: api => api.reconcileEffect(id, otherId), body: { ...envelope, effect }, field: 'effect', path: `/projects/${id}/effects/${otherId}/reconcile`, post: {} },
];
for (const route of routes) {
  it(`${route.name}: validates and routes with cookies and no-store`, async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(route.body));
    await expect(route.invoke(createApiClient({ fetchImpl }))).resolves.toEqual(route.body);
    expect(fetchImpl).toHaveBeenCalledWith(route.path, expect.objectContaining({ method: route.post ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', ...(route.post ? { body: JSON.stringify(route.post) } : {}) }));
  });
  it(`${route.name}: rejects a missing required field`, async () => { const body = { ...route.body }; delete body[route.field]; await expect(route.invoke(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(body)) }))).rejects.toMatchObject({ kind: 'bad-response' }); });
  it(`${route.name}: rejects a wrong field type`, async () => { await expect(route.invoke(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...route.body, [route.field]: 42 })) }))).rejects.toMatchObject({ kind: 'bad-response' }); });
  it(`${route.name}: discards unknown envelope fields`, async () => { await expect(route.invoke(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...route.body, extra: 'PRIVATE' })) }))).resolves.toEqual(route.body); });
  it(`${route.name}: rejects a wrong API version`, async () => { await expect(route.invoke(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...route.body, apiVersion: 2 })) }))).rejects.toMatchObject({ kind: 'bad-response' }); });
  it(`${route.name}: reports 401 and calls unauthorized observer`, async () => { const onUnauthorized = vi.fn(); await expect(route.invoke(createApiClient({ onUnauthorized, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({}, 401)) }))).rejects.toMatchObject({ status: 401 }); expect(onUnauthorized).toHaveBeenCalledOnce(); });
  it(`${route.name}: hides server error text`, async () => { const result: unknown = await route.invoke(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...failure, error: { ...failure.error, message: 'SERVER_SECRET' } }, 409)) })).catch((error: unknown) => error); expect(result).toMatchObject({ code: 'conflict' }); expect(String(result)).not.toContain('SERVER_SECRET'); });
  it(`${route.name}: hides transport error text`, async () => { const result: unknown = await route.invoke(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error('TRANSPORT_SECRET')) })).catch((error: unknown) => error); expect(result).toMatchObject({ kind: 'network' }); expect(String(result)).not.toContain('TRANSPORT_SECRET'); });
  it(`${route.name}: rejects malformed JSON`, async () => { await expect(route.invoke(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('invalid')) }))).rejects.toMatchObject({ kind: 'bad-response' }); });
}
it.each(['push', 'reconcile'])('%s uses CSRF on POST outside /commands', async name => {
  const route = routes.find(item => item.name === name)!; const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ ...envelope, csrfToken: 'fixture' })).mockResolvedValueOnce(response(route.body));
  const api = createApiClient({ fetchImpl }); await api.session(); await route.invoke(api); expect(fetchImpl.mock.calls[1]?.[1]?.headers).toEqual({ 'content-type': 'application/json', 'x-csrf-token': 'fixture' });
});
it.each(['Origin', '-origin', 'origin_name', 'remote.git', 'https://host/repo', '', 'x'.repeat(41), 12, null])('rejects invalid remote name %#', async remote => {
  for (const body of [{ remotes: [remote] }, { effects: [{ ...effect, remote }] }]) { const api = createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, ...body })) }); await expect('remotes' in body ? api.getEffectRemotes() : api.listAttemptEffects(id, otherId)).rejects.toMatchObject({ kind: 'bad-response' }); }
});
it.each(['o', 'origin', '1-backup', 'a'.repeat(40)])('accepts remote name %s', async name => { await expect(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, remotes: [name] })) }).getEffectRemotes()).resolves.toMatchObject({ remotes: [name] }); });
it.each([
  { id: 'wrong' }, { attemptId: null }, { kind: 'git.force' }, { state: 'retrying' }, { error: 'SERVER_DETAIL' }, { branch: 'x'.repeat(161) }, { branch: 42 }, { createdAt: 'yesterday' }, { completedAt: false },
])('rejects malformed effect %#', async patch => { await expect(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, effect: { ...effect, ...patch } })) }).pushAttempt(id, otherId, 'origin')).rejects.toMatchObject({ kind: 'bad-response' }); });
it.each(['pending', 'done', 'failed', 'unknown'])('accepts effect state %s', async state => { await expect(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, effect: { ...effect, state } })) }).reconcileEffect(id, id)).resolves.toMatchObject({ effect: { state } }); });
it.each(['auth', 'rejected', 'network', 'timeout', 'other', 'not-pushed', null])('accepts fixed error %s', async error => { await expect(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, effects: [{ ...effect, error }] })) }).listAttemptEffects(id, otherId)).resolves.toMatchObject({ effects: [{ error }] }); });
it.each([{ kind: 'custom' }, { revision: 0 }, { options: [] }, { subject: 'x'.repeat(501) }, { summary: 'x'.repeat(4001) }, { context: { refs: [], digest: 'wrong' } }, { state: 'resolved' }, { expiresAt: '2020-01-01T00:00:00.000Z' }])('uses approval contract validation %#', async patch => { await expect(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, approval: { ...review, ...patch } })) }).getApproval(id, id)).rejects.toMatchObject({ kind: 'bad-response' }); });
it.each([{ total: -1 }, { approvals: '2' }, { startGates: 0.5 }, { total: Number.MAX_SAFE_INTEGER + 1 }])('rejects invalid inbox counts %#', async patch => { await expect(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, ...inbox, counts: { ...inbox.counts, ...patch } })) }).getInbox(id)).rejects.toMatchObject({ kind: 'bad-response' }); });
it('requires project names in the global inbox', async () => { await expect(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, ...inbox })) }).getGlobalInbox()).rejects.toMatchObject({ kind: 'bad-response' }); });
it('ignores nested extra approval and effect fields', async () => {
  const approvalApi = createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, approval: { ...review, extra: 'private', options: review.options.map(option => ({ ...option, extra: true })), context: { ...review.context, extra: true } } })) });
  await expect(approvalApi.getApproval(id, id)).resolves.toEqual({ ...envelope, approval: review });
  await expect(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, effect: { ...effect, extra: 'private' } })) }).pushAttempt(id, otherId, 'origin')).resolves.toEqual({ ...envelope, effect });
});
it('accepts history comments up to 32000 characters', async () => { await expect(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, approval: { ...review, state: 'approved', outcome: { optionId: 'accept', actorId: id, decidedAt: review.requestedAt, comment: 'x'.repeat(32000) } } })) }).getApproval(id, id)).resolves.toBeTruthy(); });
it('rejects oversized history comments', async () => { await expect(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, approval: { ...review, state: 'approved', outcome: { optionId: 'accept', actorId: id, decidedAt: review.requestedAt, comment: 'x'.repeat(32001) } } })) }).getApproval(id, id)).rejects.toMatchObject({ kind: 'bad-response' }); });
it('rejects an oversized remotes list', async () => { await expect(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, remotes: Array.from({ length: 5001 }, () => 'origin') })) }).getEffectRemotes()).rejects.toMatchObject({ kind: 'bad-response' }); });
