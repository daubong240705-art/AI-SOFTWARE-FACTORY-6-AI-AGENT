// Built Electron renderer/preload/main, isolated SQLite and explicit UI fixtures.
const { app, BrowserWindow } = require("electron");
const { join, resolve } = require("node:path");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const directory = mkdtempSync(join(tmpdir(), "asf-ww4b-ui-"));
app.setPath("userData", directory);
const store = new Store(directory);
const project = store.addProject(resolve(__dirname, ".."));
const chat = store.conversations.create(project.id);
const settings = defaultSettings();
settings.gatewayUrl = "https://unused.example/v1";
settings.agents = settings.agents.map((a) => ({
  ...a,
  model: "ds/deepseek-v4-flash",
}));
store.save(settings, undefined);
const evidence = require("../../../docs/windows-worker/ww3-live.json").run;
const run = {
  ...evidence,
  id: crypto.randomUUID(),
  conversationId: chat.id,
  projectId: project.id,
  projectName: project.name,
  workspace: project.path,
  prompt: "Hoàn thiện chat có hàng chờ",
  state: "interrupted",
  summary: "",
  partialText:
    "Đã nhận yêu cầu. Tôi đang tổ chức các bước cập nhật giao diện.\n\n- Giữ bản nháp theo hội thoại.\n- Hiển thị yêu cầu chờ và cho phép sửa trước khi chạy.",
  error: "Lượt chạy bị gián đoạn. Kiểm tra workspace trước khi thử lại.",
  settings,
  createdAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
};
store.createRun(run);
store.queue.add({
  projectId: project.id,
  conversationId: chat.id,
  prompt: "Thêm trạng thái hàng chờ trong chat",
  role: "be",
  mode: "direct",
  settings,
  afterRunId: run.id,
  state: "held",
  reason: "Lượt trước bị gián đoạn. Chọn Chạy tiếp để tiếp tục.",
});
store.close();
BrowserWindow.prototype.show = function () {};
require("../out/main/main.js");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    const value = await fn();
    if (value) return value;
    await pause(100);
  }
  throw new Error("UI timeout");
}
app.whenReady().then(async () => {
  try {
    const win = await until(() => BrowserWindow.getAllWindows()[0]);
    win.webContents.setBackgroundThrottling(false);
    await until(() => !win.webContents.isLoading());
    const js = (code) => win.webContents.executeJavaScript(code, true);
    await until(() => js(`!!document.querySelector('.follow-up-card')`));
    const click = (label) =>
      js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`,
      );
    const edit = (selector, text) =>
      js(
        `(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    assert.equal(await js(`!!window.worker&&!window.require`), true);
    assert.equal(
      await js(
        `document.querySelector('.chat-message.assistant').textContent.includes('bị gián đoạn')`,
      ),
      true,
    );
    assert.equal(
      await js(
        `!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Thử lại · lượt mới')`,
      ),
      true,
    );
    await click("Sửa");
    await edit(
      'textarea[aria-label="Sửa yêu cầu chờ"]',
      "Yêu cầu đã sửa trước khi chạy",
    );
    await click("Lưu");
    await until(() =>
      js(
        `document.querySelector('.follow-up-card p')?.textContent==='Yêu cầu đã sửa trước khi chạy'`,
      ),
    );
    await edit(
      'textarea[aria-label="Nhắn tin cho agent"]',
      "Yêu cầu tiếp theo bằng Enter",
    );
    await js(
      `document.querySelector('textarea[aria-label="Nhắn tin cho agent"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true}))`,
    );
    await until(() =>
      js(`document.querySelectorAll('.follow-up-card').length===2`),
    );
    assert.equal(
      await js(
        `document.querySelector('textarea[aria-label="Nhắn tin cho agent"]').value`,
      ),
      "",
    );
    await edit('textarea[aria-label="Nhắn tin cho agent"]', "Bản nháp vẫn còn");
    await pause(900);
    assert.equal(
      await js(
        `document.querySelector('textarea[aria-label="Nhắn tin cho agent"]').value`,
      ),
      "Bản nháp vẫn còn",
    );
    const target = resolve(__dirname, "../../../docs/windows-worker/ww4b");
    mkdirSync(target, { recursive: true });
    await until(() =>
      js(
        `document.querySelector('.chat-title')?.textContent.includes('Hoàn thiện chat') && document.querySelectorAll('.follow-up-card').length===2 && document.querySelector('textarea[aria-label="Nhắn tin cho agent"]').value==='Bản nháp vẫn còn'`,
      ),
    );
    win.setSize(1280, 860);
    await pause(500);
    await js(
      `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
    );
    writeFileSync(
      join(target, "chat-queue.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    win.setSize(850, 700);
    await pause(400);
    assert.equal(
      await js(`document.documentElement.scrollWidth<=window.innerWidth`),
      true,
    );
    assert.ok(
      await js(
        `document.querySelector('textarea[aria-label="Nhắn tin cho agent"]').getBoundingClientRect().bottom<window.innerHeight`,
      ),
    );
    writeFileSync(
      join(target, "chat-small.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await click("Xóa");
    await until(() =>
      js(`document.querySelectorAll('.follow-up-card').length===1`),
    );
    const result = {
      passed: true,
      fixture: true,
      checks: [
        "Built renderer/preload/main with real SQLite IPC",
        "Interrupted partial reply and retry action visible",
        "Edit and remove queued request",
        "Enter enqueues without starting held work",
        "Composer draft survives queue polling",
        "No overflow at 850x700; composer visible",
        "No Node integration",
      ],
    };
    writeFileSync(
      join(target, "ui-acceptance.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
    app.quit();
  } catch (error) {
    console.error(error.stack);
    app.exit(1);
  }
});
