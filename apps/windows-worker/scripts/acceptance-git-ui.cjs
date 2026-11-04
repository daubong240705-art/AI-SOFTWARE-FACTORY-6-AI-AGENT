// Built Electron + isolated SQLite and real Git. No provider requests or production data.
const { app, BrowserWindow, ipcMain } = require("electron");
const { join, resolve } = require("node:path");
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} = require("node:fs");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const { channels } = require("../shared/channels.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "git-ui-"));
const data = join(directory, "data");
app.setPath("userData", data);
BrowserWindow.prototype.show = function () {};
const counts = {};
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) =>
  handle(channel, (...args) => {
    counts[channel] = (counts[channel] || 0) + 1;
    return listener(...args);
  });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label = "UI") {
  for (let i = 0; i < 120; i++) {
    const v = await fn();
    if (v) return v;
    await pause(100);
  }
  throw Error(`Timeout: ${label}`);
}
let win;
async function main() {
  const repo = join(directory, "Factory"),
    empty = join(directory, "No Git");
  mkdirSync(repo);
  mkdirSync(empty);
  writeFileSync(join(empty, ".git"), "gitdir: ./missing-fixture-repository\n");
  const git = (...args) =>
    execFileSync("git", ["-C", repo, ...args], {
      windowsHide: true,
      encoding: "utf8",
    }).trim();
  git("init");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(repo, "source.txt"), "original\n");
  git("add", ".");
  git("commit", "-m", "Initial");
  const store = new Store(data),
    other = store.addProject(empty),
    project = store.addProject(repo);
  const item = store.board.create({
    projectId: project.id,
    title: "Task linked from a commit",
    body: "Persist this work item",
    criteria: [],
    suggestedRole: null,
    priority: 0,
    planningState: "backlog",
  });
  writeFileSync(join(repo, "source.txt"), "committed\n");
  git("add", ".");
  git("commit", "-m", `${item.code} ${"Long subject ".repeat(35)}`);
  writeFileSync(join(repo, "source.txt"), "staged\n");
  git("add", ".");
  writeFileSync(join(repo, "source.txt"), "staged\nworking\n");
  writeFileSync(join(repo, "tài liệu.txt"), "password=private-fixture\n");
  const index = readFileSync(join(repo, ".git", "index")),
    head = git("rev-parse", "HEAD");
  const settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.forEach((a) => (a.model = "fixture"));
  store.save(settings, undefined);
  store.close();
  require("../out/main/main.js");
  await app.whenReady();
  win = await until(() => BrowserWindow.getAllWindows()[0]);
  win.webContents.setBackgroundThrottling(false);
  const errors = [];
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 3) errors.push(message);
  });
  const js = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code, true);
    } catch (e) {
      console.error(code);
      throw e;
    }
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)} && b.getClientRects().length).click()`,
    );
  async function openGit() {
    await js("document.querySelector('[aria-label=\"Khác\"]').click()");
    await until(() =>
      js("!!document.querySelector('button[title=\"Git local\"]')"),
    );
    await js("document.querySelector('button[title=\"Git local\"]').click()");
    await until(() => js("!!document.querySelector('.git-file-list')"));
  }
  await until(() => js("!!document.querySelector('.project-overview')"));
  // Select the fixture explicitly; list sorting does not assume millisecond ordering.
  await js("document.querySelector('.workspace-project > button').click()");
  await until(() =>
    js(
      `Array.from(document.querySelectorAll('.project-choice')).some(b=>b.textContent.trim()===${JSON.stringify(project.name)})`,
    ),
  );
  await js(
    `Array.from(document.querySelectorAll('.project-choice')).find(b=>b.textContent.trim()===${JSON.stringify(project.name)}).click()`,
  );
  await until(() => js("!!document.querySelector('.project-overview')"));
  await until(() =>
    js(
      `document.querySelector('.workspace-project > button').textContent.trim()===${JSON.stringify(project.name)}`,
    ),
  );
  assert.equal(
    counts[channels.gitSnapshot] || 0,
    0,
    "Git should load only on request",
  );
  await openGit();
  assert.equal(await js("document.querySelectorAll('.git-file').length"), 2);
  await js(
    "Array.from(document.querySelectorAll('.git-file')).find(b=>b.textContent.includes('source.txt')).click()",
  );
  await until(() =>
    js("!!document.querySelector('.git-diff-panel .unified-diff')"),
  );
  assert.equal(
    await js(
      "document.querySelector('.unified-diff').textContent.includes('working')",
    ),
    true,
  );
  await click("Staged");
  await until(() =>
    js(
      "document.querySelector('.git-diff-panel').textContent.includes('HEAD → Index')",
    ),
  );
  assert.equal(
    await js(
      "document.querySelector('.unified-diff').textContent.includes('working')",
    ),
    false,
  );
  const layouts = [];
  for (const [width, height, zoom] of [
    [1366, 768, 1],
    [850, 700, 1],
    [1366, 768, 1.25],
    [1366, 768, 1.5],
  ]) {
    win.setSize(width, height);
    win.webContents.setZoomFactor(zoom);
    await pause(220);
    assert.equal(
      await js(
        "[document.querySelector('main'),document.querySelector('.git-workspace')].every(e=>e.scrollWidth<=e.clientWidth+1)",
      ),
      true,
    );
    writeFileSync(
      join(directory, `git-changes-${width}-${zoom}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
    await click("Lịch sử commit");
    await until(() =>
      js("document.querySelectorAll('.git-history li').length===2"),
    );
    await pause(120);
    assert.equal(
      await js(
        "[document.querySelector('main'),document.querySelector('.git-workspace')].every(e=>e.scrollWidth<=e.clientWidth+1)",
      ),
      true,
    );
    writeFileSync(
      join(directory, `git-history-${width}-${zoom}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
    await click("Thay đổi");
    await pause(50);
    layouts.push({ width, height, zoom });
  }
  win.setSize(1366, 768);
  win.webContents.setZoomFactor(1);
  await click("Lịch sử commit");
  await until(() => js("!!document.querySelector('.git-work-refs button')"));
  await js("document.querySelector('.git-work-refs button').click()");
  await until(() =>
    js(
      "document.querySelector('.work-item-panel')?.open && document.querySelector('.work-panel-header h2')?.textContent==='Task linked from a commit'",
    ),
  );
  await js("document.querySelector('[aria-label=\"Đóng hồ sơ\"]').click()");
  await click("Thay đổi");
  await pause(80);
  await js(
    "Array.from(document.querySelectorAll('.git-file')).find(b=>b.textContent.includes('tài liệu.txt')).click()",
  );
  await until(() =>
    js(
      "document.querySelector('.unified-diff')?.textContent.includes('REDACTED')",
    ),
  );
  assert.equal(
    await js(
      "document.querySelector('.unified-diff').textContent.includes('private-fixture')",
    ),
    false,
  );
  const forbidden = await js(
    `window.worker.gitDiff({projectId:${JSON.stringify(project.id)},path:'../.git/config',comparison:'unstaged'})`,
  );
  assert.equal(forbidden.ok, false);
  const noProject = await js(
    `window.worker.gitSnapshot({projectId:crypto.randomUUID()})`,
  );
  assert.equal(noProject.ok, false);
  const badRequest = await js(
    `window.worker.gitSnapshot({projectId:${JSON.stringify(project.id)},offset:10001})`,
  );
  assert.equal(badRequest.ok, false);
  await js("document.querySelector('.workspace-project > button').click()");
  await until(() => js("!!document.querySelector('.project-choice')"));
  await js(
    `Array.from(document.querySelectorAll('.project-choice')).find(b=>b.textContent.trim()===${JSON.stringify(other.name)}).click()`,
  );
  await until(() => js("!!document.querySelector('.project-overview')"));
  await js("document.querySelector('[aria-label=\"Khác\"]').click()");
  await until(() =>
    js("!!document.querySelector('button[title=\"Git local\"]')"),
  );
  await js("document.querySelector('button[title=\"Git local\"]').click()");
  await until(() =>
    js(
      "document.querySelector('.git-workspace')?.textContent.includes('không thuộc repository')",
    ),
  );
  assert.equal(await js("!!document.querySelector('.git-history li')"), false);
  assert.ok(index.equals(readFileSync(join(repo, ".git", "index"))));
  assert.equal(git("rev-parse", "HEAD"), head);
  assert.equal(
    readFileSync(join(repo, "source.txt"), "utf8"),
    "staged\nworking\n",
  );
  assert.equal(counts[channels.startRun] || 0, 0);
  assert.equal(counts[channels.sendChat] || 0, 0);
  assert.deepEqual(errors, []);
  writeFileSync(
    join(directory, "acceptance.json"),
    JSON.stringify(
      {
        passed: true,
        providerCalls: 0,
        layouts,
        counts,
        rendererErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      directory,
      layouts: layouts.length,
      rendererErrors: errors,
    }),
  );
  app.quit();
}
main().catch(async (e) => {
  console.error(e.stack);
  try {
    if (win)
      writeFileSync(
        join(directory, "failure.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
  } catch {}
  app.exit(1);
});
