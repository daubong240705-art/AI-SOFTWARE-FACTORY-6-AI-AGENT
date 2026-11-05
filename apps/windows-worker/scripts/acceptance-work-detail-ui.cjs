// R2: one document/composer/question writer; real isolated Electron/IPC/SQLite.
const { app, BrowserWindow, ipcMain } = require("electron");
const { resolve, join } = require("node:path");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const { channels } = require("../shared/channels.ts");
const { failure } = require("../electron/runtime/failure.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "work-detail-ui-")),
  data = join(directory, "data");
app.setPath("userData", data);
BrowserWindow.prototype.show = function () {};
let failQuestionDraft = false,
  loseAnswer = false;
const counts = {};
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) =>
  originalHandle(channel, async (...args) => {
    counts[channel] = (counts[channel] || 0) + 1;
    if (channel === channels.saveQuestionDraft && failQuestionDraft)
      return { ok: false, error: "Fixture: chưa lưu câu trả lời" };
    const reply = await listener(...args);
    if (channel === channels.answerQuestions && loseAnswer && reply.ok) {
      loseAnswer = false;
      return { ok: false, error: "Fixture: mất phản hồi sau commit" };
    }
    return reply;
  });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label = "UI") {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await pause(100);
  }
  throw Error(`Timeout ${label}`);
}
let win;
async function main() {
  const store = new Store(data),
    project = store.addProject(directory),
    settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.forEach((a) => (a.model = "fixture-model"));
  store.save(settings, undefined);
  const item = store.board.create({
    projectId: project.id,
    title: "Đăng nhập với yêu cầu dài để kiểm tra hồ sơ công việc",
    body: "Mô tả tiếng Việt và tiêu chí rõ ràng.",
    criteria: ["Chọn phương thức đăng nhập"],
    priority: 0,
    suggestedRole: null,
    planningState: "ready",
  });
  const context = store.board.workChat({
    projectId: project.id,
    itemId: item.id,
  });
  const base = require("../../../docs/windows-worker/ww3-live.json").run;
  function run(state, prompt, createdAt) {
    return {
      ...base,
      id: crypto.randomUUID(),
      projectId: project.id,
      projectName: project.name,
      workspace: directory,
      conversationId: context.conversationId,
      settings,
      prompt,
      summary: prompt,
      mode: "team",
      role: "lead",
      state,
      workContext: store.board.chatSnapshot(
        project.id,
        item.id,
        1,
        context.conversationId,
      ),
      tasks: [],
      profiles: [],
      permissions: [],
      changes: [],
      commands: [],
      review: null,
      error: "",
      retryOf: undefined,
      attemptRoot: undefined,
      recoveryOf: undefined,
      integration: undefined,
      questionRequest: undefined,
      createdAt,
      endedAt: createdAt,
      currentTaskId: null,
    };
  }
  const completed = run(
    "completed",
    "Báo cáo lần thực hiện trước",
    new Date(Date.now() - 60000).toISOString(),
  );
  store.createRun(completed);
  store.board.attachChat(crypto.randomUUID(), completed.workContext, {
    runId: completed.id,
    followUpId: null,
  });
  store.updateRun(completed);
  const needs = run(
    "needs_input",
    "Cần chọn phương thức",
    new Date().toISOString(),
  );
  needs.failure = failure("needs-context", needs.summary);
  needs.questionRequest = {
    version: 1,
    kind: "questions",
    summary: "Chọn phương thức đăng nhập",
    questions: [
      {
        id: "q1",
        title: "Dùng phương thức nào?",
        required: true,
        options: [
          {
            id: "o1",
            label: "Email",
            description: "Tài khoản trong ứng dụng",
            recommended: true,
          },
          {
            id: "o2",
            label: "SSO",
            description: "Xác thực hiện có",
            recommended: false,
          },
        ],
      },
    ],
  };
  store.createRun(needs);
  store.board.attachChat(crypto.randomUUID(), needs.workContext, {
    runId: needs.id,
    followUpId: null,
  });
  store.updateRun(needs);
  const question = store.questions.list(context.conversationId)[0];
  assert.ok(question);
  const held = store.queue.add({
    projectId: project.id,
    conversationId: context.conversationId,
    prompt: "Giữ fixture, không gọi model",
    role: "lead",
    mode: "team",
    settings,
    afterRunId: null,
    state: "held",
    reason: "Fixture",
  });
  store.close();
  require("../out/main/main.js");
  await until(() => (win = BrowserWindow.getAllWindows()[0]));
  win.webContents.setBackgroundThrottling(false);
  const errors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const click = (label, scope = "document") =>
    js(
      `Array.from(${scope}.querySelectorAll('button')).find(b=>b.getClientRects().length && b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  const tab = (label) =>
    click(label, "document.querySelector('.work-panel-tabs')");
  const text = (selector, value) =>
    js(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  const composer = '[aria-label="Nhắn tin cho agent"]';
  const answer = '[aria-label="Trả lời: Dùng phương thức nào?"]';
  await until(() => js("!!document.querySelector('.workspace-home')"), "Home");
  await js(
    `document.querySelector('[data-project-id="${project.id}"]').click()`,
  );
  await until(() => js("!!document.querySelector('.board-card-title')"));
  await js(
    `(()=>{const card=Array.from(document.querySelectorAll('.board-card-title')).find(b=>b.textContent.includes(${JSON.stringify(item.title)}));card.focus();card.click();})()`,
  );
  await until(
    () =>
      js(
        "document.querySelectorAll('.work-item-panel .question-set').length===1",
      ),
    "Questions in requirements",
  );
  assert.equal(await js("document.querySelectorAll('.chat-host').length"), 1);
  assert.equal(
    await js("document.querySelectorAll('.question-set').length"),
    1,
  );
  assert.equal(
    await js("document.querySelector('.workspace-sidebar').inert"),
    true,
  );
  assert.deepEqual(
    await js(
      "Array.from(document.querySelectorAll('.work-panel-tabs button')).slice(0,4).map(b=>b.textContent)",
    ),
    ["Yêu cầu", "Trao đổi", "Tiến độ", "Kết quả"],
  );
  await text(answer, "Email cho bản đầu tiên");
  await until(async () => {
    const db = new Store(data);
    try {
      return (
        db.questions.list(context.conversationId)[0].answers[0]?.text ===
        "Email cho bản đầu tiên"
      );
    } finally {
      db.close();
    }
  }, "Durable answer draft");
  failQuestionDraft = true;
  await text(answer, "Nháp câu trả lời lỗi");
  await tab("Trao đổi");
  await until(() =>
    js(
      "document.querySelector('.work-item-panel .notice.error')?.textContent.includes('chưa lưu')",
    ),
  );
  assert.equal(
    await js(
      "document.querySelector('.work-panel-tabs button[aria-pressed=true]').textContent",
    ),
    "Yêu cầu",
  );
  failQuestionDraft = false;
  await text(answer, "Email cho MVP");
  await tab("Trao đổi");
  await until(() =>
    js(
      `document.querySelector(${JSON.stringify(composer)})?.disabled===false && !document.querySelector('.chat-host').hidden`,
    ),
  );
  assert.equal(
    await js("document.querySelectorAll('.question-set').length"),
    1,
    "One persistent question writer",
  );
  assert.equal(
    await js("document.querySelector('.question-set').getClientRects().length"),
    0,
    "Chat shows link rather than duplicate form",
  );
  await text(composer, "Nháp gửi Lead trong hồ sơ");
  await js(
    `window.__composer=document.querySelector(${JSON.stringify(composer)});window.__composer.focus();window.__composer.setSelectionRange(2,6);window.__composer.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));window.__composer.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}))`,
  );
  assert.equal(counts[channels.sendChat] || 0, 0);
  await tab("Tiến độ");
  await until(() => js("!!document.querySelector('.work-progress')"));
  await tab("Trao đổi");
  await until(() => js("!document.querySelector('.chat-host').hidden"));
  assert.equal(
    await js(
      `window.__composer===document.querySelector(${JSON.stringify(composer)})`,
    ),
    true,
  );
  assert.equal(
    await js("window.__composer.value"),
    "Nháp gửi Lead trong hồ sơ",
  );
  assert.equal(await js("window.__composer.selectionStart"), 2);
  await js(
    "window.__composer.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))",
  );
  await click("Trả lời câu hỏi trong Yêu cầu");
  await until(() =>
    js(
      `document.querySelector(${JSON.stringify(answer)})?.value==='Email cho MVP'`,
    ),
  );
  loseAnswer = true;
  await click("Gửi câu trả lời", "document.querySelector('.question-set')");
  await until(
    () =>
      js(
        "document.querySelector('.question-set')?.textContent.includes('mất phản hồi')",
      ),
    "Lost answer reply",
  );
  // Repeated answer uses the existing receipt, never a second continuation.
  await click("Gửi câu trả lời", "document.querySelector('.question-set')");
  await until(() =>
    js(
      "document.querySelector('.question-set')?.textContent.includes('Đã lưu câu trả lời')",
    ),
  );
  const db = new Store(data);
  const answered = db.questions.list(context.conversationId)[0];
  assert.equal(answered.state, "answered");
  assert.equal(db.queue.get(held.id).state, "held");
  assert.ok(answered.receipt.followUpId);
  assert.equal(
    db.board
      .detail({ projectId: project.id, itemId: item.id })
      .submissions.filter((s) => s.followUpId === answered.receipt.followUpId)
      .length,
    1,
  );
  db.close();
  await tab("Tiến độ");
  await until(() => js("!!document.querySelector('.work-progress details')"));
  await js("document.querySelector('.work-progress details').open=true");
  await click("Chi tiết task, model và lệnh");
  await until(() => js("!!document.querySelector('.task-inspector')"));
  assert.equal(
    await js(
      "document.querySelectorAll('.workspace-detail-host[role=dialog]').length",
    ),
    1,
  );
  assert.equal(await js("document.querySelectorAll('dialog[open]').length"), 0);
  assert.equal(
    await js("document.querySelector('.work-document').hidden"),
    true,
  );
  await click("Quay lại hồ sơ");
  await until(() => js("!document.querySelector('.task-inspector')"));
  assert.equal(
    await js(
      "document.querySelector('.work-panel-tabs button[aria-pressed=true]').textContent",
    ),
    "Tiến độ",
  );
  await tab("Kết quả");
  await until(() => js("!!document.querySelector('.work-report')"));
  // All four tabs fit production windows and zoom; composer remains inside host.
  const layouts = [];
  for (const [width, height, zoom] of [
    [1366, 768, 1],
    [850, 700, 1],
    [1366, 768, 1.25],
    [1366, 768, 1.5],
  ]) {
    win.setSize(width, height);
    win.webContents.setZoomFactor(zoom);
    for (const label of ["Yêu cầu", "Trao đổi", "Tiến độ", "Kết quả"]) {
      await tab(label);
      await pause(180);
      const layout = await js(
        `(()=>{const h=document.querySelector('.workspace-detail-host'),r=h.getBoundingClientRect(),c=document.querySelector('.chat-composer')?.getBoundingClientRect();return {width:innerWidth,height:innerHeight,left:r.left,right:r.right,bottom:r.bottom,overflow:h.scrollWidth>h.clientWidth+2,composerBottom:c?.bottom}})()`,
      );
      assert.ok(
        layout.left >= 0 &&
          layout.right <= layout.width + 1 &&
          layout.bottom <= layout.height + 1,
        JSON.stringify(layout),
      );
      assert.equal(layout.overflow, false, JSON.stringify(layout));
      if (label === "Trao đổi")
        assert.ok(
          layout.composerBottom <= layout.bottom + 1,
          JSON.stringify(layout),
        );
      layouts.push({ width, height, zoom, tab: label, ...layout });
      writeFileSync(
        join(directory, `${label}-${width}-${zoom}.png`),
        (await win.webContents.capturePage()).toPNG(),
      );
    }
  }
  await js("document.querySelector('[aria-label=\"Đóng hồ sơ\"]').click()");
  await until(() => js("!document.querySelector('.detail-open')"));
  assert.equal(
    await js("document.querySelector('.workspace-sidebar').inert"),
    false,
  );
  assert.ok(
    await js("document.activeElement.classList.contains('board-card-title')"),
    "Focus returns to original card",
  );
  assert.equal(counts[channels.sendChat] || 0, 0);
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    directory,
    layouts: layouts.length,
    providerCalls: 0,
    counts,
    errors,
  };
  writeFileSync(
    join(directory, "acceptance.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  app.quit();
}
main().catch(async (e) => {
  console.error(e.stack);
  try {
    if (win)
      writeFileSync(
        join(directory, "failure.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
  } catch {}
  app.exit(1);
});
