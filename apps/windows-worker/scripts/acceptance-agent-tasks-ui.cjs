// Real Electron/IPC/SQLite, isolated failed-run history, no provider calls.
const { app, BrowserWindow } = require("electron");
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
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "agent-tasks-ui-"));
const data = join(directory, "data");
app.setPath("userData", data);
BrowserWindow.prototype.show = function () {};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label = "UI") {
  for (let i = 0; i < 120; i++) {
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
  settings.agents.forEach((agent) => (agent.model = "fixture-model"));
  store.save(settings, undefined);
  const item = store.board.create({
    projectId: project.id,
    title: "Mini Notes · phân công rõ ràng",
    body: "CRUD ghi chú, tìm kiếm và lưu dữ liệu.",
    criteria: ["Dữ liệu tồn tại khi mở lại"],
    suggestedRole: null,
    priority: 0,
    planningState: "ready",
  });
  const context = store.board.workChat({
    projectId: project.id,
    itemId: item.id,
  });
  const base = require("../../../docs/windows-worker/ww3-live.json").run;
  const at = new Date().toISOString();
  const makeTask = (id, role, title, state, dependsOn = [], summary = "") => ({
    id,
    role,
    title,
    state,
    dependsOn,
    summary,
    instructions: `## Mục tiêu\n${title}\n\n## Đầu ra\nContract và hành vi cụ thể\n\n## Kiểm tra\nXác minh tiêu chí sau khi làm xong`,
    allowedPaths: [role === "fe" ? "web" : "api"],
    acceptance: ["Không mất dữ liệu khi reload", "Xử lý dữ liệu lỗi an toàn"],
    model: "fixture-model",
    kind: "work",
    round: 0,
    sessionId: null,
    startedAt: at,
    endedAt: state === "queued" ? null : at,
    error: state === "failed" ? "Gateway ngừng gửi dữ liệu" : "",
    changes: [],
    commandIds: [],
  });
  const design =
    "## Mô hình dữ liệu\n\n| Field | Type | Ràng buộc |\n| --- | --- | --- |\n| id | string | Duy nhất |\n| title | string | Không rỗng |\n| updatedAt | number | Epoch ms |\n\n" +
    "Dữ liệu được lưu an toàn.\n".repeat(90) +
    "\nAC14: không mất dữ liệu sau reload";
  const tasks = [
    makeTask(
      "t1",
      "ba",
      "Phân tích và thiết kế Note",
      "completed",
      [],
      `Trạng thái: done\nKết quả: ${design}\nBlocker: —\nChưa xác minh: —`,
    ),
    makeTask("t2", "be", "Cài đặt API Note", "failed", ["t1"]),
    makeTask("t3", "fe", "Giao diện ghi chú", "skipped", ["t1"]),
    makeTask("t4", "test", "Kiểm thử CRUD", "skipped", ["t2", "t3"]),
  ];
  const run = {
    ...base,
    id: crypto.randomUUID(),
    projectId: project.id,
    projectName: project.name,
    workspace: directory,
    conversationId: context.conversationId,
    settings,
    mode: "team",
    role: "lead",
    prompt: item.body,
    state: "failed",
    tasks,
    profiles: [],
    permissions: [],
    changes: [],
    commands: [],
    review: null,
    currentTaskId: null,
    summary: "FE/BE chưa hoàn thành",
    error: "Gateway ngừng gửi dữ liệu",
    createdAt: at,
    startedAt: at,
    endedAt: at,
    retryOf: undefined,
    attemptRoot: undefined,
    recoveryOf: undefined,
    integration: undefined,
    workContext: store.board.chatSnapshot(
      project.id,
      item.id,
      1,
      context.conversationId,
    ),
  };
  store.createRun(run);
  store.board.attachChat(crypto.randomUUID(), run.workContext, {
    runId: run.id,
    followUpId: null,
  });
  store.updateRun(run);
  store.close();
  require("../out/main/main.js");
  await until(() => (win = BrowserWindow.getAllWindows()[0]));
  win.webContents.setBackgroundThrottling(false);
  const errors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  const js = (code) =>
    win.webContents.executeJavaScript(code, true).catch((error) => {
      console.error("Renderer expression:", code, "Errors:", errors);
      throw error;
    });
  const click = (label, scope = "document") =>
    js(
      `Array.from(${scope}.querySelectorAll('button')).find(b=>b.getClientRects().length && b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  const tab = (label) =>
    click(label, "document.querySelector('.work-panel-tabs')");
  await until(() => js("!!document.querySelector('.workspace-home')"));
  await until(
    () =>
      js(
        `!!document.querySelector('[data-project-id="${project.id}"]:not(:disabled)')`,
      ),
    "Project ready",
  );
  await js(
    `document.querySelector('[data-project-id="${project.id}"]').click()`,
  );
  await until(
    () => js("document.querySelectorAll('.board-agent-tasks li').length===4"),
    "Per-agent board tasks",
  );
  assert.match(
    await js("document.querySelector('.board-agent-tasks').textContent"),
    /BA · t1.*BE · t2.*FE · t3.*TEST · t4/s,
  );
  await click("Danh sách");
  await until(() =>
    js(
      "document.querySelectorAll('.work-list .board-agent-tasks li').length===4",
    ),
  );
  await js(
    "document.querySelector('.board-agent-tasks li:nth-child(2) button').click()",
  );
  await until(() => js("!!document.querySelector('.task-inspector')"));
  assert.match(
    await js("document.querySelector('.task-inspector').textContent"),
    /Cài đặt API Note/,
  );
  await click("Đóng", "document.querySelector('.task-inspector')");
  await until(() => js("!document.querySelector('.task-inspector')"));
  await js("document.querySelector('.board-card-title').click()");
  await until(() => js("!!document.querySelector('.work-item-panel')"));
  await tab("Yêu cầu");
  await until(() =>
    js("document.querySelectorAll('.work-agent-details details').length===4"),
  );
  await js(
    "document.querySelector('.work-agent-details details:nth-of-type(3)').open=true",
  );
  assert.match(
    await js("document.querySelector('.work-agent-details').textContent"),
    /Giao diện ghi chú.*Tiêu chí hoàn thành.*Phụ thuộc: BA/s,
  );
  await tab("Tài liệu BA");
  await until(() =>
    js(
      "document.querySelector('[aria-label=\"Tài liệu phân tích BA\"]')?.textContent.includes('AC14:')",
    ),
  );
  assert.equal(
    await js("document.querySelectorAll('.work-agent-details table').length"),
    1,
  );
  const download = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Document download timeout")),
      10000,
    );
    win.webContents.session.once("will-download", (_event, item) => {
      const target = join(directory, "BA-design.md");
      item.setSavePath(target);
      item.once("done", (_e, state) => {
        clearTimeout(timer);
        state === "completed" ? resolve(target) : reject(new Error(state));
      });
    });
  });
  await click("Tải tài liệu .md");
  const target = await download;
  assert.match(
    readFileSync(target, "utf8"),
    /AC14: không mất dữ liệu sau reload/,
  );
  const layouts = [];
  for (const [width, height, zoom] of [
    [1366, 768, 1],
    [850, 700, 1],
    [1366, 768, 1.5],
  ]) {
    win.setSize(width, height);
    win.webContents.setZoomFactor(zoom);
    await pause(250);
    const layout = await js(
      "(()=>{const el=document.querySelector('.workspace-detail-host'),r=el.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:el.scrollWidth>el.clientWidth+2}})()",
    );
    assert.ok(
      layout.left >= 0 &&
        layout.right <= layout.width + 1 &&
        layout.bottom <= layout.height + 1,
      JSON.stringify(layout),
    );
    assert.equal(layout.overflow, false);
    layouts.push({ width, height, zoom });
    writeFileSync(
      join(directory, `documents-${width}-${zoom}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
  }
  assert.deepEqual(errors, []);
  const result = { passed: true, directory, layouts, providerCalls: 0, errors };
  writeFileSync(
    join(directory, "acceptance.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  app.quit();
}
main().catch(async (error) => {
  console.error(error.stack);
  if (win)
    writeFileSync(
      join(directory, "failure.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
  app.exit(1);
});
