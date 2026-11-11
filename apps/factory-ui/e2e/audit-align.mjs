// Visual audit helper (not a test): measures buttons that sit next to an input/select/textarea in the same row and
// reports height or bottom-edge mismatches, plus controls whose text touches the border.
//   node e2e/audit-align.mjs <baseUrl> <bootstrapToken>
import { chromium } from '@playwright/test';

const [base, token] = process.argv.slice(2);
if (!base || !token) { console.error('usage: node e2e/audit-align.mjs <baseUrl> <token>'); process.exit(2); }
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await context.addInitScript(() => { if (!localStorage.getItem('factory-ui.preferences.v1')) localStorage.setItem('factory-ui.preferences.v1', JSON.stringify({ locale: 'en', theme: 'dark' })); });
const page = await context.newPage();

const measure = () => page.evaluate(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const controlSel = 'input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea, select, [role=combobox]';
  const out = [];
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.id || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
  for (const button of document.querySelectorAll('button')) {
    if (!visible(button) || button.closest('[role=tablist]') || button.closest('[data-slot=toggle-group]') || button.matches('[role=combobox]')) continue;
    // find the nearest ancestor row that also holds a control which is not inside the button
    let row = button.parentElement; let control = null; let depth = 0;
    while (row && depth < 3 && !control) {
      for (const candidate of row.querySelectorAll(controlSel)) { if (visible(candidate) && !button.contains(candidate) && !candidate.contains(button)) { control = candidate; break; } }
      if (!control) row = row.parentElement; depth++;
    }
    if (!control || !row) continue;
    const b = button.getBoundingClientRect(); const c = control.getBoundingClientRect();
    if (c.top > b.bottom || c.bottom < b.top) continue; // not on the same visual row
    const dh = Math.round(Math.abs(b.height - c.height)); const dbottom = Math.round(Math.abs(b.bottom - c.bottom));
    if (dh > 1 || dbottom > 1) out.push({ kind: 'row', button: label(button), control: label(control), buttonH: Math.round(b.height), controlH: Math.round(c.height), bottomDelta: dbottom });
  }
  // controls that share a row (an ancestor within 3 levels holds both) must have the same height and bottom edge
  const controls = [...document.querySelectorAll(controlSel)].filter(visible).filter((el) => !el.matches('select[aria-hidden=true]'));
  const seen = new Set();
  for (const a of controls) {
    let row = a.parentElement;
    for (let depth = 0; row && depth < 3; depth++, row = row.parentElement) {
      for (const b of controls) {
        if (a === b || a.contains(b) || b.contains(a) || !row.contains(b)) continue;
        const key = [label(a), label(b)].sort().join('|'); if (seen.has(key)) continue;
        const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
        if (ra.top > rb.bottom || rb.top > ra.bottom || Math.abs(ra.left - rb.left) < 2) continue;
        const dh = Math.round(Math.abs(ra.height - rb.height)); const db = Math.round(Math.abs(ra.bottom - rb.bottom));
        if ((dh > 1 || db > 1) && !a.matches('textarea') && !b.matches('textarea')) { seen.add(key); out.push({ kind: 'controls', a: label(a), b: label(b), heights: [Math.round(ra.height), Math.round(rb.height)], bottomDelta: db }); }
      }
    }
  }
  for (const el of document.querySelectorAll(controlSel)) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    if (parseFloat(s.paddingLeft) < 8 && s.borderLeftWidth !== '0px' && el.tagName !== 'SELECT') out.push({ kind: 'padding', control: label(el), paddingLeft: s.paddingLeft });
  }
  return out;
});

const report = async (name) => { await page.waitForTimeout(500); const issues = await measure(); console.log(`== ${name}: ${issues.length} issue(s)`); for (const issue of issues) console.log('  ', JSON.stringify(issue)); };
const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(600); };

await page.goto(base);
await page.getByLabel(/Bootstrap token/i).first().fill(token);
await page.getByRole('button', { name: /Sign in/i }).click();
await page.getByRole('navigation').waitFor({ timeout: 20000 });
await page.waitForTimeout(800);
await report('overview');
await page.getByRole('navigation').getByRole('button', { name: /Demo project/ }).first().click();
await page.waitForTimeout(600);
const project = (await page.evaluate(() => location.hash)).split('/')[2];
for (const tab of ['', '/board', '/workflow', '/automation', '/knowledge', '/settings']) { await go(`#/project/${project}${tab}`); await report(`project${tab || '/overview'}`); }
await go(`#/project/${project}/board`);
const newTask = page.getByRole('button', { name: /New task/ }).first();
if (await newTask.count()) { await newTask.click(); await report('board + new task form'); }
const card = page.getByRole('button', { name: /TSK-001/ }).first();
if (await card.count()) { await card.click(); await report('board + task pane'); }
await go('#/attention'); await report('attention');
const item = page.getByRole('list').getByRole('button').first();
if (await item.count()) { await item.click(); await report('attention item'); }
await go('#/team'); await report('team');
await go(`#/project/${project}`);
await page.getByRole('button', { name: /Ask Lead/ }).click(); await report('chat dock');
await go('#/overview');
const create = page.getByRole('button', { name: /New project/ }).first();
if (await create.count()) { await create.click(); await report('create project dialog'); }
await browser.close();
