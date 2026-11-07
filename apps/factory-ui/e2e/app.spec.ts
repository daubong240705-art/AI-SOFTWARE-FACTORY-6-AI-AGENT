import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { hostInfo, shot, signIn, tabTo } from './helpers';

const reply = 'Hello from the fake Lead.';
const planReply = 'I propose a README task for your review.';
const title = 'Write the README section';
const xss = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script> hello';

// A bootstrap token is single-use, and Host state lasts for this entire run.
// Keep the real browser session in memory (never persist cookies or CSRF to disk).
test.describe.serial('real Host and built Factory UI', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ baseURL: 'http://127.0.0.1:8791',
      viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
    page = await context.newPage();
  });
  test.afterAll(async () => { await context?.close(); });

  async function chat() {
    await page.getByRole('tab', { name: 'Chat', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  }
  async function send(text: string, expected = reply) {
    const log = page.getByRole('log', { name: 'Conversation messages' });
    const before = await log.getByText(expected, { exact: true }).count();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(log.getByText(expected, { exact: true })).toHaveCount(before + 1);
    await expect(page.getByRole('status').filter({ hasText: /working/i })).toHaveCount(0);
  }
  async function plan() {
    await chat();
    await page.getByRole('radio', { name: 'Delegate: let the Lead propose tasks', exact: true }).check();
    await send('PLAN-PLEASE: please plan', planReply);
    await page.getByRole('tab', { name: /^Tasks/ }).click();
  }

  test('a: anonymous sign-in exposes no project data and rejects a wrong token', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(page.getByRole('log')).toHaveCount(0);
    expect((await page.request.get('/projects')).status()).toBe(401);
    await shot(page, 'sign-in-light');
    await page.getByLabel('Bootstrap token', { exact: true }).fill('WRONG');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Reference');
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByLabel('Bootstrap token', { exact: true })).toHaveValue('');
  });

  test('b/c/k: keyboard-only sign-in, project creation and chat; HttpOnly and one-time token', async ({ browser }) => {
    await signIn(page, true);
    await expect(page.getByLabel('Bootstrap token', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.cookie.includes('factory_session'))).toBe(false);
    expect((await page.request.get('/projects')).status()).toBe(200);

    const create = page.getByRole('navigation').getByRole('button', { name: 'Create project', exact: true });
    await tabTo(page, create);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Create project', exact: true });
    await expect(dialog.getByLabel('Project name', { exact: true })).toBeFocused();
    await page.keyboard.insertText('E2E Project');
    await page.keyboard.press('Tab');
    await expect(dialog.getByLabel('Workspace path', { exact: true })).toBeFocused();
    await page.keyboard.insertText('/srv/factory/workspaces/e2e-project');
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'E2E Project', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation').getByRole('button', { name: /^E2E Project/ })).toHaveAttribute('aria-current', 'page');
    await tabTo(page, page.getByRole('button', { name: 'Start chat with Lead', exact: true }));
    await page.keyboard.press('Enter');
    const message = page.getByRole('textbox', { name: 'Message', exact: true });
    await expect(message).toBeVisible();
    await tabTo(page, message);
    await page.keyboard.insertText('hello');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('log').getByText(reply, { exact: true })).toBeVisible();

    const fresh = await browser.newContext({ baseURL: 'http://127.0.0.1:8791' });
    try {
      const anonymous = await fresh.newPage();
      await anonymous.goto('/');
      await anonymous.getByLabel('Bootstrap token', { exact: true }).fill((await hostInfo()).token);
      await anonymous.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(anonymous.getByRole('alert')).toContainText('Reference');
      await expect(anonymous.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
      expect((await anonymous.request.get('/projects')).status()).toBe(401);
    } finally { await fresh.close(); }
  });

  test('c: invalid relative and parent-segment paths are rejected in the project dialog', async () => {
    await page.getByRole('navigation').getByRole('button', { name: 'Create project', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create project', exact: true });
    await dialog.getByLabel('Project name', { exact: true }).fill('Invalid project');
    for (const path of ['relative/path', '/srv/factory/../escape']) {
      await dialog.getByLabel('Workspace path', { exact: true }).fill(path);
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(dialog.getByText('Enter an absolute Linux path', { exact: false })).toBeVisible();
      await expect(dialog.getByLabel('Workspace path', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    }
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('navigation').getByRole('button', { name: /^Invalid project/ })).toHaveCount(0);
  });

  test('d/l: Team lists seven seats, the Lead badge, and light/dark screenshots', async () => {
    await page.getByRole('tab', { name: 'Team', exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: 'Team', exact: true });
    await expect(panel.getByRole('listitem')).toHaveCount(7);
    for (const seat of ['Lead', 'PM', 'BA', 'FE', 'BE', 'DevOps', 'Test']) {
      await expect(panel.getByRole('heading', { name: seat, exact: true })).toBeVisible();
    }
    const lead = panel.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Lead', exact: true }) });
    await expect(lead.getByText('Lead', { exact: true })).toHaveCount(2);
    await page.getByLabel('Theme', { exact: true }).selectOption({ label: 'Light' });
    await shot(page, 'project-team-light');
    await page.getByLabel('Theme', { exact: true }).selectOption({ label: 'Dark' });
    await shot(page, 'project-team-dark');
    await page.getByLabel('Theme', { exact: true }).selectOption({ label: 'Light' });
  });

  test('e: discussion replies stream without navigation and expose working status', async () => {
    await chat();
    let navigations = 0;
    const onNavigation = () => { navigations++; };
    page.on('framenavigated', onNavigation);
    try {
      await expect(page.getByRole('radio', { name: 'Discuss', exact: true })).toBeChecked();
      await send('hello');
      const log = page.getByRole('log');
      const before = await log.getByText(reply, { exact: true }).count();
      await page.getByRole('textbox', { name: 'Message', exact: true }).fill('SLOW-PLEASE');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: /working/i })).toBeVisible();
      await expect(log.getByText(reply, { exact: true })).toHaveCount(before + 1);
      await expect(page.getByRole('status').filter({ hasText: /working/i })).toHaveCount(0);
      expect(navigations).toBe(0);
    } finally { page.off('framenavigated', onNavigation); }
  });

  test('e: model markup remains literal text and cannot execute', async () => {
    await send('XSS-PLEASE', xss);
    const log = page.getByRole('log', { name: 'Conversation messages' });
    await expect(log.getByText(xss, { exact: true })).toBeVisible();
    // DOM inspection for forbidden elements uses no CSS selectors.
    expect(await log.evaluate((node) => Array.from(node.getElementsByTagName('img')).some((img) => img.getAttribute('src') === 'x'))).toBe(false);
    expect(await log.evaluate((node) => node.getElementsByTagName('script').length)).toBe(0);
    expect(await page.evaluate(() => (window as Window & { __pwned?: unknown }).__pwned)).toBeUndefined();
  });

  test('e/l: delegation proposes a task, screenshots it, and Accept transitions it', async () => {
    await plan();
    await expect(page.getByRole('tab', { name: 'Tasks 1 proposed', exact: true })).toBeVisible();
    const task = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await expect(task.getByText('Proposed', { exact: true })).toBeVisible();
    await shot(page, 'tasks-proposed-light');
    await page.getByLabel('Theme', { exact: true }).selectOption({ label: 'Dark' });
    await shot(page, 'tasks-proposed-dark');
    await page.getByLabel('Theme', { exact: true }).selectOption({ label: 'Light' });
    await task.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(task.getByText('accepted', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Tasks', exact: true })).toBeVisible();
    await page.getByLabel('Status filter', { exact: true }).selectOption({ label: 'Accepted' });
    await expect(task).toHaveCount(1);
  });

  test('e: Decline and Cancel each require a second confirmation', async () => {
    for (const action of ['Decline', 'Cancel'] as const) {
      await plan();
      const task = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).last();
      await task.getByRole('button', { name: action, exact: true }).click();
      const confirmation = task.getByRole('group', { name: 'Confirm task action', exact: true });
      await expect(confirmation).toBeVisible();
      await expect(task.getByText('proposed', { exact: true })).toBeVisible();
      await confirmation.getByRole('button', { name: 'Keep task', exact: true }).click();
      await expect(confirmation).toHaveCount(0);
      await expect(task.getByRole('button', { name: 'Accept', exact: true })).toBeEnabled();
      await task.getByRole('button', { name: action, exact: true }).click();
      await confirmation.getByRole('button', { name: `Confirm ${action.toLowerCase()}`, exact: true }).click();
      await expect(task.getByText(action === 'Decline' ? 'declined' : 'cancelled', { exact: true })).toBeVisible();
    }
  });

  test('f: reload recovers the session, messages and CSRF for another send', async () => {
    const recovered = page.waitForResponse((response) => new URL(response.url()).pathname === '/auth/session');
    await page.reload();
    expect((await recovered).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation').getByRole('button', { name: /^E2E Project/ })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('log').getByText(xss, { exact: true })).toBeVisible();
    await expect(page.getByRole('log').getByText('hello', { exact: true })).toHaveCount(2);
    await send('after reload');
  });

  test('h/l: theme and Vietnamese persist across reload without translating user content', async () => {
    await expect(page.getByRole('meter', { name: 'TOKEN BUDGET', exact: true })).toBeVisible();
    await expect(page.getByRole('meter')).toHaveAttribute('aria-valuenow', /[1-9][0-9]*/);
    await shot(page, 'chat-budget-light');
    await page.getByLabel('Theme', { exact: true }).selectOption({ label: 'Dark' });
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    await shot(page, 'chat-budget-dark');
    await page.getByLabel('Language', { exact: true }).selectOption({ label: 'Tiếng Việt' });
    await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Trò chuyện', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'E2E Project', exact: true })).toBeVisible();
    await expect(page.getByRole('log').getByText('after reload', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('vi');
    await expect(page.getByRole('log').getByText('after reload', { exact: true })).toBeVisible();
    await expect(page.getByRole('meter', { name: 'NGÂN SÁCH TOKEN', exact: true })).toBeVisible();
    await shot(page, 'chat-budget-vietnamese');
    await page.getByLabel('Ngôn ngữ', { exact: true }).selectOption({ label: 'English' });
    await page.getByLabel('Theme', { exact: true }).selectOption({ label: 'Light' });
  });

  test('i/l: mobile sidebar is labelled, collapsed and toggleable, with no document overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      const toggle = page.getByRole('button', { name: 'Toggle projects', exact: true });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('navigation')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await shot(page, 'mobile-light');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('navigation')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await toggle.click();
    } finally { await page.setViewportSize({ width: 1280, height: 800 }); }
  });

  test('g: sign-out removes protected content and revokes API access', async () => {
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByRole('log')).toHaveCount(0);
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'E2E Project', exact: true })).toHaveCount(0);
    expect((await page.request.get('/projects')).status()).toBe(401);
  });
});

test('j: HTML security headers, immutable assets and JSON API 404', async ({ request }) => {
  const html = await request.get('/');
  expect(html.status()).toBe(200);
  expect(html.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(html.headers()['x-frame-options']).toBe('DENY');
  const asset = (await html.text()).match(/(?:src|href)="(\/assets\/[^" ]+)"/)?.[1];
  expect(asset, 'Built HTML must reference a hashed asset').toBeDefined();
  if (!asset) throw new Error('No built asset found.');
  const resource = await request.get(asset);
  expect(resource.status()).toBe(200);
  expect(resource.headers()['cache-control']).toContain('immutable');
  const missing = await request.get('/api/e2e-unknown');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['content-type']).toContain('application/json');
  expect(await missing.json()).toMatchObject({ ok: false, error: { code: 'not-found' } });
});

test('j: foreign Host header is refused', async ({ request }) => {
  // APIRequestContext supports Host overrides, unlike browser fetch's forbidden headers.
  const response = await request.get('/health', { headers: { host: 'foreign.invalid' } });
  expect(response.status()).toBe(403);
  expect(response.headers()['content-type']).toContain('application/json');
});
