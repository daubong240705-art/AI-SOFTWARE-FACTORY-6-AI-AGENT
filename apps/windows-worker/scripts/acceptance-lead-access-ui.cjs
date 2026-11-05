// Production renderer/preload/IPC/SQLite; deterministic Controller execution,
// with no OpenCode process or provider. Real admission and permission handlers.
const { app, BrowserWindow } = require("electron");
const { resolve, join } = require("node:path");
const {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
} = require("node:fs");
const { dirname } = require("node:path");
const { Module } = require("node:module");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const { newTask } = require("../electron/team/coordinator.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "lead-access-ui-")),
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
  throw Error(`Timeout: ${label}`);
}
let executions = 0,
  replies = [],
  fixtureErrors = [],
  win,
  lastRun;
global.__asfFixtureExecute = async function (active) {
  const run = active.run;
  lastRun = run;
  try {
    executions++;
    assert.equal(run.role, "lead");
    assert.equal(run.mode, "team");
    assert.equal(run.leadAdmission, true);
    run.state = "running";
    this.record(active, "RUN_STARTED", "Fixture execution", null);
    if (executions === 1) {
      run.summary = "Lead giải thích công việc. Chưa thực hiện thay đổi.";
      run.state = "completed";
      run.endedAt = new Date().toISOString();
      this.record(active, "LEAD_REPLIED", "Lead đã trả lời", null);
      this.active = undefined;
      return;
    }
    const plan = {
      blockedReason: null,
      testingReason: "Fixture",
      tasks: [
        {
          id: "t1",
          role: "be",
          title: "Cập nhật giao diện",
          instructions: "Fixture task",
          allowedPaths: ["src"],
          acceptance: ["Gọn, rõ"],
          dependsOn: [],
        },
      ],
    };
    run.workContext = this.store.admitPlan(run, plan);
    const work = newTask(run, { ...plan.tasks[0], kind: "work" });
    run.tasks.push(work);
    run.currentTaskId = work.id;
    work.state = "running";
    let finish;
    const done = new Promise((resolve) => {
      finish = resolve;
    });
    active.runtime = {
      reply: async (id, allow) => {
        assert.equal(allow, true);
        replies.push(id);
        if (id === "first-bash") {
          this.onPermission(active, {
            id: "next-bash",
            permission: "bash",
            patterns: ["npm run build"],
          });
          setTimeout(finish, 80);
        }
      },
    };
    this.record(active, "PLAN_ACCEPTED", "Fixture accepted plan", null);
    this.onPermission(active, {
      id: "first-bash",
      permission: "bash",
      patterns: ["npm test"],
    });
    await done;
    work.state = "completed";
    work.endedAt = new Date().toISOString();
    run.summary = "Fixture đã nhận quyền. Chưa có command evidence.";
    run.state = "completed";
    run.endedAt = new Date().toISOString();
    run.currentTaskId = null;
    this.record(active, "RUN_COMPLETED", "Fixture finished", null);
    this.active = undefined;
  } catch (error) {
    fixtureErrors.push(error.stack);
    throw error;
  }
};
async function main() {
  const store = new Store(data),
    project = store.addProject(source),
    settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.forEach((agent) => {
    agent.model = "fixture-model";
  });
  store.save(settings, undefined);
  store.close();
  const mainPath = resolve(__dirname, "../out/main/main.js");
  const built = readFileSync(mainPath, "utf8");
  assert.ok(built.includes("class RunController"));
  // Instrument only this process's compiled module, without editing production
  // source/output. All handlers/admission/reply routes remain the built versions.
  const compiled = new Module(mainPath, module);
  compiled.filename = mainPath;
  compiled.paths = Module._nodeModulePaths(dirname(mainPath));
  compiled._compile(
    built + "\nRunController.prototype.execute = global.__asfFixtureExecute;",
    mainPath,
  );
  win = await until(() => BrowserWindow.getAllWindows()[0]);
  win.webContents.setBackgroundThrottling(false);
  await until(() => !win.webContents.isLoading());
  const errors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const click = (label) =>
    js(
      `(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.getClientRects().length && b.textContent.trim()===${JSON.stringify(label)}); if(!b)throw Error('Missing '+${JSON.stringify(label)}); b.click();})()`,
    );
  const input = (text) =>
    js(
      `(()=>{const e=document.querySelector('[aria-label="Nhắn tin cho agent"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  const choose = async (label, value) => {
    await js(
      `document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`,
    );
    await until(() => js("!!document.querySelector('.ui-select-menu')"));
    await js(
      `document.querySelector('.ui-select-menu [data-value="${value}"]').click()`,
    );
  };
  await until(() => js("!!document.querySelector('.workspace-home')"));
  await until(
    () =>
      js(
        `!!document.querySelector('[data-project-id="${project.id}"]:not(:disabled)')`,
      ),
    "project ready",
  );
  await js(
    `document.querySelector('[data-project-id="${project.id}"]').click()`,
  );
  await until(() => js("!!document.querySelector('.project-navigation')"));
  await click("Trao đổi");
  await until(() =>
    js(
      "!!document.querySelector('.chat-host:not([hidden]) textarea:not(:disabled)')",
    ),
  );
  assert.equal(
    await js("document.querySelector('.chat-recipient').textContent"),
    "Lead",
  );
  assert.equal(
    await js("!!document.querySelector('[aria-label=\"Model LEAD\"]')"),
    false,
    "model hidden from normal composer",
  );
  await input("Nháp trao đổi với Lead");
  await js(
    "document.querySelector('[aria-label=\"Tùy chọn trao đổi\"]').click()",
  );
  await until(() =>
    js("!!document.querySelector('[aria-label=\"Chế độ thực thi\"]')"),
  );
  await choose("Chế độ thực thi", "direct");
  await until(() =>
    js("!!document.querySelector('[aria-label=\"Vai trò thực thi\"]')"),
  );
  await choose("Vai trò thực thi", "be");
  assert.equal(
    await js("document.querySelector('.chat-recipient').textContent"),
    "BE",
  );
  await choose("Chế độ thực thi", "team");
  assert.equal(
    await js("document.querySelector('.chat-recipient').textContent"),
    "Lead",
  );
  await js(
    "document.querySelector('[aria-label=\"Tùy chọn trao đổi\"]').click()",
  );
  assert.equal(
    await js(
      "document.querySelector('[aria-label=\"Nhắn tin cho agent\"]').value",
    ),
    "Nháp trao đổi với Lead",
  );
  await js("document.querySelector('[aria-label=\"Gửi yêu cầu\"]').click()");
  await until(() =>
    js(
      "document.querySelector('.chat-scroll').textContent.includes('Lead giải thích công việc')",
    ),
  );
  let db = new Store(data);
  assert.equal(db.board.summaries(project.id).length, 0);
  db.close();
  await input("Hãy triển khai công việc đã trao đổi");
  await until(() =>
    js("!!document.querySelector('[aria-label=\"Gửi yêu cầu\"]')"),
  );
  await js("document.querySelector('[aria-label=\"Gửi yêu cầu\"]').click()");
  await until(
    () => js("!!document.querySelector('.chat-permission')"),
    "Bash permission",
  );
  assert.equal(lastRun.settings.permissionMode, "ask");
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
      "(()=>{const a=document.querySelector('.chat-permission'),b=Array.from(a.querySelectorAll('button')).find(b=>b.textContent.includes('Full access')),r=b.getBoundingClientRect();return {width:innerWidth,height:innerHeight,right:r.right,bottom:r.bottom,overflow:a.scrollWidth>a.clientWidth+1}})()",
    );
    assert.equal(layout.overflow, false);
    assert.ok(
      layout.right <= layout.width + 1 && layout.bottom <= layout.height + 1,
    );
    layouts.push({ width, height, zoom, ...layout });
    writeFileSync(
      join(directory, `permission-${width}-${zoom}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
  }
  await click("Full access cho lượt này");
  await until(() => js("!document.querySelector('.chat-permission')"));
  await until(() => lastRun.state === "completed");
  assert.deepEqual(replies, ["first-bash", "next-bash"]);
  db = new Store(data);
  const items = db.board.summaries(project.id);
  assert.equal(items.length, 1);
  assert.equal(
    db.board.detail({ projectId: project.id, itemId: items[0].id }).submissions
      .length,
    1,
  );
  assert.equal(db.settings().permissionMode, "ask");
  assert.equal(db.run(lastRun.id).settings.permissionMode, "full-access");
  assert.equal(
    db.events(lastRun.id).filter((event) => event.type === "RUN_ACCESS_GRANTED")
      .length,
    1,
  );
  db.close();
  assert.equal(
    (await js(`window.worker.grantRunAccess(${JSON.stringify(lastRun.id)})`))
      .ok,
    false,
    "terminal runs reject upgrade",
  );
  assert.deepEqual(fixtureErrors, []);
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    directory,
    layouts: layouts.length,
    providerCalls: 0,
    replies,
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
  try {
    if (win)
      writeFileSync(
        join(directory, "failure.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
  } catch {}
  app.exit(1);
});
