// Built Electron/SQLite/IPC acceptance, isolated data and explicit historical fixture.
// No provider requests or production database access.
const { app, BrowserWindow } = require("electron");
const { join, resolve } = require("node:path");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const cacheDirectory = resolve(__dirname, "../.cache");
mkdirSync(cacheDirectory, { recursive: true });
const directory = mkdtempSync(join(cacheDirectory, "monitor-ui-"));
app.setPath("userData", directory);
const store = new Store(directory);
const project = store.addProject(resolve(__dirname, ".."));
const settings = defaultSettings();
settings.gatewayUrl = "https://unused.example/v1";
settings.agents.forEach((agent) => {
  agent.model = "ds/deepseek-v4-flash";
});
settings.agents.find((agent) => agent.role === "pm").enabled = false;
settings.agents.find((agent) => agent.role === "ba").model = "";
store.save(settings, undefined);
const conversation = store.conversations.create(project.id);
const fixture = require("../../../docs/windows-worker/ww3-live.json").run;
const run = {
  ...fixture,
  id: crypto.randomUUID(),
  projectId: project.id,
  projectName: project.name,
  workspace: project.path,
  conversationId: conversation.id,
  settings,
  state: "failed",
  prompt: "Theo dõi đội ngũ — dữ liệu nghiệm thu UI",
  summary: "Fixture lịch sử, chưa có acceptance xác minh.",
  review: null,
  permissions: [],
  currentTaskId: null,
  tasks: [
    {
      id: "t1",
      originalTaskId: "t1",
      role: "be",
      title: "Kết quả chờ xác minh",
      instructions: "Fixture",
      allowedPaths: ["src"],
      acceptance: ["Kiểm tra source"],
      dependsOn: [],
      state: "completed",
      model: "ds/deepseek-v4-flash",
      kind: "work",
      round: 0,
      sessionId: null,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      summary: "Fixture",
      error: "",
      changes: [],
      commandIds: [],
    },
  ],
  createdAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
};
store.createRun(run);
store.updateRun(run);
store.close();
const output = resolve(__dirname, "../../../docs/windows-worker/v1.3");
mkdirSync(output, { recursive: true });
BrowserWindow.prototype.show = function () {};
require("../out/main/main.js");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    const result = await fn();
    if (result) return result;
    await pause(100);
  }
  throw new Error("Timed out waiting for monitor UI");
}
app.whenReady().then(async () => {
  try {
    const win = await until(() => BrowserWindow.getAllWindows()[0]);
    win.webContents.setBackgroundThrottling(false);
    await until(() => !win.webContents.isLoading());
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const errors = [];
    win.webContents.on("console-message", (_event, level, message) => {
      if (level >= 3) errors.push(message);
    });
    await until(() => js("!!document.querySelector('.monitor-chat-link')"));
    await js("document.querySelector('.monitor-chat-link').click()");
    await until(() =>
      js("document.querySelectorAll('.agent-card').length === 7"),
    );
    assert.equal(
      await js("document.querySelectorAll('.agent-card.available').length"),
      5,
    );
    assert.equal(
      await js("document.querySelectorAll('.agent-card.disabled').length"),
      1,
    );
    assert.equal(
      await js("document.querySelectorAll('.agent-card.unconfigured').length"),
      1,
    );
    assert.ok(
      await js(
        "document.querySelector('.monitor-progress').textContent.includes('0/1 task xác minh')",
      ),
    );
    assert.equal(await js("!!window.require"), false);
    const bad = await js(
      `window.worker.monitorSnapshot({projectId:${JSON.stringify(project.id)}, writeState:'completed'})`,
    );
    assert.equal(bad.ok, false);
    const first = await js(
      `window.worker.monitorSnapshot({projectId:${JSON.stringify(project.id)}})`,
    );
    assert.equal(first.ok, true);
    assert.equal(first.value.unchanged, false);
    const snapshot = first.value.snapshot;
    const unchanged = await js(
      `window.worker.monitorSnapshot(${JSON.stringify({ projectId: project.id, epoch: snapshot.epoch, sinceRevision: snapshot.revision })})`,
    );
    assert.equal(unchanged.value.unchanged, true);
    win.setSize(1440, 900);
    await pause(250);
    writeFileSync(
      join(output, "agent-monitor-desktop.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(
      "Array.from(document.querySelectorAll('.monitor-filters button')).find(b=>b.textContent.startsWith('Rảnh')).click()",
    );
    await until(() =>
      js("document.querySelectorAll('.agent-card').length === 5"),
    );
    await js(
      "Array.from(document.querySelectorAll('.monitor-filters button')).find(b=>b.textContent.startsWith('Tất cả')).click()",
    );
    win.setSize(850, 700);
    await pause(250);
    assert.equal(
      await js("document.documentElement.scrollWidth <= innerWidth"),
      true,
    );
    writeFileSync(
      join(output, "agent-monitor-small.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    // Real saveSettings IPC must invalidate the monitor revision and change roster availability.
    const changed = structuredClone(settings);
    changed.agents.find((agent) => agent.role === "ba").model =
      "ds/deepseek-v4-flash";
    const saved = await js(
      `window.worker.saveSettings(${JSON.stringify({ settings: changed, keyAction: "keep" })})`,
    );
    assert.equal(saved.ok, true);
    await until(() =>
      js("document.querySelectorAll('.agent-card.available').length === 6"),
    );
    await js("document.querySelector('.monitor-progress button').click()");
    await until(() => js("!!document.querySelector('.chat-detail-panel')"));
    assert.deepEqual(errors, []);
    const result = {
      passed: true,
      fixture: true,
      providerCalls: 0,
      checks: [
        "Built main/preload/renderer with real isolated SQLite and IPC",
        "Seven roles; available/disabled/unconfigured separated",
        "Completed task without verified review remains zero verified",
        "Chat-to-monitor and monitor-to-run navigation",
        "Filter and narrow window without horizontal overflow",
        "Real settings save invalidates snapshot and roster",
        "Strict IPC input and unchanged epoch/revision response",
        "Renderer has no Node access",
      ],
      rendererErrors: errors,
    };
    writeFileSync(
      join(output, "v1.3a-ui.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
    app.quit();
  } catch (error) {
    console.error(error.stack);
    app.exit(1);
  }
});
