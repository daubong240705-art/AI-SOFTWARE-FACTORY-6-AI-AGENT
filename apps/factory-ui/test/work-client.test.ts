import { expect, it, vi } from 'vitest';
import { createApiClient, type ApiClient } from '../src/api/client';
import { approvalsDecide, runsCancel, tasksRelease, tasksRetry } from '../src/api/commands';
import { commandSchema } from '@factory/contracts';
import { artifact, approval, attempt, patch, progress } from './ui-fixtures';
import { envelope, failure, id, otherId, response } from './fixtures';

const content = { mediaType: 'text/plain', sizeBytes: 4, contentHash: 'a'.repeat(64), text: 'text' };
type Route = { name: string; invoke: (api: ApiClient) => Promise<unknown>; body: Record<string, unknown>; field: string; path: string };
const routes: Route[] = [
  { name: 'attempts', invoke: api => api.listAttempts(id, otherId), body: { ...envelope, attempts: [attempt] }, field: 'attempts', path: `/projects/${id}/tasks/${otherId}/attempts` },
  { name: 'events', invoke: api => api.listAttemptEvents(id, otherId, { afterSeq: 5, limit: 500 }), body: { ...envelope, events: [progress] }, field: 'events', path: `/projects/${id}/attempts/${otherId}/events?afterSeq=5&limit=500` },
  { name: 'patch', invoke: api => api.getAttemptPatch(id, otherId), body: { ...envelope, ...patch }, field: 'patch', path: `/projects/${id}/attempts/${otherId}/patch` },
  { name: 'artifacts', invoke: api => api.listTaskArtifacts(id, otherId), body: { ...envelope, items: [artifact] }, field: 'items', path: `/projects/${id}/tasks/${otherId}/artifacts` },
  { name: 'content', invoke: api => api.getArtifactContent(id, otherId, 2), body: { ...envelope, ...content }, field: 'text', path: `/projects/${id}/artifacts/${otherId}/versions/2/content` },
  { name: 'approvals', invoke: api => api.listTaskApprovals(id, otherId), body: { ...envelope, approvals: [approval] }, field: 'approvals', path: `/projects/${id}/tasks/${otherId}/approvals` },
];
for (const route of routes) {
  it(`${route.name}: validates a response and uses same-origin no-store`, async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(route.body));
    await expect(route.invoke(createApiClient({ fetchImpl }))).resolves.toEqual(route.body);
    expect(fetchImpl).toHaveBeenCalledWith(route.path, expect.objectContaining({ method: 'GET', credentials: 'same-origin', cache: 'no-store' }));
  });
  it(`${route.name}: rejects missing fields`, async () => {
    const body = { ...route.body }; delete body[route.field];
    await expect(route.invoke(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(body)) }))).rejects.toMatchObject({ kind: 'bad-response' });
  });
  it(`${route.name}: rejects wrong types`, async () => {
    await expect(route.invoke(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...route.body, [route.field]: 42 })) }))).rejects.toMatchObject({ kind: 'bad-response' });
  });
  it(`${route.name}: ignores extra fields`, async () => {
    await expect(route.invoke(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...route.body, extra: '<secret>' })) }))).resolves.toEqual(route.body);
  });
  it(`${route.name}: handles 401 and never swallows it`, async () => {
    const onUnauthorized = vi.fn();
    await expect(route.invoke(createApiClient({ onUnauthorized, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({}, 401)) }))).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
  it(`${route.name}: maps only patch 404 to null`, async () => {
    const promise = route.invoke(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({}, 404)) }));
    if (route.name === 'patch') await expect(promise).resolves.toBeNull(); else await expect(promise).rejects.toMatchObject({ status: 404 });
  });
  it(`${route.name}: never exposes failure text`, async () => {
    const error: unknown = await route.invoke(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...failure, error: { ...failure.error, message: 'HOST_PRIVATE_TEXT' } }, 409)) })).catch((error: unknown) => error);
    expect(String(error)).not.toContain('HOST_PRIVATE_TEXT'); expect(error).toMatchObject({ code: 'conflict' });
  });
  it(`${route.name}: rejects wrong API versions`, async () => {
    await expect(route.invoke(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...route.body, apiVersion: 2 })) }))).rejects.toMatchObject({ kind: 'bad-response' });
  });
}
const invalidModels = [
  ['attempts', { attempts: [{ ...attempt, seatName: 'x'.repeat(501) }] }],
  ['attempts', { attempts: [{ ...attempt, state: 'bogus' }] }],
  ['attempts', { attempts: [{ ...attempt, runtime: 'bogus' }] }],
  ['attempts', { attempts: [{ ...attempt, outcome: 'bogus' }] }],
  ['attempts', { attempts: [{ ...attempt, epoch: 0 }] }],
  ['attempts', { attempts: [{ ...attempt, revision: 1.5 }] }],
  ['attempts', { attempts: [{ ...attempt, endedAt: 'not-a-date' }] }],
  ['attempts', { attempts: Array.from({ length: 5001 }, () => attempt) }],
  ['events', { events: [{ ...progress, seq: -1 }] }],
  ['events', { events: [{ ...progress, kind: 'bogus' }] }],
  ['events', { events: [{ seq: 1, at: progress.at, kind: 'state' }] }],
  ['events', { events: Array.from({ length: 5001 }, () => progress) }],
  ['patch', { ...patch, patch: 'x'.repeat(8_388_609) }],
  ['patch', { ...patch, sha256: 'wrong' }],
  ['patch', { ...patch, bytes: -1 }],
  ['content', { ...content, text: 'x'.repeat(8_388_609) }],
  ['content', { ...content, mediaType: 'x'.repeat(129) }],
  ['content', { ...content, sizeBytes: Number.MAX_SAFE_INTEGER + 1 }],
  ['artifacts', { items: [{ ...artifact, title: 'x'.repeat(501) }] }],
  ['artifacts', { items: [{ ...artifact, kind: 'bogus' }] }],
  ['artifacts', { items: [{ ...artifact, versions: [{ ...artifact.versions[0], status: 'bogus' }] }] }],
  ['artifacts', { items: [{ ...artifact, versions: Array.from({ length: 5001 }, () => artifact.versions[0]) }] }],
  ['artifacts', { items: Array.from({ length: 5001 }, () => artifact) }],
  ['approvals', { approvals: [{ ...approval, summary: 'x'.repeat(4001) }] }],
  ['approvals', { approvals: [{ ...approval, subject: 'x'.repeat(501) }] }],
  ['approvals', { approvals: [{ ...approval, state: 'bogus' }] }],
  ['approvals', { approvals: [{ ...approval, revision: '1' }] }],
  ['approvals', { approvals: Array.from({ length: 5001 }, () => approval) }],
] as const;
it.each(invalidModels.map(([name, body], index) => [name, body, index] as const))('%s rejects hostile model %#', async (name, body) => {
  const route = routes.find(route => route.name === name)!;
  await expect(route.invoke(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, ...body })) }))).rejects.toMatchObject({ kind: 'bad-response' });
});
it('events keep opaque bodies and discard nested extra metadata', async () => {
  const body = { ...envelope, events: [{ ...progress, extra: true, body: { nested: ['<img>', null] } }] };
  const api = createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(body)) });
  expect((await api.listAttemptEvents(id, otherId)).events).toEqual([{ ...progress, body: body.events[0]!.body }]);
});
it('nested attempt extras are ignored', async () => {
  const api = createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, attempts: [{ ...attempt, extra: true }] })) });
  expect((await api.listAttempts(id, otherId)).attempts).toEqual([attempt]);
});
it('patch errors other than 404 propagate', async () => {
  await expect(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({}, 415)) }).getAttemptPatch(id, otherId)).rejects.toMatchObject({ status: 415 });
});
const builders = [
  () => tasksRelease({ projectId: id, taskId: otherId, expectedRevision: 2 }),
  () => runsCancel({ projectId: id, attemptId: otherId, expectedRevision: 2 }),
  () => tasksRetry({ projectId: id, taskId: otherId, expectedRevision: 2 }),
  () => approvalsDecide({ projectId: id, approvalId: otherId, expectedRevision: 2, contextDigest: 'a'.repeat(64), optionId: 'yes', comment: 'Continue' }),
];
it.each(builders)('new command passes the contract %#', builder => { expect(commandSchema.safeParse(builder()).success).toBe(true); expect(builder().commandId).not.toBe(builder().commandId); });
it('cancel maps attemptId to runId', () => { expect(builders[1]!().payload).toEqual({ runId: otherId, expectedRevision: 2 }); });
it('retry transitions to active', () => { expect(builders[2]!()).toMatchObject({ type: 'tasks.transition', payload: { to: 'active' } }); });
it.each(['', 'bad', 'a'.repeat(63)])('decision rejects digest %s', contextDigest => { expect(() => approvalsDecide({ projectId: id, approvalId: id, expectedRevision: 1, contextDigest, optionId: 'yes', comment: '' })).toThrow(); });
it('decision preserves exactly the context the user saw', () => { expect(builders[3]!().payload).toMatchObject({ approvalId: otherId, expectedRevision: 2, contextDigest: 'a'.repeat(64), optionId: 'yes', comment: 'Continue' }); });

// --- added by the lead after mutation testing ---------------------------------------------------------------------
const bad = (route: Route, body: Record<string, unknown>) =>
  expect(route.invoke(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(body)) }))).rejects.toMatchObject({ kind: 'bad-response' });
for (const route of routes) {
  it(`${route.name}: rejects an envelope that is not ok`, async () => { await bad(route, { ...route.body, ok: false }); });
  it(`${route.name}: rejects another API version`, async () => { await bad(route, { ...route.body, apiVersion: 999 }); });
}
const route = (name: string) => routes.find(item => item.name === name)!;
for (const at of ['yesterday', '', '2026-13-45T99:99:99Z', 12345, null]) {
  it(`events: rejects the timestamp ${JSON.stringify(at)}`, async () => { await bad(route('events'), { ...route('events').body, events: [{ ...progress, at }] }); });
}
for (const sha256 of ['a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), '', 7]) {
  it(`patch: rejects the hash ${JSON.stringify(sha256)}`, async () => { await bad(route('patch'), { ...route('patch').body, sha256 }); });
}
for (const contentHash of ['a'.repeat(63), 'a'.repeat(65), 'z'.repeat(64)]) {
  it(`content: rejects the hash ${JSON.stringify(contentHash)}`, async () => { await bad(route('content'), { ...route('content').body, contentHash }); });
}
