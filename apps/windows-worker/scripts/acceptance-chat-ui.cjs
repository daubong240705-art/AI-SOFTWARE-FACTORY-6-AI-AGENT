// UI acceptance against the built main/preload/renderer and real SQLite/IPC.
// Isolated app data; no provider calls, credentials or production DB changes.
const { app, BrowserWindow } = require("electron");
const { join, resolve } = require("node:path");
const { mkdtempSync, writeFileSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const directory = mkdtempSync(join(tmpdir(), "asf-ww4a-ui-"));
app.setPath("userData", directory);
const store = new Store(directory);
const project = store.addProject(resolve(__dirname, ".."));
const settings = defaultSettings();
settings.gatewayUrl = "https://unused.example/v1";
settings.agents = settings.agents.map((a) => ({
  ...a,
  model: "ds/deepseek-v4-flash",
}));
store.save(settings, undefined);
store.setModels(["ds/deepseek-v4-flash", "other-model"]);
const conversation = store.conversations.create(project.id);
const evidence = require("../../../docs/windows-worker/ww3-live.json").run;
const run = {
  ...evidence,
  id: crypto.randomUUID(),
  projectId: project.id,
  projectName: project.name,
  workspace: project.path,
  conversationId: conversation.id,
  prompt: "Hoàn thiện giao diện chat và hiển thị ngân sách request.",
  summary:
    "Đã hoàn thiện hiển thị request trong ứng dụng.\n\n- Dùng model theo từng vai trò.\n- Kiểm thử: `npm test` — **22/22 đạt**, exit 0.\n- Giữ nguyên giới hạn request toàn lượt chạy.\n\nBạn có thể nhắn tiếp để chỉnh sửa phần giao diện.\n\n```powershell\nnpm start\n```",
  createdAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
};
store.createRun(run);
store.updateRun(run);
store.close();
const screenshots = resolve(__dirname, "../../../docs/windows-worker/ww4a");
mkdirSync(screenshots, { recursive: true });
// Keep the acceptance window hidden; capturePage renders the actual UI.
BrowserWindow.prototype.show = function () {};
require("../out/main/main.js");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    const result = await fn();
    if (result) return result;
    await pause(100);
  }
  throw new Error("Timed out waiting for UI");
}
app.whenReady().then(async () => {
  try {
    const win = await until(() => BrowserWindow.getAllWindows()[0]);
    win.webContents.setBackgroundThrottling(false);
    await until(() => !win.webContents.isLoading());
    const js = (code) => win.webContents.executeJavaScript(code, true);
    await until(() =>
      js(`!!document.querySelector('.chat-message.assistant')`),
    );
    const rendererErrors = [];
    win.webContents.on("console-message", (_event, level, message) => {
      if (level >= 3) rendererErrors.push(message);
    });
    assert.equal(await js(`!!window.worker && !window.require`), true);
    const edit = async (text) =>
      js(
        `(()=>{const el=document.querySelector('textarea[aria-label="Nhắn tin cho agent"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    await edit("Bản nháp có dấu — giữ nguyên khi đổi phiên.");
    await until(() =>
      js(
        `window.worker.conversation(${JSON.stringify(conversation.id)}).then(r=>r.ok&&r.value.conversation.draft.includes('giữ nguyên'))`,
      ),
    );
    await js(`document.querySelector('.new-conversation').click()`);
    await until(() =>
      js(
        `!!document.querySelector('.chat-empty h1') && document.querySelector('textarea').value===''`,
      ),
    );
    await js(
      `Array.from(document.querySelectorAll('.conversation-list button')).find(b=>b.title.startsWith('Hoàn thiện')).click()`,
    );
    await until(() =>
      js(
        `document.querySelector('.chat-title')?.textContent.includes('Hoàn thiện') && !!document.querySelector('.chat-message.assistant') && document.querySelector('textarea').value.includes('giữ nguyên')`,
      ),
    );
    await js(`document.querySelector('[aria-label="Mở chi tiết"]').click()`);
    await until(() => js(`!!document.querySelector('.team-task')`));
    win.webContents.setBackgroundThrottling(false);
    await pause(500);
    assert.equal(
      await js(`!!document.querySelector('.chat-detail-panel .team-task')`),
      true,
    );
    assert.equal(
      await js(
        `document.querySelector('textarea').value.includes('giữ nguyên')`,
      ),
      true,
      "Panel polling must not reset drafts",
    );
    await js(
      `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
    );
    writeFileSync(
      join(screenshots, "chat-with-panel.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(
      `document.querySelector('[aria-label="Đóng panel chi tiết"]').click()`,
    );
    await pause(200);
    writeFileSync(
      join(screenshots, "chat-desktop.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    win.setSize(850, 700);
    await pause(300);
    assert.equal(
      await js(`document.documentElement.scrollWidth<=window.innerWidth`),
      true,
      "Small window must not overflow horizontally",
    );
    writeFileSync(
      join(screenshots, "chat-small.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(`document.querySelector('.chat-title').click()`);
    await js(
      `(()=>{const el=document.querySelector('input[aria-label="Tên cuộc trò chuyện"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Giao diện chat');el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await js(`document.querySelector('[aria-label="Lưu tên"]').click()`);
    await until(() =>
      js(
        `document.querySelector('.chat-title')?.textContent.includes('Giao diện chat')`,
      ),
    );
    const result = {
      passed: true,
      checks: [
        "Real built Electron main/preload/renderer and SQLite IPC",
        "Isolated data; no provider calls; explicit transcript fixture",
        "Per-conversation draft survives switching",
        "Panel changes/polling preserve unsent draft",
        "Conversation rename persists",
        "No horizontal overflow at 850x700",
        "Renderer has no Node integration",
      ],
      rendererErrors,
    };
    assert.deepEqual(rendererErrors, []);
    writeFileSync(
      join(screenshots, "ui-acceptance.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
    app.quit();
  } catch (error) {
    console.error(error.stack);
    app.exit(1);
  }
});
