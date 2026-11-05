// Real built Electron/preload/IPC/SQLite. All data is isolated; no provider calls.
const { app, BrowserWindow, ipcMain } = require("electron");
const { join, resolve } = require("node:path");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const { channels } = require("../shared/channels.ts");
const { workTemplates } = require("../shared/templates.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "ux06-ui-"));
app.setPath("userData", join(directory, "data"));
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
  for (let i = 0; i < 100; i++) {
    const value = await fn();
    if (value) return value;
    await pause(100);
  }
  throw Error(`Timeout: ${label}`);
}
let win;
async function main() {
  const store = new Store(join(directory, "data"));
  const projects = ["Other project", "Factory Lite"].map((name) => {
    const path = join(directory, name);
    mkdirSync(path);
    return store.addProject(path);
  });
  const settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.forEach((a) => (a.model = "fixture"));
  settings.agents.find((a) => a.role === "pm").enabled = false;
  settings.agents.find((a) => a.role === "ba").model = "";
  store.save(settings, undefined);
  const historical = require("../../../docs/windows-worker/ww3-live.json").run;
  function run(project, patch = {}) {
    const r = {
      ...historical,
      id: crypto.randomUUID(),
      projectId: project.id,
      projectName: project.name,
      workspace: project.path,
      conversationId: store.conversations.create(project.id).id,
      settings,
      state: "failed",
      prompt: "A long work item title ".repeat(8),
      summary: "",
      error: "Fixture failure",
      permissions: [],
      tasks: [],
      commands: [],
      changes: [],
      review: null,
      profiles: [],
      retryOf: undefined,
      attemptRoot: undefined,
      workContext: undefined,
      questionRequest: undefined,
      integration: undefined,
      createdAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      currentTaskId: null,
      ...patch,
    };
    store.createRun(r);
    store.updateRun(r);
    return r;
  }
  const failed = run(projects[0]);
  const question = run(projects[0], {
    state: "needs_input",
    prompt: "Choose scope",
    failure: { code: "needs-context", message: "Need scope", retry: "none" },
    questionRequest: {
      version: 1,
      kind: "questions",
      summary: "Choose scope",
      questions: [
        { id: "q1", title: "Which scope?", required: true, options: [] },
      ],
    },
  });
  const held = store.queue.add({
    projectId: projects[0].id,
    conversationId: store.conversations.create(projects[0].id).id,
    prompt: "Held work",
    role: "lead",
    mode: "team",
    settings,
    afterRunId: failed.id,
    state: "held",
    reason: "Waiting for user",
  });
  store.close();
  require("../out/main/main.js");
  await app.whenReady();
  win = await until(() => BrowserWindow.getAllWindows()[0]);
  win.webContents.setBackgroundThrottling(false);
  const errors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  const js = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code, true);
    } catch (error) {
      console.error(`Renderer script failed: ${code}`);
      throw error;
    }
  };
  const nav = async (title) => {
    if (
      title !== "Hộp thư" &&
      !(await js("!!document.querySelector('.project-navigation')"))
    ) {
      await js(
        `document.querySelector('[data-project-id="${projects[1].id}"]').click()`,
      );
      await until(() => js("!!document.querySelector('.project-navigation')"));
    }
    if (title === "Hộp thư") {
      await js(
        "document.querySelector('nav button[title=\"Cần xử lý · Mọi dự án\"]').click()",
      );
    } else if (["Đội ngũ", "Tổng quan"].includes(title)) {
      await js(
        "document.querySelector('[aria-label=\"Khác trong dự án\"]').click()",
      );
      await click(title === "Tổng quan" ? "Tổng quan dự án" : "Đội ngũ dự án");
    } else {
      await js(
        `Array.from(document.querySelectorAll('.project-navigation button')).find(b=>b.textContent.trim()===${JSON.stringify(title)}).click()`,
      );
    }
    await pause(100);
  };
  const click = (text) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)} && b.getClientRects().length).click()`,
    );
  await until(() => js("!!document.querySelector('.workspace-home')"));
  await js(
    `document.querySelector('[data-project-id="${projects[1].id}"]').click()`,
  );
  await until(() => js("!!document.querySelector('.project-navigation')"));
  await nav("Tổng quan");
  await until(() => js("!!document.querySelector('.project-readiness')"));
  assert.equal(counts[channels.readiness] || 0, 0, "readiness must be lazy");
  await js("document.querySelector('.project-readiness summary').click()");
  await until(
    () => js("document.querySelectorAll('.readiness-checks li').length === 9"),
    "readiness checks",
  );
  assert.equal(counts[channels.readiness], 1);
  const ready = await js(
    `window.worker.readiness({projectId:${JSON.stringify(projects[1].id)},force:false})`,
  );
  assert.equal(ready.ok, true);
  assert.equal(
    ready.value.checks.find((c) => c.id === "folder").status,
    "pass",
  );
  assert.equal(
    ready.value.checks
      .find((c) => c.id === "gateway")
      .detail.includes("chưa kiểm tra kết nối"),
    true,
  );
  await nav("Công việc");
  await until(() => js("!!document.querySelector('.kanban-columns')"));
  await click("Tạo công việc");
  await until(() => js("!!document.querySelector('.board-editor[open]')"));
  await js(
    "document.querySelector('.board-editor[open] [aria-label=\"Mẫu công việc\"]').click()",
  );
  await until(
    () => js("!!document.querySelector('[role=\"option\"]')"),
    "template menu",
  );
  await js(
    "Array.from(document.querySelectorAll('[role=\"option\"]')).find(b=>b.textContent.trim()==='Sửa lỗi').click()",
  );
  await pause(60);
  assert.equal(
    await js(
      "document.querySelector('.board-editor[open] [aria-label=\"Yêu cầu công việc\"]').value",
    ),
    workTemplates.find((t) => t.id === "bug").body,
  );
  assert.equal(counts[channels.startRun] || 0, 0);
  assert.equal(counts[channels.submitBoardItem] || 0, 0);
  await js(
    `(() => { const i=document.querySelector('.board-editor[open] [aria-label="Tiêu đề công việc"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Template draft'); i.dispatchEvent(new Event('input',{bubbles:true})); })()`,
  );
  await js(
    "document.querySelector('.board-editor[open] form').requestSubmit()",
  );
  await until(() => js("!document.querySelector('.board-editor[open]')"));
  assert.equal(counts[channels.createBoardItem], 1);
  await nav("Đội ngũ");
  await until(() =>
    js("document.querySelectorAll('.agent-list .agent-card').length === 7"),
  );
  assert.equal(
    await js("document.querySelectorAll('.agent-card.disabled').length"),
    1,
  );
  assert.equal(
    await js("document.querySelectorAll('.agent-card.unconfigured').length"),
    1,
  );
  await click("Thẻ");
  assert.equal(
    await js("!!document.querySelector('.agent-grid:not(.agent-list)')"),
    true,
  );
  await click("Danh sách");
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
    const result = await js(
      `({width:innerWidth, overflow:document.documentElement.scrollWidth>innerWidth+1, cards:[...document.querySelectorAll('.agent-list .agent-card')].every(e=>e.scrollWidth<=e.clientWidth+1)})`,
    );
    assert.equal(result.overflow, false);
    assert.equal(result.cards, true);
    layouts.push({ width, height, zoom });
    await pause(150);
    writeFileSync(
      join(directory, `team-${width}-${zoom}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
    await nav("Hộp thư");
    await until(() =>
      js("document.querySelectorAll('.inbox-items li').length === 3"),
    );
    assert.equal(
      await js("document.documentElement.scrollWidth<=innerWidth+1"),
      true,
    );
    await pause(200);
    assert.equal(
      await js(
        "[document.querySelector('main'), document.querySelector('.global-inbox'), ...document.querySelectorAll('.inbox-items li')].every(e=>e.scrollWidth<=e.clientWidth+1)",
      ),
      true,
      "inbox content must wrap inside scroll container",
    );
    writeFileSync(
      join(directory, `inbox-${width}-${zoom}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
    await nav("Đội ngũ");
    await until(() => js("!!document.querySelector('.agent-list')"));
  }
  win.setSize(1366, 768);
  win.webContents.setZoomFactor(1);
  await nav("Hộp thư");
  await until(() =>
    js("document.querySelectorAll('.inbox-items li').length === 3"),
  );
  const seen = await js(
    "document.querySelectorAll('.inbox-items .unread').length",
  );
  await js("document.querySelector('.inbox-seen').click()");
  await until(() =>
    js(
      `document.querySelectorAll('.inbox-items .unread').length===${seen - 1}`,
    ),
  );
  assert.equal(
    await js("document.querySelectorAll('.inbox-items li').length"),
    3,
  );
  await click("Chưa đọc");
  await until(() =>
    js("document.querySelectorAll('.inbox-items li').length === 2"),
  );
  await click("Tất cả");
  await until(() =>
    js("document.querySelectorAll('.inbox-items li').length === 3"),
  );
  // A global inbox can open a different project's run without changing scope.
  await js(
    `Array.from(document.querySelectorAll('.inbox-open')).find(b=>b.textContent.includes('Fixture failure')).click()`,
  );
  await until(
    () => js("!!document.querySelector('.task-inspector')"),
    "cross-project inspector",
  );
  assert.equal(
    await js("document.querySelector('.workspace-global-scope').textContent"),
    "Toàn ứng dụng",
  );
  assert.equal(
    (await js(`window.worker.runDetail(${JSON.stringify(failed.id)})`)).value
      .run.projectId,
    projects[0].id,
  );
  await js(
    "document.querySelector('button[aria-label=\"Đóng chi tiết công việc\"]').click()",
  );
  await until(() => js("!document.querySelector('.task-inspector')"));
  await js(
    "Array.from(document.querySelectorAll('.inbox-open')).find(b=>b.textContent.includes('Cần trả lời')).click()",
  );
  await until(
    () => js("!!document.querySelector('.question-set')"),
    "question conversation",
  );
  assert.equal(
    (
      await js(
        `(async()=>window.worker.questionSet({projectId:${JSON.stringify(projects[0].id)}, conversationId:${JSON.stringify(question.conversationId)},setId:(await window.worker.inbox({unreadOnly:false})).value.items.find(i=>i.kind==='question').key.slice(9)}))()`,
      )
    ).value.state,
    "pending",
  );
  await nav("Hộp thư");
  await until(() =>
    js("document.querySelectorAll('.inbox-items li').length === 3"),
  );
  await js(
    "Array.from(document.querySelectorAll('.inbox-open')).find(b=>b.textContent.includes('Hàng chờ tạm giữ')).click()",
  );
  await until(
    () => js("!!document.querySelector('.follow-up-card')"),
    "held queue conversation",
  );
  assert.equal(counts[channels.answerQuestions] || 0, 0);
  assert.equal(counts[channels.reportDecision] || 0, 0);
  assert.equal(counts[channels.replyPermission] || 0, 0);
  assert.equal(counts[channels.startRun] || 0, 0);
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
        heldId: held.id,
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
main().catch(async (error) => {
  console.error(error.stack);
  try {
    if (win)
      writeFileSync(
        join(directory, "failure.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
  } catch {}
  app.exit(1);
});
