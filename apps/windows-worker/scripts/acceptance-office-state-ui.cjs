// D-03: real Electron/preload/shared monitor store + production projection.
// Only monitor replies use synthetic runtime observations; no provider calls.
const { app, BrowserWindow, ipcMain } = require("electron");
const { resolve, join } = require("node:path");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const { channels } = require("../shared/channels.ts");
const {
  projectMonitor,
  MonitorProjection,
} = require("../electron/controller/monitor.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "office-state-ui-"));
app.setPath("userData", directory);
const output = process.env.ASF_UI_ARTIFACT_DIR
  ? resolve(process.env.ASF_UI_ARTIFACT_DIR)
  : resolve(__dirname, "../../../docs/windows-worker/office-3d/d03");
mkdirSync(output, { recursive: true });
const store = new Store(directory),
  project = store.addProject(join(directory, "source")),
  settings = defaultSettings();
settings.gatewayUrl = "https://unused.example/v1";
settings.agents.forEach((a) => (a.model = "configured-model"));
settings.agents.find((a) => a.role === "pm").enabled = false;
settings.agents.find((a) => a.role === "ba").model = "";
store.save(settings, undefined);
store.conversations.create(project.id);
store.close();
const now = new Date().toISOString();
function task(id, patch = {}) {
  return {
    id,
    role: "be",
    title: `Tác vụ ${id}`,
    instructions: "Fixture",
    allowedPaths: ["src"],
    acceptance: ["Pass"],
    dependsOn: [],
    state: "running",
    model: `runtime-model-${id}`,
    kind: "work",
    round: 0,
    sessionId: null,
    startedAt: now,
    endedAt: null,
    summary: "",
    error: "",
    changes: [],
    commandIds: [],
    observation: {
      executionId: randomUUID(),
      startedAt: now,
      at: now,
      pendingModels: 0,
      tools: {
        tool: { activity: id === "a" ? "editing" : "testing", at: now },
      },
    },
    ...patch,
  };
}
const run = {
  ...require("../../../docs/windows-worker/ww3-live.json").run,
  id: randomUUID(),
  projectId: project.id,
  projectName: "Office fixture",
  workspace: directory,
  settings,
  prompt: "Office fixture",
  mode: "team",
  role: "lead",
  state: "running",
  startedAt: now,
  endedAt: null,
  permissions: [],
  review: null,
  integration: undefined,
  tasks: [
    task("a"),
    task("b"),
    task("c", { role: "fe", state: "queued", dependsOn: ["a"] }),
  ],
};
let offline = false,
  foreign = false,
  active = true;
const projection = new MonitorProjection();
const counts = { calls: 0, inFlight: 0, maxInFlight: 0, unchanged: 0 };
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) =>
  handle(channel, async (...args) => {
    if (channel !== channels.monitorSnapshot) return listener(...args);
    counts.calls++;
    counts.maxInFlight = Math.max(counts.maxInFlight, ++counts.inFlight);
    try {
      const original = await listener(...args);
      if (!original.ok) return original; // Retain production sender/input validation.
      if (offline) return { ok: false, error: "Fixture offline" };
      const data = foreign
        ? projectMonitor(project.id, settings, null, {
            ...run,
            projectId: "other-project",
            projectName: "Dự án khác",
          })
        : projectMonitor(project.id, settings, run, active ? run : null);
      const value = projection.snapshot(args[1], data);
      if (value.unchanged) counts.unchanged++;
      return { ok: true, value };
    } finally {
      counts.inFlight--;
    }
  });
BrowserWindow.prototype.show = function () {};
require("../out/main/main.js");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 150; i++) {
    const value = await fn();
    if (value) return value;
    await pause(100);
  }
  throw new Error("Timed out waiting for office state UI");
}
let win;
app.whenReady().then(async () => {
  try {
    win = await until(() => BrowserWindow.getAllWindows()[0]);
    win.webContents.setBackgroundThrottling(false);
    await until(() => !win.webContents.isLoading());
    const js = (source) => win.webContents.executeJavaScript(source, true);
    const errors = [];
    win.webContents.on("console-message", (event) => {
      if (event.level === "error") errors.push(event.message);
    });
    await until(() => js("!!document.querySelector('.sidebar nav')"));
    await js(
      "document.querySelector('.sidebar nav button[title=\"Văn phòng\"]').click()",
    );
    await until(() =>
      js("document.querySelector('.office-stage')?.dataset.ready==='true'"),
    );
    const label = (role) =>
      js(
        `document.querySelector('.office-seat-label[data-role="${role}"] small')?.textContent`,
      );
    await until(async () => (await label("be")) === "2 tác vụ");
    assert.equal(await label("fe"), "Chờ phụ thuộc");
    assert.equal(await label("pm"), "Đã tắt");
    assert.equal(await label("ba"), "Chưa cấu hình");
    await js("document.querySelector('.office-activity').open=true");
    assert.equal(
      await js("document.querySelectorAll('[data-execution]').length"),
      2,
    );
    const details = await js(
      "document.querySelector('.office-activity-list').textContent",
    );
    assert.ok(
      details.includes("runtime-model-a") &&
        details.includes("runtime-model-b"),
    );
    assert.ok(
      details.includes("Đang sửa file") && details.includes("Đang kiểm thử"),
    );
    assert.ok(details.includes("Chờ dependency"));
    const layouts = [];
    const capture = async (name) => {
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
    for (const size of [
      { width: 1440, height: 960, zoom: 1 },
      { width: 850, height: 700, zoom: 1 },
      { width: 1100, height: 800, zoom: 1.25 },
    ]) {
      win.setSize(size.width, size.height);
      win.webContents.setZoomFactor(size.zoom);
      await pause(600);
      const measured = await js(
        `(()=>{const r=document.querySelector('.office-stage').getBoundingClientRect(),labels=Array.from(document.querySelectorAll('.office-seat-label')).map(el=>{const b=el.getBoundingClientRect();return {role:el.dataset.role,tone:el.dataset.tone,text:el.textContent,visible:getComputedStyle(el).visibility==='visible',left:b.left,right:b.right,top:b.top,bottom:b.bottom,inside:b.left>=r.left&&b.right<=r.right&&b.top>=r.top&&b.bottom<=r.bottom}});return {height:r.height,labels,overflow:document.documentElement.scrollWidth>innerWidth,detailsHeight:document.querySelector('.office-activity-list').getBoundingClientRect().height}})()`,
      );
      assert.equal(measured.overflow, false);
      assert.equal(measured.labels.length, 7);
      assert.ok(
        measured.labels.every((l) => l.visible && l.inside),
        "All activity labels fit at the default camera",
      );
      for (const a of measured.labels)
        for (const b of measured.labels) {
          if (a.role !== b.role)
            assert.ok(
              a.right <= b.left ||
                a.left >= b.right ||
                a.bottom <= b.top ||
                a.top >= b.bottom,
              `${a.role}/${b.role} labels overlap`,
            );
        }
      assert.ok(measured.detailsHeight <= 211);
      layouts.push({ window: size, measured });
      await capture(`active-${size.width}`);
    }
    win.setSize(1440, 960);
    win.webContents.setZoomFactor(1);
    run.permissions = [
      { id: "permission", permission: "edit", patterns: [], taskId: "a" },
    ];
    run.state = "blocked";
    await until(async () => (await label("be")) === "2 tác vụ · Chờ bạn");
    const activity = await js(
      "document.querySelector('.office-activity-list').textContent",
    );
    assert.ok(
      activity.includes("Chờ bạn") && activity.includes("Đang kiểm thử"),
    );
    await capture("permission");
    run.permissions = [];
    run.state = "running";
    run.tasks[0].state = "completed";
    run.tasks[0].endedAt = now;
    await until(async () => (await label("be")) === "Đang kiểm thử");
    assert.equal(
      await js("document.querySelectorAll('[data-execution]').length"),
      1,
    );
    assert.equal(
      await js("document.querySelector('.office-progress strong').textContent"),
      "0/3",
    );
    run.state = "cancelling";
    await until(async () => (await label("be")) === "Đang dừng");
    run.state = "cancelled";
    run.tasks[1].state = "cancelled";
    run.tasks[2].state = "cancelled";
    active = false;
    await until(async () => (await label("be")) === "Rảnh");
    assert.equal(
      await js("document.querySelectorAll('[data-execution]').length"),
      0,
    );
    assert.equal(
      await js("document.querySelector('.office-progress strong').textContent"),
      "0/3",
    );
    foreign = true;
    await until(() =>
      js(
        "document.querySelector('.office-workspace').textContent.includes('Đang chạy ở dự án: Dự án khác')",
      ),
    );
    assert.equal(await label("be"), "Rảnh");
    foreign = false;
    active = true;
    run.state = "running";
    run.tasks[1].state = "running";
    await until(async () => (await label("be")) === "Đang kiểm thử");
    offline = true;
    await until(async () => (await label("be")) === "Chưa đồng bộ");
    assert.equal(
      await js("document.querySelectorAll('[data-execution]').length"),
      0,
    );
    assert.equal(
      await js("document.querySelector('.office-progress strong').textContent"),
      "—",
    );
    assert.equal(
      await js(
        "document.querySelectorAll('.office-seat-label[data-tone=unknown]').length",
      ),
      7,
    );
    await capture("offline");
    offline = false;
    await until(async () => (await label("be")) === "Đang kiểm thử");
    await until(() => counts.unchanged > 0);
    assert.equal(counts.maxInFlight, 1);
    assert.deepEqual(errors, []);
    const result = {
      passed: true,
      version: require("../package.json").version,
      scope: "D-03",
      fixture: true,
      providerCalls: 0,
      projection:
        "production projectMonitor + MonitorProjection through authenticated IPC and shared MonitorStore; synthetic runtime observations",
      verified: [
        "same-role identities/models",
        "dependency wait",
        "disabled/unconfigured",
        "permission scoped to one lane",
        "one lane finishes",
        "stop then idle",
        "unverified completion remains 0/3",
        "foreign active project",
        "offline hides old activity",
        "reconnect",
        "unchanged revisions",
        "no overlapping monitor requests",
      ],
      layouts,
      monitor: counts,
      rendererErrors: errors,
    };
    writeFileSync(join(output, "d03-ui.json"), JSON.stringify(result, null, 2));
    console.log(
      JSON.stringify({
        passed: true,
        layouts: layouts.length,
        monitor: counts,
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
