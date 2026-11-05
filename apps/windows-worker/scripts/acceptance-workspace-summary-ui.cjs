// R4: production Electron/preload/IPC, isolated data, no provider dispatch.
const { app, BrowserWindow, ipcMain } = require("electron");
const { resolve, join } = require("node:path");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { normalizeRun } = require("../shared/runs.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const { channels } = require("../shared/channels.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "workspace-summary-ui-"));
const data = join(directory, "data");
app.setPath("userData", data);
BrowserWindow.prototype.show = function () {};
let summaryFailure = false,
  indexFailure = false,
  win,
  lastChatProject;
const counts = {};
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) =>
  originalHandle(channel, async (...args) => {
    counts[channel] = (counts[channel] || 0) + 1;
    assert.ok(
      ![channels.startRun, channels.sendChat, channels.enqueue].includes(
        channel,
      ),
      "Must not dispatch work",
    );
    if (channel === channels.workspaceSummary && summaryFailure)
      return { ok: false, error: "Fixture summary unavailable" };
    if (channel === channels.resultIndex && indexFailure)
      return { ok: false, error: "Fixture results unavailable" };
    const result = await listener(...args);
    if (channel === channels.conversation && result.ok)
      lastChatProject = result.value.conversation.projectId;
    return result;
  });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(fn, label = "UI") {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await pause(100);
  }
  throw Error(`Timeout: ${label}`);
}
async function main() {
  const store = new Store(data),
    settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.forEach((a) => (a.model = "fixture-model"));
  store.save(settings, undefined);
  const projects = ["Alpha", "Beta"].map((name) => {
    const path = join(directory, name);
    mkdirSync(path);
    return store.addProject(path);
  });
  function run(project, patch = {}) {
    const run = normalizeRun({
      id: randomUUID(),
      projectId: project.id,
      projectName: project.name,
      workspace: project.path,
      prompt: "Kết quả triển khai",
      role: "be",
      model: "fixture",
      mode: "direct",
      state: "completed",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: null,
      endedAt: "2026-01-01T00:01:00.000Z",
      sessionId: null,
      conversationId: store.conversations.create(project.id).id,
      summary: "Đã tạo nội dung cho dự án",
      error: "",
      settings,
      changes: [{ path: "result.txt", kind: "added" }],
      commands: [],
      permissions: [],
      requests: 0,
      baselineComplete: false,
      toolsCompleted: 0,
      runtimeVersion: "fixture",
      inputTokens: 0,
      outputTokens: 0,
      ...patch,
    });
    store.createRun(run);
    store.updateRun(run);
    return run;
  }
  for (let i = 0; i < 24; i++)
    run(projects[0], { prompt: `Báo cáo Alpha ${i}` });
  run(projects[0], { prompt: "Tư vấn không phải kết quả", changes: [] });
  run(projects[0], {
    prompt: "Phân tích lịch sử",
    changes: [],
    commands: [
      {
        callId: "read",
        command: "git status",
        status: "completed",
        exitCode: 0,
        output: "clean",
      },
    ],
  });
  const item = store.board.create({
    projectId: projects[1].id,
    title: "Hồ sơ Beta",
    body: "Yêu cầu",
    criteria: [],
    priority: 0,
    suggestedRole: null,
    planningState: "ready",
  });
  const context = store.board.workChat({
    projectId: item.projectId,
    itemId: item.id,
  });
  const work = store.board.chatSnapshot(
    item.projectId,
    item.id,
    1,
    context.conversationId,
  );
  const linked = run(projects[1], {
    prompt: "Hồ sơ Beta",
    workContext: work,
    conversationId: context.conversationId,
    endedAt: "2026-01-02T00:00:00.000Z",
  });
  store.board.attachChat(randomUUID(), work, {
    runId: linked.id,
    followUpId: null,
  });
  for (let i = 0; i < 53; i++)
    run(projects[i % 2], {
      state: "failed",
      error: "Fixture failure",
      prompt: `Cần xử lý ${i}`,
      changes: [],
    });
  const actionable = store.inbox.count();
  const seen = store.inbox.list({}).items[0];
  store.inbox.seen({ key: seen.key, token: seen.token });
  assert.equal(store.inbox.count(), actionable);
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
      throw Error(`${error.message}\nScript: ${code}`);
    });
  const click = async (label, scope = "document") => {
    const find = `Array.from(${scope}?.querySelectorAll('button') || []).find(b=>b.textContent.trim()===${JSON.stringify(label)} && !b.disabled)`;
    await until(() => js(`!!(${find})`), label);
    await js(`(${find}).click()`);
  };
  const global = (title) =>
    js(
      `document.querySelector('nav[aria-label="Toàn ứng dụng"] button[title=${JSON.stringify(title)}]').click()`,
    );
  const select = async (p) => {
    await js(`document.querySelector('[data-project-id="${p.id}"]').click()`);
    await until(
      () =>
        js(
          `document.querySelector('[data-project-id="${p.id}"]').getAttribute('aria-current')==='page'`,
        ),
      "Project selection",
    );
  };
  const input = (selector, value, type = "HTMLInputElement") =>
    js(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${type}.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  const option = async (label, text) => {
    await js(
      `document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`,
    );
    await until(() => js("!!document.querySelector('[role=option]')"));
    await js(
      `Array.from(document.querySelectorAll('[role=option]')).find(el=>el.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  };
  await until(
    () =>
      js(
        `document.querySelector('.workspace-count')?.textContent==='${actionable}'`,
      ),
    "Global count beyond 50",
  );
  assert.equal(
    await js(
      "document.querySelectorAll('.home-summary-list')[0].children.length",
    ),
    5,
  );
  assert.equal(
    await js(
      "document.querySelectorAll('.home-summary-list')[1].children.length",
    ),
    5,
  );
  // Team works from global Home with no selected project.
  await global("Đội ngũ · Mọi dự án");
  await until(
    () =>
      js("document.querySelectorAll('.workspace-team .agent-card').length===7"),
    "Global Team",
  );
  assert.equal(
    await js("!!document.querySelector('.project-navigation')"),
    false,
  );
  const monitorCount = counts[channels.monitorSnapshot] || 0;
  await pause(2700);
  assert.equal(
    counts[channels.monitorSnapshot] || 0,
    monitorCount,
    "Global team must not fan out project monitors",
  );
  await global("Tổng quan");
  await until(() => js("!!document.querySelector('.workspace-home')"));
  await js(
    "Array.from(document.querySelectorAll('.home-summary-list')[1].querySelectorAll('button')).find(b=>b.textContent.includes('Hồ sơ Beta')).click()",
  );
  await until(
    () => js("!!document.querySelector('.work-report')"),
    "Open cross-project linked report",
  );
  assert.ok(
    await js(
      "document.querySelector('.work-item-panel').textContent.includes('Hồ sơ Beta')",
    ),
  );
  await js(
    "document.querySelector('.work-item-panel [aria-label=\"Đóng hồ sơ\"]').click()",
  );
  await until(() => js("!document.querySelector('.work-item-panel')"));
  await js(
    "Array.from(document.querySelectorAll('.home-summary-list')[1].querySelectorAll('button')).find(b=>b.textContent.includes('Báo cáo Alpha')).click()",
  );
  await until(
    () => js("!!document.querySelector('.task-inspector .work-report')"),
    "Cross-project run-only report",
  );
  await js(
    "document.querySelector('.task-inspector button[aria-label=\"Đóng chi tiết công việc\"]').click()",
  );
  // Return to a project-specific index and paginate, search without accents, filter, retry.
  await select(projects[0]);
  lastChatProject = undefined;
  await click("Trao đổi", "document.querySelector('.project-navigation')");
  await until(
    () => lastChatProject === projects[0].id,
    "Chat scope after cross-project report",
  );
  await click("Kết quả", "document.querySelector('.project-navigation')");
  await until(
    () => js("document.querySelectorAll('.result-list>li').length===20"),
    "First result page",
  );
  assert.equal(
    await js(
      "document.querySelector('.result-list').textContent.includes('Tư vấn')",
    ),
    false,
  );
  await click("Xem thêm kết quả", "document.querySelector('.project-results')");
  await until(
    () => js("document.querySelectorAll('.result-list>li').length===24"),
    "Cursor pagination",
  );
  await input('[aria-label="Tìm kết quả"]', "PHAN TICH LICH SU");
  await until(() =>
    js("document.querySelectorAll('.result-list>li').length===0"),
  );
  await option("Phạm vi kết quả", "Gồm phân tích và lượt lỗi");
  await until(() =>
    js("document.querySelectorAll('.result-list>li').length===1"),
  );
  assert.ok(
    await js(
      "document.querySelector('.result-list').textContent.includes('Phân tích lịch sử')",
    ),
  );
  await option("Phạm vi kết quả", "Thay đổi bàn giao");
  await until(() =>
    js("document.querySelectorAll('.result-list>li').length===0"),
  );
  await input('[aria-label="Tìm kết quả"]', "BAO CAO ALPHA 23");
  await until(
    () => js("document.querySelectorAll('.result-list>li').length===1"),
    "Vietnamese search",
  );
  await option("Lọc kiểm chứng", "Đạt");
  await until(
    () =>
      js(
        "document.querySelectorAll('.result-list>li').length===0 && !!document.querySelector('.overview-empty')",
      ),
    "Verification filter",
  );
  await option("Lọc kiểm chứng", "Mọi kết quả");
  await until(() =>
    js("document.querySelectorAll('.result-list>li').length===1"),
  );
  indexFailure = true;
  await click("Cập nhật", "document.querySelector('.project-results')");
  await until(
    () => js("!!document.querySelector('.project-results [role=alert]')"),
    "Index error",
  );
  assert.equal(
    await js("document.querySelector('.result-list button').disabled"),
    true,
  );
  indexFailure = false;
  await click("Cập nhật", "document.querySelector('.project-results')");
  await until(() =>
    js(
      "!document.querySelector('.project-results [role=alert]') && !document.querySelector('.result-list button').disabled",
    ),
  );
  await js("document.querySelector('.result-list button').click()");
  await until(
    () => js("!!document.querySelector('.task-inspector .work-report')"),
    "Run-only report",
  );
  await js(
    "document.querySelector('.task-inspector button[aria-label=\"Đóng chi tiết công việc\"]').click()",
  );
  // Home uses the existing ChatHost. Drafts remain scoped and opening twice reuses the conversation.
  await global("Tổng quan");
  await until(() => js("!!document.querySelector('.home-lead-controls')"));
  await option("Dự án trao đổi với Lead", "Alpha");
  await click("Nhắn Lead", "document.querySelector('.home-lead')");
  const composer = '[aria-label="Nhắn tin cho agent"]';
  await until(
    () =>
      js(
        `document.querySelector(${JSON.stringify(composer)})?.disabled===false`,
      ),
    "Home Lead dock",
  );
  await input(composer, "Nháp Alpha", "HTMLTextAreaElement");
  const conversationsBefore = counts[channels.createConversation] || 0;
  await click("Mở trao đổi", "document.querySelector('.home-lead')");
  await pause(300);
  assert.equal(
    counts[channels.createConversation] || 0,
    conversationsBefore,
    "Opening Lead twice must reuse chat",
  );
  await option("Dự án trao đổi với Lead", "Beta");
  await click("Mở trao đổi", "document.querySelector('.home-lead')");
  await until(() =>
    js(
      `document.querySelector(${JSON.stringify(composer)})?.value==='' && !document.querySelector(${JSON.stringify(composer)}).disabled`,
    ),
  );
  await input(composer, "Nháp Beta", "HTMLTextAreaElement");
  await option("Dự án trao đổi với Lead", "Alpha");
  await click("Mở trao đổi", "document.querySelector('.home-lead')");
  await until(
    () =>
      js(
        `document.querySelector(${JSON.stringify(composer)})?.value==='Nháp Alpha'`,
      ),
    "Scoped draft restored",
  );
  await global("Đội ngũ · Mọi dự án");
  summaryFailure = true;
  await click("Cập nhật", "document.querySelector('.agent-monitor')");
  await until(
    () => js("!!document.querySelector('.agent-monitor [role=alert]')"),
    "Shared stale/error state",
  );
  assert.equal(
    await js("document.querySelectorAll('.agent-card').length"),
    7,
    "Keep last good data",
  );
  summaryFailure = false;
  await click("Cập nhật", "document.querySelector('.agent-monitor')");
  await until(() =>
    js("!document.querySelector('.agent-monitor [role=alert]')"),
  );
  const layouts = [];
  for (const page of ["home", "team", "results"]) {
    if (page === "home") await global("Tổng quan");
    if (page === "team") await global("Đội ngũ · Mọi dự án");
    if (page === "results") {
      await select(projects[0]);
      await click("Kết quả", "document.querySelector('.project-navigation')");
    }
    await until(() =>
      js(
        `!!document.querySelector('${page === "home" ? ".workspace-home" : page === "team" ? ".workspace-team" : ".project-results"}')`,
      ),
    );
    for (const [width, height, zoom] of [
      [1366, 768, 1],
      [850, 700, 1],
      [1366, 768, 1.25],
      [1366, 768, 1.5],
    ]) {
      win.setSize(width, height);
      win.webContents.setZoomFactor(zoom);
      await pause(220);
      const layout = await js(
        "({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+2,mainBottom:document.querySelector('main').getBoundingClientRect().bottom})",
      );
      assert.equal(layout.overflow, false, JSON.stringify({ page, ...layout }));
      assert.ok(
        layout.mainBottom <= layout.height + 1,
        JSON.stringify({ page, ...layout }),
      );
      if (page === "results") {
        const filters = await js(
          "(()=>{const s=document.querySelector('.result-filters input').getBoundingClientRect(),f=document.querySelector('.result-filters .ui-select').getBoundingClientRect();return {search:s.width,select:f.width,overlap:s.right>f.left && s.top<f.bottom && f.top<s.bottom}})()",
        );
        assert.ok(
          filters.search >= 180 && filters.select >= 150 && !filters.overlap,
          JSON.stringify(filters),
        );
      }
      layouts.push({ page, width, height, zoom, ...layout });
      writeFileSync(
        join(directory, `${page}-${width}-${zoom}.png`),
        (await win.webContents.capturePage()).toPNG(),
      );
    }
  }
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    directory,
    actionable,
    layouts,
    counts,
    providerCalls: 0,
    errors,
  };
  writeFileSync(
    join(directory, "acceptance.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  app.quit();
}
main().catch(async (error) => {
  console.error(error.stack);
  if (win) {
    writeFileSync(
      join(directory, "failure.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    writeFileSync(
      join(directory, "failure.txt"),
      await win.webContents.executeJavaScript("document.body.innerText"),
    );
  }
  app.exit(1);
});
