// UX-04: actual renderer/IPC/SQLite, isolated schema9 migration and held continuation.
const { app, BrowserWindow, ipcMain } = require("electron");
const { resolve, join } = require("node:path");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
require("tsx/cjs");
const Database = require("better-sqlite3");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const { failure } = require("../electron/runtime/failure.ts");
const { channels } = require("../shared/channels.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "questions-ui-")),
  data = join(directory, "data"),
  source = join(directory, "source");
mkdirSync(source);
app.setPath("userData", data);
BrowserWindow.prototype.show = function () {};
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(fn, label = "UI") {
  for (let i = 0; i < 100; i++) {
    const result = await fn();
    if (result) return result;
    await pause(100);
  }
  throw Error(`Timeout ${label}`);
}
const counts = {};
let loseAnswerReply = false;
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) =>
  handle(channel, async (...args) => {
    counts[channel] = (counts[channel] || 0) + 1;
    const result = await listener(...args);
    if (channel === channels.answerQuestions && result.ok && loseAnswerReply) {
      loseAnswerReply = false;
      return { ok: false, error: "Fixture response lost after commit" };
    }
    return result;
  });
const decision = {
  version: 1,
  kind: "questions",
  summary: "Chọn phạm vi đăng nhập",
  questions: [
    {
      id: "q1",
      title: "Phương thức đăng nhập?",
      required: true,
      options: [
        {
          id: "o1",
          label: "Email và mật khẩu",
          description: "Tài khoản riêng trong ứng dụng",
          recommended: true,
        },
        {
          id: "o2",
          label: "SSO",
          description: "Dùng hệ thống xác thực hiện có",
          recommended: false,
        },
      ],
    },
    { id: "q2", title: "Ghi chú bổ sung?", required: false, options: [] },
  ],
};
let win;
async function main() {
  let store = new Store(data);
  const project = store.addProject(source),
    settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.forEach((a) => (a.model = "fixture-model"));
  settings.permissionMode = "full-access";
  store.save(settings, undefined);
  const item = store.board.create({
    projectId: project.id,
    title: "Chức năng đăng nhập",
    body: "Cần chọn phương thức đăng nhập",
    criteria: ["Người dùng chọn phương thức"],
    priority: 0,
    suggestedRole: null,
    planningState: "backlog",
  });
  const context = store.board.workChat({
    projectId: project.id,
    itemId: item.id,
  });
  const run = {
    ...require("../../../docs/windows-worker/ww3-live.json").run,
    id: crypto.randomUUID(),
    projectId: project.id,
    projectName: project.name,
    workspace: source,
    conversationId: context.conversationId,
    settings,
    prompt: "Thực hiện chức năng đăng nhập",
    mode: "team",
    role: "lead",
    state: "needs_input",
    questionRequest: decision,
    summary: decision.summary,
    error: decision.summary,
    failure: failure("needs-context", decision.summary),
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
  const set = store.questions.list(context.conversationId)[0];
  store.queue.add({
    projectId: project.id,
    conversationId: context.conversationId,
    prompt: "Giữ hàng chờ fixture",
    role: "lead",
    mode: "team",
    settings,
    afterRunId: null,
    state: "held",
    reason: "Không gọi provider",
  });
  store.close();
  // Native migration from populated schema9, before production main opens the DB.
  const db = new Database(join(data, "worker.sqlite"));
  db.exec("DROP TABLE question_sets;PRAGMA user_version=9");
  db.close();
  // Existing terminal runs are not replayed/materialized as new questions by migration.
  store = new Store(data);
  assert.equal(store.questions.list(context.conversationId).length, 0);
  store.updateRun(run);
  const actual = store.questions.list(context.conversationId)[0];
  store.close();
  const backup = new Database(
    join(data, "worker.schema9.pre-questions.backup.sqlite"),
    { readonly: true },
  );
  assert.equal(backup.pragma("user_version", { simple: true }), 9);
  backup.close();
  require("../out/main/main.js");
  win = await until(() => BrowserWindow.getAllWindows()[0]);
  win.webContents.setBackgroundThrottling(false);
  await until(() => !win.webContents.isLoading());
  const errors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  const js = (code) =>
    win.webContents.executeJavaScript(code, true).catch((e) => {
      throw Error(`${code}\n${e.message}`);
    });
  const click = (label) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  const setText = (selector, text) =>
    js(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  await until(
    () =>
      js(
        "document.querySelector('.attention-list')?.textContent.includes('Cần trả lời')",
      ),
    "question inbox",
  );
  await js(
    "document.querySelector('.attention-list button[aria-label^=\"Trả lời câu hỏi\"]').click()",
  );
  await until(() => js("!!document.querySelector('.question-set.pending')"));
  assert.equal(
    await js("!!document.querySelector('.chat-detail-panel')"),
    false,
    "Inbox opens questions, not inspector",
  );
  assert.equal(
    await js(
      "document.querySelectorAll('.question-options input:checked').length",
    ),
    0,
    "Recommendations never preselect an answer",
  );
  assert.equal(
    await js(
      "document.querySelector('[aria-label=\"Quyền thực thi\"]').textContent.includes('Full access')",
    ),
    true,
  );
  await click("Gửi câu trả lời");
  await until(() =>
    js(
      "document.querySelector('.question-set [role=alert]')?.textContent.includes('Cần trả lời')",
    ),
  );
  assert.equal(
    (
      await js(
        `window.worker.conversation(${JSON.stringify(context.conversationId)})`,
      )
    ).value.queue.length,
    1,
  );
  await setText(
    '[aria-label="Trả lời: Phương thức đăng nhập?"]',
    "Đăng nhập nội bộ bằng mã nhân viên",
  );
  await until(async () => {
    const r = await js(
      `window.worker.conversation(${JSON.stringify(context.conversationId)})`,
    );
    return (
      r.value.questionSets[0].answers[0]?.text ===
      "Đăng nhập nội bộ bằng mã nhân viên"
    );
  }, "draft persisted");
  win.webContents.reload();
  await until(() => !win.webContents.isLoading());
  await until(() => js("!!document.querySelector('.project-overview')"));
  await js(
    "document.querySelector('.attention-list button[aria-label^=\"Trả lời câu hỏi\"]').click()",
  );
  await until(
    () =>
      js(
        "document.querySelector('.question-set textarea')?.value==='Đăng nhập nội bộ bằng mã nhân viên'",
      ),
    "draft after renderer restart",
  );
  await js(
    "document.querySelector('.question-options input[value=o2]').click()",
  );
  await setText(
    '[aria-label="Trả lời: Ghi chú bổ sung?"]',
    "Chỉ dùng trong mạng nội bộ",
  );
  await until(() =>
    js("!document.querySelector('.question-actions button').disabled"),
  );
  await js(
    "window.__questionInput=document.querySelector('.question-set textarea')",
  );
  const layouts = [];
  for (const [width, height, zoom] of [
    [1366, 768, 1],
    [850, 700, 1],
    [1366, 768, 1.25],
    [1366, 768, 1.5],
  ]) {
    win.setSize(width, height);
    win.webContents.setZoomFactor(zoom);
    await pause(150);
    const layout = await js(
      `(()=>{const c=document.querySelector('.question-set'),r=c.getBoundingClientRect();return {left:r.left,right:r.right,viewport:innerWidth,overflow:c.scrollWidth>c.clientWidth+2,composerBottom:document.querySelector('.chat-composer').getBoundingClientRect().bottom,height:innerHeight};})()`,
    );
    assert.ok(
      layout.left >= 0 && layout.right <= layout.viewport + 1,
      JSON.stringify(layout),
    );
    assert.equal(layout.overflow, false);
    assert.ok(layout.composerBottom <= layout.height, JSON.stringify(layout));
    layouts.push(layout);
    await js(
      "document.querySelector('.question-set').scrollIntoView({block:'start'})",
    );
    writeFileSync(
      join(directory, `questions-${width}-${zoom}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(
      "document.querySelector('[aria-label=\"Thu chat về cạnh công việc\"]').click()",
    );
    await until(() => js("!!document.querySelector('.chat-host.dock')"));
    const dock = await js(
      "(()=>{const h=document.querySelector('.chat-host.dock'),c=document.querySelector('.question-set'),r=c.getBoundingClientRect();return {same:window.__questionInput===c.querySelector('textarea'),inside:r.left>=0&&r.right<=innerWidth+1,overflow:c.scrollWidth>c.clientWidth+2,composer:document.querySelector('.chat-composer').getBoundingClientRect().bottom<=h.getBoundingClientRect().bottom};})()",
    );
    assert.equal(dock.same, true);
    assert.equal(dock.inside, true);
    assert.equal(dock.overflow, false);
    assert.equal(dock.composer, true);
    await js(
      "document.querySelector('[aria-label=\"Mở chat toàn màn hình\"]').click()",
    );
    await until(() => js("!!document.querySelector('.chat-host.fullscreen')"));
  }
  loseAnswerReply = true;
  await js(
    "document.querySelector('.question-actions button').click();document.querySelector('.question-actions button').click()",
  );
  await until(
    () => js("!!document.querySelector('.question-set.answered')"),
    "persisted answer despite lost reply",
  );
  const detail = (
      await js(
        `window.worker.conversation(${JSON.stringify(context.conversationId)})`,
      )
    ).value,
    answered = detail.questionSets[0];
  assert.equal(detail.queue.length, 2);
  assert.equal(answered.answers[0].optionId, "o2");
  assert.ok(answered.receipt.followUpId);
  const again = await js(
    `window.worker.answerQuestions(${JSON.stringify({ projectId: project.id, conversationId: context.conversationId, setId: actual.id, version: actual.recordVersion, answers: answered.answers })})`,
  );
  assert.equal(again.ok, true);
  assert.equal(again.value.receipt.followUpId, answered.receipt.followUpId);
  await js("document.querySelector('nav button[title=\"Tổng quan\"]').click()");
  await until(
    () =>
      js(
        "document.querySelector('.project-overview .attention-list') && !document.querySelector('.attention-list').textContent.includes('Cần trả lời')",
      ),
    "answered inbox refresh",
  );
  // Create another requirement revision in fixture DB; old set becomes read-only.
  store = new Store(data);
  const current = store.board.item(item.id);
  store.board.update({
    id: item.id,
    version: current.version,
    patch: { body: "Yêu cầu revision hai" },
  });
  const newer = {
    ...run,
    id: crypto.randomUUID(),
    workContext: store.board.chatSnapshot(
      project.id,
      item.id,
      2,
      context.conversationId,
    ),
    createdAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  };
  store.createRun(newer);
  store.updateRun(newer);
  const stale = store.questions
    .list(context.conversationId)
    .find((q) => q.sourceRunId === newer.id);
  store.board.update({
    id: item.id,
    version: store.board.item(item.id).version,
    patch: { body: "Revision ba" },
  });
  store.close();
  await js(
    "document.querySelector('nav button[title=\"Trò chuyện\"]').click()",
  );
  await until(() => js("!!document.querySelector('.question-set.superseded')"));
  assert.equal(
    await js(
      "document.querySelector('.question-set.superseded textarea')===null",
    ),
    true,
  );
  const rejected = await js(
    `window.worker.answerQuestions(${JSON.stringify({ projectId: project.id, conversationId: context.conversationId, setId: stale.id, version: stale.recordVersion, answers: answered.answers })})`,
  );
  assert.equal(rejected.ok, false);
  assert.deepEqual(errors, []);
  writeFileSync(
    join(directory, "acceptance.json"),
    JSON.stringify(
      { passed: true, providerCalls: 0, layouts, counts, errors },
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
