import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { projectSchema, taskSchema } from '@factory/contracts';
import { ProjectView } from '../src/screens/ProjectView';
import type { Store } from '../src/state/store';
import { conversation, envelope, id, project, task } from './fixtures';
import { briefing } from './m3-fixtures';
import { useEnglish } from './setup';
import { setupUI } from './ui-fixtures';

const stores: Store[] = [];
beforeEach(useEnglish);
afterEach(() => { cleanup(); stores.splice(0).forEach(store => store.dispose()); });

async function page(tab: 'overview' | 'board' | 'knowledge' = 'board') {
  history.replaceState(null, '', `#/project/${id}${tab === 'overview' ? '' : `/${tab}`}`);
  const fixture = setupUI(); stores.push(fixture.store);
  fixture.api.listTasks.mockResolvedValue({ ...envelope, items: [taskSchema.parse(task)] });
  fixture.api.listConversations.mockResolvedValue({ ...envelope, conversations: [conversation] });
  fixture.api.getBriefing.mockResolvedValue(briefing);
  await fixture.store.boot(); await fixture.store.selectProject(id);
  render(<ProjectView store={fixture.store} project={projectSchema.parse(project)} />);
  await act(async () => {});
  return fixture;
}

function openCard() {
  const card = screen.getAllByRole('button').find(button => button.dataset.taskId === id)!;
  card.focus(); fireEvent.click(card);
  return card;
}

it.each(['Escape', 'Close task'] as const)('closes the inline task pane with %s and restores focus to its Board card', async action => {
  await page();
  const card = openCard();
  const pane = screen.getByRole('region', { name: 'Task details' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(pane).getByRole('heading', { name: 'Core' })).toBeTruthy();
  expect(card.isConnected).toBe(true);
  expect(card.closest('.project-board-area')?.parentElement).toBe(pane.parentElement);
  expect(pane.contains(document.activeElement)).toBe(true);
  const sections = within(pane).getByRole('tablist', { name: 'Task sections' });
  expect(within(sections).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Context', 'Progress', 'Results', 'Actions']);
  expect(within(sections).getByRole('tab', { name: 'Progress', selected: true })).toBeTruthy();
  if (action === 'Escape') fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  else fireEvent.click(within(pane).getByRole('button', { name: /^Close task/ }));
  expect(screen.queryByRole('region', { name: 'Task details' })).toBeNull();
  expect(document.activeElement).toBe(card);
  await act(async () => {});
});

it.each(['overview', 'board', 'knowledge'] as const)('opens Ask Lead from %s with aria wiring and closes with Escape and focus return', async tab => {
  await page(tab);
  const ask = screen.getByRole('button', { name: 'Ask Lead' });
  expect(ask.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('region', { name: 'Agent chat' })).toBeNull();
  ask.focus(); fireEvent.click(ask);
  const dock = screen.getByRole('region', { name: 'Agent chat' });
  expect(ask.getAttribute('aria-expanded')).toBe('true');
  expect(ask.getAttribute('aria-controls')).toBe(dock.id);
  expect(dock.contains(document.activeElement)).toBe(true);
  expect(within(dock).getByRole('textbox', { name: 'Message' })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  const input = within(dock).getByRole('textbox', { name: 'Message' });
  input.focus(); fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Agent chat' })).toBeNull();
  expect(ask.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(ask);
  await act(async () => {});
});

it.each(['Close chat', 'Ask Lead'] as const)('closes the chat dock using %s and restores focus to Ask Lead', async action => {
  await page();
  const ask = screen.getByRole('button', { name: 'Ask Lead' });
  ask.focus(); fireEvent.click(ask);
  const dock = screen.getByRole('region', { name: 'Agent chat' });
  fireEvent.click(action === 'Ask Lead' ? ask : within(dock).getByRole('button', { name: /^Close chat/ }));
  expect(screen.queryByRole('region', { name: 'Agent chat' })).toBeNull();
  expect(ask.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(ask);
  await act(async () => {});
});

it('keeps the task pane and chat dock mutually exclusive in both directions', async () => {
  await page();
  openCard();
  expect(screen.getByRole('region', { name: 'Task details' })).toBeTruthy();
  const ask = screen.getByRole('button', { name: 'Ask Lead' });
  ask.focus(); fireEvent.click(ask);
  expect(screen.queryByRole('region', { name: 'Task details' })).toBeNull();
  const dock = screen.getByRole('region', { name: 'Agent chat' });
  expect(ask.getAttribute('aria-expanded')).toBe('true');
  expect(dock.contains(document.activeElement)).toBe(true);
  const card = openCard();
  const pane = screen.getByRole('region', { name: 'Task details' });
  expect(screen.queryByRole('region', { name: 'Agent chat' })).toBeNull();
  expect(ask.getAttribute('aria-expanded')).toBe('false');
  expect(pane.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Task details' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Agent chat' })).toBeNull();
  expect(document.activeElement).toBe(card);
  await act(async () => {});
});
