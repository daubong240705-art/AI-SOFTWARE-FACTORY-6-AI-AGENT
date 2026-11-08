import { afterEach, expect, it, vi } from 'vitest';
import { ApiClientError } from '../src/api/client';
import type { Store } from '../src/state/store';
import { setupUI } from './ui-fixtures';
import { deferred, envelope, event, id, otherId } from './fixtures';
import { document, item, result } from './knowledge-fixtures';

const stores: Store[] = [];
afterEach(() => { stores.forEach(store => store.dispose()); stores.length = 0; vi.useRealTimers(); });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
async function setup() {
  const value = setupUI(); stores.push(value.store);
  value.api.searchKnowledge.mockResolvedValue({ ...envelope, results: [result] });
  value.api.listKnowledgeArtifacts.mockResolvedValue({ ...envelope, items: [item] });
  value.api.getKnowledgeArtifact.mockResolvedValue({ ...envelope, artifact: document });
  await value.store.boot(); await value.store.selectProject(id); return value;
}
it('loads search results with trimmed query and filters', async () => {
  const { store, api } = await setup(); await store.searchKnowledge('  tài liệu  ', { kinds: ['adr'], statuses: ['approved'] });
  expect(store.getState().knowledge).toMatchObject({ query: 'tài liệu', filters: { kinds: ['adr'], statuses: ['approved'] }, results: [result], list: [], hasMore: false });
  expect(api.searchKnowledge).toHaveBeenCalledExactlyOnceWith(id, { query: 'tài liệu', kinds: ['adr'], statuses: ['approved'], offset: 0, limit: 50 });
});
it('browses artifacts with filters', async () => {
  const { store, api } = await setup(); await store.loadKnowledgeList({ kinds: ['plan'] });
  expect(store.getState().knowledge.list).toEqual([item]); expect(api.listKnowledgeArtifacts).toHaveBeenCalledExactlyOnceWith(id, { kinds: ['plan'], offset: 0, limit: 50 });
});
it.each(['', ' ', '\n\t'])('query %j browses without search', async query => {
  const { store, api } = await setup(); await store.searchKnowledge(query); expect(api.searchKnowledge).not.toHaveBeenCalled(); expect(api.listKnowledgeArtifacts).toHaveBeenCalledOnce(); expect(store.getState().knowledge.query).toBe('');
});
it('loads artifact versions and provenance', async () => {
  const { store } = await setup(); await store.openKnowledgeArtifact(id); expect(store.getState().knowledge.detail[id]).toEqual(document); expect(store.getState().knowledge.loading[`knowledge-detail:${id}`]).toBe(false);
});
it('concurrent list and detail completions preserve both responses', async () => {
  const { store, api } = await setup(); const list = deferred<unknown>(); const detail = deferred<unknown>();
  api.listKnowledgeArtifacts.mockReturnValueOnce(list.promise); api.getKnowledgeArtifact.mockReturnValueOnce(detail.promise);
  const reads = [store.loadKnowledgeList(), store.openKnowledgeArtifact(id)]; list.resolve({ ...envelope, items: [item] }); detail.resolve({ ...envelope, artifact: document }); await Promise.all(reads);
  expect(store.getState().knowledge.list).toEqual([item]); expect(store.getState().knowledge.detail[id]).toEqual(document);
});
for (const area of ['search', 'list', 'detail'] as const) {
  it(`${area} exposes safe error and supports retry`, async () => {
    const { store, api } = await setup();
    const read = () => area === 'search' ? store.searchKnowledge('query') : area === 'list' ? store.loadKnowledgeList() : store.openKnowledgeArtifact(id);
    const mock = area === 'search' ? api.searchKnowledge : area === 'list' ? api.listKnowledgeArtifacts : api.getKnowledgeArtifact;
    const key = area === 'detail' ? `knowledge-detail:${id}` : 'knowledge';
    mock.mockRejectedValueOnce(new Error('PRIVATE_TEXT')); await read(); expect(store.getState().knowledge.errors[key]?.kind).toBe('unexpected'); expect(JSON.stringify(store.getState())).not.toContain('PRIVATE_TEXT'); await read(); expect(store.getState().knowledge.errors[key]).toBeUndefined();
  });
  it(`${area} publishes loading while pending`, async () => {
    const { store, api } = await setup(); const pending = deferred<unknown>();
    const mock = area === 'search' ? api.searchKnowledge : area === 'list' ? api.listKnowledgeArtifacts : api.getKnowledgeArtifact;
    mock.mockReturnValueOnce(pending.promise);
    const read = area === 'search' ? store.searchKnowledge('query') : area === 'list' ? store.loadKnowledgeList() : store.openKnowledgeArtifact(id);
    const key = area === 'detail' ? `knowledge-detail:${id}` : 'knowledge';
    expect(store.getState().knowledge.loading[key]).toBe(true);
    pending.resolve({ ...envelope, results: [result], items: [item], artifact: document }); await read; expect(store.getState().knowledge.loading[key]).toBe(false);
  });
  it(`${area} 401 clears session and knowledge`, async () => {
    const { store, api } = await setup(); await store.loadKnowledgeList(); await store.openKnowledgeArtifact(id);
    const mock = area === 'search' ? api.searchKnowledge : area === 'list' ? api.listKnowledgeArtifacts : api.getKnowledgeArtifact;
    mock.mockRejectedValueOnce(new ApiClientError('bad-response', 401));
    await (area === 'search' ? store.searchKnowledge('query') : area === 'list' ? store.loadKnowledgeList() : store.openKnowledgeArtifact(id));
    expect(store.getState().session).toBe('anonymous'); expect(store.getState().knowledge).toMatchObject({ query: '', filters: {}, list: [], results: [], detail: {}, loading: {}, errors: {} });
  });
  for (const boundary of ['project', 'signout'] as const) {
    it(`${area} drops stale success after ${boundary}`, async () => {
      const { store, api } = await setup(); const pending = deferred<unknown>();
      const mock = area === 'search' ? api.searchKnowledge : area === 'list' ? api.listKnowledgeArtifacts : api.getKnowledgeArtifact;
      mock.mockReturnValueOnce(pending.promise);
      const read = area === 'search' ? store.searchKnowledge('query') : area === 'list' ? store.loadKnowledgeList() : store.openKnowledgeArtifact(id);
      if (boundary === 'project') await store.selectProject(otherId); else await store.signOut();
      pending.resolve({ ...envelope, results: [result], items: [item], artifact: document }); await read;
      expect(store.getState().knowledge).toMatchObject({ query: '', filters: {}, list: [], results: [], detail: {} });
    });
    it(`${area} drops stale unauthorized after ${boundary}`, async () => {
      const { store, api } = await setup(); const pending = deferred<unknown>();
      const mock = area === 'search' ? api.searchKnowledge : area === 'list' ? api.listKnowledgeArtifacts : api.getKnowledgeArtifact;
      mock.mockReturnValueOnce(pending.promise);
      const read = area === 'search' ? store.searchKnowledge('query') : area === 'list' ? store.loadKnowledgeList() : store.openKnowledgeArtifact(id);
      if (boundary === 'project') await store.selectProject(otherId); else { await store.signOut(); await store.boot(); await store.selectProject(otherId); }
      pending.reject(new ApiClientError('bad-response', 401)); await read; expect(store.getState().session).toBe('authenticated'); expect(store.getState().knowledge.errors).toEqual({});
    });
  }
}
it('new query runs immediately and supersedes older pending search', async () => {
  const { store, api } = await setup(); const pending = deferred<unknown>(); api.searchKnowledge.mockReturnValueOnce(pending.promise);
  const first = store.searchKnowledge('old'); await store.searchKnowledge('new'); expect(api.searchKnowledge).toHaveBeenCalledTimes(2);
  pending.resolve({ ...envelope, results: [{ ...result, title: 'Old' }] }); await first; expect(store.getState().knowledge.query).toBe('new'); expect(store.getState().knowledge.results).toEqual([result]);
});
it('old query failure cannot sign out or overwrite newer loading state', async () => {
  const { store, api } = await setup(); const old = deferred<unknown>(); const latest = deferred<unknown>(); api.searchKnowledge.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  const first = store.searchKnowledge('old'); const second = store.searchKnowledge('latest'); old.reject(new ApiClientError('bad-response', 401)); await first;
  expect(store.getState().session).toBe('authenticated'); expect(store.getState().knowledge.loading.knowledge).toBe(true); latest.resolve({ ...envelope, results: [result] }); await second;
});
it('cancellation drops a result even before the next debounced query starts', async () => {
  const { store, api } = await setup(); const pending = deferred<unknown>(); api.searchKnowledge.mockReturnValueOnce(pending.promise); const first = store.searchKnowledge('old'); store.cancelKnowledgeSearch(); pending.resolve({ ...envelope, results: [result] }); await first; expect(store.getState().knowledge.results).toEqual([]);
});
it('empty query supersedes pending search and shows list', async () => {
  const { store, api } = await setup(); const pending = deferred<unknown>(); api.searchKnowledge.mockReturnValueOnce(pending.promise); const first = store.searchKnowledge('old'); await store.searchKnowledge(' '); pending.resolve({ ...envelope, results: [result] }); await first; expect(store.getState().knowledge.results).toEqual([]); expect(store.getState().knowledge.list).toEqual([item]);
});
it.each(['search', 'list'] as const)('%s appends pages, caps at 500, then stops', async mode => {
  const { store, api } = await setup(); const rows = Array.from({ length: 50 }, (_, index) => ({ ...(mode === 'search' ? result : item), artifactId: `${id}-${index}` }));
  const mock = mode === 'search' ? api.searchKnowledge : api.listKnowledgeArtifacts; mock.mockResolvedValue({ ...envelope, [mode === 'search' ? 'results' : 'items']: rows });
  await (mode === 'search' ? store.searchKnowledge('q') : store.loadKnowledgeList());
  for (let i = 0; i < 11; i++) await store.loadKnowledgeMore();
  const knowledge = store.getState().knowledge;
  expect(mode === 'search' ? knowledge.results : knowledge.list).toHaveLength(500); expect(mock).toHaveBeenCalledTimes(10); expect(mock.mock.calls[1]?.[1]).toMatchObject({ offset: 50, limit: 50 }); expect(knowledge.hasMore).toBe(false);
});
it('short second page appends and clears hasMore', async () => {
  const { store, api } = await setup(); api.listKnowledgeArtifacts.mockResolvedValueOnce({ ...envelope, items: Array.from({ length: 50 }, () => item) }).mockResolvedValueOnce({ ...envelope, items: [{ ...item, artifactId: otherId }] });
  await store.loadKnowledgeList(); await store.loadKnowledgeMore(); expect(store.getState().knowledge.list).toHaveLength(51); expect(store.getState().knowledge.list[50]?.artifactId).toBe(otherId); expect(store.getState().knowledge.hasMore).toBe(false);
});
it('paging failure preserves rows and offset for retry', async () => {
  const { store, api } = await setup(); api.listKnowledgeArtifacts.mockResolvedValueOnce({ ...envelope, items: Array.from({ length: 50 }, () => item) }).mockRejectedValueOnce(new Error('private'));
  await store.loadKnowledgeList(); await store.loadKnowledgeMore(); expect(store.getState().knowledge.list).toHaveLength(50); await store.loadKnowledgeMore(); expect(api.listKnowledgeArtifacts.mock.calls[2]?.[1]).toMatchObject({ offset: 50 });
});
it('ignores repeated load more while a page is pending', async () => {
  const { store, api } = await setup(); api.listKnowledgeArtifacts.mockResolvedValueOnce({ ...envelope, items: Array.from({ length: 50 }, () => item) }); await store.loadKnowledgeList();
  const pending = deferred<unknown>(); api.listKnowledgeArtifacts.mockReturnValueOnce(pending.promise); const read = store.loadKnowledgeMore(); await store.loadKnowledgeMore(); pending.resolve({ ...envelope, items: [] }); await read; expect(api.listKnowledgeArtifacts).toHaveBeenCalledTimes(2);
});
const artifactEvent = () => event({ type: 'entity.changed', entity: { kind: 'artifact-version', id, revision: 3 } });
it('artifact SSE debounces refresh of open list and detail only', async () => {
  vi.useFakeTimers(); const { store, api } = await setup(); store.openKnowledgeList(); await store.loadKnowledgeList(); await store.openKnowledgeArtifact(id); await store.openKnowledgeArtifact(otherId); store.closeKnowledgeArtifact(otherId);
  api.listKnowledgeArtifacts.mockClear(); api.getKnowledgeArtifact.mockClear();
  for (let i = 0; i < 5; i++) store.applyEvent(artifactEvent()); expect(api.listKnowledgeArtifacts).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(150);
  expect(api.listKnowledgeArtifacts).toHaveBeenCalledOnce(); expect(api.getKnowledgeArtifact).toHaveBeenCalledExactlyOnceWith(id, id);
});
it('artifact SSE refreshes open search with current filters', async () => {
  vi.useFakeTimers(); const { store, api } = await setup(); store.openKnowledgeList(); await store.searchKnowledge('q', { statuses: ['draft'] }); api.searchKnowledge.mockClear(); store.applyEvent(artifactEvent()); await vi.advanceTimersByTimeAsync(150); expect(api.searchKnowledge).toHaveBeenCalledExactlyOnceWith(id, { query: 'q', statuses: ['draft'], offset: 0, limit: 50 });
});
it('closed views do not refresh and cancel pending debounces', async () => {
  vi.useFakeTimers(); const { store, api } = await setup(); store.openKnowledgeList(); await store.loadKnowledgeList(); await store.openKnowledgeArtifact(id); api.listKnowledgeArtifacts.mockClear(); api.getKnowledgeArtifact.mockClear();
  store.applyEvent(artifactEvent()); store.closeKnowledgeList(); store.closeKnowledgeArtifact(id); await vi.advanceTimersByTimeAsync(150); store.applyEvent(artifactEvent()); await vi.advanceTimersByTimeAsync(150); expect(api.listKnowledgeArtifacts).not.toHaveBeenCalled(); expect(api.getKnowledgeArtifact).not.toHaveBeenCalled();
});
it('unrelated entity and other-project events leave knowledge alone', async () => {
  vi.useFakeTimers(); const { store, api } = await setup(); store.openKnowledgeList(); await store.openKnowledgeArtifact(id); api.getKnowledgeArtifact.mockClear();
  store.applyEvent(event()); store.applyEvent({ ...artifactEvent(), projectId: otherId }); await vi.advanceTimersByTimeAsync(150); expect(api.listKnowledgeArtifacts).not.toHaveBeenCalled(); expect(api.getKnowledgeArtifact).not.toHaveBeenCalled();
});
it('snapshot recovery refreshes open knowledge', async () => {
  const { store, api, connections } = await setup(); store.openKnowledgeList(); await store.openKnowledgeArtifact(id); api.getKnowledgeArtifact.mockClear(); connections[0]?.onSnapshotRequired('gap'); await flush(); expect(api.listKnowledgeArtifacts).toHaveBeenCalledOnce(); expect(api.getKnowledgeArtifact).toHaveBeenCalledOnce();
});
it('closed pending detail cannot repopulate after close', async () => {
  const { store, api } = await setup(); const pending = deferred<unknown>(); api.getKnowledgeArtifact.mockReturnValueOnce(pending.promise); const read = store.openKnowledgeArtifact(id); store.closeKnowledgeArtifact(id); pending.resolve({ ...envelope, artifact: document }); await read; expect(store.getState().knowledge.detail).toEqual({});
});
it('anonymous state performs no knowledge reads', async () => {
  const { store, api } = await setup(); await store.signOut(); await store.searchKnowledge('q'); await store.loadKnowledgeList(); await store.openKnowledgeArtifact(id); expect(api.searchKnowledge).not.toHaveBeenCalled(); expect(api.listKnowledgeArtifacts).not.toHaveBeenCalled(); expect(api.getKnowledgeArtifact).not.toHaveBeenCalled();
});
