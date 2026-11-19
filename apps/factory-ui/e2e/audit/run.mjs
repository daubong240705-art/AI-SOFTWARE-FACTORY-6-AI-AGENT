import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { dialogs, hashFor, openScreen, screens } from './screens.mjs';
import { seed } from './seed.mjs';
import { runCrudFlows } from './flows.mjs';
import { writeFindings, writeReport } from './report.mjs';

const uiRoot = fileURLToPath(new URL('../../', import.meta.url));
const hostRoot = resolve(uiRoot, '../factory-host');
const auditRoot = join(uiRoot, '.audit');
const screenshots = join(auditRoot, 'screenshots');
const keep = process.argv.includes('--keep');
const dir = join(uiRoot, 'dist');
const hostMain = join(hostRoot, 'dist/main.js');
const variants = [1280, 800].flatMap(width => ['light', 'dark'].map(theme => ({ width, height: width === 1280 ? 800 : 900, theme })));
const safeText = value => String(value).replace(/\x1b\[[0-9;]*m/g, '').replace(/https?:\/\/[^\s"'<>]+/g, match => urlPath(match))
  .replace(/((?:token|cookie|authorization|password|secret|api[-_ ]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]').slice(0, 1200);

function urlPath(value) {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.pathname : `[${url.protocol}]`; }
  catch { return '[URL invalide]'; }
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  try { await once(server, 'listening'); }
  catch (error) { throw new Error(`Không thể mở cổng loopback cho Host: ${error.code ?? 'lỗi socket'}.`); }
  const { port } = server.address();
  await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
  return port;
}

async function startHost(root, children, openLogin) {
  const port = await freePort();
  const projectsRoot = join(root, 'projects');
  const paths = { FACTORY_STATE_DIR: join(root, 'state'), FACTORY_PROJECTS_ROOT: projectsRoot,
    FACTORY_WORKTREES_ROOT: join(root, 'worktrees'), FACTORY_MIGRATION_BACKUP_DIR: join(root, 'migrations'),
    FACTORY_BACKUP_DIR: join(root, 'backups'), HOME: join(root, 'home'), TMPDIR: join(root, 'tmp') };
  await Promise.all(Object.values(paths).map(path => mkdir(path, { recursive: true })));
  const env = { PATH: process.env.PATH, LANG: process.env.LANG ?? 'C.UTF-8', ...paths,
    FACTORY_PORT: String(port), FACTORY_UI_DIR: dir, FACTORY_OPEN_LOGIN: openLogin ? '1' : '0',
    FACTORY_LISTEN_HOST: '127.0.0.1', FACTORY_DEFAULT_PACK: 'software-team', FACTORY_LOCAL_CLI: '0' };
  const child = spawn(process.execPath, [hostMain], { cwd: hostRoot, env, stdio: 'ignore' });
  children.push(child);
  let spawnError;
  child.on('error', error => { spawnError = error; });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (spawnError) throw new Error(`Không thể khởi động Host: ${spawnError.code ?? 'lỗi tiến trình'}.`);
    if (child.exitCode !== null || child.signalCode) throw new Error(`Host thoát trước /health (${child.exitCode ?? child.signalCode}).`);
    try { if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(750) })).ok) return { base, projectsRoot }; }
    catch { /* Host may still be migrating. */ }
    await delay(250);
  }
  throw new Error('Host không trả về /health thành công trong thời hạn.');
}

async function stopHost(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  try { await exited; } finally { clearTimeout(timer); }
}

function record(page, add) {
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) add({ type: `console ${message.type()}`, text: safeText(message.text()) }); });
  page.on('pageerror', error => add({ type: 'pageerror', text: safeText(error.message) }));
  page.on('response', response => { if (response.status() >= 400) add({ type: 'HTTP', status: response.status(), path: urlPath(response.url()) }); });
  page.on('requestfailed', request => add({ type: 'requestfailed', path: urlPath(request.url()), text: safeText(request.failure()?.errorText ?? '') }));
}

async function inspect(page) {
  const dom = await page.evaluate(() => {
    const visible = element => element.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true }) && element.getClientRects().length > 0;
    const text = (document.body.innerText || '').replace(/\b(?:Codex|Claude(?: Code)?|OpenCode|Factory|Git|MCP|API)\b/gi, '');
    const english = text.match(/\b(?:Approve|Reject|Save|Delete|Cancel|Loading|Error|Settings|Workflow is|Take the)\b[^\n]*/gi) ?? [];
    const headerSelectors = 'header,[role="toolbar"],[data-slot="tabs-list"]';
    const overflow = [...document.querySelectorAll(headerSelectors)].filter(element => visible(element) && element.scrollWidth > element.clientWidth + 2).map(element => {
      const boundary = element.getBoundingClientRect();
      const clipped = [...element.querySelectorAll('button,a')].filter(child => visible(child) && child.getBoundingClientRect().right > boundary.right + 2);
      return { element: element.getAttribute('aria-label') || element.tagName, extra: element.scrollWidth - element.clientWidth,
        clipped: clipped.map(child => child.innerText.trim() || child.getAttribute('aria-label') || child.title).filter(Boolean) };
    });
    const nodes = [...document.querySelectorAll('.react-flow__node')].map(node => ({ id: node.dataset.id, position: node.style.transform }));
    return { english: [...new Set(english)].slice(0, 20), uuids: [...new Set(text.match(/[0-9a-f]{8}-[0-9a-f]{4}-/gi) ?? [])].slice(0, 20), overflow, nodes,
      selects: [...document.querySelectorAll('select')].filter(visible).length,
      missingAlt: [...document.images].filter(image => visible(image) && !image.hasAttribute('alt')).length };
  });
  const snapshot = await page.locator('body').ariaSnapshot({ timeout: 5000 });
  const unnamedButtons = (snapshot.match(/^\s*- button(?:\s+\[[^\]]+\])*\s*:?\s*$/gm) ?? []).length;
  return { ...dom, english: dom.english.map(safeText), unnamedButtons };
}

function issuesFor(entry) {
  const { inspection, issues, flags } = entry;
  const { english, uuids, overflow, selects, unnamedButtons, missingAlt } = inspection;
  if (english.length || uuids.length) flags.push('language');
  if (english.length) issues.push(`Từ tiếng Anh: ${english.join(' · ')}`);
  if (uuids.length) issues.push(`UUID hiển thị: ${uuids.join(', ')}`);
  if (overflow.length) flags.push('overflow');
  for (const item of overflow) issues.push(`Tràn ngang ${item.element}: ${item.extra}px${item.clipped.length ? `; hành động ngoài mép: ${item.clipped.join(', ')}` : ''}`);
  if (selects) { flags.push('select'); issues.push(`Ô chọn gốc: ${selects}`); }
  if (unnamedButtons || missingAlt) { flags.push('accessibility'); issues.push(`Nút không tên: ${unnamedButtons}; ảnh thiếu alt: ${missingAlt}`); }
  if (entry.id === 'project-flow-detail' && inspection.nodes.length === 4 && inspection.nodes.every(({ position }, index) => {
    const [left, top] = position.match(/-?[\d.]+(?=px)/g)?.map(Number) ?? [];
    return left === (index % 3) * 290 && top === Math.floor(index / 3) * 340;
  })) { flags.push('grid'); issues.push('Sơ đồ dùng vị trí lưới mặc định cho bản nháp không có tọa độ.'); }
}

async function newContext(browser, { width, height, theme }) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, locale: 'vi-VN', reducedMotion: 'reduce', acceptDownloads: false });
  context.setDefaultTimeout(6000);
  await context.addInitScript(value => {
    if (location.protocol === 'http:') localStorage.setItem('factory-ui.preferences.v1', JSON.stringify({ locale: 'vi', theme: value, mascotSkin: 'original' }));
  }, theme);
  return context;
}

async function paint(page) {
  await page.evaluate(async () => {
    await Promise.race([document.fonts.ready, new Promise(accept => setTimeout(accept, 1500))]);
    await new Promise(accept => requestAnimationFrame(() => requestAnimationFrame(accept)));
  });
}

const shot = (page, file) => page.screenshot({ path: join(screenshots, file), animations: 'disabled', timeout: 8000 }).then(() => file);

async function capture(page, results, item, variant, fixture, base, signInBase, events) {
  const { width, theme } = variant;
  const screen = item.screen ? screens.find(candidate => candidate.id === item.screen) : item;
  const entry = { id: item.id, area: item.screen ? 'hop-thoai' : item.area, width, theme, status: 'PASS', issues: [], flags: [], events };
  results.captures.push(entry);
  const file = `${String(results.captures.length).padStart(2, '0')}-${entry.area}-${item.id}-${width}-${theme}.png`;
  try {
    await openScreen(page, screen, fixture, screen.signIn ? signInBase : base);
    if (item.screen && item.open) await item.open(page, fixture);
    await page.locator(`html[data-theme="${theme}"]`).waitFor();
    await paint(page);
    entry.inspection = await inspect(page);
    issuesFor(entry);
  } catch (error) { entry.status = 'FAIL'; entry.issues.push(safeText(error.message)); }
  try { entry.file = await shot(page, file); }
  catch (error) { entry.status = 'FAIL'; entry.issues.push(safeText(error.message)); }
}

async function main() {
  const results = { generatedAt: new Date().toISOString(), status: 'CHƯA CHẠY', captures: [], events: [], flows: [], deepLink: null };
  const children = [];
  let temp;
  let browser;
  await mkdir(screenshots, { recursive: true });
  try {
    const built = await Promise.all([hostMain, join(dir, 'index.html')].map(path => access(path).then(() => true, () => false)));
    if (!built.every(Boolean)) throw new Error('Thiếu bản build. Chạy: (cd packages/factory-contracts && npm run build); (cd apps/factory-host && npm run build); (cd apps/factory-ui && npm run build)');
    temp = await mkdtemp(join(auditRoot, 'host-'));
    const host = await startHost(join(temp, 'open'), children, true);
    const signInHost = await startHost(join(temp, 'signin'), children, false);
    const fixture = await seed(host);
    results.seedFailures = fixture.seedFailures.map(({ type, error }) => ({ type, error: safeText(error) }));
    const requested = process.env.FACTORY_AUDIT_CHROME || '/usr/bin/google-chrome-stable';
    const executablePath = await access(requested, constants.X_OK).then(() => requested, () => chromium.executablePath());
    try { await access(executablePath, constants.X_OK); }
    catch { throw new Error('Không tìm thấy Chrome từ FACTORY_AUDIT_CHROME hoặc Chromium đi kèm Playwright.'); }
    browser = await chromium.launch({ executablePath, args: ['--enable-unsafe-swiftshader'] });
    const deepContext = await newContext(browser, variants[0]);
    try {
      const page = await deepContext.newPage();
      record(page, event => results.events.push({ ...event, phase: 'deep-link' }));
      const hash = hashFor(screens.find(screen => screen.id === 'project-agents'), fixture.projects.primary);
      await page.goto(`${host.base}/${hash}`);
      await page.locator('#factory-main').waitFor();
      await page.locator('#factory-navigation').getByRole('button', { name: fixture.projectNames.primary, exact: true }).waitFor();
      await paint(page);
      const actual = new URL(page.url()).hash;
      results.deepLink = { hash, actual, redirectedHome: actual === '#/overview', result: `Sau lần tải đầu: ${actual}`, file: await shot(page, '00-trong-project-deep-link-1280-light.png') };
    } catch (error) { results.events.push({ type: 'deep-link', text: safeText(error.message) }); }
    finally { await deepContext.close(); }
    for (const variant of variants) {
      const context = await newContext(browser, variant);
      try {
        const page = await context.newPage();
        let events;
        record(page, event => events?.push(event));
        for (const item of [...screens, ...dialogs]) {
          events = [];
          await capture(page, results, item, variant, fixture, host.base, signInHost.base, events);
        }
      } finally { await context.close(); }
    }
    const crudContext = await newContext(browser, variants[0]);
    try {
      const page = await crudContext.newPage();
      record(page, event => results.events.push({ ...event, phase: 'CRUD' }));
      await runCrudFlows({ page, fixture, base: host.base, results: results.flows, screenshot: name => shot(page, name), safeText });
    } finally { await crudContext.close(); }
    results.events.push(...fixture.apiFailures.map(({ path, status }) => ({ type: 'HTTP (fixture)', path, status })));
    const failed = !results.deepLink || results.seedFailures.length || [...results.captures, ...results.flows].some(entry => entry.status !== 'PASS');
    results.status = failed ? 'ĐÃ CHẠY · CÓ BƯỚC THẤT BẠI' : 'ĐÃ CHẠY';
    if (failed) process.exitCode = 1;
  } catch (error) {
    if (results.captures.length) results.status = 'CHẠY MỘT PHẦN';
    results.error = safeText(error.message ?? error);
    console.error(results.error);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
    await Promise.all(children.map(stopHost));
    if (temp && !keep) await rm(temp, { recursive: true, force: true });
    if (temp && keep) console.log(`Giữ state: ${temp}`);
    await writeReport(auditRoot, results);
    await writeFindings(join(auditRoot, 'findings.md'), results);
    console.log(`Báo cáo: ${join(auditRoot, 'report.html')}`);
  }
}

await main();
