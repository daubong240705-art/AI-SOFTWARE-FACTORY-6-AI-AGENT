import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { projectSchema, taskSchema, type Task } from '@factory/contracts';
import { requestItemSchema } from '../src/api/m3Models';
import { ProjectView } from '../src/screens/ProjectView';
import type { Store } from '../src/state/store';
import { budget, conversation, envelope, id, otherId, project, task } from './fixtures';
import { item as document } from './knowledge-fixtures';
import { briefing, dossier, requestItem } from './m3-fixtures';
import { review } from './inbox-fixtures';
import { useEnglish } from './setup';
import { attempt, setupUI } from './ui-fixtures';

const stores: Store[] = [];
const makeTask = (patch: Partial<Task> = {}) => taskSchema.parse({ ...task, ...patch });
beforeEach(useEnglish);
afterEach(() => { cleanup(); stores.splice(0).forEach(store => store.dispose()); });

async function page(items: Task[] = [], configure?: (fixture: ReturnType<typeof setupUI>) => void) {
  history.replaceState(null, '', `#/project/${id}`);
  const fixture = setupUI(); stores.push(fixture.store);
  fixture.api.listTasks.mockResolvedValue({ ...envelope, items });
  fixture.api.getBriefing.mockResolvedValue(briefing);
  configure?.(fixture);
  await fixture.store.boot(); await fixture.store.selectProject(id);
  const rendered = render(<ProjectView store={fixture.store} project={projectSchema.parse(project)} />);
  await act(async () => {});
  return { ...fixture, ...rendered };
}

it('shows four plain, labelled numbers from store data and updates them after a refresh', async () => {
  const states: Task['state'][] = [
    'active', 'active', 'in-review', 'awaiting-go', 'awaiting-go', 'awaiting-go',
    'done', 'done', 'done', 'done', 'proposed', 'cancelled',
  ];
  const { api, store } = await page(states.map((state, index) => makeTask({
    id: crypto.randomUUID(), code: `TSK-${String(index).padStart(3, '0')}`, state,
  })));
  expect(screen.getAllByRole('term').map(node => node.textContent)).toEqual(['Running', 'In review', 'Waiting for a go', 'Done']);
  const numbers = screen.getAllByRole('definition');
  expect(numbers.map(node => node.textContent)).toEqual(['2', '1', '3', '4']);
  expect(numbers.every(node => node.childElementCount === 0)).toBe(true);
  expect(screen.queryByRole('region', { name: 'Proposed' })).toBeNull();
  api.listTasks.mockResolvedValue({ ...envelope, items: [makeTask({ state: 'done' })] });
  await act(async () => { await store.loadTasks(); });
  expect(screen.getAllByRole('definition').map(node => node.textContent)).toEqual(['0', '0', '0', '1']);
});

it('keeps zero-valued Overview counts visible in an empty project', async () => {
  await page();
  expect(screen.getAllByRole('definition').map(node => node.textContent)).toEqual(['0', '0', '0', '0']);
  expect(screen.getByText('No tasks are running or waiting for you.')).toBeTruthy();
});

it('shows one TOKEN BUDGET meter and keeps one when moving between Overview and chat', async () => {
  await page([], ({ api }) => {
    api.listConversations.mockResolvedValue({ ...envelope, conversations: [conversation] });
    api.getBudget.mockResolvedValue({ ...envelope, budget: { ...budget, day: { ...budget.day, used: 375 } } });
  });
  const meter = screen.getByRole('meter', { name: 'TOKEN BUDGET' });
  expect(screen.getAllByRole('meter')).toHaveLength(1);
  expect(meter.getAttribute('aria-valuemin')).toBe('0');
  expect(meter.getAttribute('aria-valuemax')).toBe('1000');
  expect(meter.getAttribute('aria-valuenow')).toBe('375');
  expect(meter.getAttribute('aria-valuetext')).toBe('375 / 1,000 tokens');
  fireEvent.click(screen.getByRole('button', { name: 'Ask Lead' }));
  await screen.findByRole('textbox', { name: 'Message' });
  expect(screen.getAllByRole('meter', { name: 'TOKEN BUDGET' })).toEqual([meter]);
  expect(within(screen.getByRole('region', { name: 'Agent chat' })).queryByRole('meter')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Board' }));
  expect(screen.getAllByRole('meter', { name: 'TOKEN BUDGET' })).toHaveLength(1);
  expect(within(screen.getByRole('region', { name: 'Agent chat' })).getByRole('meter')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
  expect(screen.getAllByRole('meter', { name: 'TOKEN BUDGET' })).toHaveLength(1);
  expect(within(screen.getByRole('region', { name: 'Agent chat' })).queryByRole('meter')).toBeNull();
  await act(async () => {});
});

it.each([
  ['active', 'Waiting'], ['awaiting-go', 'Needs approval'], ['in-review', 'Needs approval'],
] as const)('opens the %s activity row in the Board task pane', async (state, status) => {
  await page([makeTask({ state }), makeTask({ id: otherId, code: 'UI-002', title: 'Finished', state: 'done' })]);
  const activity = within(screen.getByRole('region', { name: 'Active tasks' }));
  const row = activity.getByRole('button', { name: new RegExp(`UI-001\\s*Core\\s*${status}`) });
  expect(activity.getAllByRole('button')).toHaveLength(1);
  expect(activity.queryByText('Finished')).toBeNull();
  row.focus(); fireEvent.click(row);
  const pane = screen.getByRole('region', { name: 'Task details' });
  expect(within(pane).getByRole('heading', { name: 'Core' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Board' }).getAttribute('aria-selected')).toBe('true');
  expect(location.hash).toBe(`#/project/${id}/board`);
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => {});
});

it('shows Requests only while the store contains requests', async () => {
  const { api, store } = await page();
  expect(screen.queryByRole('region', { name: 'Requests' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Requests' })).toBeNull();
  api.listRequests.mockResolvedValue({ ...envelope, items: [requestItem] });
  await act(async () => { await store.loadRequests(); });
  const requests = within(screen.getByRole('region', { name: 'Requests' }));
  expect(requests.getByRole('heading', { name: 'Requests' })).toBeTruthy();
  expect(requests.getByRole('button', { name: 'REQ-001 Find sources' })).toBeTruthy();
  api.listRequests.mockResolvedValue({ ...envelope, items: [] });
  await act(async () => { await store.loadRequests(); });
  expect(screen.queryByRole('region', { name: 'Requests' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Requests' })).toBeNull();
});

it('keeps completed request history reachable on Overview', async () => {
  const request = requestItemSchema.parse({ ...requestItem, taskState: 'done', triageState: 'accepted' });
  await page([], ({ api }) => api.listRequests.mockResolvedValue({ ...envelope, items: [request] }));
  const section = within(screen.getByRole('region', { name: 'Requests' }));
  expect(section.getByRole('button', { name: 'REQ-001 Find sources' })).toBeTruthy();
  expect(within(section.getByRole('listitem')).getByText('Accepted')).toBeTruthy();
});

it('shows a Board card with code, title, one status and an owner without capability or dependency chips', async () => {
  await page([makeTask({
    state: 'active', ownerSeatId: id, requiredCapabilities: ['runtime.node', 'runtime.browser'], dependsOn: [otherId],
  })], ({ api }) => api.listAttempts.mockResolvedValue({ ...envelope, attempts: [attempt] }));
  fireEvent.click(screen.getByRole('tab', { name: 'Board' }));
  const card = screen.getAllByRole('button').find(button => button.dataset.taskId === id)!;
  expect(within(card).getByText('UI-001').className).toContain('task-code');
  expect(within(card).getByText('Core').tagName).toBe('STRONG');
  expect(within(card).getAllByText('Running')).toHaveLength(1);
  expect(card.querySelectorAll('.project-status')).toHaveLength(1);
  expect(within(card).getByText('Lead')).toBeTruthy();
  for (const text of [/runtime\./, /dependenc/i, /Owner:/, 'Active', 'Needs your decision']) {
    expect(within(card).queryByText(text)).toBeNull();
  }
  expect(card.querySelector('.badge')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Tasks' })).toBeNull();
  expect(screen.queryByText(/awaiting your review/)).toBeNull();
});

it('shows the warm decision badge only on the task with a pending approval and removes it on refresh', async () => {
  const { api, store } = await page([
    makeTask({ state: 'in-review' }),
    makeTask({ id: otherId, code: 'UI-002', title: 'Ready to start', state: 'awaiting-go' }),
  ], ({ api }) => api.getInbox.mockResolvedValue({
    ...envelope, approvals: [review], startGates: [], counts: { approvals: 1, startGates: 0, total: 1 },
  }));
  fireEvent.click(screen.getByRole('tab', { name: 'Board' }));
  const card = screen.getAllByRole('button').find(button => button.dataset.taskId === id)!;
  expect(within(card).getByText('Needs your decision').className).toContain('project-needs-decision');
  expect(within(card).getAllByText('Needs approval')).toHaveLength(1);
  expect(card.querySelectorAll('.project-status')).toHaveLength(1);
  const otherCard = screen.getAllByRole('button').find(button => button.dataset.taskId === otherId)!;
  expect(within(otherCard).queryByText('Needs your decision')).toBeNull();
  api.getInbox.mockResolvedValue({ ...envelope, approvals: [], startGates: [], counts: { approvals: 0, startGates: 0, total: 0 } });
  await act(async () => { await store.loadInbox(); });
  expect(screen.queryByText('Needs your decision')).toBeNull();
  const refreshed = screen.getAllByRole('button').find(button => button.dataset.taskId === id)!;
  expect(within(refreshed).getAllByText('Needs approval')).toHaveLength(1);
});

it('shows Documents and Dossier together with search, dossier refresh and resume briefing controls', async () => {
  const { api } = await page([], ({ api }) => {
    api.listKnowledgeArtifacts.mockResolvedValue({ ...envelope, items: [document] });
    api.getDossier.mockResolvedValue({ ...envelope, dossier });
  });
  fireEvent.click(screen.getByRole('tab', { name: 'Knowledge' }));
  const panel = within(screen.getByRole('tabpanel', { name: 'Knowledge' }));
  const documents = panel.getByRole('region', { name: 'Documents' });
  const projectDossier = panel.getByRole('region', { name: 'Dossier' });
  expect(within(documents).getByRole('heading', { name: 'Documents' })).toBeTruthy();
  expect(within(documents).getByRole('searchbox', { name: 'Search documents' })).toBeTruthy();
  expect(within(projectDossier).getByRole('heading', { name: 'Dossier' })).toBeTruthy();
  expect(within(projectDossier).getByRole('button', { name: 'Refresh dossier' })).toBeTruthy();
  expect(within(projectDossier).getByRole('heading', { name: 'Resume briefing' })).toBeTruthy();
  expect(within(projectDossier).getByLabelText('Since')).toBeTruthy();
  expect(panel.queryByRole('tablist')).toBeNull();
  expect(await within(documents).findByText('Knowledge document')).toBeTruthy();
  expect(await within(projectDossier).findByText(dossier.markdown)).toBeTruthy();
  expect(api.getDossier).toHaveBeenCalledWith(id);
  expect(api.getBriefing).toHaveBeenCalledWith(id, undefined);
});
