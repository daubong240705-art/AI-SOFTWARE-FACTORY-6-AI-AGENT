import { expect, it, vi } from 'vitest';
import { createApiClient } from '../src/api/client';
import { allKinds } from './attention-fixtures';
import { envelope, id, project, response } from './fixtures';

const extras = ['patches', 'monitors', 'stalledWorkflows', 'quarantinedRules', 'teamBreakers', 'integrationConflicts'] as const;
for (const global of [false, true]) {
  const label = global ? 'global' : 'project';
  const read = (body: unknown) => {
    const api = createApiClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(body)) });
    return global ? api.getGlobalInbox() : api.getInbox(id);
  };
  it(`${label} parses every new array, ignores extra fields, and preserves Host total`, async () => {
    const body = Object.fromEntries(extras.map(key => [key, allKinds[key]?.map(item => ({ ...item, privateField: 'ignored' }))]));
    const result = await read({ ...envelope, ...allKinds, ...body, counts: { ...allKinds.counts, total: 99 } });
    for (const key of extras) expect(result[key]).toEqual(allKinds[key]);
    expect(result.counts.total).toBe(99);
    expect(JSON.stringify(result)).not.toContain('privateField');
  });
  it(`${label} treats missing optional arrays as empty`, async () => {
    const result = await read({ ...envelope, approvals: [], startGates: [], counts: { approvals: 0, startGates: 0, total: 0 } });
    for (const key of extras) expect(result[key]).toEqual([]);
  });
  it.each(extras)(`${label} rejects a malformed single %s item and a wrong array type`, async key => {
    await expect(read({ ...envelope, ...allKinds, [key]: [...(allKinds[key] ?? []), {}] })).rejects.toMatchObject({ kind: 'bad-response' });
    await expect(read({ ...envelope, ...allKinds, [key]: null })).rejects.toMatchObject({ kind: 'bad-response' });
  });
}

it('resolves the Host global stalled-workflow project from scoped inboxes', async () => {
  const workflow = { instanceId: id, title: 'Stalled', reason: 'Missing artifact' };
  const body = { ...envelope, approvals: [], startGates: [], stalledWorkflows: [workflow], counts: { approvals: 0, startGates: 0, total: 1 } };
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response(body)).mockResolvedValueOnce(response({ ...envelope, projects: [project] })).mockResolvedValueOnce(response(body));
  const result = await createApiClient({ fetchImpl }).getGlobalInbox();
  expect(result.stalledWorkflows?.[0]).toMatchObject({ ...workflow, projectId: id, projectName: project.name });
  expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(['/inbox', '/projects', `/projects/${id}/inbox`]);
});
