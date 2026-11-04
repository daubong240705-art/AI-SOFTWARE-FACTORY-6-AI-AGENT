// Built Electron renderer + real IPC/SQLite. Synthetic conversation; no provider.
const { app, BrowserWindow } = require("electron");
const { join, resolve } = require("node:path");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const { loadProfiles } = require("../electron/team/profiles.ts");
const { loadSkillCatalog } = require("../electron/team/skills.ts");
const { newTask } = require("../electron/team/coordinator.ts");
const { emptyMetrics } = require("../electron/runtime/metrics.ts");
const artifacts = resolve(
  __dirname,
  "../../../.cache/asf-research/interaction-ui",
);
mkdirSync(artifacts, { recursive: true });
const directory = mkdtempSync(join(artifacts, "data-"));
app.setPath("userData", directory);
const source = join(directory, "source");
mkdirSync(source);
const store = new Store(directory);
const settings = defaultSettings();
settings.gatewayUrl = "https://unused.example/v1";
settings.permissionMode = "full-access";
settings.agents.forEach((agent) => {
  agent.model = "fixture-model";
});
store.save(settings, undefined);
store.setModels(["fixture-model"]);
const project = store.addProject(source);
const conversation = store.conversations.create(project.id);
const run = {
  id: crypto.randomUUID(),
  projectId: project.id,
  projectName: "Dự án thử",
  workspace: source,
  conversationId: conversation.id,
  prompt: "hi",
  summary: "Chào bạn! Bạn muốn trao đổi ý tưởng hay bắt đầu một công việc?",
  role: "lead",
  model: "fixture-model",
  mode: "team",
  state: "completed",
  tasks: [],
  profiles: loadProfiles(),
  skillCatalog: loadSkillCatalog(),
  currentTaskId: null,
  fixRound: 0,
  review: null,
  settings,
  createdAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  sessionId: "fixture-session",
  changes: [],
  commands: [],
  permissions: [],
  requests: 1,
  inputTokens: 0,
  outputTokens: 0,
  toolsCompleted: 0,
  runtimeVersion: "1.19.5",
  baselineComplete: true,
  error: "",
  metrics: emptyMetrics(),
};
const lead = newTask(run, {
  id: "plan-0-0",
  role: "lead",
  kind: "plan",
  title: "Lead",
  instructions: "Read",
  allowedPaths: ["."],
  acceptance: ["Reply"],
  dependsOn: [],
});
lead.state = "completed";
lead.summary = JSON.stringify({ reply: run.summary });
run.tasks.push(lead);
store.createRun(run);
store.updateRun(run);
store.event(run.id, "MODEL_STEP", "FIXTURE_TELEMETRY input/output tokens");
const workRun = {
  ...structuredClone(run),
  id: crypto.randomUUID(),
  prompt: "Thu gọn giao diện",
  summary: "Đã thu gọn giao diện. Dữ liệu minh họa để kiểm tra bố cục.",
  tasks: [],
  commands: [
    {
      callId: "cmd",
      command: "npm test",
      status: "completed",
      output: "Fixture only",
      exitCode: 0,
    },
  ],
};
const work = newTask(workRun, {
  id: "t1",
  role: "fe",
  kind: "work",
  title: "Thu gọn bảng Hoạt động",
  instructions: "Work",
  allowedPaths: ["src"],
  acceptance: ["Nội dung gọn"],
  dependsOn: [],
});
work.state = "completed";
workRun.tasks.push(work);
store.createRun(workRun);
store.updateRun(workRun);
store.event(
  workRun.id,
  "MODEL_REQUEST",
  "FIXTURE_TELEMETRY internal request/session",
);
store.close();
BrowserWindow.prototype.show = function () {};
require("../out/main/main.js");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    const result = await fn();
    if (result) return result;
    await pause(100);
  }
  throw new Error("UI timeout");
}
app.whenReady().then(async () => {
  let status = 0;
  try {
    const win = await until(() => BrowserWindow.getAllWindows()[0]);
    win.webContents.setBackgroundThrottling(false);
    await until(() => !win.webContents.isLoading());
    const js = (code) => win.webContents.executeJavaScript(code, true);
    await until(() =>
      js(`document.querySelectorAll('.chat-message.assistant').length === 2`),
    );
    assert.equal(
      await js(`document.querySelector('[aria-label="Quyền thực thi"]').value`),
      "full-access",
    );
    assert.equal(
      await js(
        `document.querySelector('[aria-label="Chế độ thực thi"] option:checked').textContent`,
      ),
      "Lead",
    );
    await js(`document.querySelector('[aria-label="Mở chi tiết"]').click()`);
    await until(() => js(`!!document.querySelector('.technical-log')`));
    assert.equal(await js(`document.querySelectorAll('.team-task').length`), 1);
    assert.equal(await js(`document.querySelectorAll('.event-row').length`), 0);
    assert.equal(
      await js(`!!document.querySelector('.technical-log').open`),
      false,
    );
    const capture = async (name) => {
      await js(
        `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
      );
      writeFileSync(
        join(artifacts, name),
        (await win.webContents.capturePage()).toPNG(),
      );
    };
    await capture("activity-desktop.png");
    await js(`document.querySelector('.technical-log summary').click()`);
    await until(() =>
      js(
        `document.querySelector('.event-list')?.textContent.includes('FIXTURE_TELEMETRY')`,
      ),
    );
    await js(`document.querySelector('.technical-log summary').click()`);
    await until(() => js(`!document.querySelector('.event-list')`));
    // The first response is a conversation: no work card or needs-input status.
    await js(
      `document.querySelectorAll('.chat-message.assistant')[0].querySelectorAll('.message-actions button')[1].click()`,
    );
    await until(() =>
      js(
        `document.querySelector('.activity-summary')?.textContent.includes('Đã trả lời.')`,
      ),
    );
    assert.equal(await js(`document.querySelectorAll('.team-task').length`), 0);
    await capture("lead-reply.png");
    win.setSize(850, 700);
    await pause(250);
    assert.equal(
      await js(`document.documentElement.scrollWidth<=window.innerWidth`),
      true,
    );
    await js(
      `document.querySelector('[aria-label="Đóng panel chi tiết"]').click()`,
    );
    await capture("composer-small.png");
    console.log(
      "PASS: Lead conversation, compact activity, expandable technical logs and Full access selector; no horizontal overflow at 850px.",
    );
    console.log("Screenshots: " + artifacts);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "UI check failed");
    status = 1;
  }
  app.exit(status);
});
