import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TASK_TRANSITIONS, taskSchema, taskStateSchema, projectSchema, type Task } from '@factory/contracts';
import { ProjectTasks } from '../src/screens/ProjectTasks';
import { ProjectView } from '../src/screens/ProjectView';
import { ApiClientError } from '../src/api/client';
import * as commands from '../src/api/commands';
import { i18n } from '../src/i18n';
import { extra as en } from '../src/i18n/extra.en';
import { extra as vietnamese } from '../src/i18n/extra.vi';
import type { Store } from '../src/state/store';
import { setupUI } from './ui-fixtures';
import { deferred, envelope, id, otherId, project, receipt, task } from './fixtures';

const stores: Store[] = [];
beforeEach(() => { i18n.setLocale('en'); });
afterEach(() => { cleanup(); stores.forEach((store) => store.dispose()); stores.length = 0; vi.restoreAllMocks(); i18n.setLocale('en'); });
const error = (code: 'conflict' | 'internal' = 'internal') => new ApiClientError('api', code === 'conflict' ? 409 : 500, { code, message: 'Ignored', correlationId: id, nextAction: 'refresh' });
const makeTask = (patch: Partial<Task> = {}) => taskSchema.parse({ ...task, ...patch });
async function tasks(items: Task[] = [makeTask()]) {
  const value = setupUI(); stores.push(value.store); value.api.listTasks.mockResolvedValue({ ...envelope, items }); await value.store.boot(); await value.store.selectProject(id);
  const rendered = render(<ProjectTasks store={value.store} projectId={id} />); fireEvent.click(screen.getByRole('button', { name: 'List' })); return { ...value, ...rendered };
}
function newTask() { fireEvent.click(screen.getByRole('button', { name: 'New task' })); }
function fill(title = 'My task', goal = 'Reach the goal', acceptance = 'First criterion\nSecond criterion') {
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: title } }); fireEvent.change(screen.getByLabelText('Goal'), { target: { value: goal } }); fireEvent.change(screen.getByLabelText('Acceptance criteria'), { target: { value: acceptance } });
}
function create() { fireEvent.click(screen.getByRole('button', { name: 'Create task' })); }

it('sorts task rows by code', async () => {
  await tasks([makeTask({ code: 'TSK-010' }), makeTask({ id: otherId, code: 'TSK-002', title: 'Earlier' })]); const rows = screen.getAllByRole('listitem'); expect(rows.map((row) => row.querySelector('.task-code')?.textContent)).toEqual(['TSK-002', 'TSK-010']);
});
it.each([
  ['draft', 'waiting'], ['active', 'waiting'], ['failed', 'blocked'], ['awaiting-go', 'needs approval'], ['in-review', 'needs approval'], ['done', 'completed'], ['cancelled', 'closed'], ['declined', 'closed'], ['superseded', 'closed'],
] as const)('projects lifecycle %s to %s with no live attempt', async (state, label) => {
  await tasks([makeTask({ state })]); const row = screen.getByRole('listitem'); expect(within(row).getByText(label.charAt(0).toUpperCase() + label.slice(1))).toBeTruthy(); expect(within(row).getByText(en.taskUi.lifecycle[state])).toBeTruthy();
});
it('projects actionable holds as blocked', async () => {
  await tasks([makeTask({ holds: [{ kind: 'budget', reason: 'Limit', ref: null, since: '2026-11-07T00:00:00.000Z', needsAction: true }] })]); expect(screen.getByText('Blocked')).toBeTruthy();
});
it('shows required capability chips', async () => { await tasks([makeTask({ requiredCapabilities: ['runtime.node', 'runtime.browser'] })]); expect(screen.getByText('runtime.node').className).toContain('badge'); expect(screen.getByText('runtime.browser')).toBeTruthy(); });
it('shows owner seat name', async () => { await tasks([makeTask({ ownerSeatId: id })]); expect(screen.getByText('Owner: Lead')).toBeTruthy(); });
it('shows a dash when unassigned', async () => { await tasks(); expect(screen.getByText('Owner: —')).toBeTruthy(); });
it('labels proposed tasks without inventing an author', async () => {
  await tasks(); const row = screen.getByRole('listitem'); expect(within(row).getAllByText('Proposed')).toHaveLength(1); expect(within(row).getAllByText('Waiting')).toHaveLength(1); expect(within(row).queryByText('proposed')).toBeNull(); expect(row.querySelectorAll('.task-summary > .badge, .task-summary > .muted')).toHaveLength(2); expect(screen.queryByText('Proposed by Lead')).toBeNull(); expect(document.querySelector('.task-proposed')).toBeTruthy();
});
it('reveals goal, acceptance, dependencies and policies through a disclosure', async () => {
  await tasks([makeTask({ acceptance: ['Works', 'Verified'], dependsOn: [otherId] }), makeTask({ id: otherId, code: 'TSK-002', title: 'Dependency' })]); const button = screen.getByRole('button', { name: 'Details UI-001' }); expect(button.getAttribute('aria-expanded')).toBe('false'); expect(screen.queryByText('Build core')).toBeNull(); fireEvent.click(button);
  expect(button.getAttribute('aria-expanded')).toBe('true'); const details = document.getElementById(button.getAttribute('aria-controls')!)!;
  for (const label of ['Build core', 'Works', 'Verified', 'TSK-002', 'Portable', 'None', 'Human final review']) expect(within(details).getByText(label)).toBeTruthy(); fireEvent.click(button); expect(screen.queryByText('Build core')).toBeNull();
});
it('renders all task content as plain text', async () => {
  const payload = '<img src=x onerror=alert(1)><script>alert(1)</script>'; await tasks([makeTask({ title: payload, goal: payload, acceptance: [payload] })]); fireEvent.click(screen.getByRole('button', { name: 'Details UI-001' })); expect(screen.getAllByText(payload)).toHaveLength(3); expect(document.querySelector('img, script')).toBeNull();
});
it.each(taskStateSchema.options)('offers exactly the supported contract transitions from %s', async (state) => {
  await tasks([makeTask({ state })]); const supported = ['proposed', 'accepted', 'declined', 'cancelled']; const expected = TASK_TRANSITIONS[state].filter((target) => supported.includes(target)).map((target) => en.taskUi.actions[target as keyof typeof en.taskUi.actions]); const actions = within(screen.getByRole('listitem')).queryAllByRole('button').filter((button) => !button.textContent?.startsWith('Details')); expect(actions.map((button) => button.textContent)).toEqual(expected);
});
it.each([['Decline', 'Confirm decline', 'declined'], ['Cancel', 'Confirm cancel', 'cancelled']] as const)('requires inline confirmation for %s', async (action, confirmation, to) => {
  const { api } = await tasks(); fireEvent.click(screen.getByRole('button', { name: action })); expect(api.sendCommand).not.toHaveBeenCalled(); expect(screen.getByRole('group', { name: 'Confirm task action' })).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: confirmation })); expect(api.sendCommand.mock.calls[0]?.[0]).toMatchObject({ type: 'tasks.transition', payload: { taskId: id, expectedRevision: 1, to } }); await act(async () => {});
});
it.each(['Decline', 'Cancel'])('cancels %s confirmation without sending', async (action) => {
  const { api } = await tasks(); fireEvent.click(screen.getByRole('button', { name: action })); fireEvent.click(screen.getByRole('button', { name: 'Keep task' })); expect(screen.queryByRole('group', { name: 'Confirm task action' })).toBeNull(); expect(api.sendCommand).not.toHaveBeenCalled();
});
it('sends Accept with the revision from its task row', async () => {
  const { api } = await tasks([makeTask({ revision: 17 })]); fireEvent.click(screen.getByRole('button', { name: 'Accept' })); expect(api.sendCommand.mock.calls[0]?.[0]).toMatchObject({ type: 'tasks.transition', projectId: id, payload: { expectedRevision: 17, to: 'accepted', taskId: id } }); await act(async () => {});
});
it('sends Propose from draft', async () => { const { api } = await tasks([makeTask({ state: 'draft' })]); fireEvent.click(screen.getByRole('button', { name: 'Propose' })); expect(api.sendCommand.mock.calls[0]?.[0].payload.to).toBe('proposed'); await act(async () => {}); });
it('builds and sends only once for repeated transition clicks', async () => {
  const { api } = await tasks(); const pending = deferred<unknown>(); api.sendCommand.mockReturnValue(pending.promise); const build = vi.spyOn(commands, 'tasksTransition'); const button = screen.getByRole('button', { name: 'Accept' }); fireEvent.click(button); fireEvent.click(button); expect(build).toHaveBeenCalledOnce(); expect(api.sendCommand).toHaveBeenCalledOnce(); expect((button as HTMLButtonElement).disabled).toBe(true); await act(async () => { pending.resolve({ ...envelope, receipt }); });
});
it('keeps pending state independent across rows', async () => {
  const { api } = await tasks([makeTask(), makeTask({ id: otherId, code: 'TSK-002' })]); const pending = deferred<unknown>(); api.sendCommand.mockReturnValue(pending.promise); const buttons = screen.getAllByRole('button', { name: 'Accept' }); fireEvent.click(buttons[0]!); expect((buttons[0] as HTMLButtonElement).disabled).toBe(true); expect((buttons[1] as HTMLButtonElement).disabled).toBe(false); fireEvent.click(buttons[1]!); expect(api.sendCommand).toHaveBeenCalledTimes(2); await act(async () => { pending.resolve({ ...envelope, receipt }); });
});
it('shows transition failure with Reference and retries the same command', async () => {
  const { store, api } = await tasks(); api.sendCommand.mockRejectedValueOnce(error()); const retry = vi.spyOn(store, 'retry'); fireEvent.click(screen.getByRole('button', { name: 'Accept' })); expect((await screen.findByRole('alert')).textContent).toContain(`Reference: ${id}`); const original = api.sendCommand.mock.calls[0]?.[0]; const retryButton = await screen.findByRole('button', { name: 'Retry' }); await waitFor(() => expect((retryButton as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(retryButton); await waitFor(() => expect(api.sendCommand).toHaveBeenCalledTimes(2)); expect(api.sendCommand.mock.calls[1]?.[0]).toBe(original); expect(retry).toHaveBeenCalledWith(original.commandId); await act(async () => {});
});
it('reloads tasks on transition conflict', async () => { const { store, api } = await tasks(); const load = vi.spyOn(store, 'loadTasks'); api.sendCommand.mockRejectedValueOnce(error('conflict')); fireEvent.click(screen.getByRole('button', { name: 'Accept' })); await waitFor(() => expect(load).toHaveBeenCalledOnce()); });
it('reloads tasks after a successful transition', async () => { const { store } = await tasks(); const load = vi.spyOn(store, 'loadTasks'); fireEvent.click(screen.getByRole('button', { name: 'Accept' })); await waitFor(() => expect(load).toHaveBeenCalledOnce()); });
it.each(['proposed', 'accepted', 'done', 'closed'])('filters tasks by %s', async (filter) => {
  await tasks([makeTask({ code: 'TSK-001', title: 'Proposed task' }), makeTask({ id: otherId, state: 'accepted', code: 'TSK-002', title: 'Accepted task' }), makeTask({ id: crypto.randomUUID(), state: 'done', code: 'TSK-003', title: 'Done task' }), makeTask({ id: crypto.randomUUID(), state: 'declined', code: 'TSK-004', title: 'Closed task' })]); fireEvent.change(screen.getByLabelText('Status filter'), { target: { value: filter } }); expect(screen.getAllByRole('listitem')).toHaveLength(1); expect(screen.getByRole('listitem').textContent).toContain(filter === 'closed' ? 'Closed task' : `${filter.charAt(0).toUpperCase()}${filter.slice(1)} task`);
});
it('All filter restores every task', async () => { await tasks([makeTask(), makeTask({ id: otherId, state: 'accepted', code: 'TSK-002' })]); const filter = screen.getByLabelText('Status filter'); fireEvent.change(filter, { target: { value: 'done' } }); fireEvent.change(filter, { target: { value: 'all' } }); expect(screen.getAllByRole('listitem')).toHaveLength(2); });
it('distinguishes an empty project from an empty filter result', async () => {
  const { api, store } = await tasks([]); expect(screen.getByText('No tasks yet.')).toBeTruthy(); api.listTasks.mockResolvedValue({ ...envelope, items: [makeTask()] }); await act(async () => { await store.loadTasks(); }); fireEvent.change(screen.getByLabelText('Status filter'), { target: { value: 'done' } }); expect(screen.getByText('No tasks match this filter.')).toBeTruthy();
});
it.each([0, 1, 2])('shows correct header and tab wording for %s proposed tasks', async (count) => {
  const items = Array.from({ length: count }, (_, index) => makeTask({ id: index ? otherId : id, code: `TSK-00${index + 1}` }));
  const { store, unmount } = await tasks(items);
  expect(screen.getByText(`${count} proposed ${count === 1 ? 'task' : 'tasks'} awaiting your review`)).toBeTruthy();
  unmount(); render(<ProjectView store={store} project={projectSchema.parse(project)} />);
  const tab = screen.getByRole('tab', { name: count ? `Tasks ${count} proposed` : 'Tasks' });
  expect(tab.querySelector('.badge')?.textContent ?? null).toBe(count ? `${count} proposed` : null);
});
it('shows the proposed count in the Tasks tab with accessible text', async () => {
  const { store, unmount } = await tasks([makeTask(), makeTask({ id: otherId, code: 'TSK-002' }), makeTask({ id: crypto.randomUUID(), code: 'TSK-003' })]); unmount(); render(<ProjectView store={store} project={projectSchema.parse(project)} />); expect(screen.getByRole('tab', { name: 'Tasks 3 proposed' })).toBeTruthy();
});
it('does not display a zero count badge on the tab', async () => { const { store, unmount } = await tasks([]); unmount(); render(<ProjectView store={store} project={projectSchema.parse(project)} />); expect(screen.getByRole('tab', { name: 'Tasks' }).querySelector('.badge')).toBeNull(); });
it('opens and closes New task as a disclosure without losing text', async () => {
  await tasks(); const button = screen.getByRole('button', { name: 'New task' }); expect(button.getAttribute('aria-expanded')).toBe('false'); newTask(); fill(); expect(button.getAttribute('aria-expanded')).toBe('true'); newTask(); expect(screen.queryByLabelText('Title')).toBeNull(); newTask(); expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('My task');
});
it.each([
  ['', 'Goal', 'Pass', 'Title', '1 and 160'], ['x'.repeat(161), 'Goal', 'Pass', 'Title', '1 and 160'],
  ['Title', '', 'Pass', 'Goal', '1 and 500'], ['Title', 'x'.repeat(501), 'Pass', 'Goal', '1 and 500'],
  ['Title', 'Goal', '', 'Acceptance criteria', '1–30'], ['Title', 'Goal', '  \n  ', 'Acceptance criteria', '1–30'],
  ['Title', 'Goal', 'x'.repeat(501), 'Acceptance criteria', '1–30'], ['Title', 'Goal', Array.from({ length: 31 }, () => 'Pass').join('\n'), 'Acceptance criteria', '1–30'],
])('validates new task field %s / %s / criteria', async (title, goal, acceptance, field, hint) => {
  const { api } = await tasks(); newTask(); fill(title, goal, acceptance); create(); const input = screen.getByLabelText(field); expect(input.getAttribute('aria-invalid')).toBe('true'); const descriptions = input.getAttribute('aria-describedby')!.split(' ').map((value) => document.getElementById(value)?.textContent).join(' '); expect(descriptions).toContain(hint); expect(api.sendCommand).not.toHaveBeenCalled();
});
it('creates a valid task with trimmed criteria and the next generated code', async () => {
  const { api } = await tasks([makeTask({ code: 'TSK-003' }), makeTask({ id: otherId, code: 'UI-999' })]); newTask(); fill(' New task ', ' Goal ', ' Pass \n\n Verified '); create(); expect(api.sendCommand.mock.calls[0]?.[0]).toMatchObject({ type: 'tasks.create', projectId: id, payload: { code: 'TSK-004', title: 'New task', goal: 'Goal', brief: 'Goal', acceptance: ['Pass', 'Verified'] } }); await act(async () => {});
});
it('allows acceptance boundaries of 30 criteria with 500 characters each', async () => { const { api } = await tasks([]); newTask(); fill('Title', 'Goal', Array.from({ length: 30 }, () => 'x'.repeat(500)).join('\n')); create(); expect(api.sendCommand).toHaveBeenCalledOnce(); await act(async () => {}); });
it('sends only one creation command for repeated clicks and submits', async () => {
  const { api } = await tasks([]); const pending = deferred<unknown>(); api.sendCommand.mockReturnValue(pending.promise); const build = vi.spyOn(commands, 'tasksCreate'); newTask(); fill(); create(); create(); fireEvent.submit(screen.getByLabelText('Title').closest('form')!); expect(build).toHaveBeenCalledOnce(); expect(api.sendCommand).toHaveBeenCalledOnce(); await act(async () => { pending.resolve({ ...envelope, receipt }); });
});
it('keeps form values while pending, then clears and reloads after success', async () => {
  const { api, store } = await tasks([]); const pending = deferred<unknown>(); api.sendCommand.mockReturnValue(pending.promise); const load = vi.spyOn(store, 'loadTasks'); newTask(); fill(); create(); expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('My task'); await act(async () => { pending.resolve({ ...envelope, receipt }); }); for (const label of ['Title', 'Goal', 'Acceptance criteria']) expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(''); expect(load).toHaveBeenCalledOnce();
});
it('keeps failed task values and shows Reference', async () => { const { api } = await tasks([]); api.sendCommand.mockRejectedValueOnce(error()); newTask(); fill(); create(); expect((await screen.findByRole('alert')).textContent).toContain(`Reference: ${id}`); expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('My task'); });
it('retries a non-conflict task creation with the same command', async () => {
  const { api, store } = await tasks([]); const retry = vi.spyOn(store, 'retry'); api.sendCommand.mockRejectedValueOnce(error()); newTask(); fill(); create(); fireEvent.click(await screen.findByRole('button', { name: 'Retry' })); await waitFor(() => expect(api.sendCommand).toHaveBeenCalledTimes(2)); const original = api.sendCommand.mock.calls[0]?.[0]; expect(api.sendCommand.mock.calls[1]?.[0]).toBe(original); expect(retry).toHaveBeenCalledWith(original.commandId); await act(async () => {});
});
it('reloads after a code conflict and retries with a fresh code and commandId', async () => {
  const { api, store } = await tasks([]); const load = vi.spyOn(store, 'loadTasks'); const retry = vi.spyOn(store, 'retry'); api.sendCommand.mockRejectedValueOnce(error('conflict')); api.listTasks.mockResolvedValue({ ...envelope, items: [makeTask({ code: 'TSK-001' })] }); newTask(); fill(); create();
  await waitFor(() => expect(screen.getByText('Code: TSK-002')).toBeTruthy()); expect(load).toHaveBeenCalledOnce(); const original = api.sendCommand.mock.calls[0]?.[0]; expect(original.payload.code).toBe('TSK-001'); fireEvent.click(screen.getByRole('button', { name: 'Retry as new' })); await waitFor(() => expect(api.sendCommand).toHaveBeenCalledTimes(2)); const next = api.sendCommand.mock.calls[1]?.[0]; expect(next.payload.code).toBe('TSK-002'); expect(next.commandId).not.toBe(original.commandId); expect(next.payload.taskId).not.toBe(original.payload.taskId); expect(retry).not.toHaveBeenCalled(); await act(async () => {});
});
it('renders tasks and expanded details in Vietnamese without missing strings', async () => {
  await tasks(); const warn = vi.spyOn(console, 'warn'); act(() => i18n.setLocale('vi')); fireEvent.click(screen.getByRole('button', { name: 'Chi tiết UI-001' })); fireEvent.click(screen.getByRole('button', { name: 'Công việc mới' })); expect(screen.getByLabelText('Tiêu đề')).toBeTruthy(); expect(screen.getByText(vietnamese.taskUi.display.waiting)).toBeTruthy(); expect(warn).not.toHaveBeenCalled();
});
function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value };
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => Object.entries(flatten(child, `${prefix}.${key}`))));
}
it('has identical English and Vietnamese keys for every chat and task label', () => {
  for (const section of ['chatUi', 'taskUi'] as const) { const english = flatten(en[section]); const viLabels = flatten(vietnamese[section]); expect(Object.keys(english).sort()).toEqual(Object.keys(viLabels).sort()); for (const value of Object.values(viLabels)) expect(value.trim()).not.toBe(''); }
});
it('has named task controls, linked errors and unique ids', async () => {
  await tasks(); newTask(); create(); expect(screen.getByRole('combobox', { name: 'Status filter' })).toBeTruthy(); for (const name of ['Title', 'Goal', 'Acceptance criteria']) expect(screen.getByRole('textbox', { name })).toBeTruthy(); for (const button of screen.getAllByRole('button')) expect(button.textContent?.trim()).toBeTruthy(); const ids = [...document.querySelectorAll('[id]')].map((node) => node.id); expect(new Set(ids).size).toBe(ids.length);
});
