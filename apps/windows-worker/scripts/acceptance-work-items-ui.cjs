// UX-02: built renderer, real IPC/SQLite and isolated fixtures; no model calls.
const { app, BrowserWindow, dialog } = require("electron");
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
const Database = require("better-sqlite3");
const { stripWorkSchema } = require("../tests/legacy-board-fixture.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "work-items-ui-"));
const data = join(directory, "data"),
  output = join(directory, "screenshots");
mkdirSync(output);
app.setPath("userData", data);
BrowserWindow.prototype.show = function () {};
dialog.showSaveDialog = async () => ({
  canceled: false,
  filePath: join(directory, "work-item.json"),
});
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
  const store = new Store(data),
    project = store.addProject(directory);
  const settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.forEach((a) => (a.model = "fixture-model"));
  store.save(settings, undefined);
  const chat = store.conversations.create(project.id);
  store.queue.add({
    projectId: project.id,
    conversationId: chat.id,
    prompt: "Keep submissions held",
    role: "lead",
    mode: "team",
    settings,
    afterRunId: null,
    state: "held",
    reason: "Fixture",
  });
  const item = store.board.create({
    projectId: project.id,
    title: "Hồ sơ UX-02",
    body: "Yêu cầu ban đầu",
    criteria: ["Giữ lịch sử"],
    suggestedRole: null,
    priority: 0,
    planningState: "ready",
  });
  for (let i = 0; i < 18; i++)
    store.board.create({
      projectId: project.id,
      title: `Việc phụ ${i}`,
      body: "",
      suggestedRole: null,
      priority: 0,
      planningState: "ready",
    });
  const base = require("../../../docs/windows-worker/ww3-live.json").run;
  const run = {
    ...base,
    id: crypto.randomUUID(),
    projectId: project.id,
    projectName: project.name,
    workspace: directory,
    conversationId: chat.id,
    prompt: "Legacy runtime",
    settings,
    state: "completed",
    tasks: [],
    profiles: [],
    permissions: [],
    changes: [],
    commands: [],
    review: null,
    error: "",
    summary: "Fixture",
    retryOf: undefined,
    attemptRoot: undefined,
    recoveryOf: undefined,
    integration: undefined,
    createdAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    currentTaskId: null,
  };
  store.createRun(run);
  store.updateRun(run);
  store.close();
  const legacyDB = new Database(join(data, "worker.sqlite"));
  stripWorkSchema(legacyDB);
  legacyDB.pragma("user_version=7");
  legacyDB.close();
  require("../out/main/main.js");
  win = await until(() => BrowserWindow.getAllWindows()[0]);
  win.webContents.setBackgroundThrottling(false);
  await until(() => !win.webContents.isLoading());
  const errors = [];
  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 3) errors.push(message);
  });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const click = (label, scope = "document") =>
    js(
      `Array.from(${scope}.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  const setInput = (selector, text, tag = "HTMLInputElement") =>
    js(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${tag}.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  const ref = JSON.stringify({ projectId: project.id, itemId: item.id });
  const migrationBackup = new Database(
    join(data, "worker.schema7.pre-work-items.backup.sqlite"),
    { readonly: true },
  );
  assert.equal(migrationBackup.pragma("user_version", { simple: true }), 7);
  migrationBackup.close();
  await until(() =>
    js("!!document.querySelector('.workspace-project > button')"),
  );
  await until(() =>
    js("!!document.querySelector('.project-overview .attention-list')"),
  );
  await click(
    "Công việc",
    "document.querySelector('nav[aria-label=\"Điều hướng chính\"]')",
  );
  await until(() =>
    js("document.querySelectorAll('.kanban-column').length===6"),
  );
  const total = await js("document.querySelectorAll('.board-task').length");
  assert.equal(total, 20);
  await click("Danh sách");
  assert.equal(
    await js("document.querySelectorAll('.work-list tbody tr').length"),
    total,
  );
  await click("Board", "document.querySelector('.work-view-switch')");
  // Planning drag uses the actual DOM handler; runtime mutation remains denied by IPC.
  await js(
    `(()=>{const source=Array.from(document.querySelectorAll('.board-task')).find(el=>el.textContent.includes('Việc phụ 0'));const data=new DataTransfer();source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));document.querySelector('.kanban-column.backlog').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}));})()`,
  );
  await until(() =>
    js("document.querySelector('.backlog').textContent.includes('Việc phụ 0')"),
  );
  const invalid = await js(
    `window.worker.moveBoardItem({id:${JSON.stringify(item.id)},version:1,planningState:'done'})`,
  );
  assert.equal(invalid.ok, false);
  await click("Thêm việc", "document.querySelector('.page-heading')");
  await until(() => js("document.querySelector('.board-editor')?.open"));
  await setInput('[aria-label="Tiêu đề công việc"]', "Việc tạo từ UI");
  await setInput(
    '[aria-label="Tiêu chí hoàn thành"]',
    "Tiêu chí thứ nhất\nTiêu chí thứ hai",
    "HTMLTextAreaElement",
  );
  await js("document.querySelector('.board-editor form').requestSubmit()");
  await until(() =>
    js(
      "!document.querySelector('.board-editor').open && document.querySelector('.backlog').textContent.includes('Việc tạo từ UI')",
    ),
  );
  await js(
    "Array.from(document.querySelectorAll('.board-card-title')).find(b=>b.textContent.includes('Việc tạo từ UI')).click()",
  );
  await until(() =>
    js(
      "document.querySelector('.work-panel-header h2')?.textContent==='Việc tạo từ UI'",
    ),
  );
  assert.ok(
    await js(
      "document.querySelector('.work-panel-content').textContent.includes('Tiêu chí thứ hai')",
    ),
  );
  await click("Lưu trữ", "document.querySelector('.work-item-panel')");
  await until(() =>
    js(
      "Array.from(document.querySelectorAll('.work-item-panel button')).some(b=>b.textContent==='Khôi phục')",
    ),
  );
  await click("Đóng", "document.querySelector('.work-item-panel')");
  await click("Bộ lọc", "document.querySelector('.board-filters')");
  await js(
    "Array.from(document.querySelectorAll('.board-filters label')).find(l=>l.textContent.trim()==='Lưu trữ').querySelector('input').click()",
  );
  await until(() => js("document.querySelectorAll('.board-task').length===1"));
  await js("document.querySelector('.board-card-title').click()");
  await until(() =>
    js(
      "document.querySelector('.work-panel-header h2')?.textContent==='Việc tạo từ UI'",
    ),
  );
  await click("Khôi phục", "document.querySelector('.work-item-panel')");
  await until(() =>
    js(
      "Array.from(document.querySelectorAll('.work-item-panel button')).some(b=>b.textContent==='Lưu trữ')",
    ),
  );
  await click("Đóng", "document.querySelector('.work-item-panel')");
  await js(
    "Array.from(document.querySelectorAll('.board-filters label')).find(l=>l.textContent.trim()==='Lưu trữ').querySelector('input').click()",
  );
  await until(() => js("document.querySelectorAll('.board-task').length===21"));
  await click("Bộ lọc", "document.querySelector('.board-filters')");
  await js(
    "document.querySelector('.kanban-column.ready').scrollTop=150;document.querySelector('.kanban-columns').scrollLeft=100",
  );
  const scroll = await js(
    "({y:document.querySelector('.kanban-column.ready').scrollTop,x:document.querySelector('.kanban-columns').scrollLeft})",
  );
  await js(
    "(()=>{const b=Array.from(document.querySelectorAll('.board-card-title')).find(b=>b.textContent.includes('Hồ sơ UX-02'));b.focus({preventScroll:true});b.click();})()",
  );
  await until(() =>
    js(
      "document.querySelector('.work-item-panel')?.open && document.querySelector('.work-panel-header h2').textContent==='Hồ sơ UX-02'",
    ),
  );
  await click("Trao đổi", "document.querySelector('.work-panel-tabs')");
  await setInput(
    ".work-item-panel textarea",
    "Ghi chú tiếng Việt",
    "HTMLTextAreaElement",
  );
  await js(
    "document.querySelector('.work-item-panel form').requestSubmit();document.querySelector('.work-item-panel form').requestSubmit()",
  );
  await until(() =>
    js("document.querySelectorAll('.work-comment').length===1"),
  );
  assert.equal(
    (await js(`window.worker.workItemDetail(${ref})`)).value.comments.length,
    1,
  );
  await click("Tổng quan", "document.querySelector('.work-panel-tabs')");
  await click("Sửa yêu cầu", "document.querySelector('.work-item-panel')");
  await setInput(
    ".work-item-form textarea",
    "Yêu cầu đã sửa",
    "HTMLTextAreaElement",
  );
  // A concurrent edit forces optimistic conflict without discarding the local draft.
  await js(
    `(async()=>{const r=await window.worker.boardItem(${JSON.stringify(item.id)});return window.worker.updateBoardItem({id:r.value.id,version:r.value.version,patch:{title:'Hồ sơ cập nhật ngoài'}});})()`,
  );
  await click("Lưu phiên bản", "document.querySelector('.work-item-panel')");
  await until(() =>
    js(
      "document.querySelector('.work-item-panel [role=alert]')?.textContent.includes('đã thay đổi')",
    ),
  );
  assert.equal(
    await js("document.querySelector('.work-item-form textarea').value"),
    "Yêu cầu đã sửa",
  );
  await click("Tải lại dữ liệu", "document.querySelector('.work-item-panel')");
  await until(() =>
    js(
      "document.querySelector('.work-panel-header h2').textContent==='Hồ sơ cập nhật ngoài'",
    ),
  );
  await js(
    "Array.from(document.querySelectorAll('.work-item-panel button')).find(b=>b.textContent.startsWith('Dùng bản nháp')).click()",
  );
  await click("Lưu phiên bản", "document.querySelector('.work-item-panel')");
  await until(() =>
    js(
      "!document.querySelector('.work-item-form') && document.querySelector('.work-panel-header small').textContent.includes('v3')",
    ),
  );
  await click("Gửi Lead", "document.querySelector('.work-item-panel')");
  await until(async () => {
    const r = await js(`window.worker.workItemDetail(${ref})`);
    return r.value.submissions.length === 1;
  });
  await click("Lần thực hiện", "document.querySelector('.work-panel-tabs')");
  await until(() =>
    js(
      "document.querySelector('.work-submission')?.textContent.includes('Trong hàng chờ')",
    ),
  );
  await click("Tổng quan", "document.querySelector('.work-panel-tabs')");
  await click("Sửa yêu cầu", "document.querySelector('.work-item-panel')");
  await setInput(
    ".work-item-form textarea",
    "Yêu cầu v4 khác snapshot đã gửi",
    "HTMLTextAreaElement",
  );
  await click("Lưu phiên bản", "document.querySelector('.work-item-panel')");
  await until(() =>
    js(
      "!document.querySelector('.work-item-form') && document.querySelector('.work-panel-header small').textContent.includes('v4')",
    ),
  );
  const saved = (await js(`window.worker.workItemDetail(${ref})`)).value;
  assert.equal(saved.submissions[0].revision, 3);
  assert.equal(
    saved.revisions.find((r) => r.revision === 3).body,
    "Yêu cầu đã sửa",
  );
  await click("Xuất hồ sơ", "document.querySelector('.work-item-panel')");
  await until(() => {
    try {
      return !!JSON.parse(
        readFileSync(join(directory, "work-item.json"), "utf8"),
      );
    } catch {
      return false;
    }
  });
  const exported = JSON.parse(
    readFileSync(join(directory, "work-item.json"), "utf8"),
  );
  assert.equal(exported.item.code, item.code);
  assert.equal(exported.comments.length, 1);
  await click("Mở rộng", "document.querySelector('.work-item-panel')");
  const layouts = [];
  for (const [width, height, zoom] of [
    [1366, 768, 1],
    [850, 700, 1],
    [1366, 768, 1.25],
    [1366, 768, 1.5],
  ]) {
    win.setSize(width, height);
    win.webContents.setZoomFactor(zoom);
    await pause(180);
    const layout = await js(
      `(()=>{const d=document.querySelector('.work-item-panel'),r=d.getBoundingClientRect(),c=document.querySelector('.work-panel-content');return {width:innerWidth,height:innerHeight,left:r.left,top:r.top,right:r.right,bottom:r.bottom,overflow:c.scrollWidth>c.clientWidth+2};})()`,
    );
    assert.ok(
      layout.left >= 0 &&
        layout.top >= 0 &&
        layout.right <= layout.width + 1 &&
        layout.bottom <= layout.height + 1,
      JSON.stringify(layout),
    );
    assert.equal(layout.overflow, false);
    layouts.push({ width, height, zoom, ...layout });
    writeFileSync(
      join(output, `${width}-${zoom}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
  }
  win.setSize(1366, 768);
  win.webContents.setZoomFactor(1);
  await pause(200);
  await click("Đóng", "document.querySelector('.work-item-panel')");
  await until(() => js("!document.querySelector('.work-item-panel')"));
  assert.equal(
    await js("document.activeElement?.className"),
    "board-card-title",
  );
  const restored = await js(
    "({y:document.querySelector('.kanban-column.ready').scrollTop,x:document.querySelector('.kanban-columns').scrollLeft})",
  );
  assert.equal(restored.x, scroll.x);
  assert.equal(restored.y, scroll.y);
  // Reopen after card moved to the queue; persisted discussion and history remain available.
  await setInput('[aria-label="Tìm công việc"]', "W-0001");
  await until(() => js("document.querySelectorAll('.board-task').length===1"));
  await js("document.querySelector('.board-card-title').click()");
  await until(() =>
    js(
      "document.querySelector('.work-panel-header small')?.textContent.includes('v4')",
    ),
  );
  await click("Trao đổi", "document.querySelector('.work-panel-tabs')");
  assert.equal(
    await js("document.querySelectorAll('.work-comment').length"),
    1,
  );
  await click("Đóng", "document.querySelector('.work-item-panel')");
  assert.equal(
    await js("document.querySelector('[aria-label=\"Tìm công việc\"]').value"),
    "W-0001",
  );
  await setInput('[aria-label="Tìm công việc"]', "Legacy runtime");
  await until(() => js("document.querySelectorAll('.board-task').length===1"));
  await js("document.querySelector('.board-card-title').click()");
  await click(
    "Lưu thành công việc",
    "document.querySelector('.board-details')",
  );
  await until(() =>
    js(
      "document.querySelector('.work-panel-header h2')?.textContent==='Legacy runtime'",
    ),
  );
  await click("Lần thực hiện", "document.querySelector('.work-panel-tabs')");
  await click("Báo cáo", "document.querySelector('.work-item-panel')");
  await until(() =>
    js("!!document.querySelector('.work-inline-report .report-heading')"),
  );
  assert.ok(
    await js(
      "document.querySelector('.work-item-panel').textContent.includes('Legacy runtime')",
    ),
  );
  const reopened = new Store(data);
  assert.equal(
    reopened.board.detail({ projectId: project.id, itemId: item.id }).comments
      .length,
    1,
  );
  reopened.close();
  assert.deepEqual(errors, []);
  writeFileSync(
    join(directory, "acceptance.json"),
    JSON.stringify(
      { passed: true, providerCalls: 0, layouts, errors },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      directory,
      layouts: layouts.length,
      errors,
    }),
  );
  app.quit();
}
main().catch(async (error) => {
  console.error(error.stack);
  try {
    if (win)
      writeFileSync(
        join(output, "failure.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
  } catch {}
  app.exit(1);
});
