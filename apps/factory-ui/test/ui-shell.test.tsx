import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { projectSchema } from '@factory/contracts';
import { App } from '../src/App';
import { SignIn } from '../src/screens/SignIn';
import { AppShell } from '../src/screens/AppShell';
import { CreateProject } from '../src/screens/CreateProject';
import { ProjectView } from '../src/screens/ProjectView';
import { TeamPanel } from '../src/screens/TeamPanel';
import { ProjectChat } from '../src/screens/ProjectChat';
import { ProjectTasks } from '../src/screens/ProjectTasks';
import { ApiClientError } from '../src/api/client';
import { applyTheme, getPreferences, i18n, PREFERENCES_KEY } from '../src/i18n';
import { extra as en } from '../src/i18n/extra.en';
import { extra as viLabels } from '../src/i18n/extra.vi';
import type { Store } from '../src/state/store';
import { deferred, envelope, engagement, id, otherId, project, receipt, seat, team } from './fixtures';
import { setupUI } from './ui-fixtures';

const stores: Store[] = [];
function setup() { const fixture = setupUI(); stores.push(fixture.store); return fixture; }
const authError = () => new ApiClientError('api', 401, { code: 'needs-auth', message: 'Ignored', correlationId: id, nextAction: 'authenticate' });
const commandError = () => new ApiClientError('api', 409, { code: 'conflict', message: 'Ignored', correlationId: id, nextAction: 'refresh' });
beforeEach(() => { i18n.setLocale('en'); applyTheme('light'); });
afterEach(() => { cleanup(); stores.forEach((store) => store.dispose()); stores.length = 0; vi.unstubAllGlobals(); i18n.setLocale('en'); });

async function anonymous() { const fixture = setup(); await fixture.store.signOut(); return fixture; }
async function authenticated() { const fixture = setup(); await fixture.store.boot(); return fixture; }
async function shell() {
  const fixture = await authenticated(); render(<App store={fixture.store} />);
  await screen.findByRole('tab', { name: 'Chat' }); return fixture;
}
function tokenInput() { return screen.getByLabelText('Bootstrap token') as HTMLInputElement; }
function submitToken(value = 'fixture-bootstrap-secret') {
  const input = tokenInput(); fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.form!); return input;
}
function fillProject(name = 'New project', root = '/srv/factory/workspaces/my-project') {
  fireEvent.change(screen.getByLabelText('Project name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Workspace path'), { target: { value: root } });
}
async function openCreate() {
  const fixture = await shell();
  const opener = screen.getByRole('button', { name: 'Create project' }); opener.focus(); fireEvent.click(opener);
  return { ...fixture, opener };
}
function clickCreate() { fireEvent.click(screen.getByRole('button', { name: 'Create' })); }

it('unknown session renders a loading status and no sign-in', () => {
  const { store, api } = setup(); api.session.mockReturnValue(deferred<unknown>().promise);
  render(<App store={store} />); expect(screen.getByRole('status').textContent).toBe('Loading');
  expect(screen.queryByLabelText('Bootstrap token')).toBeNull();
});
it('App boots exactly once in StrictMode', async () => {
  const { store, api } = setup(); const boot = vi.spyOn(store, 'boot');
  api.listProjects.mockResolvedValue({ ...envelope, projects: [] });
  render(<StrictMode><App store={store} /></StrictMode>);
  await screen.findByRole('banner'); expect(boot).toHaveBeenCalledOnce();
});
it('authenticated boot renders the shell and no sign-in form', async () => {
  await shell(); expect(screen.getByRole('banner')).toBeTruthy(); expect(screen.queryByLabelText('Bootstrap token')).toBeNull();
});
it('401 boot renders sign-in only', async () => {
  const { store, api } = setup(); api.session.mockRejectedValue(authError()); render(<App store={store} />);
  await screen.findByLabelText('Bootstrap token'); expect(screen.queryByRole('banner')).toBeNull();
});
it('sign-in uses one password input with autocomplete and spellcheck disabled', async () => {
  const { store } = await anonymous(); render(<SignIn store={store} />); const input = tokenInput();
  expect(document.querySelectorAll('input')).toHaveLength(1); expect(input.type).toBe('password');
  expect(input.autocomplete).toBe('off'); expect(input.getAttribute('spellcheck')).toBe('false');
  expect(screen.getByText(/one-time bootstrap token is printed by the Host/)).toBeTruthy();
});
it('submitting sign-in invokes store.signIn exactly once', async () => {
  const { store, api } = await anonymous(); const signIn = vi.spyOn(store, 'signIn'); render(<SignIn store={store} />);
  submitToken(); await waitFor(() => expect(api.bootstrap).toHaveBeenCalledOnce()); expect(signIn).toHaveBeenCalledExactlyOnceWith('fixture-bootstrap-secret');
});
it('successful sign-in clears the input immediately and keeps the token out of the DOM and state', async () => {
  const { store } = await anonymous(); render(<SignIn store={store} />); const input = submitToken();
  expect(input.value).toBe(''); expect(document.body.innerHTML).not.toContain('fixture-bootstrap-secret');
  await waitFor(() => expect(store.getState().session).toBe('authenticated'));
  expect(JSON.stringify(store.getState())).not.toContain('fixture-bootstrap-secret'); expect(input.value).toBe('');
});
it('failed sign-in clears the input immediately and after failure', async () => {
  const { store, api } = await anonymous(); api.bootstrap.mockRejectedValue(new Error('fixture-bootstrap-secret'));
  render(<SignIn store={store} />); const input = submitToken(); expect(input.value).toBe('');
  await screen.findByRole('alert'); expect(input.value).toBe('');
  expect(document.body.innerHTML).not.toContain('fixture-bootstrap-secret'); expect(JSON.stringify(store.getState())).not.toContain('fixture-bootstrap-secret');
});
it('failed sign-in displays a safe alert with Reference', async () => {
  const { store, api } = await anonymous(); api.bootstrap.mockRejectedValue(authError()); render(<SignIn store={store} />); submitToken();
  expect((await screen.findByRole('alert')).textContent).toContain(`Reference: ${id}`);
  expect(screen.getByRole('alert').textContent).toContain('Authentication required.');
});
it('native form submission from Enter signs in', async () => {
  const { store, api } = await anonymous(); render(<SignIn store={store} />); const input = tokenInput();
  input.focus(); fireEvent.change(input, { target: { value: 'enter-token' } });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
  // jsdom does not perform keyboard default actions; requestSubmit models native Enter submission.
  act(() => input.form!.requestSubmit());
  await waitFor(() => expect(api.bootstrap).toHaveBeenCalledExactlyOnceWith('enter-token')); expect(input.value).toBe('');
});
it('sign-in disables the input and submit while loading and prevents duplicate submits', async () => {
  const { store, api } = await anonymous(); const pending = deferred<unknown>(); api.bootstrap.mockReturnValue(pending.promise);
  render(<SignIn store={store} />); const input = submitToken();
  expect(input.disabled).toBe(true); expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(input.form!); expect(api.bootstrap).toHaveBeenCalledOnce();
  await act(async () => pending.resolve({ ...envelope, csrfToken: 'fixture' }));
});
it('sign-in stores no token in browser preferences or URL', async () => {
  const { store } = await anonymous(); render(<SignIn store={store} />); submitToken();
  await waitFor(() => expect(store.getState().session).toBe('authenticated'));
  expect(localStorage.getItem(PREFERENCES_KEY)).not.toContain('fixture-bootstrap-secret'); expect(location.href).not.toContain('fixture-bootstrap-secret');
});
it('shell has named projects navigation, banner and main landmarks', async () => {
  await shell(); expect(screen.getByRole('banner')).toBeTruthy(); expect(screen.getByRole('navigation', { name: 'Projects' })).toBeTruthy(); expect(screen.getByRole('main')).toBeTruthy();
});
it('shell loads projects on mount', async () => { const { api } = await shell(); expect(api.listProjects).toHaveBeenCalledOnce(); });
it('shell lists projects and selection invokes selectProject with aria-current', async () => {
  const { store, api } = await authenticated(); api.listProjects.mockResolvedValue({ ...envelope, projects: [project, { ...project, id: otherId, name: 'Second project' }] });
  const select = vi.spyOn(store, 'selectProject'); render(<AppShell store={store} />);
  const button = await screen.findByRole('button', { name: 'Second project' }); fireEvent.click(button);
  await waitFor(() => expect(button.getAttribute('aria-current')).toBe('page')); expect(select).toHaveBeenCalledExactlyOnceWith(otherId);
  expect(screen.getByRole('button', { name: 'Project' }).getAttribute('aria-current')).toBeNull();
});
it('one project is selected automatically', async () => { const { store } = await shell(); expect(store.getState().selectedProjectId).toBe(id); });
it('existing selection is retained with one project', async () => {
  const { store } = await authenticated(); await store.selectProject(id); const select = vi.spyOn(store, 'selectProject');
  render(<AppShell store={store} />); await screen.findByRole('tab', { name: 'Chat' }); expect(select).not.toHaveBeenCalled();
});
it('multiple projects require an explicit selection', async () => {
  const { store, api } = await authenticated(); api.listProjects.mockResolvedValue({ ...envelope, projects: [project, { ...project, id: otherId, name: 'Second' }] });
  render(<AppShell store={store} />); await screen.findByRole('button', { name: 'Second' });
  expect(store.getState().selectedProjectId).toBeNull(); expect(screen.getByText('Select a project or create one to get started.')).toBeTruthy();
});
it('empty project list shows a useful empty state', async () => {
  const { store, api } = await authenticated(); api.listProjects.mockResolvedValue({ ...envelope, projects: [] }); render(<AppShell store={store} />);
  await screen.findByText('No projects yet.'); expect(within(screen.getByRole('main')).getByRole('button', { name: 'Create project' })).toBeTruthy();
});
it('project list shows loading state', async () => {
  const { store, api } = await authenticated(); api.listProjects.mockReturnValue(deferred<unknown>().promise); render(<AppShell store={store} />);
  expect(within(screen.getByRole('navigation')).getByRole('status').textContent).toBe('Loading');
});
it('project list errors offer retry', async () => {
  const { store, api } = await authenticated(); api.listProjects.mockRejectedValueOnce(commandError()); render(<AppShell store={store} />);
  await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('tab', { name: 'Chat' }); expect(api.listProjects).toHaveBeenCalledTimes(2);
});
it.each([['open', 'Live'], ['reconnecting', 'Reconnecting'], ['connecting', 'Reconnecting'], ['closed', 'Offline']] as const)('stream %s renders %s only for selected project', async (status, label) => {
  const { connections } = await shell(); act(() => connections[0]?.onStatus?.(status, { lastEventId: null, invalidMessages: 0 }));
  const nav = screen.getByRole('navigation'); expect(within(nav).getAllByText(label)).toHaveLength(1);
});
it('sign out invokes store and returns to sign-in', async () => {
  const { store, api } = await shell(); const signOut = vi.spyOn(store, 'signOut'); fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByLabelText('Bootstrap token'); expect(signOut).toHaveBeenCalledOnce(); expect(api.logout).toHaveBeenCalledOnce();
});
it('compact sidebar toggles aria-expanded and navigation visibility', async () => {
  const media = Object.assign(new EventTarget(), { matches: true }); vi.stubGlobal('matchMedia', vi.fn(() => media));
  await shell(); const toggle = screen.getByRole('button', { name: 'Toggle projects' }); expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('navigation')).toBeNull(); fireEvent.click(toggle); expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('navigation', { name: 'Projects' })).toBeTruthy(); fireEvent.click(toggle); expect(toggle.getAttribute('aria-expanded')).toBe('false');
});
it('sidebar responds to matchMedia viewport changes', async () => {
  const media = Object.assign(new EventTarget(), { matches: false }); vi.stubGlobal('matchMedia', vi.fn(() => media)); await shell();
  expect(screen.queryByRole('button', { name: 'Toggle projects' })).toBeNull();
  act(() => { media.matches = true; media.dispatchEvent(new Event('change')); }); expect(screen.getByRole('button', { name: 'Toggle projects' })).toBeTruthy();
});
it.each(['light', 'dark', 'system'] as const)('theme control persists %s and updates data-theme', async (theme) => {
  await shell(); fireEvent.change(screen.getByLabelText('Theme'), { target: { value: theme } }); expect(getPreferences().theme).toBe(theme);
  expect(document.documentElement.dataset.theme).toBe(theme === 'system' ? 'light' : theme);
  expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY)!)).toMatchObject({ theme });
});
it('language switches labels, html lang and stored preference to Vietnamese and back', async () => {
  await shell(); fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'vi' } });
  expect(document.documentElement.lang).toBe('vi'); expect(getPreferences().locale).toBe('vi'); expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Ngôn ngữ'), { target: { value: 'en' } }); expect(document.documentElement.lang).toBe('en'); expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
});
it('user project names are never translated', async () => {
  const { store, api } = setup(); api.listProjects.mockResolvedValue({ ...envelope, projects: [{ ...project, name: 'global.projects' }] });
  render(<App store={store} />); await screen.findByRole('heading', { name: 'global.projects' }); act(() => i18n.setLocale('vi'));
  expect(screen.getByRole('heading', { name: 'global.projects' })).toBeTruthy();
});
it('create dialog is labelled, modal and focuses the first field', async () => {
  await openCreate(); const dialog = screen.getByRole('dialog', { name: 'Create project' }); expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(document.activeElement).toBe(within(dialog).getByLabelText('Project name'));
});
it('Escape closes the dialog and restores opener focus', async () => {
  const { opener } = await openCreate(); fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(opener);
});
it('Cancel closes the dialog and restores opener focus', async () => {
  const { opener } = await openCreate(); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(opener);
});
it('Tab wraps from last to first inside dialog', async () => {
  await openCreate(); const last = screen.getByRole('button', { name: 'Create' }); last.focus(); fireEvent.keyDown(last, { key: 'Tab' }); expect(document.activeElement).toBe(screen.getByLabelText('Project name'));
});
it('Shift+Tab wraps from first to last inside dialog', async () => {
  await openCreate(); const first = screen.getByLabelText('Project name'); fireEvent.keyDown(first, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Create' }));
});
it('programmatic focus outside dialog is contained', async () => {
  const { opener } = await openCreate(); opener.focus(); expect(document.activeElement).toBe(screen.getByLabelText('Project name'));
});
it('empty project name has a linked validation message and sends nothing', async () => {
  const { api } = await openCreate(); fillProject('', '/work'); clickCreate(); const input = screen.getByLabelText('Project name');
  expect(input.getAttribute('aria-invalid')).toBe('true'); expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toContain('1 and 160'); expect(api.sendCommand).not.toHaveBeenCalled();
});
it('overlong project name follows the contract limit', async () => {
  const { api } = await openCreate(); fillProject('a'.repeat(161), '/work'); clickCreate(); expect(screen.getByLabelText('Project name').getAttribute('aria-invalid')).toBe('true'); expect(api.sendCommand).not.toHaveBeenCalled();
});
it.each(['relative/path', '/work/../project', '/work\\project', '/work/./project', '/work/\0project', ''])('invalid workspace path %j has linked validation and sends nothing', async (root) => {
  const { api } = await openCreate(); fillProject('New', root); clickCreate(); const input = screen.getByLabelText('Workspace path');
  expect(input.getAttribute('aria-invalid')).toBe('true'); expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toContain('absolute Linux path'); expect(api.sendCommand).not.toHaveBeenCalled();
});
it('workspace field shows the requested placeholder', async () => { await openCreate(); expect(screen.getByPlaceholderText('/srv/factory/workspaces/my-project')).toBeTruthy(); });
it('valid create sends exactly one projects.create command', async () => {
  const { api } = await openCreate(); fillProject(); clickCreate(); await waitFor(() => expect(api.sendCommand).toHaveBeenCalledOnce());
  expect(api.sendCommand.mock.calls[0]?.[0]).toMatchObject({ type: 'projects.create', payload: { name: 'New project', workspace: { kind: 'directory', root: '/srv/factory/workspaces/my-project' } } });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('pending create disables submit and duplicate form submits send once', async () => {
  const { api } = await openCreate(); const pending = deferred<unknown>(); api.sendCommand.mockReturnValue(pending.promise); fillProject(); clickCreate();
  const create = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement; expect(create.disabled).toBe(true);
  fireEvent.submit(create.form!); expect(api.sendCommand).toHaveBeenCalledOnce(); await act(async () => pending.resolve({ ...envelope, receipt }));
});
it('create failure keeps dialog open and shows safe message and Reference', async () => {
  const { api } = await openCreate(); api.sendCommand.mockRejectedValue(commandError()); fillProject(); clickCreate();
  const alert = await screen.findByRole('alert'); expect(alert.textContent).toContain('The resource changed.'); expect(alert.textContent).toContain(`Reference: ${id}`); expect(screen.getByRole('dialog')).toBeTruthy();
});
it('Retry calls store.retry and resends the same command object and commandId', async () => {
  const { store, api } = await openCreate(); api.sendCommand.mockRejectedValueOnce(commandError()); const retry = vi.spyOn(store, 'retry'); fillProject(); clickCreate();
  await screen.findByRole('button', { name: 'Retry' }); const original = api.sendCommand.mock.calls[0]?.[0];
  fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await waitFor(() => expect(api.sendCommand).toHaveBeenCalledTimes(2));
  expect(api.sendCommand.mock.calls[1]?.[0]).toBe(original); expect(retry).toHaveBeenCalledExactlyOnceWith(original.commandId);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('successful create closes, reloads projects and selects new project', async () => {
  const { store, api } = await openCreate(); const select = vi.spyOn(store, 'selectProject');
  api.sendCommand.mockImplementation(async (command) => {
    api.listProjects.mockResolvedValue({ ...envelope, projects: [project, { ...project, id: command.projectId, name: 'New project' }] });
    return { ...envelope, receipt: { ...receipt, commandId: command.commandId, projectId: command.projectId } };
  });
  fillProject(); clickCreate(); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.listProjects).toHaveBeenCalledTimes(2); expect(select).toHaveBeenCalledWith(api.sendCommand.mock.calls[0]?.[0].projectId); expect(screen.getByRole('heading', { name: 'New project' })).toBeTruthy();
});
it('tabs expose correct roles, selection and screen cards', async () => {
  await shell(); expect(screen.getByRole('tablist', { name: 'Project views' })).toBeTruthy(); const chat = screen.getByRole('tab', { name: 'Chat' });
  expect(chat.getAttribute('aria-selected')).toBe('true'); expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(chat.id);
  expect(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Start chat with Lead' })).toBeTruthy(); fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }));
  expect(screen.getByRole('tab', { name: 'Tasks' }).getAttribute('aria-selected')).toBe('true'); expect(within(screen.getByRole('tabpanel')).getByRole('heading', { name: 'Tasks' })).toBeTruthy();
});
it('arrow keys move tab focus and selection with wrapping', async () => {
  await shell(); const chat = screen.getByRole('tab', { name: 'Chat' }); chat.focus(); fireEvent.keyDown(chat, { key: 'ArrowLeft' });
  const inboxTab = screen.getByRole('tab', { name: 'Knowledge' }); expect(document.activeElement).toBe(inboxTab); expect(inboxTab.getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(inboxTab, { key: 'ArrowRight' }); expect(document.activeElement).toBe(chat); expect(chat.getAttribute('aria-selected')).toBe('true');
});
it('Home and End navigate tabs and inactive tabs are outside tab order', async () => {
  await shell(); const chat = screen.getByRole('tab', { name: 'Chat' }); fireEvent.keyDown(chat, { key: 'End' }); expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Knowledge' }));
  expect(chat.tabIndex).toBe(-1); fireEvent.keyDown(document.activeElement!, { key: 'Home' }); expect(document.activeElement).toBe(chat); expect(chat.tabIndex).toBe(0);
});
it('Team tab shows team name, engagement and seats with Lead badge', async () => {
  await shell(); fireEvent.click(screen.getByRole('tab', { name: 'Team' })); const panel = screen.getByRole('tabpanel');
  expect(within(panel).getByRole('heading', { name: 'Team' })).toBeTruthy();
  for (const label of ['Engagement', 'Priority', 'Max concurrent', 'State', 'Active', 'Role', 'Runtime', 'Slots', 'claude-code']) expect(within(panel).getByText(label)).toBeTruthy();
  expect(panel.querySelector('.badge.lead')?.textContent).toBe('Lead'); expect(within(panel).getByRole('heading', { name: 'Lead' })).toBeTruthy();
});
it('non-lead seats do not receive Lead badges', async () => {
  const { store, api } = await authenticated(); api.getTeam.mockResolvedValue({ ...envelope, team, engagement, seats: [{ ...seat, isLead: false, name: 'Builder', role: 'Developer' }] });
  await store.selectProject(id); render(<TeamPanel store={store} />); expect(screen.getByText('Builder')).toBeTruthy(); expect(document.querySelector('.badge.lead')).toBeNull();
});
it('team has a loading state while fetching', async () => {
  const { store, api } = await authenticated(); api.getTeam.mockReturnValue(deferred<unknown>().promise);
  void store.selectProject(id); render(<TeamPanel store={store} />); expect(screen.getByRole('status').textContent).toBe('Loading');
});
it('team has an empty state before team assignment', async () => { const { store } = await authenticated(); render(<TeamPanel store={store} />); expect(screen.getByText('No team assigned.')).toBeTruthy(); });
it('team with no seats has a seat empty state', async () => {
  const { store, api } = await authenticated(); api.getTeam.mockResolvedValue({ ...envelope, team, engagement, seats: [] }); await store.selectProject(id); render(<TeamPanel store={store} />); expect(screen.getByText('No seats assigned.')).toBeTruthy();
});
it('team error shows safe alert and Reference', async () => {
  const { store, api } = await authenticated(); api.getTeam.mockRejectedValue(commandError()); await store.selectProject(id); render(<TeamPanel store={store} />); expect(screen.getByRole('alert').textContent).toContain(`Reference: ${id}`);
});
it.each(['paused', 'ended'] as const)('team translates engagement state %s', async (state) => {
  const { store, api } = await authenticated(); api.getTeam.mockResolvedValue({ ...envelope, team, engagement: { ...engagement, state }, seats: [] }); await store.selectProject(id); render(<TeamPanel store={store} />); expect(screen.getByText(state === 'paused' ? 'Paused' : 'Ended')).toBeTruthy();
});
function leaves(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value };
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => Object.entries(leaves(child, `${prefix}.${key}`))));
}
it('all extra English and Vietnamese keys match and all values are non-empty', () => {
  const english = leaves(en); const vietnamese = leaves(viLabels); expect(Object.keys(english).sort()).toEqual(Object.keys(vietnamese).sort());
  for (const value of [...Object.values(english), ...Object.values(vietnamese)]) expect(value.trim().length).toBeGreaterThan(0);
});
it.each(['App', 'SignIn', 'AppShell', 'CreateProject', 'ProjectView', 'TeamPanel', 'ProjectChat', 'ProjectTasks'])('renders %s in Vietnamese without missing labels or exceptions', async (name) => {
  const { store } = await authenticated(); await store.loadProjects(); await store.selectProject(id); act(() => i18n.setLocale('vi'));
  const warn = vi.spyOn(console, 'warn');
  const screens = { App: <App store={store} />, SignIn: <SignIn store={store} />, AppShell: <AppShell store={store} />, CreateProject: <CreateProject store={store} onClose={() => {}} />, ProjectView: <ProjectView store={store} project={projectSchema.parse(project)} />, TeamPanel: <TeamPanel store={store} />, ProjectChat: <ProjectChat store={store} projectId={id} />, ProjectTasks: <ProjectTasks store={store} projectId={id} /> };
  render(screens[name as keyof typeof screens]); await act(async () => { await Promise.resolve(); }); expect(warn).not.toHaveBeenCalled(); expect(document.body.textContent?.trim()).toBeTruthy();
});
function checkNamesAndIds() {
  for (const button of screen.queryAllByRole('button')) expect((button.getAttribute('aria-label') ?? button.textContent ?? '').trim()).toBeTruthy();
  for (const input of document.querySelectorAll<HTMLInputElement>('input, select')) {
    const label = Array.from(document.querySelectorAll('label')).find((element) => element.htmlFor === input.id);
    expect(label?.textContent?.trim()).toBeTruthy(); expect(screen.getByLabelText(label!.textContent!)).toBe(input);
  }
  const ids = Array.from(document.querySelectorAll('[id]'), (node) => node.id); expect(new Set(ids).size).toBe(ids.length);
}
it('accessibility smoke: shell controls have names and ids are unique', async () => { await shell(); checkNamesAndIds(); });
it('accessibility smoke: sign-in controls have names and ids are unique', async () => { const { store } = await anonymous(); render(<SignIn store={store} />); checkNamesAndIds(); });
it('accessibility smoke: create dialog is labelled and controls have unique ids', async () => { await openCreate(); checkNamesAndIds(); const dialog = screen.getByRole('dialog'); expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Create project'); });
