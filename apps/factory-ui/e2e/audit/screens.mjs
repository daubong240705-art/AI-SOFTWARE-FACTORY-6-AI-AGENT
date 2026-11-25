export const hook = (scope, id) => scope.getByTestId(id);
export const dialog = page => page.getByRole('dialog').last();
export const approvalRow = (page, id) => hook(page, `attention-row-approval:${id}`);
export const libraryRow = (page, name) => hook(page, 'library-row').filter({ has: page.getByText(name, { exact: true }) });

const global = (id, hash, ready) => ({ id, area: 'global', hash, ready });
const project = (id, tab, options = {}) => ({ id, area: 'project', project: 'primary', tab, ...options });
export const screens = [
  global('overview', '#/overview', 'overview-screen'),
  global('attention', '#/attention', 'attention-screen'),
  global('library', '#/library', 'skill-create'),
  { ...global('library-templates', '#/library', 'template-create'), select: 'library-templates' },
  global('integrations', '#/integrations', 'connection-create'),
  { ...global('integration-secrets', '#/integrations', 'secret-create'), select: 'integration-secrets' },
  global('world', '#/world', 'world-screen'),
  { ...global('system', '#/system'), selector: '#setup' },
  { ...global('system-setup', '#/system'), selector: '#setup', scroll: true },
  { id: 'sign-in', area: 'global', signIn: true, ready: 'signin-screen' },
  ...['overview', 'children', 'settings', 'library', 'integrations'].map(tab => ({
    id: `group-${tab}`, area: 'group', group: true, select: `group-tab-${tab}`,
    ready: { settings: 'group-settings-save', library: 'group-library-skills', integrations: 'connection-create' }[tab],
  })),
  ...['overview', 'agents', 'office', 'board', 'knowledge', 'flows'].map(tab => project(`project-${tab}`, tab, {
    ready: { agents: 'agent-create', flows: 'flow-create' }[tab],
    selector: { office: '.universal-office', board: '.project-tasks' }[tab],
  })),
  project('project-monitor', 'monitor', { ready: 'monitor-refresh' }),
  project('project-trace', 'monitor', { trace: true, ready: 'trace-refresh' }),
  project('project-empty-flows', 'flows', { project: 'empty', ready: 'flow-create' }),
  project('project-flow-detail', 'flows', { flow: true, ready: 'flow-save' }),
  ...['waiting', 'finished'].map(run => project(`project-run-${run}`, 'flows', { run, ready: 'flow-run-detail' })),
  ...['automation', 'budget', 'autonomy', 'approvals', 'code', 'group'].map(section => project(`project-settings-${section}`, 'settings', {
    section, ready: `project-settings-${section}`,
  })),
];

export async function sidebar(page) {
  const nav = page.locator('#factory-navigation');
  if (!await nav.isVisible()) await hook(page, 'sidebar-toggle').click();
  await nav.waitFor();
  return nav;
}

export async function openTreeProject(page, projectId, ancestors) {
  const nav = await sidebar(page);
  const treeItem = id => nav.getByRole('treeitem').and(hook(nav, `tree-${id}`));
  for (const id of ancestors) {
    const branch = treeItem(`group:${id}`).and(page.locator('[aria-expanded]'));
    await branch.waitFor();
    if (await branch.getAttribute('aria-expanded') === 'false') await branch.locator(':scope > [data-testid="tree-open"] > [data-testid="tree-expand"]').click();
  }
  await treeItem(`project:${projectId}`).locator(':scope > [data-testid="tree-open"]').click();
}

export async function agentMenu(page, id, action) {
  await hook(hook(page, `agent-row-${id}`), 'agent-row-menu').click();
  await hook(page, `agent-${action}`).click();
}

export async function createMenu(page, item) {
  await hook(page, 'shell-create').click();
  await hook(page, item).click();
}

const click = id => page => hook(page, id).click();
const modal = (id, screen, action, ready = 'dialog-cancel') => ({ id, screen, open: async (page, fixture) => {
  await action(page, fixture);
  await hook(dialog(page), ready).waitFor();
} });
const agent = action => (page, fixture) => agentMenu(page, fixture.agents.fresh, action);
const library = (name, action) => async page => { await libraryRow(page, name).click(); await hook(page, action).click(); };
export const dialogs = [
  modal('agent-create', 'project-agents', click('agent-create')),
  modal('agent-edit', 'project-agents', agent('edit'), 'agent-name'),
  modal('agent-history', 'project-agents', async (page, fixture) => { await agent('edit')(page, fixture); await hook(page, 'agent-tab-history').click(); }, 'agent-history-version'),
  modal('agent-clone', 'project-agents', agent('clone')),
  modal('agent-archive', 'project-agents', agent('archive')),
  modal('agent-delete', 'project-agents', agent('delete')),
  modal('agent-from-template', 'project-agents', click('agent-from-template')),
  modal('team-create', 'project-agents', click('team-create')),
  ...['edit', 'delete'].map(action => modal(`team-${action}`, 'project-agents', (page, fixture) => hook(hook(page, `team-row-${fixture.team}`), `team-${action}`).click())),
  modal('skill-create', 'library', click('skill-create')),
  modal('skill-edit', 'library', library('audit-skill', 'skill-edit'), 'skill-content'),
  modal('skill-delete', 'library', library('audit-skill', 'skill-delete')),
  modal('template-create', 'library-templates', click('template-create')),
  modal('template-edit', 'library-templates', library('Mẫu audit', 'template-edit'), 'agent-name'),
  modal('template-delete', 'library-templates', library('Mẫu audit', 'template-delete')),
  modal('connection-create', 'integrations', click('connection-create')),
  modal('secret-create', 'integration-secrets', click('secret-create')),
  modal('group-create-child', 'group-children', click('group-create-child')),
  modal('group-edit', 'group-overview', click('group-edit')),
  modal('group-move', 'group-overview', click('group-move')),
  modal('group-archive', 'group-overview', click('group-archive')),
  modal('group-delete', 'group-overview', click('group-delete')),
  modal('project-group-move', 'project-settings-group', click('project-group-move')),
  modal('flow-create', 'project-flows', click('flow-create'), 'flow-cancel'),
  modal('flow-import', 'project-flows', click('flow-import'), 'flow-cancel'),
  modal('flow-test-run', 'project-flow-detail', click('flow-test-run'), 'flow-start-run'),
  modal('flow-run', 'project-flow-detail', click('flow-run'), 'flow-start-run'),
  { id: 'new-task', screen: 'project-board', open: async page => { await createMenu(page, 'task-create'); await hook(page, 'task-title').waitFor(); } },
  { id: 'task-detail', screen: 'project-board', open: (page, fixture) => page.locator(`[data-task-id="${fixture.task}"]`).click() },
  { id: 'decision', screen: 'attention', open: async (page, fixture) => { await approvalRow(page, fixture.approval).click(); await hook(page, 'attention-approve').waitFor(); } },
];

export function hashFor(screen, fixture) {
  if (screen.group) return `#/g/${fixture.groups.child}`;
  if (!screen.project) return screen.hash ?? '';
  const prefix = `#/project/${fixture.projects[screen.project]}`;
  if (screen.trace) return `${prefix}/trace/${encodeURIComponent(fixture.trace)}`;
  if (screen.run) return `${prefix}/runs/${fixture.runs[screen.run]}`;
  if (screen.flow) return `${prefix}/flows/${fixture.flow}`;
  if (screen.section) return `${prefix}/settings/${screen.section}`;
  return screen.tab === 'overview' ? prefix : `${prefix}/${screen.tab}`;
}

const seeded = new WeakMap();
export async function seedSession(page, base) {
  if (seeded.get(page) === base && new URL(page.url()).origin === base) return;
  const session = page.waitForResponse(response => response.url() === `${base}/auth/session` && response.ok());
  await Promise.all([session, page.goto(`${base}/`)]);
  await hook(page, 'overview-screen').waitFor();
  seeded.set(page, base);
}

export async function navigateHash(page, base, hash, { observe } = {}) {
  const href = `${base}/${hash}`;
  await page.goto(href);
  const projectLink = hash.startsWith('#/project/');
  const shell = page.locator('#factory-main');
  await shell.waitFor();
  // The shell can canonicalize a project link to overview on first load. Report it before retrying.
  const settled = () => page.waitForFunction(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))));
  await settled();
  const actual = new URL(page.url()).hash;
  const redirectedHome = projectLink && actual === '#/overview';
  if (observe) await observe({ hash, actual, redirectedHome });
  if (redirectedHome) {
    // Reloading overview would lose the target hash. Restore it first, then reload.
    await page.goto(href);
    await page.reload();
    await shell.waitFor();
  }
  // A screen may select a child item and extend the hash (e.g. #/attention → #/attention/<id>).
  await page.waitForFunction(expected => location.hash === expected || location.hash.startsWith(`${expected}/`), hash);
}

export async function openScreen(page, screen, fixture, base) {
  if (screen.signIn) await page.goto(`${base}/`);
  else {
    await seedSession(page, base);
    // Reset same-route state (tabs, drawers and dialogs) without using translated labels.
    if (new URL(page.url()).hash === hashFor(screen, fixture)) await page.reload();
    await navigateHash(page, base, hashFor(screen, fixture));
  }
  if (screen.project) {
    const tab = hook(page, `project-tab-${screen.tab}`);
    await tab.and(page.locator('[aria-selected="true"], [aria-current="page"]')).waitFor();
  }
  if (screen.select) await hook(page, screen.select).click();
  if (screen.ready) await hook(page, screen.ready).waitFor();
  if (screen.section) await hook(page, `project-settings-${screen.section}`).and(page.locator('[aria-current="page"]')).waitFor();
  if (screen.selector) {
    await page.locator(screen.selector).waitFor();
    if (screen.scroll) await page.locator(screen.selector).scrollIntoViewIfNeeded();
  }
}
