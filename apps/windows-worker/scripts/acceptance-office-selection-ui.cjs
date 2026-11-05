// D-04: isolated SQLite, real inspector/board IPC, synthetic live monitor only.
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
const { projectBoard } = require("../electron/controller/board.ts");
const { officeSeats, officeZoom } = require("../src/features/office/layout.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "office-selection-ui-"));
const source = join(directory, "source");
mkdirSync(source);
mkdirSync(join(directory, "foreign"));
const output = process.env.ASF_UI_ARTIFACT_DIR
  ? resolve(process.env.ASF_UI_ARTIFACT_DIR)
  : resolve(__dirname, "../../../docs/windows-worker/office-3d/d04");
mkdirSync(output, { recursive: true });
app.setPath("userData", directory);
const store = new Store(directory),
  settings = defaultSettings();
settings.gatewayUrl = "https://unused.example/v1";
settings.agents.forEach((a) => (a.model = "configured-current"));
store.save(settings, undefined);
store.addProject(join(directory, "foreign"));
const project = store.addProject(source);
const conversation = store.conversations.create(project.id);
const now = new Date().toISOString();
const task = (id, patch = {}) => ({
  id,
  role: "be",
  title: `Task ${id}`,
  instructions: `Instructions ${id}`,
  allowedPaths: [`src/${id}.ts`],
  acceptance: ["Pass"],
  dependsOn: [],
  state: "running",
  model: `runtime-${id}`,
  kind: "work",
  round: 0,
  sessionId: null,
  workspace: join(source, id),
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
    tools: { tool: { activity: id === "a" ? "editing" : "testing", at: now } },
  },
  ...patch,
});
const base = require("../../../docs/windows-worker/ww3-live.json").run;
const team = {
  ...base,
  id: randomUUID(),
  projectId: project.id,
  projectName: "Office selection",
  conversationId: conversation.id,
  workspace: source,
  settings,
  prompt: "Office team fixture",
  mode: "team",
  role: "lead",
  state: "interrupted",
  startedAt: now,
  endedAt: null,
  review: null,
  integration: undefined,
  permissions: [],
  commands: [],
  changes: [],
  observation: undefined,
  summary: "",
  error: "",
  tasks: [
    task("a"),
    task("b"),
    task("c", { role: "fe", state: "queued", dependsOn: ["a"] }),
  ],
};
const direct = {
  ...team,
  id: randomUUID(),
  prompt: "Direct fixture",
  mode: "direct",
  role: "fe",
  model: "runtime-direct",
  tasks: [],
  observation: {
    executionId: randomUUID(),
    startedAt: now,
    at: now,
    pendingModels: 1,
    tools: {},
  },
};
store.createRun(direct);
store.createRun(team);
store.close();
let current = team,
  offline = false;
const counts = {},
  opened = [],
  projection = new MonitorProjection();
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) =>
  handle(channel, async (...args) => {
    counts[channel] = (counts[channel] || 0) + 1;
    const original = await listener(...args);
    if (!original.ok || channel !== channels.monitorSnapshot) return original;
    if (offline) return { ok: false, error: "Fixture offline" };
    const request = args[1];
    const belongs = request.projectId === current.projectId;
    const data = projectMonitor(
      request.projectId,
      settings,
      belongs ? current : null,
      current,
    );
    if (request.board) {
      const boardRun = {
        id: current.id,
        rootId: current.id,
        conversationId: conversation.id,
        state: current.state,
        mode: current.mode,
        prompt: current.prompt,
        model: current.model,
        role: current.role,
        createdAt: current.createdAt,
        endedAt: null,
        integrationState: null,
        reviewVerified: false,
        tasks: current.tasks.map((t) => ({
          ...t,
          acceptanceCount: t.acceptance.length,
        })),
        changes: 0,
        error: "",
      };
      data.board = projectBoard(
        [],
        [],
        belongs ? [boardRun] : [],
        [],
        request.board,
      );
    }
    return { ok: true, value: projection.snapshot(request, data) };
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
  throw new Error("Timed out waiting for office selection UI");
}
let win;
app.whenReady().then(async () => {
  try {
    const { OrthographicCamera, Vector3 } = await import("three");
    win = await until(() => BrowserWindow.getAllWindows()[0]);
    win.webContents.setBackgroundThrottling(false);
    await until(() => !win.webContents.isLoading());
    // Restore synthetic live fixtures after startup interruption recovery. The
    // controller still owns no runtime; no tools or models are started.
    const fixtureStore = new Store(directory);
    team.state = "running";
    const save = (run) => fixtureStore.updateRun(run);
    save(team);
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const errors = [];
    win.webContents.on("console-message", (event) => {
      if (event.level === "error") errors.push(event.message);
    });
    const nav = async (title) => {
      await js(
        `document.querySelector('.sidebar nav button[title=${JSON.stringify(title)}]').click()`,
      );
      if (title === "Văn phòng")
        await until(() =>
          js("document.querySelector('.office-stage')?.dataset.ready==='true'"),
        );
    };
    const click = (label, scope = "document") =>
      js(
        `Array.from(${scope}.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`,
      );
    const seat = (role) =>
      js(
        `document.querySelector('.office-seat-label[data-role="${role}"]').click()`,
      );
    const selected = (role) =>
      js(
        `document.querySelector('.office-seat-label[data-role="${role}"]')?.getAttribute('aria-pressed')==='true'`,
      );
    const close = async () => {
      await click("Đóng chi tiết công việc");
      await until(() => js("!document.querySelector('.task-inspector[open]')"));
    };
    const openTask = async (id, expected) => {
      await js(
        `(()=>{const button=document.querySelector('[data-${id === "c" ? "waiting" : "execution"}="${id === "c" ? id : (current.tasks.find((t) => t.id === id)?.observation.executionId ?? current.observation.executionId)}"] .office-task-link');button.focus();button.click()})()`,
      );
      await until(() =>
        js(
          `document.querySelector('.inspector-title')?.textContent===${JSON.stringify(expected)}`,
        ),
      );
      const facts = await js(
        "document.querySelector('.inspector-facts').textContent",
      );
      const target = current.tasks.find((t) => t.id === id);
      assert.ok(facts.includes(target?.model ?? current.model));
      assert.ok(facts.includes(target?.workspace ?? current.workspace));
      assert.ok(!facts.includes("configured-current"));
      if (target?.state !== "queued")
        assert.ok(
          facts.includes(
            target?.observation.executionId ?? current.observation.executionId,
          ),
        );
      opened.push({
        taskId: target?.id ?? null,
        executionId:
          target?.observation.executionId ?? current.observation?.executionId,
        model: target?.model ?? current.model,
      });
    };
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
    await until(() => js("!!document.querySelector('.sidebar nav')"));
    await until(() =>
      js("!!document.querySelector('.chat-composer textarea')"),
    );
    await js(
      "Array.from(document.querySelectorAll('.recent-project')).find(b=>b.textContent.includes('source')).click()",
    );
    await until(() =>
      js(
        "document.querySelector('.recent-row.selected')?.textContent.includes('source') && !document.querySelector('.recent-project')?.disabled && !!document.querySelector('.chat-composer textarea')",
      ),
    );
    win.setSize(1440, 960);
    win.webContents.setZoomFactor(1);
    await nav("Văn phòng");
    await until(() =>
      js(
        "document.querySelector('.office-seat-label[data-role=be]')?.dataset.executions==='2'",
      ),
    );
    await seat("be");
    assert.equal(await selected("be"), true);
    assert.equal(
      await js("document.querySelector('.office-activity').open"),
      true,
    );
    assert.equal(
      await js("document.querySelectorAll('[data-execution]').length"),
      2,
    );
    assert.equal(
      await js("document.querySelectorAll('[data-waiting]').length"),
      0,
    );
    await openTask("b", "Task b");
    const layouts = [];
    for (const size of [
      { width: 1440, height: 960, zoom: 1 },
      { width: 850, height: 700, zoom: 1 },
      { width: 1100, height: 800, zoom: 1.25 },
    ]) {
      win.setSize(size.width, size.height);
      win.webContents.setZoomFactor(size.zoom);
      await pause(350);
      const measured = await js(
        "(()=>{const d=document.querySelector('.task-inspector'),r=d.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:d.scrollWidth>d.clientWidth}})()",
      );
      assert.ok(
        measured.left >= 0 &&
          measured.right <= measured.width + 1 &&
          measured.top >= 0 &&
          measured.bottom <= measured.height + 1,
      );
      assert.equal(measured.overflow, false);
      layouts.push({ window: size, measured });
      await capture(`inspector-${size.width}`);
    }
    win.setSize(1440, 960);
    win.webContents.setZoomFactor(1);
    await close();
    assert.equal(
      await js(
        "document.activeElement?.closest('[data-execution]')?.dataset.execution",
      ),
      team.tasks[1].observation.executionId,
    );
    await openTask("a", "Task a");
    await click(
      "Xem bảng công việc",
      "document.querySelector('.task-inspector')",
    );
    await until(() =>
      js("document.querySelectorAll('.board-task.selected').length===1"),
    );
    assert.equal(
      await js(
        "document.querySelector('.board-task.selected .board-card-title').textContent",
      ),
      team.prompt,
    );
    await js(
      "document.querySelector('.board-task.selected .board-card-title').click()",
    );
    await until(() =>
      js("document.querySelector('.inspector-title')?.textContent==='Task a'"),
    );
    await click("Văn phòng", "document.querySelector('.task-inspector')");
    await until(() => selected("be"));
    await until(() =>
      js("!!document.querySelector('.office-task-link[aria-current=true]')"),
    );
    assert.equal(
      await js(
        "document.querySelector('.office-task-link[aria-current=true]').textContent",
      ),
      "Task a",
    );
    await seat("fe");
    await openTask("c", "Task c");
    await close();
    // Send browser key input directly: hidden windows do not have OS focus.
    await seat("be");
    await js(
      "document.querySelector('[data-execution] .office-task-link').focus()",
    );
    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      text: "\r",
    });
    await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await until(() => js("!!document.querySelector('.task-inspector[open]')"));
    await close();
    // Actual canvas raycast, using the production orthographic camera/layout.
    await seat("pm");
    await capture("before-canvas-selection");
    await until(() =>
      js(
        "(()=>{const b=document.querySelector('.office-seat-label[data-role=be]');return b.style.visibility==='visible'&&parseFloat(b.style.left)>100})()",
      ),
    );
    await until(() =>
      js(
        "(()=>{const s=document.querySelector('.office-stage'),c=s.querySelector('canvas');return c.clientWidth>500&&Math.abs(c.clientWidth-s.clientWidth)<2&&Math.abs(c.clientHeight-s.clientHeight)<2})()",
      ),
    );
    await pause(300);
    const bounds = await js(
      "(()=>{const r=document.querySelector('.office-stage canvas').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})()",
    );
    const camera = new OrthographicCamera(
      -bounds.width / 2,
      bounds.width / 2,
      bounds.height / 2,
      -bounds.height / 2,
      0.1,
      150,
    );
    camera.position.set(16, 19, 21);
    camera.lookAt(0, 0, 0);
    camera.zoom = officeZoom(bounds.width, bounds.height);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const be = officeSeats.find((s) => s.role === "be");
    const p = new Vector3(be.x, 1.48, be.z + 1).project(camera);
    let point = {
      x: Math.round(bounds.left + ((p.x + 1) * bounds.width) / 2),
      y: Math.round(bounds.top + ((1 - p.y) * bounds.height) / 2),
    };
    // Read the rendered head's neighborhood relative to its HTML seat anchor;
    // the demand renderer can finish camera resizing after the DOM dimensions.
    // Use only a canvas hit, never the overlaid HTML button, for this check.
    const anchor = await js(
      "(()=>{const r=document.querySelector('.office-seat-label[data-role=be]').getBoundingClientRect();return {x:(r.left+r.right)/2,y:r.bottom}})()",
    );
    const candidates = [
      point,
      ...[12, 20, 30, 40].flatMap((dy) =>
        [-8, 0, 8].map((dx) => ({
          x: Math.round(anchor.x + dx),
          y: Math.round(anchor.y + dy),
        })),
      ),
    ];
    let hit = false;
    for (const candidate of candidates) {
      if (
        !(await js(
          `document.elementFromPoint(${candidate.x},${candidate.y})?.tagName==='CANVAS'`,
        ))
      )
        continue;
      await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        ...candidate,
      });
      await pause(80);
      if (
        await js(
          "document.querySelector('.office-stage').dataset.hoveredRole==='be'",
        )
      ) {
        point = candidate;
        hit = true;
        break;
      }
    }
    assert.ok(hit, "Pointer must hit BE geometry through canvas raycasting");
    await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...point,
    });
    await until(() =>
      js("document.querySelector('.office-stage').dataset.hoveredRole==='be'"),
    );
    await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await until(() => selected("be"));
    win.webContents.debugger.detach();
    await capture("selected-be");
    await openTask("b", "Task b");
    await click("Mở trao đổi", "document.querySelector('.task-inspector')");
    await until(() =>
      js(
        "!!document.querySelector('.chat-workspace') || !!document.querySelector('.chat-composer')",
      ),
    );
    await nav("Văn phòng");
    await until(() => selected("be"));
    team.tasks[0].state = "completed";
    team.tasks[0].endedAt = now;
    save(team);
    await until(() =>
      js("document.querySelectorAll('[data-execution]').length===1"),
    );
    assert.equal(
      await js("document.querySelector('[data-execution]').dataset.execution"),
      team.tasks[1].observation.executionId,
    );
    offline = true;
    await until(() =>
      js(
        "document.querySelectorAll('.office-seat-label[data-tone=unknown]').length===7",
      ),
    );
    assert.equal(
      await js("document.querySelectorAll('.office-task-link').length"),
      0,
    );
    offline = false;
    team.state = "cancelled";
    team.endedAt = now;
    save(team);
    direct.state = "running";
    save(direct);
    current = direct;
    await seat("fe");
    await until(() =>
      js("document.querySelectorAll('[data-execution]').length===1"),
    );
    await openTask("direct", "Direct fixture");
    await close();
    await nav("Công việc");
    await until(() => js("!!document.querySelector('.kanban-workspace')"));
    // Switch project using the real project selector, then ensure old office selection is cleared.
    await js(
      `Array.from(document.querySelectorAll('.recent-project')).find(b=>b.textContent.includes('foreign')).click()`,
    );
    await until(() =>
      js(
        "document.querySelector('.recent-row.selected')?.textContent.includes('foreign') && !document.querySelector('.recent-project')?.disabled && !!document.querySelector('.chat-composer textarea')",
      ),
    );
    await nav("Văn phòng");
    await until(() =>
      js("document.querySelector('.office-stage').dataset.selectedRole===''"),
    );
    assert.equal(
      await js("document.querySelectorAll('.office-task-link').length"),
      0,
    );
    assert.equal(
      await js(
        "document.querySelectorAll('.office-seat-label[aria-pressed=true]').length",
      ),
      0,
    );
    assert.deepEqual(errors, []);
    fixtureStore.close();
    const result = {
      passed: true,
      version: require("../package.json").version,
      scope: "D-04",
      fixture: true,
      providerCalls: 0,
      monitor:
        "synthetic active run through production projection; runDetail reads isolated SQLite through real IPC",
      checks: [
        "same-role exact task/model/workspace",
        "queued dependency inspector",
        "direct null task",
        "native button keyboard activation",
        "focus restored",
        "canvas hover and click raycast",
        "Kanban selected parent retains exact task",
        "inspector returns to highlighted office task",
        "Chat navigation preserves role",
        "finishing one execution preserves other",
        "offline disables stale task links",
        "switching project clears agent/task selection",
      ],
      opened,
      layouts,
      calls: counts,
      rendererErrors: errors,
    };
    writeFileSync(join(output, "d04-ui.json"), JSON.stringify(result, null, 2));
    console.log(
      JSON.stringify({
        passed: true,
        layouts: layouts.length,
        opened: opened.length,
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
