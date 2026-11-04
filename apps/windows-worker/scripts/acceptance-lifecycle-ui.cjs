// Isolated real Electron/SQLite/IPC/renderer + real npm server. No provider calls.
const { app, BrowserWindow, dialog, shell } = require("electron");
const { join, resolve } = require("node:path");
const {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
} = require("node:fs");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const { normalizeRun } = require("../shared/runs.ts");
const artifacts = resolve(
  __dirname,
  "../../../.cache/asf-research/lifecycle-ui",
);
mkdirSync(artifacts, { recursive: true });
const directory = mkdtempSync(join(artifacts, "data-"));
app.setPath("userData", directory);
const source = join(directory, "source");
mkdirSync(source);
writeFileSync(
  join(source, "package.json"),
  JSON.stringify({ scripts: { dev: "node server.cjs" } }),
);
writeFileSync(
  join(source, "server.cjs"),
  "const http=require('node:http');const s=http.createServer((q,r)=>r.end('v11-fixture'));s.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+s.address().port));",
);
const store = new Store(directory);
const settings = defaultSettings();
settings.gatewayUrl = "https://unused.example/v1";
settings.agents.forEach((a) => {
  a.model = "fixture";
});
store.save(settings, undefined);
store.setModels(["fixture"]);
const project = store.addProject(source);
const conversation = store.conversations.create(project.id);
const run = normalizeRun({
  id: crypto.randomUUID(),
  projectId: project.id,
  projectName: "Fixture",
  workspace: source,
  conversationId: conversation.id,
  prompt: "Continue work",
  summary: "Previous result preserved",
  error: "",
  role: "be",
  model: "fixture",
  mode: "direct",
  state: "running",
  settings,
  createdAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  endedAt: null,
  sessionId: "old-session",
  tasks: [],
  profiles: [],
  currentTaskId: null,
  fixRound: 0,
  review: null,
  changes: [],
  commands: [],
  permissions: [
    { id: "old-permission", permission: "bash", patterns: ["npm test"] },
  ],
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  toolsCompleted: 0,
  runtimeVersion: "1.19.5",
  baselineComplete: true,
});
store.createRun(run);
const old = {
  ...structuredClone(run),
  id: crypto.randomUUID(),
  conversationId: undefined,
  state: "completed",
  createdAt: "2020-01-01T00:00:00.000Z",
  permissions: [],
};
store.createRun(old);
store.close();
let choice = 0,
  closeDialogs = 0,
  quitCalls = 0,
  opened = "";
dialog.showMessageBox = async () => {
  closeDialogs++;
  return { response: choice };
};
dialog.showSaveDialog = async () => ({
  canceled: false,
  filePath: join(directory, "export.json"),
});
shell.openExternal = async (url) => {
  opened = url;
};
BrowserWindow.prototype.show = function () {};
require("../out/main/main.js");
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error("Lifecycle UI timeout");
}
app.whenReady().then(async () => {
  let status = 0;
  try {
    const win = await until(() => BrowserWindow.getAllWindows()[0]);
    win.webContents.setBackgroundThrottling(false);
    await until(() => !win.webContents.isLoading());
    const js = (code) => win.webContents.executeJavaScript(code, true);
    await until(() =>
      js(`document.querySelectorAll('.chat-message.assistant').length===1`),
    );
    const detail = await js(
      `window.worker.runDetail(${JSON.stringify(run.id)})`,
    );
    assert.equal(detail.value.run.state, "interrupted");
    assert.deepEqual(detail.value.run.permissions, []);
    await js(`document.querySelector('[aria-label="Mở chi tiết"]').click()`);
    await js(
      `[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='Kết quả').click()`,
    );
    await until(() => js(`!!document.querySelector('.recovery-actions')`));
    await js(`document.querySelector('.recovery-actions button').click()`);
    await until(() =>
      js(
        `document.querySelector('.recovery-actions').textContent.includes('attempt mới')`,
      ),
    );
    assert.equal(
      (await js(`window.worker.continueRecovery('invalid')`)).ok,
      false,
    );
    await js(
      `[...document.querySelectorAll('.recovery-actions button')].find(e=>e.textContent==='Kết thúc lượt gián đoạn').click()`,
    );
    await until(
      async () =>
        (await js(`window.worker.runDetail(${JSON.stringify(run.id)})`)).value
          .run.state === "cancelled",
    );
    const exported = await js(
      `window.worker.exportRun(${JSON.stringify(run.id)})`,
    );
    assert.equal(exported.value, true);
    const report = JSON.parse(
      readFileSync(join(directory, "export.json"), "utf8"),
    );
    assert.equal(report.run.summary, "Previous result preserved");
    assert.equal(report.run.settings, undefined);
    assert.equal(
      (await js(`window.worker.retention({days:0,keep:1})`)).ok,
      false,
    );
    const retention = await js(`window.worker.retention({days:30,keep:1})`);
    assert.deepEqual(retention.value.runIds, [old.id]);
    assert.equal(
      (
        await js(
          `window.worker.prune(${JSON.stringify(retention.value.token)})`,
        )
      ).value,
      1,
    );
    await js(`document.querySelector('[aria-label="Công cụ dự án"]').click()`);
    await js(
      `[...document.querySelectorAll('.ui-popover-panel button')].find(e=>e.textContent==='Chạy local').click()`,
    );
    await until(() =>
      js(`document.querySelector('[aria-label="Lệnh dự án"]')?.value==='dev'`),
    );
    assert.equal(
      (
        await js(
          `window.worker.startCommand({projectId:${JSON.stringify(project.id)},script:'dev & echo invalid'})`,
        )
      ).ok,
      false,
    );
    await js(
      `[...document.querySelectorAll('.workspace-tools button')].find(e=>e.textContent==='Chạy').click()`,
    );
    const local = await until(async () => {
      const r = await js(`window.worker.localCommand()`);
      return r.ok && r.value?.url ? r.value : null;
    });
    assert.equal(await (await fetch(local.url)).text(), "v11-fixture");
    assert.equal(
      (await js(`window.worker.recovery(${JSON.stringify(run.id)})`)).ok,
      false,
      "recovery must wait for local command",
    );
    await until(() =>
      js(
        `[...document.querySelectorAll('.workspace-tools button')].some(e=>e.textContent==='Mở preview')`,
      ),
    );
    await js(
      `[...document.querySelectorAll('.workspace-tools button')].find(e=>e.textContent==='Mở preview').click()`,
    );
    await until(() => opened === new URL(local.url).href);
    writeFileSync(
      join(artifacts, "local-preview.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    app.quit = () => {
      quitCalls++;
    };
    win.close();
    await until(() => closeDialogs === 1);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(win.isDestroyed(), false);
    assert.equal(
      (await js(`window.worker.localCommand()`)).value.state,
      "running",
    );
    assert.equal(quitCalls, 0);
    choice = 1;
    win.close();
    await until(() => quitCalls === 1);
    assert.equal(
      (await js(`window.worker.localCommand()`)).value.state,
      "interrupted",
    );
    await assert.rejects(fetch(local.url));
    writeFileSync(
      join(artifacts, "result.json"),
      JSON.stringify(
        {
          passed: true,
          kind: "real-electron-npm-fixture",
          checks: [
            "reopen and clear stale approval",
            "recovery preview and abort",
            "export JSON",
            "retention and IPC validation",
            "local npm server and preview",
            "keep working on close",
            "stop before quit",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS: V1.1 real Electron/IPC/SQLite/renderer, recovery/abort/export/retention and npm preview, both close choices.",
    );
    console.log("Artifacts: " + artifacts);
  } catch (error) {
    console.error(error.stack);
    status = 1;
  }
  app.exit(status);
});
