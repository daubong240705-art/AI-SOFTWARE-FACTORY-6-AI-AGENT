// Production Electron/SQLite/IPC with isolated historical fixtures. No provider requests.
const { app, BrowserWindow, ipcMain } = require("electron");
const { resolve, join } = require("node:path");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const { snapshot } = require("../electron/workspace/snapshot.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "inspector-ui-"));
app.setPath("userData", join(directory, "data"));
const source = join(directory, "source");
mkdirSync(source);
const output = process.env.ASF_UI_ARTIFACT_DIR
  ? resolve(process.env.ASF_UI_ARTIFACT_DIR)
  : resolve(__dirname, "../../../docs/windows-worker/v1.3");
mkdirSync(output, { recursive: true });
const counts = {};
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) =>
  handle(channel, (...args) => {
    counts[channel] = (counts[channel] || 0) + 1;
    return listener(...args);
  });
BrowserWindow.prototype.show = function () {};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    const value = await fn();
    if (value) return value;
    await pause(100);
  }
  throw new Error("Timed out waiting for inspector UI");
}
async function main() {
  const store = new Store(join(directory, "data"));
  const project = store.addProject(source),
    conversation = store.conversations.create(project.id),
    settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.permissionMode = "full-access";
  settings.agents.forEach((a) => (a.model = "configured-current-model"));
  store.save(settings, undefined);
  writeFileSync(join(source, "sample.ts"), "export const value = 1;\n");
  const before = await snapshot(source, true);
  writeFileSync(join(source, "sample.ts"), "export const value = 2;\n");
  const after = await snapshot(source, true);
  const baseEvidence = store.evidence.saveTaskSnapshot(before),
    evidence = store.evidence.saveTaskSnapshot(after);
  const now = new Date().toISOString();
  const task = (id, patch = {}) => ({
    id,
    role: "be",
    title: "Cải thiện luồng xử lý",
    instructions: "Thay đổi giá trị trong sample.ts",
    allowedPaths: ["sample.ts"],
    acceptance: ["Giá trị bằng 2"],
    dependsOn: [],
    state: "completed",
    model: "snapshot-deepseek-flash",
    kind: "work",
    round: 0,
    sessionId: `session-${id}`,
    startedAt: now,
    endedAt: now,
    summary: "Đã thực thi; chờ xác minh",
    error: "",
    changes: [{ path: "sample.ts", kind: "modified" }],
    commandIds: [],
    baseEvidence,
    evidence,
    ...patch,
  });
  const run = {
    ...require("../../../docs/windows-worker/ww3-live.json").run,
    id: crypto.randomUUID(),
    projectId: project.id,
    projectName: "Inspector fixture",
    workspace: source,
    prompt: "Hoàn thiện task và kiểm thử",
    conversationId: conversation.id,
    settings,
    state: "completed",
    mode: "team",
    role: "lead",
    model: "snapshot-lead-model",
    createdAt: now,
    startedAt: now,
    endedAt: now,
    tasks: [
      task("t1"),
      task("fix-1", { originalTaskId: "t1", kind: "fix", round: 1 }),
      task("t2", {
        role: "test",
        title: "Kiểm thử kết quả",
        dependsOn: ["t1"],
        changes: [],
      }),
    ],
    currentTaskId: null,
    permissions: [],
    commands: [],
    changes: [],
    summary: "Fixture · chưa xác minh acceptance",
    error: "",
    review: null,
    integration: undefined,
    observation: undefined,
  };
  store.createRun(run);
  run.commands.push({
    callId: "check-fixture",
    taskId: "fix-1",
    command: "node --check sample.ts",
    status: "completed",
    exitCode: 0,
    output: "",
    cwd: source,
  });
  store.evidence.saveCommand(run.id, "check-fixture", "FIXTURE_COMMAND_OUTPUT");
  store.updateRun(run);
  store.event(run.id, "TASK_STARTED", "RAW_PAYLOAD_MUST_STAY_TECHNICAL", {
    version: 1,
    taskId: "fix-1",
    activity: "running",
  });
  for (let i = 0; i < 8; i++)
    store.event(run.id, "TOOL_STARTED", `read ${i}`, {
      version: 1,
      taskId: "fix-1",
      activity: "reading",
    });
  store.event(run.id, "MODEL_STEP", "RAW_TOKEN_NOISE", {
    version: 1,
    taskId: "fix-1",
  });
  store.event(run.id, "TASK_FINISHED", "Fixture finished", {
    version: 1,
    taskId: "fix-1",
    activity: "finished",
  });
  store.event(run.id, "RUN_COMPLETED", "Fixture complete", {
    version: 1,
    taskId: null,
    activity: "finished",
  });
  store.addProject(join(directory, "foreign"));
  // Restore selected project ordering without touching runtime settings.
  store.addProject(source);
  store.close();
  require("../out/main/main.js");
  await app.whenReady();
  const win = await until(() => BrowserWindow.getAllWindows()[0]);
  win.webContents.setBackgroundThrottling(false);
  await until(() => !win.webContents.isLoading());
  const errors = [];
  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 3) errors.push(message);
  });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const click = (label) =>
    js(
      `(()=>{const el=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!el)throw new Error('Missing button: '+${JSON.stringify(label)});el.click();})()`,
    );
  const selectTask = (id) =>
    require("./ui-select-test.cjs").selectValue(win, "Chọn task / attempt", id);
  await until(() =>
    js("!!document.querySelector('.project-overview .overview-section')"),
  );
  await js(
    "document.querySelector('nav button[title=\"Trò chuyện\"]').click()",
  );
  await until(() =>
    js(
      "!!document.querySelector('.chat-actions') || !!document.querySelector('.chat-composer textarea')",
    ),
  );
  await until(() =>
    js(
      "Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Chi tiết')",
    ),
  );
  await js(
    `(()=>{const el=document.querySelector('[aria-label="Nhắn tin cho agent"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Bản nháp cần giữ');el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  // Chat latest run + opened RunPanel + inspector all subscribe to the same run store.
  await js(
    "document.querySelector('.message-actions [aria-label=\"Thao tác tin nhắn\"]').click()",
  );
  await click("Hoạt động");
  await until(() =>
    js("!!document.querySelector('.chat-detail-panel .task-timeline')"),
  );
  await click("Chi tiết");
  await until(() =>
    js("!!document.querySelector('.task-inspector[open] .inspector-title')"),
  );
  const countBefore = counts["worker:run-detail"] || 0;
  await pause(2800);
  const sharedCalls = (counts["worker:run-detail"] || 0) - countBefore;
  assert.ok(
    sharedCalls <= 2,
    `Shared terminal run fetched ${sharedCalls} times`,
  );
  assert.equal(counts["worker:task-file-diff"] || 0, 0);
  await selectTask("t1");
  await until(() =>
    js(
      "document.querySelector('.task-inspector').textContent.includes('đã được thay bằng')",
    ),
  );
  assert.equal(
    await js(
      "document.querySelector('.inspector-facts').textContent.includes('snapshot-deepseek-flash')",
    ),
    true,
  );
  assert.equal(
    await js(
      "document.querySelector('.inspector-facts').textContent.includes('configured-current-model')",
    ),
    false,
  );
  await selectTask("t2");
  assert.equal(
    await js(
      "document.querySelector('.inspector-facts').textContent.includes('t1 (fix-1)')",
    ),
    true,
  );
  await selectTask("fix-1");
  win.setSize(1440, 960);
  await pause(200);
  writeFileSync(
    join(output, "inspector-desktop.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  await click("Timeline");
  await until(() =>
    js("!!document.querySelector('.task-inspector .task-timeline')"),
  );
  assert.equal(
    await js(
      "document.querySelector('.task-inspector').textContent.includes('RAW_TOKEN_NOISE')",
    ),
    false,
  );
  assert.equal(
    await js(
      "document.querySelector('.task-inspector .task-timeline').textContent.includes('×8')",
    ),
    false,
  );
  assert.equal(
    await js(
      "document.querySelector('.task-inspector .task-timeline').textContent.includes('RAW_PAYLOAD')",
    ),
    false,
  );
  await js(
    "document.querySelector('.task-inspector .technical-log').open=true",
  );
  await until(() =>
    js(
      "document.querySelector('.task-inspector .technical-log').textContent.includes('RAW_TOKEN_NOISE')",
    ),
  );
  await js(
    "document.querySelector('.task-inspector .technical-log').open=false",
  );
  writeFileSync(
    join(output, "inspector-timeline.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  await js(
    "Array.from(document.querySelectorAll('.task-inspector [role=tab]')).find(b=>b.textContent==='Kết quả').click()",
  );
  assert.equal(counts["worker:command-output"] || 0, 0);
  await js(
    "document.querySelector('.task-inspector .command-result').open=true",
  );
  await until(() =>
    js(
      "document.querySelector('.task-inspector').textContent.includes('FIXTURE_COMMAND_OUTPUT')",
    ),
  );
  assert.equal(counts["worker:command-output"], 1);
  await js(
    "Array.from(document.querySelectorAll('.task-inspector [role=tab]')).find(b=>b.textContent==='Thay đổi').click()",
  );
  await until(() =>
    js(
      "!!document.querySelector('.task-inspector [aria-label=\"Thay đổi của task\"]')",
    ),
  );
  assert.equal(counts["worker:task-file-diff"] || 0, 0);
  await js(
    "Array.from(document.querySelectorAll('.task-inspector button')).find(b=>b.textContent==='Xem diff').click()",
  );
  await until(() =>
    js(
      "document.querySelector('.task-inspector .unified-diff')?.textContent.includes('+export const value = 2;')",
    ),
  );
  assert.equal(counts["worker:task-file-diff"], 1);
  // A later saved source version must clear the old task diff before another lazy read.
  const updateStore = new Store(join(directory, "data"));
  writeFileSync(join(source, "sample.ts"), "export const value = 3;\n");
  const third = await snapshot(source, true);
  run.tasks[1].evidence = updateStore.evidence.saveTaskSnapshot(third);
  updateStore.updateRun(run);
  updateStore.close();
  await until(() =>
    js("!document.querySelector('.task-inspector .unified-diff')"),
  );
  await js(
    "Array.from(document.querySelectorAll('.task-inspector button')).find(b=>b.textContent==='Xem diff').click()",
  );
  await until(() =>
    js(
      "document.querySelector('.task-inspector .unified-diff')?.textContent.includes('+export const value = 3;')",
    ),
  );
  win.setSize(850, 700);
  await pause(200);
  assert.equal(
    await js(
      "document.querySelector('.task-inspector').scrollWidth<=document.querySelector('.task-inspector').clientWidth",
    ),
    true,
  );
  writeFileSync(
    join(output, "inspector-small.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  assert.equal(
    await js(
      "document.querySelector('.task-inspector').contains(document.activeElement)",
    ),
    true,
  );
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await until(() => js("!document.querySelector('.task-inspector[open]')"));
  assert.equal(
    await js(
      "document.querySelector('[aria-label=\"Nhắn tin cho agent\"]').value",
    ),
    "Bản nháp cần giữ",
  );
  await click("Chi tiết");
  await until(() =>
    js("!!document.querySelector('.task-inspector[open] .inspector-title')"),
  );
  await js(
    "Array.from(document.querySelectorAll('.task-inspector button')).find(b=>b.textContent==='Xem bảng công việc').click()",
  );
  await until(() => js("document.querySelectorAll('.board-task').length===1"));
  await js("document.querySelector('.board-card-title').click()");
  await until(() =>
    js("!!document.querySelector('.task-inspector[open] .inspector-title')"),
  );
  await js(
    "Array.from(document.querySelectorAll('.task-inspector button')).find(b=>b.textContent==='Xem đội ngũ').click()",
  );
  await until(() => js("!!document.querySelector('.agent-last button')"));
  await js("document.querySelector('.agent-last button').click()");
  await until(() =>
    js("!!document.querySelector('.task-inspector[open] .inspector-title')"),
  );
  await js(
    "Array.from(document.querySelectorAll('.task-inspector button')).find(b=>b.textContent==='Mở trao đổi').click()",
  );
  await until(() =>
    js(
      "document.querySelector('[aria-label=\"Nhắn tin cho agent\"]')?.value==='Bản nháp cần giữ'",
    ),
  );
  assert.equal(
    await js("!!document.querySelector('.chat-detail-panel')"),
    true,
  );
  const bad = await js(
    `window.worker.taskFileDiff({kind:'file',runId:${JSON.stringify(run.id)},taskId:'t1',attemptId:'fix-1',sessionId:'wrong-session',sourceVersion:'${evidence.sourceVersion}',path:'sample.ts',hash:'${evidence.files["sample.ts"].hash}'})`,
  );
  assert.equal(bad.ok, false);
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    fixture: true,
    providerCalls: 0,
    sharedRunCallsIn2800ms: sharedCalls,
    checks: [
      "Production Electron with real SQLite and IPC",
      "Chat/RunPanel/inspector share one run feed",
      "Exact attempt selection, snapshot model and latest dependency",
      "Compact task timeline hides model payload and preserves technical log",
      "Task diff loads lazily from immutable baseline; invalid session rejected",
      "A new saved source version clears previous diff and reloads exact evidence",
      "Command output is lazy; native dialog keeps focus and closes with Escape",
      "Small window inspector remains within viewport",
      "Chat, Kanban and agent monitor open the shared inspector",
      "Draft and selected conversation survive navigation",
    ],
    rendererErrors: errors,
  };
  writeFileSync(join(output, "v1.3c-ui.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  app.quit();
}
main().catch((error) => {
  console.error(error.stack);
  app.exit(1);
});
