// Visual review helper (not a test): signs in to a running work Host and captures the main screens.
//   node e2e/shots.mjs <baseUrl> <bootstrapToken> [vi-dark|en-light] [outDir]
// The bootstrap token is single use, so give this script its own Host (see docs/ui/README.md).
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [base, token, mode = 'vi-dark', out = 'e2e/screenshots/ux'] = process.argv.slice(2);
if (!base || !token) { console.error('usage: node e2e/shots.mjs <baseUrl> <token> [vi-dark|en-light] [outDir]'); process.exit(2); }
mkdirSync(out, { recursive: true });
const [locale, theme] = mode === 'en-light' ? ['en', 'light'] : ['vi', 'dark'];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: Number(process.env.WIDTH ?? 1440), height: Number(process.env.HEIGHT ?? 900) }, reducedMotion: process.env.MOTION ? 'no-preference' : 'reduce' });
await context.addInitScript(([l, t]) => { if (!localStorage.getItem('factory-ui.preferences.v1')) localStorage.setItem('factory-ui.preferences.v1', JSON.stringify({ locale: l, theme: t })); }, [locale, theme]);
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
const shot = async (name, full = false) => { await page.waitForTimeout(process.env.MOTION ? 900 : 350); await page.screenshot({ path: `${out}/${mode}-${name}.png`, fullPage: full }); console.log('shot', name); };
const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(500); };

await page.goto(base);
await page.getByLabel(/Bootstrap token|Mã khởi tạo|token/i).first().fill(token);
await page.getByRole('button', { name: /Sign in|Đăng nhập/i }).click();
await page.getByRole('navigation').waitFor({ timeout: 20000 });
await page.waitForTimeout(800);
await shot('01-overview');
await page.getByRole('navigation').getByRole('button', { name: /Demo project/ }).first().click();
await page.waitForTimeout(600);
const projectHash = await page.evaluate(() => location.hash);
const project = projectHash.split('/')[2];
await shot('02-project-overview');
for (const [name, tab] of [['03-board', 'board'], ['04-workflow', 'workflow'], ['05-automation', 'automation'], ['06-knowledge', 'knowledge'], ['07-settings', 'settings']]) {
  await go(`#/project/${project}/${tab}`); await shot(name);
}
await go('#/attention'); await shot('08-attention');
const first = page.getByRole('list').getByRole('button').first();
if (await first.count()) { await first.click(); await page.waitForTimeout(500); await shot('09-attention-detail'); }
await go('#/team'); await shot('10-team', true);
await go(`#/project/${project}/board`);
const card = page.getByRole('button', { name: /TSK-001/ }).first();
if (await card.count()) { await card.click(); await page.waitForTimeout(600); await shot('11-task-pane'); }
await go(`#/project/${project}`);
await page.getByRole('button', { name: /Ask Lead|Hỏi Lead/ }).click(); await shot('12-chat-dock');
await go('#/overview');
const create = page.getByRole('navigation').getByRole('button', { name: /New project|Dự án mới|Create project/ }).first();
if (await create.count()) { await create.click(); await page.waitForTimeout(500); await shot('13-create-project'); }
await browser.close();
