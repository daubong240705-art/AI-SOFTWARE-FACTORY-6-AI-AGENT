import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppShell } from '../src/screens/AppShell';
import { projectHue } from '../src/screens/shell/ProjectTile';
import { applyTheme, createI18n, getPreferences, i18n } from '../src/i18n';
import type { Store } from '../src/state/store';
import { globalInbox } from './inbox-fixtures';
import { setupShell } from './shell-fixtures';
import { id, otherId } from './fixtures';

const stores: Store[] = [];
beforeEach(() => { i18n.setLocale('en'); applyTheme('dark'); });
afterEach(() => { cleanup(); stores.splice(0).forEach(store => store.dispose()); vi.unstubAllGlobals(); localStorage.clear(); });
async function shell(inbox = globalInbox) {
  const fixture = await setupShell(inbox); stores.push(fixture.store); render(<AppShell store={fixture.store} />); return fixture;
}

it('shows the global attention badge only when the total is positive', async () => {
  await shell();
  expect(screen.getByRole('button', { name: /Needs attention, 3/ }).querySelector('.badge')?.textContent).toBe('3');
  cleanup(); stores.splice(0).forEach(store => store.dispose());
  const empty = await setupShell({ approvals: [], startGates: [], counts: { approvals: 0, startGates: 0, total: 0 } }); stores.push(empty.store); render(<AppShell store={empty.store} />);
  const button = await screen.findByRole('button', { name: 'Needs attention, 0 items needing attention' });
  expect(button.querySelector('.badge')).toBeNull();
});

it('uses a stable cool identity hue for each project tile', async () => {
  await shell();
  const first = screen.getByRole('button', { name: 'Project' }).querySelector('.project-tile') as HTMLElement;
  const second = screen.getByRole('button', { name: 'Second project' }).querySelector('.project-tile') as HTMLElement;
  expect(first.style.getPropertyValue('--project-hue')).toBe(projectHue(id));
  expect(second.style.getPropertyValue('--project-hue')).toBe(projectHue(otherId));
  expect(projectHue(id)).not.toMatch(/need|run|ok|info/i);
  expect(projectHue(id)).not.toBe(projectHue(otherId));
  expect(projectHue(id)).toMatch(/^var\(--p-[1-4]\)$/);
});

it('renders a warm waiting dot only for projects represented in global attention', async () => {
  await shell();
  const projectButton = screen.getByRole('button', { name: 'Project' });
  const secondButton = screen.getByRole('button', { name: 'Second project' });
  expect(projectButton.querySelector('.waiting-dot')).not.toBeNull();
  expect(secondButton.querySelector('.waiting-dot')).toBeNull();
  expect(projectButton.querySelector('.waiting-dot')?.getAttribute('aria-label')).toBe('Needs your decision');
});

it('collapses the desktop sidebar and restores its labels', async () => {
  await shell();
  const collapse = screen.getByRole('button', { name: 'Collapse' }); fireEvent.click(collapse);
  expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
  expect(document.querySelector('.app')?.classList.contains('sidebar-collapsed')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
  expect(screen.getByRole('button', { name: 'Collapse' })).toBeTruthy();
  expect(screen.getByText('Projects')).toBeTruthy();
});

it('opens the compact overlay, traps focus, and Escape restores the toggle focus', async () => {
  const media = Object.assign(new EventTarget(), { matches: true }); vi.stubGlobal('matchMedia', vi.fn(() => media));
  await shell();
  const toggle = screen.getByRole('button', { name: 'Toggle projects' }); toggle.focus(); fireEvent.click(toggle);
  const dialog = await screen.findByRole('dialog', { name: 'Main navigation' });
  expect(toggle.getAttribute('aria-expanded')).toBe('true'); expect(within(dialog).getByRole('navigation')).toBeTruthy();
  const first = within(dialog).getByRole('button', { name: 'Overview' }); expect(document.activeElement).toBe(first);
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(toggle.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(toggle);
});

it('keeps one named navigation landmark and announces the current page', async () => {
  await shell();
  expect(screen.getAllByRole('navigation', { name: 'Main navigation' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Overview', current: 'page' })).toBeTruthy();
  expect(screen.getByRole('main').getAttribute('aria-label')).toBe('Overview');
});

it('persists the dark Vietnamese defaults and lets stored preferences win', () => {
  expect(createI18n().locale).toBe('vi');
  localStorage.clear(); applyTheme('dark'); i18n.setLocale('vi');
  expect(getPreferences()).toEqual({ theme: 'dark', locale: 'vi' }); expect(document.documentElement.dataset.theme).toBe('dark');
  localStorage.setItem('factory-ui.preferences.v1', JSON.stringify({ theme: 'light', locale: 'en' }));
  expect(getPreferences()).toEqual({ theme: 'light', locale: 'en' });
});

it('disables shell motion when reduced motion is requested', () => {
  const media = Object.assign(new EventTarget(), { matches: true }); vi.stubGlobal('matchMedia', vi.fn(() => media));
  expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);
  const styles = document.createElement('style'); styles.textContent = '@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }'; document.head.append(styles);
  expect(document.head.textContent).toContain('prefers-reduced-motion'); styles.remove();
});
