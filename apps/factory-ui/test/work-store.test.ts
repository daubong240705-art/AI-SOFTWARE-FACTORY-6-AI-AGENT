import { afterEach, expect, it, vi } from 'vitest';
import { ApiClientError } from '../src/api/client';
import type { Store } from '../src/state/store';
import { setupUI, approval, artifact, attempt, patch, progress } from './ui-fixtures';
import { deferred, envelope, event, id, otherId } from './fixtures';

const stores: Store[] = [];
afterEach(() => { stores.forEach(store => store.dispose()); stores.length = 0; vi.useRealTimers(); });
async function setup() {
  const value = setupUI(); stores.push(value.store);
  value.api.listAttempts.mockResolvedValue({ ...envelope, attempts: [attempt] });
  value.api.listAttemptEvents.mockResolvedValue({ ...envelope, events: [progress] });
  value.api.listTaskArtifacts.mockResolvedValue({ ...envelope, items: [artifact] });
  value.api.listTaskApprovals.mockResolvedValue({ ...envelope, approvals: [approval] });
  value.api.getAttemptPatch.mockResolvedValue({ ...envelope, ...patch });
  await value.store.boot(); await value.store.selectProject(id); return value;
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
it('loads all task detail read models', async () => {
  const { store } = await setup(); await store.loadTaskDetail(id);
  expect(store.getState().details[id]).toMatchObject({ loading: false, attempts: [attempt], artifacts: [artifact], approvals: [approval], events: {}, patches: {} });
});
it('openTask subscribes to progress and loads events', async () => {
  const { store } = await setup(); await store.openTask(id); await flush(); expect(store.getState().details[id]?.events[otherId]).toEqual([progress]);
});
it('sorts attempts newest epoch first', async () => {
  const { store, api } = await setup(); api.listAttempts.mockResolvedValue({ ...envelope, attempts: [attempt, { ...attempt, id, epoch: 2 }] }); await store.loadTaskDetail(id); expect(store.getState().details[id]?.attempts.map(a => a.epoch)).toEqual([2, 1]);
});
it('publishes loading before a read finishes', async () => {
  const { store, api } = await setup(); const pending = deferred<unknown>(); api.listAttempts.mockReturnValueOnce(pending.promise); const loading = store.loadTaskDetail(id); expect(store.getState().details[id]?.loading).toBe(true); pending.resolve({ ...envelope, attempts: [] }); await loading; expect(store.getState().details[id]?.loading).toBe(false);
});
it('keeps errors safe and retry clears the error', async () => {
  const { store, api } = await setup(); api.listAttempts.mockRejectedValueOnce(new Error('PRIVATE_HOST_TEXT')); await store.loadTaskDetail(id);
  expect(store.getState().details[id]?.error).toMatchObject({ kind: 'unexpected' }); expect(JSON.stringify(store.getState())).not.toContain('PRIVATE_HOST_TEXT'); await store.loadTaskDetail(id); expect(store.getState().details[id]?.error).toBeUndefined();
});
it('pages events using afterSeq until a short page', async () => {
  const { store, api } = await setup(); const page = Array.from({ length: 500 }, (_, index) => ({ ...progress, seq: index + 1 }));
  api.listAttemptEvents.mockResolvedValueOnce({ ...envelope, events: page }).mockResolvedValueOnce({ ...envelope, events: [{ ...progress, seq: 501 }] });
  await store.loadAttemptEvents(id, otherId); expect(api.listAttemptEvents.mock.calls).toEqual([[id, otherId, { afterSeq: 0, limit: 500 }], [id, otherId, { afterSeq: 500, limit: 500 }]]); expect(store.getState().details[id]?.events[otherId]).toHaveLength(501);
});
it('caps events at 2000', async () => {
  const { store, api } = await setup(); api.listAttemptEvents.mockImplementation((_project: string, _attempt: string, options: { afterSeq: number }) => Promise.resolve({ ...envelope, events: Array.from({ length: 500 }, (_, index) => ({ ...progress, seq: options.afterSeq + index + 1 })) }));
  await store.loadAttemptEvents(id, otherId); expect(api.listAttemptEvents).toHaveBeenCalledTimes(4); expect(store.getState().details[id]?.events[otherId]).toHaveLength(2000);
});
it('stops paging when the host repeats a page', async () => {
  const { store, api } = await setup(); api.listAttemptEvents.mockResolvedValue({ ...envelope, events: Array.from({ length: 500 }, (_, index) => ({ ...progress, seq: index + 1 })) });
  await store.loadAttemptEvents(id, otherId); expect(api.listAttemptEvents).toHaveBeenCalledTimes(2); expect(store.getState().details[id]?.events[otherId]).toHaveLength(500);
});
it('deduplicates and orders events', async () => {
  const { store, api } = await setup(); api.listAttemptEvents.mockResolvedValue({ ...envelope, events: [{ ...progress, seq: 2 }, progress, progress] }); await store.loadAttemptEvents(id, otherId); expect(store.getState().details[id]?.events[otherId]?.map(e => e.seq)).toEqual([1, 2]);
});
it('caches patches including a missing patch', async () => {
  const { store, api } = await setup(); api.getAttemptPatch.mockResolvedValue(null); await store.loadPatch(id, otherId); await store.loadPatch(id, otherId); expect(api.getAttemptPatch).toHaveBeenCalledOnce(); expect(store.getState().details[id]?.patches[otherId]).toBeNull();
});
it('reloads a formerly missing patch after detail refresh', async () => {
  const { store, api } = await setup(); api.getAttemptPatch.mockResolvedValueOnce(null); await store.loadPatch(id, otherId); await store.loadTaskDetail(id); await store.loadPatch(id, otherId); expect(api.getAttemptPatch).toHaveBeenCalledTimes(2); expect(store.getState().details[id]?.patches[otherId]).toMatchObject(patch);
});
it('coalesces simultaneous patch reads', async () => { const { store, api } = await setup(); await Promise.all([store.loadPatch(id, otherId), store.loadPatch(id, otherId)]); expect(api.getAttemptPatch).toHaveBeenCalledOnce(); });
it('caches artifact content', async () => { const { store, api } = await setup(); await store.loadArtifactContent(id, otherId, 1); await store.loadArtifactContent(id, otherId, 1); expect(api.getArtifactContent).toHaveBeenCalledOnce(); expect(store.getState().artifactContents[`${otherId}:1`]?.text).toBe('Artifact text'); });
it('bounds shared content cache to 20 and evicts old patches', async () => {
  const { store, api } = await setup(); await store.loadPatch(id, otherId); for (let version = 1; version <= 20; version++) await store.loadArtifactContent(id, id, version);
  expect(Object.keys(store.getState().artifactContents)).toHaveLength(20); expect(store.getState().details[id]?.patches[otherId]).toBeUndefined(); await store.loadPatch(id, otherId); expect(api.getAttemptPatch).toHaveBeenCalledTimes(2); expect(Object.keys(store.getState().artifactContents)).toHaveLength(19);
});
it('cache hits refresh LRU order', async () => {
  const { store } = await setup(); for (let version = 1; version <= 20; version++) await store.loadArtifactContent(id, id, version); await store.loadArtifactContent(id, id, 1); await store.loadArtifactContent(id, id, 21); expect(store.getState().artifactContents[`${id}:1`]).toBeDefined(); expect(store.getState().artifactContents[`${id}:2`]).toBeUndefined();
});
for (const boundary of ['project', 'signout'] as const) {
  it(`drops stale detail success after ${boundary}`, async () => {
    const { store, api } = await setup(); const pending = deferred<unknown>(); api.listAttempts.mockReturnValueOnce(pending.promise); const read = store.loadTaskDetail(id); if (boundary === 'project') await store.selectProject(otherId); else await store.signOut(); pending.resolve({ ...envelope, attempts: [attempt] }); await read; expect(store.getState().details).toEqual({});
  });
  it(`drops stale patch after ${boundary}`, async () => {
    const { store, api } = await setup(); const pending = deferred<unknown>(); api.getAttemptPatch.mockReturnValueOnce(pending.promise); const read = store.loadPatch(id, otherId); if (boundary === 'project') await store.selectProject(otherId); else await store.signOut(); pending.resolve({ ...envelope, ...patch }); await read; expect(store.getState().details).toEqual({});
  });
  it(`drops stale content after ${boundary}`, async () => {
    const { store, api } = await setup(); const pending = deferred<unknown>(); api.getArtifactContent.mockReturnValueOnce(pending.promise); const read = store.loadArtifactContent(id, id, 1); if (boundary === 'project') await store.selectProject(otherId); else await store.signOut(); pending.resolve({ ...envelope, text: 'old' }); await read; expect(store.getState().artifactContents).toEqual({});
  });
  it(`drops stale event pages after ${boundary}`, async () => {
    const { store, api } = await setup(); const pending = deferred<unknown>(); api.listAttemptEvents.mockReturnValueOnce(pending.promise); const read = store.loadAttemptEvents(id, otherId); if (boundary === 'project') await store.selectProject(otherId); else await store.signOut(); pending.resolve({ ...envelope, events: [progress] }); await read; expect(store.getState().details).toEqual({});
  });
}
it('stale 401 cannot sign out the newly selected project', async () => {
  const { store, api } = await setup(); const pending = deferred<unknown>(); api.listAttempts.mockReturnValueOnce(pending.promise); const read = store.loadTaskDetail(id); await store.selectProject(otherId); pending.reject(new ApiClientError('bad-response', 401)); await read; expect(store.getState().session).toBe('authenticated');
});
it.each(['detail', 'events', 'patch', 'content'] as const)('401 in %s clears the session and every detail', async area => {
  const { store, api } = await setup(); await store.loadTaskDetail(id); const error = new ApiClientError('bad-response', 401);
  if (area === 'detail') { api.listAttempts.mockRejectedValueOnce(error); await store.loadTaskDetail(id); }
  if (area === 'events') { api.listAttemptEvents.mockRejectedValueOnce(error); await store.loadAttemptEvents(id, otherId); }
  if (area === 'patch') { api.getAttemptPatch.mockRejectedValueOnce(error); await store.loadPatch(id, otherId); }
  if (area === 'content') { api.getArtifactContent.mockRejectedValueOnce(error); await store.loadArtifactContent(id, id, 1); }
  expect(store.getState().session).toBe('anonymous'); expect(store.getState().details).toEqual({}); expect(store.getState().artifactContents).toEqual({});
});
// 'effect' events refresh only the effects of open tasks (covered in inbox-store.test.ts).
it.each(['task', 'attempt', 'artifact-version', 'approval'] as const)('%s changes refresh open details once after debounce', async kind => {
  vi.useFakeTimers(); const { store, api } = await setup(); await store.loadTaskDetail(otherId); await store.openTask(id); await flush(); api.listAttempts.mockClear();
  for (let i = 0; i < 4; i++) store.applyEvent(event({ type: 'entity.changed', entity: { kind, id, revision: 3 } }));
  expect(api.listAttempts).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(150); expect(api.listAttempts).toHaveBeenCalledTimes(1); expect(api.listAttempts).toHaveBeenCalledWith(id, id);
});
it('closed tasks have no event subscription', async () => {
  vi.useFakeTimers(); const { store, api } = await setup(); await store.openTask(id); await flush(); store.closeTask(id); api.listAttempts.mockClear(); store.applyEvent(event()); await vi.advanceTimersByTimeAsync(150); expect(api.listAttempts).not.toHaveBeenCalled();
});
it('closing a task cancels an already scheduled refresh', async () => {
  vi.useFakeTimers(); const { store, api } = await setup(); await store.openTask(id); await flush(); api.listAttempts.mockClear(); store.applyEvent(event()); store.closeTask(id); await vi.advanceTimersByTimeAsync(150); expect(api.listAttempts).not.toHaveBeenCalled();
});
it.each(['task', 'attempt'] as const)('%s changes always refresh the tasks list without any open task', async kind => {
  vi.useFakeTimers(); const { store, api } = await setup(); api.listTasks.mockClear(); store.applyEvent(event({ type: 'entity.changed', entity: { kind, id, revision: 2 } })); await vi.advanceTimersByTimeAsync(150); expect(api.listTasks).toHaveBeenCalledOnce();
});
it('snapshot recovery includes open details', async () => { const { store, api, connections } = await setup(); await store.openTask(id); await flush(); api.listAttempts.mockClear(); connections[0]?.onSnapshotRequired('gap'); await flush(); expect(api.listAttempts).toHaveBeenCalledWith(id, id); });
