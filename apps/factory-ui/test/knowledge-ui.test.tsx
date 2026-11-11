import { chooseOption } from './select-helpers';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { projectSchema } from '@factory/contracts';
import { ApiClientError, type KnowledgeItem } from '../src/api/client';
import { knowledgeKinds, knowledgeStatuses, knowledgeVisibilities } from '../src/api/readModels';
import { i18n, type Locale } from '../src/i18n';
import { extra as en } from '../src/i18n/extra.en';
import { extra as viLabels } from '../src/i18n/extra.vi';
import type { Store, StoreOptions } from '../src/state/store';
import { KnowledgeArtifact } from '../src/screens/KnowledgeArtifact';
import { ProjectKnowledge } from '../src/screens/ProjectKnowledge';
import { ProjectView } from '../src/screens/ProjectView';
import { setupUI } from './ui-fixtures';
import { deferred, envelope, id, otherId, project } from './fixtures';
import { document as artifact, item, result, version } from './knowledge-fixtures';

const stores: Store[] = [];
afterEach(() => { cleanup(); stores.forEach(store => store.dispose()); stores.length = 0; i18n.setLocale('en'); vi.useRealTimers(); vi.restoreAllMocks(); });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
async function setup(options: Pick<StoreOptions, 'timer'> = {}) {
  const value = setupUI(options); stores.push(value.store);
  value.api.searchKnowledge.mockResolvedValue({ ...envelope, results: [result] });
  value.api.listKnowledgeArtifacts.mockResolvedValue({ ...envelope, items: [item] });
  value.api.getKnowledgeArtifact.mockResolvedValue({ ...envelope, artifact });
  await value.store.boot(); await value.store.selectProject(id); return value;
}
async function browse(rows: KnowledgeItem[] = [item]) {
  const value = await setup(); value.api.listKnowledgeArtifacts.mockResolvedValue({ ...envelope, items: rows });
  render(<ProjectKnowledge store={value.store} projectId={id} />); await act(flush); return value;
}
async function open() {
  const value = await browse(); const opener = screen.getByRole('button', { name: /Knowledge document/ }); opener.focus(); fireEvent.click(opener); await act(flush); return { ...value, opener };
}
it('fifth tab is Knowledge and has a linked panel', async () => {
  const { store } = await setup(); render(<ProjectView store={store} project={projectSchema.parse(project)} />);
  expect(screen.getAllByRole('tab')).toHaveLength(6); const tab = screen.getByRole('tab', { name: 'Knowledge' }); fireEvent.click(tab); await act(flush); expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tab.id); expect(screen.getByRole('search')).toBeTruthy();
});
it('tab keyboard wraps left and right over six tabs', async () => {
  const { store } = await setup(); render(<ProjectView store={store} project={projectSchema.parse(project)} />);
  const first = screen.getByRole('tab', { name: 'Overview' }); fireEvent.keyDown(first, { key: 'ArrowLeft' }); await act(flush);
  const last = screen.getByRole('tab', { name: 'Settings' }); expect(document.activeElement).toBe(last); expect(last.tabIndex).toBe(0); expect(first.tabIndex).toBe(-1);
  fireEvent.keyDown(last, { key: 'ArrowRight' }); expect(document.activeElement).toBe(first); expect(first.getAttribute('aria-selected')).toBe('true');
});
it('Home and End keep six-tab keyboard navigation correct', async () => {
  const { store } = await setup(); render(<ProjectView store={store} project={projectSchema.parse(project)} />); const chat = screen.getByRole('tab', { name: 'Overview' }); fireEvent.keyDown(chat, { key: 'End' }); await act(flush); expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Settings' })); fireEvent.keyDown(document.activeElement!, { key: 'Home' }); expect(document.activeElement).toBe(chat);
});
it('browse heading, count, kinds, status, visibility and version counts are visible', async () => {
  await browse(); expect(screen.getByRole('heading', { name: 'All documents' })).toBeTruthy(); expect(screen.getByText('1 document shown')).toBeTruthy(); const row = screen.getByRole('button', { name: /Knowledge document/ }); expect(row.textContent).toContain('Research report'); expect(row.textContent).toContain('Approved'); expect(row.textContent).toContain('Project'); expect(row.textContent).toContain('v 2'); expect(row.textContent).toContain('2 versions');
});
it('search field is labelled, in a search landmark, and bounded to 200', async () => { await browse(); const input = screen.getByRole('searchbox', { name: 'Search documents' }) as HTMLInputElement; expect(within(screen.getByRole('search')).getByLabelText('Search documents')).toBe(input); expect(input.maxLength).toBe(200); });
it('screen debounces query for 300ms using the injected timer and cancels previous input', async () => {
  vi.useFakeTimers(); const timer = { setTimeout: vi.fn((cb: () => void, ms: number) => setTimeout(cb, ms)), clearTimeout: vi.fn((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>)) };
  const { store, api } = await setup({ timer }); render(<ProjectKnowledge store={store} projectId={id} />); await act(flush);
  const input = screen.getByRole('searchbox'); fireEvent.change(input, { target: { value: 'tai' } }); await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  fireEvent.change(input, { target: { value: 'tài liệu' } }); await act(async () => { await vi.advanceTimersByTimeAsync(299); }); expect(api.searchKnowledge).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(api.searchKnowledge).toHaveBeenCalledExactlyOnceWith(id, { query: 'tài liệu', limit: 50, offset: 0 }); expect(timer.setTimeout).toHaveBeenCalledWith(expect.any(Function), 300); expect(timer.clearTimeout).toHaveBeenCalled(); expect(screen.getByRole('heading', { name: 'Search results' })).toBeTruthy();
});
it('Escape clears search and immediately browses', async () => {
  vi.useFakeTimers(); const { store, api } = await setup(); render(<ProjectKnowledge store={store} projectId={id} />); await act(flush);
  const input = screen.getByRole('searchbox') as HTMLInputElement; fireEvent.change(input, { target: { value: 'query' } }); await act(async () => { await vi.advanceTimersByTimeAsync(300); }); fireEvent.keyDown(input, { key: 'Escape' }); await act(flush);
  expect(input.value).toBe(''); expect(screen.getByRole('heading', { name: 'All documents' })).toBeTruthy(); expect(api.listKnowledgeArtifacts).toHaveBeenCalledTimes(2); expect(api.searchKnowledge).toHaveBeenCalledOnce();
});
it('whitespace query browses and never searches', async () => {
  const { api } = await browse(); fireEvent.change(screen.getByRole('searchbox'), { target: { value: '   ' } }); await act(flush); expect(api.searchKnowledge).not.toHaveBeenCalled(); expect(screen.getByRole('heading', { name: 'All documents' })).toBeTruthy();
});
it('unmount cancels the pending search timer', async () => {
  vi.useFakeTimers(); const { store, api } = await setup(); const view = render(<ProjectKnowledge store={store} projectId={id} />); await act(flush); fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'q' } }); view.unmount(); await vi.advanceTimersByTimeAsync(300); expect(api.searchKnowledge).not.toHaveBeenCalled();
});
it('kind and status selects send filters', async () => {
  const { api } = await browse(); await chooseOption('Document kind', 'Architecture decision'); await act(flush); await chooseOption('Document status', 'Approved'); await act(flush);
  expect(api.listKnowledgeArtifacts).toHaveBeenLastCalledWith(id, { kinds: ['adr'], statuses: ['approved'], limit: 50, offset: 0 });
});
it('filter choices cover every contract enum', async () => {
  await browse(); const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'Document kind' }));
  expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(knowledgeKinds.length + 1);
  for (const kind of knowledgeKinds) expect(screen.getByRole('option', { name: en.knowledgeUi.kinds[kind] })).toBeTruthy();
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('combobox', { name: 'Document status' }));
  expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(knowledgeStatuses.length + 1);
  for (const status of knowledgeStatuses) expect(screen.getByRole('option', { name: en.knowledgeUi.statuses[status] })).toBeTruthy();
});
it.each(knowledgeStatuses)('row shows non-colour status %s', async status => { await browse([{ ...item, status }]); expect(screen.getByRole('button', { name: /Knowledge document/ }).textContent).toContain(en.knowledgeUi.statuses[status]); });
it.each(knowledgeVisibilities)('row shows visibility %s', async visibility => { await browse([{ ...item, visibility }]); expect(screen.getByRole('button', { name: /Knowledge document/ }).textContent).toContain(en.knowledgeUi.visibility[visibility]); });
it('server title and summary render as plain text in browse rows', async () => {
  await browse([{ ...item, title: '<img src=x onerror=alert(1)>', abstractL0: '<script>danger()</script>' }]); expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy(); expect(screen.getByText('<script>danger()</script>')).toBeTruthy(); expect(document.querySelector('img, script')).toBeNull();
});
it('search title, abstract and snippet stay plain text', async () => {
  vi.useFakeTimers(); const { store, api } = await setup(); api.searchKnowledge.mockResolvedValue({ ...envelope, results: [{ ...result, title: '<b>title</b>', abstractL0: '<svg onload=alert(1)>', snippet: '<img src=x>' }] }); render(<ProjectKnowledge store={store} projectId={id} />); await act(flush); fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'q' } }); await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  for (const text of ['<b>title</b>', '<svg onload=alert(1)>', '<img src=x>']) expect(screen.getByText(text)).toBeTruthy(); expect(screen.getByRole('list').querySelector('b, svg, img')).toBeNull();
});
it('empty browse has a friendly message', async () => { await browse([]); expect(screen.getByText('No documents yet.')).toBeTruthy(); });
it('empty search explains accent insensitive search', async () => {
  vi.useFakeTimers(); const { store, api } = await setup(); api.searchKnowledge.mockResolvedValue({ ...envelope, results: [] }); render(<ProjectKnowledge store={store} projectId={id} />); await act(flush); fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'absent' } }); await act(async () => { await vi.advanceTimersByTimeAsync(300); }); expect(screen.getByText('No matches. Try fewer words; search ignores accents.')).toBeTruthy(); expect(screen.getByText('0 documents shown')).toBeTruthy();
});
it('list loading is announced and suppresses empty state', async () => {
  const { store, api } = await setup(); api.listKnowledgeArtifacts.mockReturnValue(deferred<unknown>().promise); render(<ProjectKnowledge store={store} projectId={id} />); expect(screen.getByText('Loading')).toBeTruthy(); expect(screen.queryByText('No documents yet.')).toBeNull();
});
it('list error uses a safe message with Retry', async () => {
  const { store, api } = await setup(); api.listKnowledgeArtifacts.mockRejectedValueOnce(new Error('PRIVATE_SERVER')); render(<ProjectKnowledge store={store} projectId={id} />); await act(flush); expect(screen.getByRole('alert').textContent).not.toContain('PRIVATE_SERVER'); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await act(flush); expect(screen.queryByRole('alert')).toBeNull(); expect(screen.getByText(item.title)).toBeTruthy();
});
it('load more appends rows and updates plural count', async () => {
  const { store, api } = await setup(); api.listKnowledgeArtifacts.mockResolvedValueOnce({ ...envelope, items: Array.from({ length: 50 }, (_, index) => ({ ...item, artifactId: `${id}-${index}`, title: `Document ${index}` })) }).mockResolvedValueOnce({ ...envelope, items: [{ ...item, artifactId: otherId }] }); render(<ProjectKnowledge store={store} projectId={id} />); await act(flush); fireEvent.click(screen.getByRole('button', { name: 'Load more' })); await act(flush); expect(screen.getByText('51 documents shown')).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
});
it('detail opens with title, latest status and kind', async () => { await open(); const dialog = screen.getByRole('dialog'); expect(dialog.getAttribute('aria-modal')).toBe('true'); expect(within(dialog).getByRole('heading', { name: item.title })).toBeTruthy(); expect(within(dialog).getAllByText('Approved').length).toBeGreaterThan(0); expect(within(dialog).getByText('Research report')).toBeTruthy(); });
it('detail Escape closes and returns focus', async () => { const { opener } = await open(); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(opener); });
it('close document button returns focus', async () => { const { opener } = await open(); fireEvent.click(screen.getByRole('button', { name: 'Close document' })); expect(document.activeElement).toBe(opener); });
it('detail traps forward Tab at the last control', async () => { await open(); const controls = within(screen.getByRole('dialog')).getAllByRole('button'); const last = controls.at(-1)!; last.focus(); fireEvent.keyDown(last, { key: 'Tab' }); expect(document.activeElement).toBe(controls[0]); });
it('detail traps reverse Tab at the first control', async () => { await open(); const controls = within(screen.getByRole('dialog')).getAllByRole('button'); const first = controls[0]!; first.focus(); fireEvent.keyDown(first, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(controls.at(-1)); });
it('detail contains programmatic outside focus', async () => { const { opener } = await open(); opener.focus(); expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close document' })); });
it('versions show newest first, dates, sizes, abstracts and supersession', async () => {
  await open(); const dialog = within(screen.getByRole('dialog')); const versions = dialog.getByRole('heading', { name: 'Versions' }).nextElementSibling!; const rows = within(versions as HTMLElement).getAllByRole('listitem'); expect(rows[0]?.textContent).toContain('v 2'); expect(rows[1]?.textContent).toContain('v 1'); expect(rows[0]?.textContent).toContain('Supersedes v 1'); expect(rows[0]?.textContent).toContain('42 bytes'); expect(dialog.getByText('Detailed summary text')).toBeTruthy(); expect(document.querySelector('time')?.textContent).toBe(new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(version.createdAt)));
});
it('provenance shows built from and used by pinned titles and versions', async () => { await open(); expect(screen.getByRole('heading', { name: 'Built from' })).toBeTruthy(); expect(screen.getByRole('heading', { name: 'Used by' })).toBeTruthy(); expect(screen.getByText('Source document · v 3')).toBeTruthy(); expect(screen.getByText('Dependent document · v 4')).toBeTruthy(); });
it('empty provenance lists have explicit empty labels', async () => {
  const { store, api } = await setup(); api.getKnowledgeArtifact.mockResolvedValue({ ...envelope, artifact: { ...artifact, inputs: [], dependants: [] } }); render(<KnowledgeArtifact store={store} artifactId={id} onClose={() => {}} />); await act(flush); expect(screen.getAllByText('None.')).toHaveLength(2);
});
it('detail title, L0, L1 and provenance titles remain plain text', async () => {
  const { store, api } = await setup(); api.getKnowledgeArtifact.mockResolvedValue({ ...envelope, artifact: { ...artifact, title: '<img src=x>', versions: [{ ...version, abstractL0: '<svg>l0</svg>', abstractL1: '<script>l1</script>' }], inputs: [{ artifactId: id, version: 1, title: '<b>source</b>' }], dependants: [] } }); render(<KnowledgeArtifact store={store} artifactId={id} onClose={() => {}} />); await act(flush); for (const text of ['<img src=x>', '<svg>l0</svg>', '<script>l1</script>']) expect(screen.getByText(text)).toBeTruthy(); expect(screen.getByText(/<b>source<\/b>/)).toBeTruthy(); expect(document.querySelector('img, svg, script, b')).toBeNull();
});
it('read text uses existing API and renders plain pre text', async () => {
  const { api } = await open(); api.getArtifactContent.mockResolvedValue({ ...envelope, mediaType: 'text/plain', text: '<img src=x><script>bad()</script>', sizeBytes: 30, contentHash: 'a'.repeat(64) }); fireEvent.click(screen.getAllByRole('button', { name: 'Read text' })[0]!); await act(flush); expect(api.getArtifactContent).toHaveBeenCalledExactlyOnceWith(id, id, 2); expect(screen.getByText('<img src=x><script>bad()</script>').tagName).toBe('PRE'); expect(document.querySelector('img, script')).toBeNull();
});
it('read text truncates at 20000 with a visible note', async () => {
  const { api } = await open(); api.getArtifactContent.mockResolvedValue({ ...envelope, mediaType: 'text/plain', text: 'x'.repeat(20001), sizeBytes: 20001, contentHash: 'a'.repeat(64) }); fireEvent.click(screen.getAllByRole('button', { name: 'Read text' })[0]!); await act(flush); expect(document.querySelector('pre')?.textContent).toHaveLength(20000); expect(screen.getByText('Truncated at 20,000 characters.')).toBeTruthy();
});
it('read text at exactly 20000 is not marked truncated', async () => {
  const { api } = await open(); api.getArtifactContent.mockResolvedValue({ ...envelope, mediaType: 'text/plain', text: 'x'.repeat(20000), sizeBytes: 20000, contentHash: 'a'.repeat(64) }); fireEvent.click(screen.getAllByRole('button', { name: 'Read text' })[0]!); await act(flush); expect(document.querySelector('pre')?.textContent).toHaveLength(20000); expect(screen.queryByText(/Truncated at/)).toBeNull();
});
it('read text 415 error is safe and retry succeeds', async () => {
  const { api } = await open(); api.getArtifactContent.mockRejectedValueOnce(new ApiClientError('bad-response', 415)); fireEvent.click(screen.getAllByRole('button', { name: 'Read text' })[0]!); await act(flush); expect(screen.getByRole('alert').textContent).toContain('Invalid Host response.'); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await act(flush); expect(screen.getByText('Artifact text')).toBeTruthy(); expect(screen.queryByRole('alert')).toBeNull();
});
it.each(['text/plain', 'text/markdown; charset=utf-8', 'text/x-diff', 'image/png', 'application/pdf'])('read availability for %s', async mediaType => {
  const { store, api } = await setup(); api.getKnowledgeArtifact.mockResolvedValue({ ...envelope, artifact: { ...artifact, versions: [{ ...version, mediaType }] } }); render(<KnowledgeArtifact store={store} artifactId={id} onClose={() => {}} />); await act(flush); expect(!!screen.queryByRole('button', { name: 'Read text' })).toBe(mediaType.startsWith('text/'));
});
it('detail loading and error support Retry', async () => {
  const { store, api } = await setup(); const pending = deferred<unknown>(); api.getKnowledgeArtifact.mockReturnValueOnce(pending.promise); render(<KnowledgeArtifact store={store} artifactId={id} onClose={() => {}} />); expect(screen.getByText('Loading')).toBeTruthy(); await act(async () => { pending.reject(new Error('PRIVATE')); await flush(); }); expect(screen.getByRole('alert').textContent).not.toContain('PRIVATE'); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await act(flush); expect(screen.getByRole('heading', { name: item.title })).toBeTruthy();
});
it('session loss closes knowledge views and clears data', async () => { const { store, api } = await open(); api.getArtifactContent.mockRejectedValueOnce(new ApiClientError('bad-response', 401)); fireEvent.click(screen.getAllByRole('button', { name: 'Read text' })[0]!); await act(flush); expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByRole('search')).toBeNull(); expect(store.getState().knowledge.detail).toEqual({}); });
it('project switch clears detail and browse data', async () => { const { store } = await open(); await act(async () => { await store.selectProject(otherId); }); expect(store.getState().knowledge.list).toEqual([]); expect(store.getState().knowledge.detail).toEqual({}); expect(screen.queryByText(item.title)).toBeNull(); });
it.each(['en', 'vi'] as Locale[])('browse and detail render in %s without raw keys', async locale => {
  i18n.setLocale(locale); const { store } = await setup(); const warn = vi.spyOn(console, 'warn'); render(<ProjectKnowledge store={store} projectId={id} />); await act(flush); fireEvent.click(screen.getByRole('button', { name: /Knowledge document/ })); await act(flush); expect(screen.getByRole('heading', { name: locale === 'en' ? 'Provenance' : 'Nguồn gốc' })).toBeTruthy(); expect(document.body.textContent).not.toMatch(/knowledgeUi\.|safeErrors\.|viewStates\./); expect(warn).not.toHaveBeenCalled();
});
it('StrictMode mounts and cleans up knowledge subscriptions', async () => { const { store } = await setup(); render(<StrictMode><ProjectKnowledge store={store} projectId={id} /></StrictMode>); await act(flush); expect(screen.getByText(item.title)).toBeTruthy(); });
it('knowledge English and Vietnamese keys match with nonempty translations', () => {
  function leaves(value: unknown, prefix = ''): Record<string, string> { if (typeof value === 'string') return { [prefix]: value }; return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => Object.entries(leaves(child, `${prefix}.${key}`)))); }
  const english = leaves(en.knowledgeUi); const vietnamese = leaves(viLabels.knowledgeUi); expect(Object.keys(english).sort()).toEqual(Object.keys(vietnamese).sort()); for (const value of Object.values(vietnamese)) expect(value.trim()).not.toBe('');
});


it('a snippet identical to the abstract is shown once, a different one is still shown', async () => {
  vi.useFakeTimers(); const { store, api } = await setup();
  api.searchKnowledge.mockResolvedValue({ ...envelope, results: [{ ...result, abstractL0: 'Same words', snippet: 'Same words' }, { ...result, artifactId: otherId, abstractL0: 'Abstract text', snippet: 'Different snippet' }] });
  render(<ProjectKnowledge store={store} projectId={id} />); await act(flush);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'words' } }); await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(screen.getAllByText('Same words')).toHaveLength(1); expect(screen.getByText('Different snippet')).toBeTruthy();
});
