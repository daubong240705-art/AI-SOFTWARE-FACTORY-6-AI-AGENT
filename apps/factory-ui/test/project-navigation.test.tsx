import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { AppShell } from '../src/screens/AppShell';
import { parseHash, projectTab, viewHash, type ProjectTab } from '../src/screens/shell/navigation';
import type { Store } from '../src/state/store';
import { id } from './fixtures';
import { briefing } from './m3-fixtures';
import { setupShell } from './shell-fixtures';
import { useEnglish } from './setup';

const stores: Store[] = [];
beforeEach(useEnglish);
afterEach(() => { cleanup(); stores.splice(0).forEach(store => store.dispose()); });

const tabs = [
  ['overview', 'Overview', `#/project/${id}`],
  ['board', 'Board', `#/project/${id}/board`],
  ['workflow', 'Workflow', `#/project/${id}/workflow`],
  ['automation', 'Automation', `#/project/${id}/automation`],
  ['knowledge', 'Knowledge', `#/project/${id}/knowledge`],
] as const;

async function shell(hash = `#/project/${id}`) {
  history.replaceState(null, '', hash);
  const fixture = await setupShell(); stores.push(fixture.store);
  fixture.api.getBriefing.mockResolvedValue(briefing);
  const rendered = render(<AppShell store={fixture.store} />);
  await screen.findByRole('tablist', { name: 'Project views' });
  await act(async () => {});
  return { ...fixture, ...rendered };
}

function selected(name: string) {
  const list = within(screen.getByRole('tablist', { name: 'Project views' }));
  const buttons = list.getAllByRole('tab');
  expect(buttons.map(button => button.textContent)).toEqual(['Overview', 'Board', 'Workflow', 'Automation', 'Knowledge']);
  expect(list.getAllByRole('tab', { selected: true })).toEqual([list.getByRole('tab', { name })]);
  for (const button of buttons) expect(button.tabIndex).toBe(button.textContent === name ? 0 : -1);
  const active = list.getByRole('tab', { name });
  const panel = screen.getByRole('tabpanel', { name });
  expect(active.getAttribute('aria-controls')).toBe(panel.id);
  expect(panel.getAttribute('aria-labelledby')).toBe(active.id);
  return active;
}

it.each(tabs)('parses and builds the project %s tab', (tab, _name, hash) => {
  expect(viewHash(`project:${id}`, tab)).toBe(hash);
  expect(parseHash(hash)).toBe(`project:${id}`);
  expect(projectTab(hash)).toBe(tab);
});

it('builds Overview without a suffix and accepts the explicit overview alias', () => {
  expect(viewHash(`project:${id}`)).toBe(`#/project/${id}`);
  expect(parseHash(`#/project/${id}/overview`)).toBe(`project:${id}`);
  expect(projectTab(`#/project/${id}/overview`)).toBe('overview');
});

it.each([
  ['a/b c', 'a%2Fb%20c'], ['project?#%', 'project%3F%23%25'],
  ['%2F', '%252F'], ['dự án', 'd%E1%BB%B1%20%C3%A1n'], ['a\\b', 'a%5Cb'],
])('round trips the encoded project id %s on all five tabs', (projectId, encoded) => {
  for (const [tab] of tabs) {
    const hash = `#/project/${encoded}${tab === 'overview' ? '' : `/${tab}`}`;
    expect(viewHash(`project:${projectId}`, tab)).toBe(hash);
    expect(parseHash(hash)).toBe(`project:${projectId}`);
    expect(projectTab(hash)).toBe(tab);
  }
});

it.each([
  '', '#/unknown', '#/project', '#/project/', '#/project//board', '#/project/%',
  '#/project/%E0%A4%A/board', '#/project/%20/knowledge', '#/project/%09/board',
  `#/project/${id}/tasks`, `#/project/${id}/chat`, `#/project/${id}/unknown`,
  `#/project/${id}/BOARD`, `#/project/${id}/board/`, `#/project/${id}/board/extra`,
  `#/project/${id}/knowledge?tab=board`, '#/overview/board', '#/team/knowledge',
])('falls back safely for malformed or unknown project hash %j', hash => {
  expect(parseHash(hash)).toBe('overview');
  expect(projectTab(hash)).toBe('overview');
  expect(viewHash(parseHash(hash), projectTab(hash))).toBe('#/overview');
});

it.each(tabs)('restores exactly five wired tabs at %s on load and remount', async (_tab, name, hash) => {
  const { store, unmount } = await shell(hash);
  selected(name); expect(location.hash).toBe(hash);
  unmount(); render(<AppShell store={store} />);
  selected(name); expect(location.hash).toBe(hash);
  await act(async () => {});
});

it('supports roving focus, wrapping arrows, Home and End across five tabs', async () => {
  await shell();
  selected('Overview').focus();
  const moves: Array<[string, string, ProjectTab]> = [
    ['ArrowRight', 'Board', 'board'], ['ArrowRight', 'Workflow', 'workflow'],
    ['ArrowRight', 'Automation', 'automation'], ['ArrowRight', 'Knowledge', 'knowledge'],
    ['ArrowRight', 'Overview', 'overview'], ['ArrowLeft', 'Knowledge', 'knowledge'],
    ['Home', 'Overview', 'overview'], ['End', 'Knowledge', 'knowledge'],
    ['ArrowLeft', 'Automation', 'automation'], ['ArrowLeft', 'Workflow', 'workflow'], ['ArrowLeft', 'Board', 'board'],
  ];
  for (const [key, name, tab] of moves) {
    fireEvent.keyDown(document.activeElement!, { key });
    expect(document.activeElement).toBe(selected(name));
    expect(location.hash).toBe(viewHash(`project:${id}`, tab));
  }
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(selected('Board'));
  await act(async () => {});
});

it('restores the selected project tab and panel on browser Back and Forward', async () => {
  await shell();
  fireEvent.click(screen.getByRole('tab', { name: 'Board' }));
  await waitFor(() => selected('Board'));
  fireEvent.click(screen.getByRole('tab', { name: 'Knowledge' }));
  await waitFor(() => selected('Knowledge'));
  act(() => history.back());
  await waitFor(() => { selected('Board'); expect(location.hash).toBe(`#/project/${id}/board`); });
  act(() => history.back());
  await waitFor(() => { selected('Overview'); expect(location.hash).toBe(`#/project/${id}`); });
  act(() => history.forward());
  await waitFor(() => { selected('Board'); expect(location.hash).toBe(`#/project/${id}/board`); });
  act(() => history.forward());
  await waitFor(() => { selected('Knowledge'); expect(location.hash).toBe(`#/project/${id}/knowledge`); });
});

it('synchronizes selected tabs with external hashchange and popstate events', async () => {
  await shell();
  act(() => { location.hash = `#/project/${id}/board`; });
  await waitFor(() => selected('Board'));
  act(() => {
    history.pushState(null, '', `#/project/${id}/knowledge`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  selected('Knowledge');
  await act(async () => {});
});
