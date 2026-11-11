import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppShell } from '../src/screens/AppShell';
import { parseHash, viewHash, type View } from '../src/screens/shell/navigation';
import type { Store } from '../src/state/store';
import { id, otherId } from './fixtures';
import { globalInbox, review } from './inbox-fixtures';
import { setupShell } from './shell-fixtures';

const stores: Store[] = [];
async function shell(hash = '#/overview') {
  history.replaceState(null, '', hash);
  const fixture = await setupShell(globalInbox); stores.push(fixture.store);
  const view = render(<AppShell store={fixture.store} />);
  return { ...fixture, ...view };
}
afterEach(() => { cleanup(); stores.splice(0).forEach(store => store.dispose()); });
function current(name: string | RegExp) {
  const nav = screen.getByRole('navigation', { name: 'Main navigation' });
  expect(within(nav).getAllByRole('button', { current: 'page' })).toHaveLength(1);
  expect(within(nav).getByRole('button', { name, current: 'page' })).toBeTruthy();
}

it.each<[string, string | RegExp, string]>([
  ['#/overview', 'Overview', 'Overview'], ['#/attention', /^Needs attention,/, 'Needs attention'],
  ['#/team', 'Team', 'Team'], [`#/project/${id}`, 'Project', 'Project'],
])('loads %s as the announced page and preserves it after remount', async (hash, name, pageName) => {
  const { store, unmount } = await shell(hash);
  await waitFor(() => current(name));
  if (hash.includes('/project/')) await screen.findByRole('tab', { name: 'Chat' });
  expect(screen.getByRole('main', { name: pageName })).toBeTruthy();
  expect(screen.getAllByRole('status').some(node => node.textContent === pageName)).toBe(true);
  unmount(); render(<AppShell store={store} />);
  await waitFor(() => current(name)); expect(location.hash).toBe(hash);
});

it.each(['', '#/unknown', '#/project/', '#/project/%', '#/project/%20', '#/project/a/b'])('normalizes unknown or malformed hash %j to Overview', async hash => {
  await shell(hash || '/');
  current('Overview'); expect(location.hash).toBe('#/overview');
  expect(screen.getByRole('heading', { name: 'Hello', level: 1 })).toBeTruthy();
});

it('sidebar selection updates the hash and uses the existing project selection action', async () => {
  const { store } = await shell(); const select = vi.spyOn(store, 'selectProject');
  fireEvent.click(screen.getByRole('button', { name: 'Second project' }));
  await screen.findByRole('tab', { name: 'Chat' }); current('Second project');
  expect(location.hash).toBe(`#/project/${otherId}`); expect(select).toHaveBeenCalledExactlyOnceWith(otherId);
  fireEvent.click(screen.getByRole('button', { name: /^Needs attention,/ }));
  current(/^Needs attention,/); expect(location.hash).toBe('#/attention');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('main'));
});

it('browser back and forward restore the view, hash and current navigation item', async () => {
  await shell();
  fireEvent.click(screen.getByRole('button', { name: 'Team' }));
  await waitFor(() => current('Team'));
  fireEvent.click(screen.getByRole('button', { name: /^Needs attention,/ }));
  await waitFor(() => current(/^Needs attention,/));
  act(() => history.back());
  await waitFor(() => { current('Team'); expect(location.hash).toBe('#/team'); });
  act(() => history.back());
  await waitFor(() => { current('Overview'); expect(location.hash).toBe('#/overview'); });
  act(() => history.forward());
  await waitFor(() => { current('Team'); expect(location.hash).toBe('#/team'); });
});

it('responds to hashchange and popstate from outside the shell', async () => {
  await shell();
  act(() => { location.hash = '#/team'; }); await waitFor(() => current('Team'));
  act(() => { history.pushState(null, '', '#/attention'); window.dispatchEvent(new PopStateEvent('popstate')); });
  current(/^Needs attention,/);
});

it('Overview attention rows open the attention page with that approval selected', async () => {
  const { api } = await shell(); api.getApproval.mockResolvedValue({ approval: review });
  const card = screen.getByRole('complementary', { name: 'Needs attention' });
  fireEvent.click(within(card).getByRole('button', { name: /Review patch/ }));
  await screen.findByRole('radiogroup'); current(/^Needs attention,/);
  expect(location.hash).toBe('#/attention'); expect(api.getApproval).toHaveBeenCalledWith(id, review.id);
});

it.each<View>(['overview', 'needs-attention', 'team', 'project:a/b c'])('round trips typed view %s through a URL-safe hash', view => {
  expect(parseHash(viewHash(view))).toBe(view);
});
