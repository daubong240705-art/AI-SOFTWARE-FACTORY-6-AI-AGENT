// Built Electron UI and real IPC/SQLite. Isolated fixtures; no provider calls.
const { app, BrowserWindow } = require("electron");
const { join, resolve } = require("node:path");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "board-ui-"));
app.setPath("userData", directory);
const store = new Store(directory),
  project = store.addProject(resolve(__dirname, ".."));
const settings = defaultSettings();
settings.gatewayUrl = "https://unused.example/v1";
settings.agents.forEach((a) => {
  a.model = "ds/deepseek-v4-flash";
});
store.save(settings, undefined);
const conversation = store.conversations.create(project.id);
const base = require("../../../docs/windows-worker/ww3-live.json").run;
function history(title, state, verified = false) {
  const run = {
    ...base,
    id: crypto.randomUUID(),
    projectId: project.id,
    projectName: project.name,
    workspace: project.path,
    conversationId: conversation.id,
    prompt: title,
    settings,
    state,
    permissions: [],
    currentTaskId: null,
    error: state === "failed" ? "TEST cần xử lý" : "",
    summary: "Fixture UI",
    integration: undefined,
    createdAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    tasks: [
      {
        id: "t1",
        originalTaskId: "t1",
        role: "be",
        title,
        instructions: "Fixture",
        allowedPaths: ["src"],
        acceptance: ["Đúng yêu cầu"],
        dependsOn: [],
        state: "completed",
        model: "ds/deepseek-v4-flash",
        kind: "work",
        round: 0,
        sessionId: null,
        startedAt: null,
        endedAt: new Date().toISOString(),
        summary: "Fixture",
        error: "",
        changes: [],
        commandIds: [],
      },
    ],
    review: verified
      ? {
          version: 2,
          status: "completed",
          summary: "Fixture verified",
          acceptance: [
            {
              criterionId: "t1:ac1",
              criterion: "Đúng yêu cầu",
              status: "passed",
              evidence: "Fixture only",
              method: "source",
              refs: [],
            },
          ],
          fixes: [],
          limitations: [],
          verification: { verified: true, issues: [] },
        }
      : null,
  };
  store.createRun(run);
  store.updateRun(run);
}
history("Kết nối trạng thái agent", "completed", true);
history("Rà soát giao diện", "completed");
history("Sửa lỗi kiểm thử", "failed");
history("Việc đã dừng", "cancelled");
const create = (title, planningState) =>
  store.board.create({
    projectId: project.id,
    title,
    body: "Yêu cầu fixture",
    suggestedRole: "fe",
    priority: 0,
    planningState,
  });
const a = create("Thiết kế màn công việc", "backlog"),
  b = create("Hoàn thiện bộ lọc", "ready");
// A held queue ensures submitting through the actual UI never starts a model.
store.queue.add({
  conversationId: conversation.id,
  projectId: project.id,
  prompt: "Giữ hàng chờ nghiệm thu",
  role: "lead",
  mode: "team",
  settings,
  afterRunId: null,
  state: "held",
  reason: "Fixture giữ hàng chờ",
});
store.close();
const output = resolve(__dirname, "../../../docs/windows-worker/v1.3");
mkdirSync(output, { recursive: true });
BrowserWindow.prototype.show = function () {};
require("../out/main/main.js");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    const r = await fn();
    if (r) return r;
    await pause(100);
  }
  throw new Error("Timed out waiting for board UI");
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
    await js(
      "document.querySelector('nav button[title=\"Công việc\"]').click()",
    );
    await until(() =>
      js("document.querySelectorAll('.kanban-column').length===6"),
    );
    assert.equal(
      await js("document.querySelectorAll('.done .board-task').length"),
      1,
    );
    assert.equal(
      await js("document.querySelectorAll('.review .board-task').length"),
      1,
    );
    assert.equal(
      await js("document.querySelectorAll('.blocked .board-task').length"),
      1,
    );
    // Native drag/drop with the app's MIME type; persist and refresh from real IPC.
    await js(
      `(()=>{const source=Array.from(document.querySelectorAll('.board-task')).find(el=>el.textContent.includes('Thiết kế màn công việc'));const data=new DataTransfer();source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));document.querySelector('.kanban-column.ready').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}));})()`,
    );
    await until(() =>
      js("document.querySelectorAll('.ready .board-task').length===2"),
    );
    const moved = await js(`window.worker.boardItem(${JSON.stringify(a.id)})`);
    assert.equal(moved.value.planningState, "ready");
    const invalid = await js(
      `window.worker.moveBoardItem({id:${JSON.stringify(b.id)},version:1,planningState:'done'})`,
    );
    assert.equal(invalid.ok, false);
    await js(
      "Array.from(document.querySelectorAll('.kanban-workspace .page-heading button')).find(b=>b.textContent==='Thêm việc').click()",
    );
    await until(() => js("document.querySelector('dialog')?.open"));
    const setInput = (selector, value, tag = "HTMLInputElement") =>
      js(
        `(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${tag}.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    await setInput('[aria-label="Tiêu đề công việc"]', "Thẻ tạo từ UI");
    await setInput(
      '[aria-label="Yêu cầu công việc"]',
      "Giữ nội dung tiếng Việt",
      "HTMLTextAreaElement",
    );
    await js("document.querySelector('.board-editor form').requestSubmit()");
    await until(() =>
      js(
        "!document.querySelector('dialog').open && document.querySelector('.backlog')?.textContent.includes('Thẻ tạo từ UI')",
      ),
    );
    await js(
      "Array.from(document.querySelectorAll('.backlog .board-card-title')).find(b=>b.textContent==='Thẻ tạo từ UI').click()",
    );
    await until(() => js("!!document.querySelector('.board-details')"));
    await js(
      "Array.from(document.querySelectorAll('.board-details button')).find(b=>b.textContent==='Lưu trữ thẻ').click()",
    );
    await until(() =>
      js(
        "!document.querySelector('.backlog').textContent.includes('Thẻ tạo từ UI')",
      ),
    );
    await js(
      "Array.from(document.querySelectorAll('.board-filters label')).find(el=>el.textContent.trim()==='Lưu trữ').querySelector('input').click()",
    );
    await until(() =>
      js("document.querySelectorAll('.board-task').length===1"),
    );
    await js("document.querySelector('.board-card-title').click()");
    await js(
      "Array.from(document.querySelectorAll('.board-details button')).find(b=>b.textContent==='Khôi phục thẻ').click()",
    );
    await until(() =>
      js("document.querySelectorAll('.board-task').length===0"),
    );
    await js(
      "Array.from(document.querySelectorAll('.board-filters label')).find(el=>el.textContent.trim()==='Lưu trữ').querySelector('input').click()",
    );
    await until(() =>
      js("document.querySelectorAll('.board-task').length===6"),
    );
    const current = await js(
      `window.worker.boardItem(${JSON.stringify(b.id)})`,
    );
    const submitted = await js(
      `Promise.all([window.worker.submitBoardItem({id:${JSON.stringify(b.id)},version:${current.value.version}}),window.worker.submitBoardItem({id:${JSON.stringify(b.id)},version:${current.value.version}})])`,
    );
    assert.equal(submitted[0].ok, true);
    assert.equal(submitted[1].ok, true);
    assert.equal(submitted[0].value.followUpId, submitted[1].value.followUpId);
    assert.equal(submitted[0].value.queued, true);
    await until(() =>
      js(
        "document.querySelector('.blocked').textContent.includes('Hoàn thiện bộ lọc')",
      ),
    );
    const editLinked = await js(
      `window.worker.updateBoardItem({id:${JSON.stringify(b.id)},version:${current.value.version + 1},patch:{title:'forged'}})`,
    );
    assert.equal(editLinked.ok, false);
    win.setSize(1920, 960);
    await pause(300);
    writeFileSync(
      join(output, "kanban-desktop.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await setInput('[aria-label="Tìm công việc"]', "ra soat giao dien");
    await until(() =>
      js("document.querySelectorAll('.board-task').length===1"),
    );
    await setInput('[aria-label="Tìm công việc"]', "");
    await until(() =>
      js("document.querySelectorAll('.board-task').length===6"),
    );
    win.setSize(850, 700);
    await pause(300);
    assert.equal(
      await js("document.documentElement.scrollWidth <= innerWidth"),
      true,
    );
    assert.equal(
      await js(
        "document.querySelector('.kanban-columns').scrollWidth > document.querySelector('.kanban-columns').clientWidth",
      ),
      true,
    );
    writeFileSync(
      join(output, "kanban-small.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js("document.querySelector('.review .board-card-title').click()");
    await js(
      "Array.from(document.querySelectorAll('.board-details button')).find(b=>b.textContent==='Mở kết quả / task').click()",
    );
    await until(() => js("!!document.querySelector('.chat-detail-panel')"));
    assert.deepEqual(errors, []);
    const result = {
      passed: true,
      fixture: true,
      providerCalls: 0,
      checks: [
        "Built Electron, real isolated SQLite and strict IPC",
        "Six columns distinguish verified/unverified/stopped results",
        "Native drag persists planning state; IPC rejects Done mutation",
        "Create, archive and restore via UI",
        "Lead submission queue/idempotency; linked card mutation denied",
        "Vietnamese search and pagination projection",
        "Horizontal scrolling stays within board at small width",
        "Open existing run/task results from a card",
      ],
      rendererErrors: errors,
    };
    writeFileSync(
      join(output, "v1.3b-ui.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
    app.quit();
  } catch (error) {
    console.error(error.stack);
    app.exit(1);
  }
});
