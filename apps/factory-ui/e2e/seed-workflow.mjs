// Demo helper (not a test): signs in to a work Host, creates a workflow from the first available definition and starts it.
//   node e2e/seed-workflow.mjs <baseUrl> <bootstrapToken>
import { chromium } from '@playwright/test';

const [base, token] = process.argv.slice(2);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await context.addInitScript(() => localStorage.setItem('factory-ui.preferences.v1', JSON.stringify({ locale: 'vi', theme: 'dark' })));
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
process.on('unhandledRejection', async (e) => { console.log('FAILED:', String(e.message).split(String.fromCharCode(10))[0]); await page.screenshot({ path: 'e2e/screenshots/ux/workflow-seed-failed.png' }); process.exit(1); });
await page.goto(base);
await page.getByLabel(/Bootstrap token|Mã khởi tạo|token/i).first().fill(token);
await page.getByRole('button', { name: /Sign in|Đăng nhập/i }).click();
await page.getByRole('navigation').waitFor({ timeout: 20000 });
await page.getByRole('navigation').getByRole('button', { name: /Demo project/ }).first().click();
await page.getByRole('tab', { name: /Quy trình/ }).click();
await page.getByRole('button', { name: /Tạo quy trình/ }).first().click();
await page.getByRole('dialog').waitFor();
await page.getByRole('dialog').getByRole('button', { name: /^Tạo$/ }).click();
await page.waitForTimeout(1500);
const start = page.getByRole('button', { name: /^Bắt đầu$/ });
if (await start.count()) { await start.first().click(); await page.waitForTimeout(1500); }
await page.screenshot({ path: 'e2e/screenshots/ux/workflow-seeded.png' });
console.log('seeded');
await browser.close();
