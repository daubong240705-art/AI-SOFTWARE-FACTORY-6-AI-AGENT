// UX-05: production renderer/preload/IPC, isolated SQLite, no provider calls.
const { app, BrowserWindow, dialog, ipcMain, protocol } = require("electron");
const { resolve, join } = require("node:path");
const {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
} = require("node:fs");
const assert = require("node:assert/strict");
// Snapshot fixtures yield until after Electron is ready. Register the production
// scheme now, then assert main requests that same registration when loaded later.
const schemes = [
  {
    scheme: "asf-image",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
];
protocol.registerSchemesAsPrivileged(schemes);
protocol.registerSchemesAsPrivileged = (requested) =>
  assert.deepEqual(requested, schemes);
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const { snapshot } = require("../electron/workspace/snapshot.ts");
const { channels } = require("../shared/channels.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "reports-ui-")),
  data = join(directory, "data"),
  source = join(directory, "source");
mkdirSync(source);
app.setPath("userData", data);
BrowserWindow.prototype.show = function () {};
dialog.showSaveDialog = async () => ({
  canceled: false,
  filePath: join(directory, "report.json"),
});
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(fn, label = "UI") {
  for (let i = 0; i < 100; i++) {
    const result = await fn();
    if (result) return result;
    await pause(100);
  }
  throw Error(`Timeout: ${label}`);
}
let win,
  loseReply = false;
const counts = {},
  originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) =>
  originalHandle(channel, async (...args) => {
    counts[channel] = (counts[channel] || 0) + 1;
    const result = await listener(...args);
    if (channel === channels.reportDecision && result.ok && loseReply) {
      loseReply = false;
      return { ok: false, error: "Fixture lost reply" };
    }
    return result;
  });
async function main() {
  let store = new Store(data);
  const project = store.addProject(source),
    settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.forEach((a) => (a.model = "fixture-model"));
  store.save(settings, undefined);
  const fixtures = [];
  writeFileSync(join(source, "result.txt"), "before\n");
  for (const name of ["Bản nghiệm thu", "Bản cần sửa"]) {
    const item = store.board.create({
      projectId: project.id,
      title: name,
      body: "Yêu cầu gốc",
      criteria: ["Hiển thị đúng kết quả"],
      priority: 0,
      suggestedRole: null,
      planningState: "ready",
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
      prompt: name,
      mode: "direct",
      role: "be",
      state: "running",
      tasks: [],
      profiles: [],
      permissions: [],
      commands: [],
      changes: [],
      review: null,
      retryOf: undefined,
      attemptRoot: undefined,
      recoveryOf: undefined,
      integration: undefined,
      createdAt: new Date().toISOString(),
      endedAt: null,
      currentTaskId: null,
      workContext: store.board.chatSnapshot(
        project.id,
        item.id,
        1,
        context.conversationId,
      ),
      error: "",
      summary: `## ${name}\n\n| File | Kết quả |\n| --- | --- |\n| ${"result/".repeat(30)} | Hoàn thành |\n\n\`\`\`txt\n${"code_".repeat(120)}\n\`\`\`\n\n<script>window.BAD_REPORT=true</script>`,
    };
    store.createRun(run);
    store.board.attachChat(crypto.randomUUID(), run.workContext, {
      runId: run.id,
      followUpId: null,
    });
    const before = await snapshot(source, true);
    store.evidence.begin(run.id, source, before, {
      state: null,
      versions: {},
      blobs: new Map(),
    });
    writeFileSync(join(source, "result.txt"), "after\n");
    const after = await snapshot(source, true);
    store.evidence.finish(run.id, after, {
      state: null,
      versions: {},
      blobs: new Map(),
    });
    run.changes = [{ path: "result.txt", kind: "modified" }];
    run.commands = [
      {
        command: "npm test",
        callId: "missing-output",
        status: "completed",
        exitCode: 0,
        output: "Legacy claim",
      },
    ];
    run.state = "completed";
    run.endedAt = new Date().toISOString();
    store.updateRun(run);
    fixtures.push({ item, context, run });
  }
  store.close();
  require("../out/main/main.js");
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
      `(()=>{const b=Array.from(document.querySelectorAll('.detail-open button')).find(b=>b.getClientRects().length && b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing button '+${JSON.stringify(label)});b.click();})()`,
    );
  const open = async (name) => {
    await until(() =>
      js(
        "!!document.querySelector('.workspace-home') || !!document.querySelector('.project-navigation')",
      ),
    );
    if (await js("!!document.querySelector('.workspace-home')")) {
      await js(
        `document.querySelector('[data-project-id="${project.id}"]').click()`,
      );
      await until(() => js("!!document.querySelector('.project-navigation')"));
      await js(
        "document.querySelector('[aria-label=\"Khác trong dự án\"]').click()",
      );
      await js(
        "Array.from(document.querySelectorAll('.project-more button')).find(b=>b.textContent.trim()==='Tổng quan dự án').click()",
      );
    }
    await until(() =>
      js("!!document.querySelector('.overview-results button')"),
    );
    await js(
      `Array.from(document.querySelectorAll('.overview-results button')).find(b=>b.textContent.includes(${JSON.stringify(name)})).click()`,
    );
    await until(
      () => js("!!document.querySelector('.work-report .report-heading')"),
      "report opened directly",
    );
  };
  await open(fixtures[0].run.prompt);
  assert.equal(
    await js(
      "document.querySelector('.work-panel-tabs [aria-pressed=true]')?.textContent==='Kết quả'",
    ),
    true,
  );
  assert.equal(
    await js("document.querySelector('.report-policy input').checked"),
    false,
  );
  assert.equal(await js("!!window.BAD_REPORT"), false);
  assert.equal(
    await js(
      "document.querySelector('.work-report').textContent.includes('Kiểm chứng: Chưa xác định')",
    ),
    true,
  );
  await js("document.querySelector('.report-policy input').click()");
  await until(() =>
    js(
      "document.querySelector('.report-acceptance').textContent.includes('Chờ nghiệm thu')",
    ),
  );
  await click("Nghiệm thu");
  await until(() =>
    js(
      "document.querySelector('.report-acceptance').textContent.includes('Đã nghiệm thu phiên bản này')",
    ),
  );
  await click("Xuất báo cáo");
  await until(() => {
    try {
      return JSON.parse(readFileSync(join(directory, "report.json"))).result;
    } catch {
      return false;
    }
  });
  const exported = JSON.parse(
    readFileSync(join(directory, "report.json")),
  ).result;
  assert.equal(exported.manifest.revision, 1);
  assert.equal(exported.attachments[0].status, "missing");
  assert.equal(exported.report.verification, "unknown");
  await js("document.querySelector('[aria-label=\"Đóng hồ sơ\"]').click()");
  await open(fixtures[1].run.prompt);
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
      "(()=>{const d=document.querySelector('.detail-open'),c=document.querySelector('.work-report'),r=c.getBoundingClientRect();return {width:innerWidth,right:r.right,left:r.left,overflow:d.scrollWidth>d.clientWidth+2,reportOverflow:c.scrollWidth>c.clientWidth+2};})()",
    );
    assert.equal(layout.overflow, false, JSON.stringify(layout));
    assert.equal(layout.reportOverflow, false, JSON.stringify(layout));
    assert.ok(
      layout.left >= 0 && layout.right <= layout.width + 1,
      JSON.stringify(layout),
    );
    layouts.push({ width, height, zoom, ...layout });
    writeFileSync(
      join(directory, `report-${width}-${zoom}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
  }
  win.setSize(1366, 768);
  win.webContents.setZoomFactor(1);
  store = new Store(data);
  store.queue.add({
    projectId: project.id,
    conversationId: fixtures[1].context.conversationId,
    prompt: "Hold fixture",
    role: "lead",
    mode: "team",
    settings,
    afterRunId: null,
    state: "held",
    reason: "No provider",
  });
  store.close();
  await click("Yêu cầu sửa");
  await js(
    "(()=>{const e=document.querySelector('.report-acceptance textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Sửa căn lề tiếng Việt');e.dispatchEvent(new Event('input',{bubbles:true}));})()",
  );
  loseReply = true;
  await click("Gửi yêu cầu sửa");
  await until(() =>
    js(
      "document.querySelector('.work-report [role=alert]')?.textContent.includes('Fixture lost reply')",
    ),
  );
  await click("Gửi yêu cầu sửa");
  await until(() =>
    js(
      "document.querySelector('.report-acceptance').textContent.includes('Đã gửi yêu cầu sửa')",
    ),
  );
  const queue = (
    await js(
      `window.worker.conversation(${JSON.stringify(fixtures[1].context.conversationId)})`,
    )
  ).value.queue;
  assert.equal(queue.length, 2);
  store = new Store(data);
  assert.equal(
    store.board.detail({ projectId: project.id, itemId: fixtures[1].item.id })
      .comments.length,
    1,
  );
  const current = store.board.item(fixtures[1].item.id);
  store.board.update({
    id: current.id,
    version: current.version,
    patch: { criteria: ["Tiêu chí phiên bản hai"] },
  });
  store.close();
  const stale = await js(
    `window.worker.workReport(${JSON.stringify({ projectId: project.id, runId: fixtures[1].run.id })})`,
  );
  assert.equal(stale.value.freshness, "stale");
  assert.equal(stale.value.report.work.revision, 1);
  win.webContents.reload();
  await until(() => !win.webContents.isLoading());
  await open(fixtures[1].run.prompt);
  assert.equal(
    await js(
      "document.querySelector('.report-acceptance').textContent.includes('Báo cáo cũ')",
    ),
    true,
  );
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
