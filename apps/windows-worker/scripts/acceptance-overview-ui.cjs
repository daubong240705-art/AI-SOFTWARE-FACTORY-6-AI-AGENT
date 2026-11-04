// UX-01 acceptance: built renderer + real isolated SQLite/IPC, no provider calls.
const { app, BrowserWindow, ipcMain } = require("electron");
const { resolve, join } = require("node:path");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const { channels } = require("../shared/channels.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "overview-ui-"));
const output = join(directory, "screenshots");
mkdirSync(output);
app.setPath("userData", join(directory, "data"));
let failMonitor = false;
const counts = {};
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) =>
  handle(channel, (...args) => {
    counts[channel] = (counts[channel] || 0) + 1;
    if (channel === channels.monitorSnapshot && failMonitor)
      return {
        ok: false,
        error: "Không tải được trạng thái — fixture offline",
      };
    return listener(...args);
  });
BrowserWindow.prototype.show = function () {};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label = "UI") {
  for (let i = 0; i < 100; i++) {
    const result = await fn();
    if (result) return result;
    await pause(100);
  }
  throw new Error(`Timeout: ${label}`);
}
let win;
async function main() {
  const store = new Store(join(directory, "data"));
  const source = join(directory, "Factory Lite"),
    otherSource = join(directory, "Other project");
  mkdirSync(source);
  mkdirSync(otherSource);
  const other = store.addProject(otherSource),
    project = store.addProject(source);
  const chat = store.conversations.create(project.id),
    heldChat = store.conversations.create(project.id);
  const settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.permissionMode = "full-access";
  settings.agents.forEach((a) => (a.model = "fixture-model"));
  store.save(settings, undefined);
  const historical = require("../../../docs/windows-worker/ww3-live.json").run;
  function run(state, prompt, index) {
    const r = {
      ...historical,
      id: crypto.randomUUID(),
      projectId: project.id,
      projectName: project.name,
      conversationId: chat.id,
      workspace: source,
      settings,
      state,
      prompt,
      summary: "Kết quả minh họa có trong SQLite",
      error:
        state === "needs_input"
          ? "Cần xác định hành vi lưu phiên đăng nhập"
          : "",
      review: null,
      permissions: [],
      tasks: [],
      profiles: [],
      commands: [],
      changes: [],
      retryOf: undefined,
      attemptRoot: undefined,
      recoveryOf: undefined,
      integration: undefined,
      createdAt: new Date(Date.now() - index * 60000).toISOString(),
      startedAt: null,
      endedAt: new Date().toISOString(),
      currentTaskId: null,
    };
    store.createRun(r);
    store.updateRun(r);
    return r;
  }
  const result = run("completed", "Sửa lỗi lưu cấu hình", 4);
  const needs = run("needs_input", "Giữ phiên đăng nhập trên thiết bị mới?", 2);
  store.event(needs.id, "RUN_STARTED", "Start");
  store.event(needs.id, "RUN_NEEDS_INPUT", "Need context");
  for (let i = 0; i < 350; i++)
    store.event(needs.id, "TOOL_STARTED", "noise", {
      version: 1,
      taskId: null,
      activity: "reading",
    });
  store.queue.add({
    projectId: project.id,
    conversationId: heldChat.id,
    prompt: "Bổ sung bộ lọc khách hàng",
    role: "lead",
    mode: "team",
    settings,
    afterRunId: needs.id,
    state: "held",
    reason: "Ứng dụng đã dừng lượt trước. Chọn cách tiếp tục.",
  });
  store.close();
  require("../out/main/main.js");
  await app.whenReady();
  win = await until(() => BrowserWindow.getAllWindows()[0]);
  win.webContents.setBackgroundThrottling(false);
  const errors = [];
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 3) errors.push(message);
  });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const click = (label) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  const nav = (label) =>
    js(
      `Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  await until(
    () => js("document.querySelectorAll('.recent-project').length===2"),
    "project list",
  );
  await js(
    `Array.from(document.querySelectorAll('.recent-project')).find(b=>b.textContent.includes(${JSON.stringify(project.name)})).click()`,
  );
  await until(
    () => js("!!document.querySelector('.project-overview .attention-list')"),
    "overview",
  );
  assert.equal(
    await js("document.querySelectorAll('.attention-list > li').length"),
    2,
  );
  assert.equal(
    await js("document.querySelector('.workspace-project').textContent"),
    project.name,
  );
  assert.equal(
    await js(
      "document.querySelector('.overview-results').textContent.includes('Chưa xác minh')",
    ),
    true,
  );
  assert.equal(
    await js(
      "document.querySelector('.overview-timeline').textContent.includes('Đang đọc source')",
    ),
    false,
  );
  assert.equal(
    counts[channels.runDetail] || 0,
    0,
    "overview must not fetch full run detail",
  );
  await click("Bổ sung ngữ cảnh");
  await until(
    () =>
      js("!!document.querySelector('.chat-composer textarea:not(:disabled)')"),
    "context chat",
  );
  assert.equal(
    await js("document.querySelectorAll('.chat-composer textarea').length"),
    1,
  );
  await js(
    `(() => {const input=document.querySelector('.chat-composer textarea'); const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; set.call(input,'Bản nháp tiếng Việt chưa gửi'); input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await nav("Tổng quan");
  await until(() =>
    js("!!document.querySelector('.project-overview .attention-list')"),
  );
  await click("Hỏi Lead");
  await until(
    () =>
      js(
        "document.querySelector('.chat-composer textarea')?.value==='Bản nháp tiếng Việt chưa gửi'",
      ),
    "draft restored",
  );
  await click("Tạo công việc");
  await until(
    () => js("!!document.querySelector('.board-editor[open]')"),
    "create board item",
  );
  await js(
    `(() => {const input=document.querySelector('[aria-label="Tiêu đề công việc"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Công việc từ header');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await js("document.querySelector('.board-editor form').requestSubmit()");
  await until(
    () =>
      js(
        "!document.querySelector('.board-editor[open]') && document.querySelector('.kanban-columns')?.textContent.includes('Công việc từ header')",
      ),
    "board saved",
  );
  await nav("Tổng quan");
  await until(() => js("!!document.querySelector('.overview-results button')"));
  await js("document.querySelector('.overview-results button').click()");
  await until(
    () =>
      js(
        "document.querySelector('.task-inspector[open]')?.textContent.includes('Sửa lỗi lưu cấu hình')",
      ),
    "exact result inspector",
  );
  await js(
    "document.querySelector('[aria-label=\"Đóng chi tiết công việc\"]').click()",
  );
  await click("Mở hàng đợi");
  await until(
    () =>
      js(
        "document.body.textContent.includes('Bổ sung bộ lọc khách hàng') && !!document.querySelector('.chat-composer')",
      ),
    "held conversation",
  );
  await nav("Tổng quan");
  await until(() => js("!!document.querySelector('.attention-list')"));
  failMonitor = true;
  await click("Cập nhật");
  await until(
    () =>
      js(
        "document.querySelectorAll('.attention-list button:disabled').length===2",
      ),
    "failed monitor disables stale actions",
  );
  failMonitor = false;
  await click("Cập nhật");
  await until(() =>
    js(
      "document.querySelectorAll('.attention-list button:not(:disabled)').length===2",
    ),
  );
  const layouts = [];
  for (const [width, height, zoom] of [
    [1440, 900, 1],
    [1366, 768, 1],
    [850, 700, 1],
    [1366, 768, 1.25],
    [1366, 768, 1.5],
  ]) {
    win.setSize(width, height);
    win.webContents.setZoomFactor(zoom);
    await pause(200);
    const layout = await js(
      `(() => {const h=document.querySelector('.workspace-topbar').getBoundingClientRect(); const buttons=[...document.querySelectorAll('.workspace-actions button')].map(b=>{const r=b.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}});return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,buttonsWithinHeader:buttons.every(r=>r.right<=innerWidth && r.left>=0 && r.top>=h.top && r.bottom<=h.bottom)}})()`,
    );
    assert.equal(layout.overflow, false);
    assert.equal(layout.buttonsWithinHeader, true);
    layouts.push({ width, height, zoom, ...layout });
    writeFileSync(
      join(output, `overview-${width}-${zoom}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
  }
  win.webContents.setZoomFactor(1);
  win.setSize(850, 700);
  await js(
    `document.querySelector('.workspace-project [role="combobox"]').focus()`,
  );
  for (const keyCode of ["Space", "End", "Enter"]) {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode });
    await pause(50);
  }
  await until(
    () =>
      js(
        "document.querySelector('.workspace-project')?.textContent==='Other project' && !!document.querySelector('.overview-empty')",
      ),
    "project switch",
  );
  assert.equal(
    await js(
      "document.querySelector('.project-overview').textContent.includes('Giữ phiên đăng nhập')",
    ),
    false,
  );
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    providerCalls: 0,
    fixture: true,
    checks: [
      "project-scoped overview and held inbox",
      "milestone timeline survives 350 noisy tool events",
      "no runDetail reads for overview",
      "context chat and draft preserved",
      "header creates real BoardItem without starting run",
      "unverified result opens exact inspector",
      "held queue opens correct conversation",
      "stale actions disabled and refresh recovers",
      "five viewport/scaling layouts",
      "custom project dropdown works by keyboard in narrow window",
      "project switch clears previous data",
    ],
    layouts,
    counts,
    rendererErrors: errors,
  };
  writeFileSync(
    join(directory, "acceptance.json"),
    JSON.stringify(report, null, 2),
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
main().catch(async (error) => {
  if (win)
    writeFileSync(
      join(output, "failure.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
  console.error(error.stack);
  app.exit(1);
});
