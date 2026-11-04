// Layout regression through production Electron. Real isolated SQLite; no model requests.
const { app, BrowserWindow } = require("electron");
const { resolve, join } = require("node:path");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "ui-foundation-"));
app.setPath("userData", directory);
const output = resolve(__dirname, "../../../docs/windows-worker/ui-foundation");
mkdirSync(output, { recursive: true });
const store = new Store(directory),
  project = store.addProject(join(directory, "source")),
  settings = defaultSettings();
settings.gatewayUrl = "https://unused.example/v1";
settings.agents.forEach(
  (a) =>
    (a.model = "deepseek/flash-with-long-snapshot-model-name-for-layout-audit"),
);
store.save(settings, undefined);
const conversation = store.conversations.create(project.id),
  now = new Date().toISOString();
const longTitle =
  "Rà soát giao diện, căn chỉnh nội dung và dependency của từng agent khi có nhiều tác vụ cùng lúc";
const longPath =
  "src/features/very-long-component-name-without-spaces/".repeat(4) +
  "AcceptanceEvidence.tsx";
const table =
  "| Agent | Công việc | Workspace | Model | Trạng thái | Bằng chứng |\n|---|---|---|---|---|---|\n" +
  Array.from(
    { length: 24 },
    (_, i) =>
      `| BE ${i + 1} | ${longTitle} | ${longPath} | deepseek-flash | Chờ xác minh | Đọc bằng chứng trước khi hoàn thành |`,
  ).join("\n");
const run = {
  ...require("../../../docs/windows-worker/ww3-live.json").run,
  id: crypto.randomUUID(),
  projectId: project.id,
  projectName: project.name,
  workspace: project.path,
  conversationId: conversation.id,
  settings,
  prompt: longTitle,
  summary:
    "### Kết quả rà soát\n\n" +
    table +
    "\n\n```text\n" +
    "x".repeat(500) +
    "\n```",
  error: "",
  state: "completed",
  mode: "team",
  role: "lead",
  model: settings.agents[0].model,
  createdAt: now,
  startedAt: now,
  endedAt: now,
  permissions: [],
  currentTaskId: null,
  integration: undefined,
  review: null,
  commands: [],
  changes: [],
  tasks: [
    {
      id: "t1",
      role: "be",
      title: longTitle,
      instructions: "Đọc và sửa bố cục theo bộ nền chung.",
      allowedPaths: ["src/features"],
      acceptance: [
        "Các nội dung không chồng nhau",
        "Thông tin dài phải đọc được",
      ],
      dependsOn: [],
      state: "completed",
      model: settings.agents[0].model,
      kind: "work",
      round: 0,
      sessionId: null,
      startedAt: now,
      endedAt: now,
      summary: longTitle,
      error: "",
      changes: [{ path: longPath, kind: "modified" }],
      commandIds: [],
    },
  ],
};
store.createRun(run);
store.updateRun(run);
for (let i = 0; i < 15; i++)
  store.board.create({
    projectId: project.id,
    title: `${i + 1}. ${longTitle}`,
    body: "Nội dung thử bố cục",
    suggestedRole: "devops",
    priority: i % 3,
    planningState: "backlog",
  });
store.board.create({
  projectId: project.id,
  title: "Sẵn sàng",
  body: "Fixture",
  suggestedRole: "fe",
  priority: 0,
  planningState: "ready",
});
store.close();
BrowserWindow.prototype.show = function () {};
require("../out/main/main.js");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    const value = await fn();
    if (value) return value;
    await pause(100);
  }
  throw new Error("Timed out waiting for layout");
}
let win;
app.whenReady().then(async () => {
  try {
    win = await until(() => BrowserWindow.getAllWindows()[0]);
    win.webContents.setBackgroundThrottling(false);
    await until(() => !win.webContents.isLoading());
    const js = (code) =>
        win.webContents.executeJavaScript(code, true).catch((error) => {
          throw new Error(`${code}\n${error.message}`);
        }),
      errors = [],
      measurements = [];
    win.webContents.on("console-message", (_event, level, message) => {
      if (level >= 3) errors.push(message);
    });
    await until(() => js("!!document.querySelector('.chat-markdown table')"));
    const navigate = async (title) => {
      await js(
        `Array.from(document.querySelectorAll('.sidebar nav button')).find(b=>b.textContent.trim()===${JSON.stringify(title)}).click()`,
      );
      await pause(150);
    };
    const screenshot = async (name, selector) => {
      await until(() =>
        js(`!!document.querySelector(${JSON.stringify(selector)})`),
      );
      // Hidden Electron windows can return the previous composited frame after
      // navigation. Wait for two animation frames and a paint before capture.
      await js(
        "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
      );
      await pause(250);
      await win.webContents.capturePage();
      await pause(150);
      writeFileSync(
        join(output, name + ".png"),
        (await win.webContents.capturePage()).toPNG(),
      );
    };
    const within = async (selector) => {
      const violations = await js(
        `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(el=>{if(!el.getClientRects().length)return false;const r=el.getBoundingClientRect();return r.right>innerWidth+2||r.left< -2;}).map(el=>el.className)`,
      );
      assert.deepEqual(violations, [], `Outside viewport: ${selector}`);
    };
    for (const scenario of [
      { width: 1920, height: 1080, zoom: 1 },
      { width: 1440, height: 960, zoom: 1 },
      { width: 1100, height: 800, zoom: 1 },
      { width: 850, height: 700, zoom: 1 },
      { width: 1100, height: 800, zoom: 1.25 },
    ]) {
      win.setSize(scenario.width, scenario.height);
      win.webContents.setZoomFactor(scenario.zoom);
      await pause(180);
      await navigate("Trò chuyện");
      await until(() => js("!!document.querySelector('.markdown-table')"));
      const chat = await js(
        `(()=>{const el=document.querySelector('.markdown-table');const r=el.getBoundingClientRect();return {height:r.height,client:el.clientWidth,scroll:el.scrollWidth,tableHeight:el.scrollHeight,root:document.documentElement.scrollWidth,viewport:innerWidth};})()`,
      );
      assert.ok(chat.height <= 362);
      assert.ok(chat.root <= chat.viewport);
      assert.ok(chat.tableHeight > chat.height);
      await within(
        ".chat-header,.chat-composer,.markdown-table,.message-actions",
      );
      await js(
        "Array.from(document.querySelectorAll('.message-actions button')).find(b=>b.textContent.trim()==='Hoạt động').click()",
      );
      await until(() =>
        js("!!document.querySelector('.chat-detail-panel .task-board')"),
      );
      const panel = await js(
        `(()=>{const el=document.querySelector('.chat-detail-header'),p=el.getBoundingClientRect();return Array.from(el.children).map(x=>{const r=x.getBoundingClientRect();return r.left>=p.left-1&&r.right<=p.right+1;});})()`,
      );
      assert.ok(panel.every(Boolean), "Panel tabs and close button must fit");
      if (scenario.width === 1440)
        await screenshot(
          "chat-panel-desktop",
          ".chat-detail-panel .task-board",
        );
      await js(
        "document.querySelector('[aria-label=\"Đóng panel chi tiết\"]').click()",
      );
      await js(
        "Array.from(document.querySelectorAll('.message-actions button')).find(b=>b.textContent.trim()==='Chi tiết').click()",
      );
      await until(() =>
        js(
          "!!document.querySelector('.task-inspector[open] .inspector-title')",
        ),
      );
      await js(
        "(()=>{const el=document.querySelector('[aria-label=\"Chọn task / attempt\"]');el.value='t1';el.dispatchEvent(new Event('change',{bubbles:true}));})()",
      );
      const inspector = await js(
        `(()=>{const el=document.querySelector('.task-inspector'),facts=el.querySelector('.inspector-facts'),r=el.getBoundingClientRect(),children=Array.from(facts.children);return {width:r.width,right:r.right,height:r.height,viewport:innerWidth,overflow:el.scrollWidth>el.clientWidth+1,aligned:children.every((x,i)=>i%2===1||Math.abs(x.getBoundingClientRect().top-children[i+1].getBoundingClientRect().top)<2)};})()`,
      );
      assert.equal(inspector.overflow, false);
      assert.ok(inspector.right <= inspector.viewport + 1);
      assert.ok(inspector.aligned);
      if (scenario.width === 1440)
        await screenshot("inspector-desktop", ".task-inspector[open]");
      await js(
        "document.querySelector('[aria-label=\"Đóng chi tiết công việc\"]').click()",
      );
      await navigate("Công việc");
      await until(() =>
        js("document.querySelectorAll('.board-task').length>=16"),
      );
      const board = await js(
        `(()=>{const col=document.querySelector('.backlog'),ready=document.querySelector('.ready'),empty=document.querySelector('.in_progress'),label=document.querySelector('.board-filters label'),input=label.querySelector('input'),title=col.querySelector('.board-card-title');return {backlogHeight:col.getBoundingClientRect().height,backlogClient:col.clientHeight,backlogScroll:col.scrollHeight,readyHeight:ready.getBoundingClientRect().height,emptyHeight:empty.getBoundingClientRect().height,labelCenter:label.getBoundingClientRect().top+label.getBoundingClientRect().height/2,checkboxCenter:input.getBoundingClientRect().top+input.getBoundingClientRect().height/2,titleWhiteSpace:getComputedStyle(title).whiteSpace,titleOverflow:title.scrollWidth>title.clientWidth+1,root:document.documentElement.scrollWidth,viewport:innerWidth};})()`,
      );
      assert.ok(board.backlogScroll > board.backlogClient);
      assert.ok(board.backlogHeight <= 642);
      assert.ok(board.emptyHeight < board.backlogHeight);
      assert.ok(board.readyHeight < board.backlogHeight);
      assert.ok(Math.abs(board.labelCenter - board.checkboxCenter) < 2);
      assert.equal(board.titleWhiteSpace, "normal");
      assert.equal(board.titleOverflow, false);
      assert.ok(board.root <= board.viewport);
      await within(".board-filters,.board-pagination,.kanban-columns");
      if (scenario.width === 1440)
        await screenshot("kanban-desktop", ".kanban-columns");
      if (scenario.width === 850)
        await screenshot("kanban-small", ".kanban-columns");
      const reachability = await js(
        `(()=>{const col=document.querySelector('.backlog'),board=document.querySelector('.kanban-columns');col.scrollTop=col.scrollHeight;board.scrollLeft=board.scrollWidth;const last=col.querySelector('.board-task:last-child'),end=board.lastElementChild;const result={lastCard:last.getBoundingClientRect().bottom<=col.getBoundingClientRect().bottom+1,lastColumn:end.getBoundingClientRect().right<=board.getBoundingClientRect().right+1};col.scrollTop=0;board.scrollLeft=0;return result;})()`,
      );
      assert.ok(reachability.lastCard, "Last backlog card must be reachable");
      assert.ok(reachability.lastColumn, "Last board column must be reachable");
      await js(
        "Array.from(document.querySelectorAll('.page-heading button')).find(b=>b.textContent==='Thêm việc').click()",
      );
      await until(() => js("!!document.querySelector('.board-editor[open]')"));
      const editor = await js(
        `(()=>{const el=document.querySelector('.board-editor');return el.scrollWidth<=el.clientWidth+1 && Array.from(el.querySelectorAll('input,select,textarea')).every(c=>c.getBoundingClientRect().right<=el.getBoundingClientRect().right-10);})()`,
      );
      assert.equal(editor, true);
      await js(
        "document.querySelector('.board-editor').dispatchEvent(new Event('cancel',{cancelable:true}))",
      );
      await navigate("Đội ngũ");
      await until(() =>
        js("document.querySelectorAll('.agent-card').length===7"),
      );
      await within(
        ".agent-grid,.monitor-filters,.monitor-progress,.agent-card",
      );
      const agent = await js(
        "document.querySelector('.agent-task') ? getComputedStyle(document.querySelector('.agent-task')).whiteSpace : null",
      );
      // Finished runs expose a last-result action instead of an active task button.
      if (agent) assert.equal(agent, "normal");
      if (scenario.width === 1440)
        await screenshot("agents-desktop", ".agent-grid");
      await navigate("Cài đặt");
      await until(() => js("!!document.querySelector('.settings-grid')"));
      await within(".settings-grid,.settings-card,.agent-row,.limit-grid");
      const limits = await js(
        "Array.from(document.querySelectorAll('.limit-grid input')).map(el=>el.getBoundingClientRect().top)",
      );
      assert.ok(
        Math.max(...limits) - Math.min(...limits) < 2,
        "Number fields must align even with optional unit labels",
      );
      if (scenario.width === 1440)
        await screenshot("settings-desktop", ".settings-grid");
      if (scenario.width === 850)
        await screenshot("settings-small", ".settings-grid");
      await navigate("Lịch sử");
      await until(() => js("!!document.querySelector('.run-history')"));
      await within(".run-history,.history-tools,.page-heading");
      measurements.push({ ...scenario, chat, inspector, board, reachability });
    }
    assert.deepEqual(errors, []);
    const result = {
      passed: true,
      version: "1.3.0-alpha.4",
      fixture: true,
      providerCalls: 0,
      scenarios: measurements,
      rendererErrors: errors,
    };
    writeFileSync(
      join(output, "layout-checks.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(
      JSON.stringify({
        passed: true,
        scenarios: measurements.length,
        rendererErrors: errors,
      }),
    );
    app.quit();
  } catch (error) {
    if (win)
      writeFileSync(
        join(output, "failure.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
    console.error(error.stack);
    app.exit(1);
  }
});
