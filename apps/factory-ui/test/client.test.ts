import { describe, expect, it, vi } from 'vitest';
import { createApiClient, ApiClientError } from '../src/api/client';
import { projectsCreate } from '../src/api/commands';
import { envelope, id, otherId, project, team, engagement, task, conversation, message, budget, receipt, failure, response } from './fixtures';

const routes = [
  ['health', [], '/health', 'GET', envelope],
  ['bootstrap', ['private-bootstrap'], '/auth/bootstrap', 'POST', { ...envelope, csrfToken: 'private-csrf' }],
  ['session', [], '/auth/session', 'GET', { ...envelope, csrfToken: 'private-csrf' }],
  ['logout', [], '/auth/logout', 'POST', envelope],
  ['listProjects', [], '/projects', 'GET', { ...envelope, projects: [project] }],
  ['getTeam', [id], `/projects/${id}/team`, 'GET', { ...envelope, team, seats: [], engagement }],
  ['listTasks', [id], `/projects/${id}/tasks`, 'GET', { ...envelope, items: [task] }],
  ['listConversations', [id], `/projects/${id}/conversations`, 'GET', { ...envelope, conversations: [conversation] }],
  ['listMessages', [id, otherId, { afterOrdinal: 3, limit: 12 }], `/projects/${id}/conversations/${otherId}/messages?afterOrdinal=3&limit=12`, 'GET', { ...envelope, messages: [{ ordinal: 4, message }], turns: [] }],
  ['getBudget', [id], `/projects/${id}/budget`, 'GET', { ...envelope, budget }],
  ['sendCommand', [projectsCreate({ name: 'Demo', root: '/work' })], '/commands', 'POST', { ...envelope, receipt }],
] as const;

describe.each(['', '/api'])('baseUrl %s', (baseUrl) => {
  it.each(routes)('%s uses the Host path and request policy', async (method, args, path, verb, body) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(body));
    const client = createApiClient({ baseUrl, fetchImpl });
    const invoke = client[method] as (...args: readonly unknown[]) => Promise<unknown>;
    await expect(invoke(...args)).resolves.toEqual(body);
    expect(fetchImpl).toHaveBeenCalledWith(`${baseUrl}${path}`, expect.objectContaining({ method: verb, credentials: 'same-origin', cache: 'no-store' }));
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(new Headers(init.headers).has('x-csrf-token')).toBe(false);
    if (verb === 'POST') expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });
});
it.each(['bootstrap', 'session'] as const)('%s retains csrf only in client and sends it on POST', async (method) => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ ...envelope, csrfToken: 'private-csrf' }))
    .mockResolvedValueOnce(response(envelope)).mockResolvedValueOnce(response(envelope));
  const client = createApiClient({ fetchImpl });
  expect(client.csrfToken).toBeNull();
  await client[method]('private-bootstrap');
  expect(client.csrfToken).toBe('private-csrf');
  await client.health(); await client.logout();
  expect(new Headers(fetchImpl.mock.calls[1]![1]!.headers).has('x-csrf-token')).toBe(false);
  expect(new Headers(fetchImpl.mock.calls[2]![1]!.headers).get('x-csrf-token')).toBe('private-csrf');
  expect(client.csrfToken).toBeNull();
});
it('bootstrap token occurs only in its JSON body', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, csrfToken: 'csrf' }));
  await createApiClient({ baseUrl: '/api', fetchImpl }).bootstrap('private-bootstrap');
  const [url, init] = fetchImpl.mock.calls[0]!;
  expect(init!.body).toBe(JSON.stringify({ token: 'private-bootstrap' }));
  expect(JSON.stringify([url, { ...init, body: undefined }])).not.toContain('private-bootstrap');
});
it('401 clears csrf and invokes the observer once even for malformed data', async () => {
  const onUnauthorized = vi.fn();
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ ...envelope, csrfToken: 'csrf' })).mockResolvedValueOnce(response({}, 401));
  const client = createApiClient({ fetchImpl, onUnauthorized });
  await client.session();
  await expect(client.health()).rejects.toMatchObject({ kind: 'bad-response', status: 401 });
  expect(client.csrfToken).toBeNull(); expect(onUnauthorized).toHaveBeenCalledTimes(1);
});
it('failure preserves structured fields and a safe message', async () => {
  const client = createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(failure, 409)) });
  await expect(client.listProjects()).rejects.toMatchObject({ name: 'ApiClientError', kind: 'api', status: 409, ...failure.error });
});
it.each([
  { ...envelope, projects: [{ ...project, name: 3 }] },
  { ...envelope, projects: [{ id }] },
  { ...envelope, projects: [{ ...project, secret: 'extra' }] },
  { ...envelope, projects: [], extra: true },
  { ok: true, projects: [] },
  { ...envelope, projects: 'wrong' },
])('rejects malformed project responses %#', async (body) => {
  await expect(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(body)) }).listProjects()).rejects.toMatchObject({ kind: 'bad-response' });
});
it.each(routes)('%s rejects unvalidated collections and extra fields', async (method, args, _path, _verb, body) => {
  const client = createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ ...body, extra: 'x' })) });
  await expect((client[method] as (...args: readonly unknown[]) => Promise<unknown>)(...args)).rejects.toMatchObject({ kind: 'bad-response' });
});
it('network errors never echo bodies, cookies or tokens', async () => {
  const client = createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error('private-bootstrap cookie=secret body')) });
  const error = await client.bootstrap('private-bootstrap').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiClientError);
  expect(error).toMatchObject({ kind: 'network' });
  expect(JSON.stringify(error) + String(error)).not.toMatch(/private-bootstrap|cookie=secret|body/);
});
it('server error text cannot echo credentials', async () => {
  const body = { ...failure, error: { ...failure.error, message: 'private-bootstrap cookie=secret body' } };
  const error = await createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(body, 409)) }).bootstrap('private-bootstrap').catch((e: unknown) => e);
  expect(String(error)).not.toMatch(/private-bootstrap|cookie=secret|body/);
});
it('retry sends the identical commandId and payload', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response({ ...envelope, receipt }));
  const client = createApiClient({ fetchImpl }); const command = projectsCreate({ name: 'Demo', root: '/work' });
  await expect(client.sendCommand(command)).rejects.toMatchObject({ kind: 'network' });
  await client.sendCommand(command);
  expect(fetchImpl.mock.calls[0]![1]!.body).toBe(fetchImpl.mock.calls[1]![1]!.body);
  expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]!.body)).commandId).toBe(command.commandId);
});
it('invalid JSON produces bad-response', async () => {
  await expect(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('oops')) }).health()).rejects.toMatchObject({ kind: 'bad-response' });
});
it('a non-success HTTP response cannot masquerade as success', async () => {
  await expect(createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(envelope, 500)) }).health()).rejects.toMatchObject({ kind: 'bad-response', status: 500 });
});
it('messages without options have no query suffix', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ ...envelope, messages: [], turns: [] }));
  await createApiClient({ fetchImpl }).listMessages(id, otherId);
  expect(fetchImpl.mock.calls[0]![0]).toBe(`/projects/${id}/conversations/${otherId}/messages`);
});
