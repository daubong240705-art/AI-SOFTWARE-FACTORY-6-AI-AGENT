import { expect, it, vi } from 'vitest';
import { createApiClient, type ApiClient } from '../src/api/client';
import { knowledgeKinds, knowledgeStatuses, knowledgeVisibilities } from '../src/api/readModels';
import { envelope, failure, id, otherId, response } from './fixtures';
import { document, item, result, version } from './knowledge-fixtures';

type Route = { name: string; invoke: (api: ApiClient) => Promise<unknown>; body: Record<string, unknown>; field: string; path: string; model: Record<string, unknown>; wrap: (model: Record<string, unknown>) => Record<string, unknown> };
const routes: Route[] = [
  { name: 'search', invoke: api => api.searchKnowledge(id, { query: 'tài liệu &?#/+' }), body: { ...envelope, results: [result] }, field: 'results', path: `/projects/${id}/knowledge/search?q=t%C3%A0i+li%E1%BB%87u+%26%3F%23%2F%2B`, model: result, wrap: model => ({ results: [model] }) },
  { name: 'list', invoke: api => api.listKnowledgeArtifacts(id), body: { ...envelope, items: [item] }, field: 'items', path: `/projects/${id}/knowledge/artifacts`, model: item, wrap: model => ({ items: [model] }) },
  { name: 'detail', invoke: api => api.getKnowledgeArtifact(id, otherId), body: { ...envelope, artifact: document }, field: 'artifact', path: `/projects/${id}/knowledge/artifacts/${otherId}`, model: document, wrap: model => ({ artifact: model }) },
];
const client = (body: unknown, status = 200) => createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(body, status)) });
for (const route of routes) {
  it(`${route.name}: validates and sends safe GET options`, async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(route.body));
    await expect(route.invoke(createApiClient({ fetchImpl }))).resolves.toEqual(route.body);
    expect(fetchImpl).toHaveBeenCalledWith(route.path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: {} });
  });
  it(`${route.name}: rejects missing envelope payload`, async () => { await expect(route.invoke(client(envelope))).rejects.toMatchObject({ kind: 'bad-response' }); });
  it(`${route.name}: rejects wrong payload type`, async () => { await expect(route.invoke(client({ ...route.body, [route.field]: 7 }))).rejects.toMatchObject({ kind: 'bad-response' }); });
  it(`${route.name}: drops extra fields at both levels`, async () => {
    await expect(route.invoke(client({ ...envelope, ...route.wrap({ ...route.model, ignored: 'PRIVATE' }), ignored: 'PRIVATE' }))).resolves.toEqual(route.body);
  });
  it(`${route.name}: handles unauthorized`, async () => {
    const onUnauthorized = vi.fn();
    await expect(route.invoke(createApiClient({ onUnauthorized, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({}, 401)) }))).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
  it(`${route.name}: suppresses server failure text`, async () => {
    const error: unknown = await route.invoke(client({ ...failure, error: { ...failure.error, message: 'PRIVATE_SERVER_TEXT' } }, 409)).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'conflict' }); expect(String(error)).not.toContain('PRIVATE_SERVER_TEXT');
  });
  it(`${route.name}: suppresses malformed server text`, async () => {
    const error: unknown = await route.invoke(client({ message: 'PRIVATE_SERVER_TEXT' })).catch((error: unknown) => error);
    expect(error).toMatchObject({ kind: 'bad-response', message: 'Invalid Host response.' });
  });
  for (const field of Object.keys(route.model)) {
    it(`${route.name}: requires ${field}`, async () => {
      const model = { ...route.model }; delete model[field];
      await expect(route.invoke(client({ ...envelope, ...route.wrap(model) }))).rejects.toMatchObject({ kind: 'bad-response' });
    });
  }
  for (const [field, value] of [['title', 'x'.repeat(501)], ['title', 5], ['kind', 'unknown'], ['artifactId', 'invalid']] as const) {
    it(`${route.name}: rejects invalid ${field} ${typeof value}`, async () => {
      await expect(route.invoke(client({ ...envelope, ...route.wrap({ ...route.model, [field]: value }) }))).rejects.toMatchObject({ kind: 'bad-response' });
    });
  }
  for (const patch of [{ apiVersion: 2 }, { ok: false }]) {
    it(`${route.name}: rejects envelope ${JSON.stringify(patch)}`, async () => { await expect(route.invoke(client({ ...route.body, ...patch }))).rejects.toMatchObject({ kind: 'bad-response' }); });
  }
}
for (const route of routes.slice(0, 2)) {
  for (const [field, value] of [['abstractL0', 'x'.repeat(6001)], ['version', 0], ['version', 1.5], ['version', Number.MAX_SAFE_INTEGER + 1], ['status', 'unknown'], ['visibility', 'unknown'], ['projectId', null]] as const) {
    it(`${route.name}: rejects ${field} boundary ${String(value).slice(0, 10)}`, async () => {
      await expect(route.invoke(client({ ...envelope, ...route.wrap({ ...route.model, [field]: value }) }))).rejects.toMatchObject({ kind: 'bad-response' });
    });
  }
  it(`${route.name}: bounds arrays to 200`, async () => { await expect(route.invoke(client({ ...envelope, [route.field]: Array.from({ length: 201 }, () => route.model) }))).rejects.toMatchObject({ kind: 'bad-response' }); });
}
it.each([['snippet', 'x'.repeat(1001)], ['rank', '1'], ['rank', null]])('search rejects invalid %s', async (field, value) => {
  await expect(client({ ...envelope, results: [{ ...result, [String(field)]: value }] }).searchKnowledge(id, { query: 'q' })).rejects.toMatchObject({ kind: 'bad-response' });
});
it.each([['versionCount', 0], ['sizeBytes', -1], ['sizeBytes', 1.5], ['createdAt', 'yesterday'], ['mediaType', 'x'.repeat(129)]])('list rejects invalid %s', async (field, value) => {
  await expect(client({ ...envelope, items: [{ ...item, [String(field)]: value }] }).listKnowledgeArtifacts(id)).rejects.toMatchObject({ kind: 'bad-response' });
});
const badVersions: Array<[string, unknown]> = [['status', 'unknown'], ['visibility', 'unknown'], ['version', 0], ['sizeBytes', -1], ['abstractL0', 'x'.repeat(6001)], ['abstractL1', 'x'.repeat(6001)], ['createdAt', 'invalid'], ['producedByAttemptId', 4], ['supersedesVersion', 0]];
for (const [field, value] of badVersions) {
  it(`detail rejects version ${field}`, async () => {
    await expect(client({ ...envelope, artifact: { ...document, versions: [{ ...version, [field]: value }] } }).getKnowledgeArtifact(id, id)).rejects.toMatchObject({ kind: 'bad-response' });
  });
}
it.each(['versions', 'inputs', 'dependants'] as const)('detail caps %s to 200', async field => {
  await expect(client({ ...envelope, artifact: { ...document, [field]: Array.from({ length: 201 }, () => document[field][0]) } }).getKnowledgeArtifact(id, id)).rejects.toMatchObject({ kind: 'bad-response' });
});
it('detail validates provenance titles', async () => { await expect(client({ ...envelope, artifact: { ...document, inputs: [{ artifactId: id, version: 1, title: 42 }] } }).getKnowledgeArtifact(id, id)).rejects.toMatchObject({ kind: 'bad-response' }); });
it('detail keeps unknown 404 as an error', async () => { await expect(client({}, 404).getKnowledgeArtifact(id, id)).rejects.toMatchObject({ status: 404 }); });
it('detail removes nested version and provenance extras', async () => {
  const artifact = { ...document, versions: [{ ...version, private: true }], inputs: [{ ...document.inputs[0], private: true }] };
  const response = await client({ ...envelope, artifact }).getKnowledgeArtifact(id, id);
  expect(response.artifact.versions).toEqual([version]); expect(response.artifact.inputs).toEqual(document.inputs);
});
it.each(knowledgeKinds)('accepts contract kind %s', async kind => { expect((await client({ ...envelope, items: [{ ...item, kind }] }).listKnowledgeArtifacts(id)).items[0]?.kind).toBe(kind); });
it.each(knowledgeStatuses)('accepts contract status %s', async status => { expect((await client({ ...envelope, results: [{ ...result, status }] }).searchKnowledge(id, { query: 'q' })).results[0]?.status).toBe(status); });
it.each(knowledgeVisibilities)('accepts visibility %s', async visibility => { expect((await client({ ...envelope, results: [{ ...result, visibility }] }).searchKnowledge(id, { query: 'q' })).results[0]?.visibility).toBe(visibility); });
it('search URL preserves repeated filters, diacritics and paging', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, results: [] }));
  await createApiClient({ fetchImpl }).searchKnowledge('p/?', { query: 'Đề án + &?#', kinds: ['adr', 'plan'], statuses: ['draft', 'approved'], limit: 10, offset: 20 });
  const url = new URL(String(fetchImpl.mock.calls[0]?.[0]), 'http://localhost');
  expect(url.pathname).toBe('/projects/p%2F%3F/knowledge/search'); expect(url.searchParams.get('q')).toBe('Đề án + &?#'); expect(url.searchParams.getAll('kind')).toEqual(['adr', 'plan']); expect(url.searchParams.getAll('status')).toEqual(['draft', 'approved']); expect(url.searchParams.get('offset')).toBe('20'); expect(url.searchParams.get('limit')).toBe('10');
});
it('list URL encodes filters and zero offset', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, items: [] }));
  await createApiClient({ fetchImpl }).listKnowledgeArtifacts(id, { kinds: ['plan', 'adr'], statuses: ['reviewed', 'draft'], limit: 50, offset: 0 });
  expect(fetchImpl.mock.calls[0]?.[0]).toBe(`/projects/${id}/knowledge/artifacts?kind=plan&kind=adr&status=reviewed&status=draft&limit=50&offset=0`);
});
it('detail URL encodes both IDs', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, artifact: document })); await createApiClient({ fetchImpl }).getKnowledgeArtifact('p /', 'a?#');
  expect(fetchImpl.mock.calls[0]?.[0]).toBe('/projects/p%20%2F/knowledge/artifacts/a%3F%23');
});
