// Production main/preload/renderer with an isolated DB and main-process clock.
const { app, BrowserWindow, ipcMain, powerMonitor } = require("electron");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { channels } = require("../shared/channels.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "schedules-ui-"));
const data = join(directory, "data"),
  source = join(directory, "source");
mkdirSync(source);
app.setPath("userData", data);
BrowserWindow.prototype.show = function () {};
const RealDate = Date;
let clock = RealDate.parse("2026-11-05T01:00:00.000Z");
global.Date = class extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [clock]));
  }
  static now() {
    return clock;
  }
};
const handle = ipcMain.handle.bind(ipcMain);
const counts = {};
ipcMain.handle = (channel, listener) =>
  handle(channel, async (...args) => {
    counts[channel] = (counts[channel] || 0) + 1;
    assert.ok(
      ![
        channels.sendChat,
        channels.startRun,
        channels.enqueue,
        channels.fetchModels,
        channels.prune,
      ].includes(channel),
      "Schedules must not dispatch agents or fetch models",
    );
    return listener(...args);
  });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label = "UI") {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await pause(80);
  }
  throw Error(`Timeout ${label}`);
}
let win;
async function main() {
  let store = new Store(data);
  const project = store.addProject(source),
    foreign = store.addProject(directory);
  store.close();
  require("../out/main/main.js");
  await until(() => (win = BrowserWindow.getAllWindows()[0]));
  win.setMinimumSize(500, 400);
  win.webContents.setBackgroundThrottling(false);
  const errors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  const js = (code) =>
    win.webContents.executeJavaScript(code, true).catch((error) => {
      throw Error(`${error.message}\n${code}\n${errors.join("\n")}`);
    });
  const click = async (label, scope = "document") => {
    const expr = `Array.from(${scope}.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
    await until(() => js(`!!(${expr})`), label);
    await js(`(${expr}).click()`);
    await pause(80);
  };
  const input = (selector, text) =>
    js(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  const api = async (method, arg) => {
    const result = await js(`window.worker.${method}(${JSON.stringify(arg)})`);
    assert.ok(result.ok, result.error);
    return result.value;
  };
  await until(() => js('!!document.querySelector(".workspace-home")'));
  await js(
    `document.querySelector('[data-project-id="${project.id}"]').click()`,
  );
  // Project buttons have a stable title even if sidebar presentation changes.
  if (!(await js('!!document.querySelector(".project-navigation")'))) {
    await js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.title===${JSON.stringify(source)})?.click()`,
    );
  }
  await until(
    () => js('!!document.querySelector(".project-navigation")'),
    "project",
  );
  await js(
    `document.querySelector('[aria-label="Thêm mục trong dự án"]').click()`,
  );
  await click("Lịch");
  await until(() => js('!!document.querySelector(".schedules-workspace")'));
  await click("Tạo lịch");
  await input('.schedule-dialog input[maxlength="100"]', "Review định kỳ");
  await input('.schedule-dialog input[maxlength="160"]', "Kiểm tra chất lượng");
  await input(
    '.schedule-dialog textarea[rows="4"]',
    "Đọc các thay đổi và báo vấn đề.",
  );
  await input(
    '.schedule-dialog textarea[rows="3"]',
    "Có kết luận\nCó bằng chứng",
  );
  assert.equal(
    await js('document.querySelector(".schedule-dialog .primary").disabled'),
    true,
  );
  await click("Xem trước", 'document.querySelector(".schedule-dialog")');
  await until(() => js('!!document.querySelector(".schedule-preview")'));
  assert.equal((await api("scheduleList", project.id)).schedules.length, 0);
  await input('.schedule-dialog input[maxlength="100"]', "Review buổi sáng");
  assert.equal(
    await js('!!document.querySelector(".schedule-preview")'),
    false,
    "Changing fields invalidates preview",
  );
  await click("Xem trước", 'document.querySelector(".schedule-dialog")');
  await click("Lưu · mặc định tắt");
  let listing = await api("scheduleList", project.id),
    record = listing.schedules[0];
  assert.equal(record.enabled, false);
  assert.equal((await api("scheduleList", foreign.id)).schedules.length, 0);
  const bad = await js(
    `window.worker.scheduleHistory({projectId:${JSON.stringify(foreign.id)},id:${JSON.stringify(record.id)}})`,
  );
  assert.equal(bad.ok, false, "Foreign project cannot read history");
  await click("Xem trước & bật");
  await click("Xem trước", 'document.querySelector(".schedule-dialog")');
  await click("Bật lịch", 'document.querySelector(".schedule-dialog")');
  clock = RealDate.parse("2026-11-05T02:00:00.000Z");
  powerMonitor.emit("resume");
  await pause(100);
  powerMonitor.emit("resume");
  await pause(100);
  store = new Store(data);
  const cards = store.board.summaries(project.id);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].planningState, "backlog");
  assert.equal(store.runs().length, 0);
  assert.equal(store.queue.list().length, 0);
  store.close();
  await click("Lịch sử");
  await until(() =>
    js(
      'document.querySelector(".schedule-history")?.textContent.includes("Đã tạo công việc")',
    ),
  );
  await click("Mở công việc");
  await until(() =>
    js('!!document.querySelector(".workspace-detail-host.detail-open")'),
  );
  // Escape returns to schedules without navigating or creating a run.
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await pause(150);
  await click("Tạm dừng tất cả");
  clock = RealDate.parse("2026-12-01T04:00:00.000Z");
  powerMonitor.emit("resume");
  await pause(100);
  store = new Store(data);
  assert.equal(store.schedules.isPaused(), true);
  assert.equal(store.schedules.deliveries(project.id, record.id).length, 1);
  store.close();
  await click("Tiếp tục tất cả");
  await pause(150);
  listing = await api("scheduleList", project.id);
  record = listing.schedules[0];
  assert.equal(listing.latest[record.id].state, "missed");
  store = new Store(data);
  assert.equal(store.board.summaries(project.id).length, 1);
  store.close();
  await click("Đóng lịch sử");
  await click("Sửa");
  // Conflict preserves the editor and offers an explicit reload of the current record.
  await click("Xem trước", 'document.querySelector(".schedule-dialog")');
  await api("scheduleToggle", {
    projectId: project.id,
    id: record.id,
    version: record.version,
    enabled: false,
  });
  await click("Lưu thay đổi");
  await until(() =>
    js(
      'document.querySelector(".schedule-dialog [role=alert]")?.textContent.includes("thay đổi")',
    ),
  );
  await click("Tải bản mới");
  await click("Xem trước", 'document.querySelector(".schedule-dialog")');
  const layouts = [];
  for (const [width, height, zoom] of [
    [1366, 768, 1],
    [850, 700, 1],
    [1366, 768, 1.25],
    [1366, 768, 1.5],
    [620, 700, 1],
  ]) {
    win.setSize(width, height);
    win.webContents.setZoomFactor(zoom);
    await pause(120);
    const layout = await js(
      `(()=>{const dialog=document.querySelector('dialog').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth+2,dialogOverflow:document.querySelector('dialog').scrollWidth>dialog.width+2,right:dialog.right,width:innerWidth,bottom:dialog.bottom,height:innerHeight}})()`,
    );
    assert.equal(layout.overflow, false);
    assert.equal(layout.dialogOverflow, false);
    assert.ok(layout.right <= layout.width + 2);
    assert.ok(layout.bottom <= layout.height + 2);
    layouts.push({ width, height, zoom, ...layout });
    writeFileSync(
      join(directory, `schedule-${width}-${zoom}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
  }
  await click("Đóng", 'document.querySelector(".schedule-dialog")');
  // Native modal confines keyboard focus and closes through Escape.
  await click("Tạo lịch");
  assert.equal(
    await js('document.activeElement.closest("dialog")!==null'),
    true,
  );
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
  assert.equal(
    await js('document.activeElement.closest("dialog")!==null'),
    true,
  );
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await pause(100);
  assert.equal(await js('!!document.querySelector("dialog[open]")'), false);
  await click("Tạo lịch");
  await input('.schedule-dialog input[maxlength="100"]', "Một lần");
  await input('.schedule-dialog input[maxlength="160"]', "Công việc một lần");
  await input(
    '.schedule-dialog input[value="Asia/Ho_Chi_Minh"]',
    "Invalid/Zone",
  );
  await click("Xem trước", 'document.querySelector(".schedule-dialog")');
  await until(() =>
    js(
      'document.querySelector(".schedule-dialog [role=alert]")?.textContent.includes("Múi giờ không hợp lệ")',
    ),
  );
  await require("./ui-select-test.cjs").selectValue(win, "Loại lịch", "once");
  await input(
    '.schedule-dialog input[type="datetime-local"]',
    "2026-12-01T04:01",
  );
  await click("Xem trước", 'document.querySelector(".schedule-dialog")');
  await until(() =>
    js('document.querySelectorAll(".schedule-preview ol>li").length===1'),
  );
  await click("Lưu · mặc định tắt");
  listing = await api("scheduleList", project.id);
  const once = listing.schedules.find((item) => item.name === "Một lần");
  const ref = { projectId: project.id, id: once.id, version: once.version };
  const draft = {
    projectId: project.id,
    name: once.name,
    timing: once.timing,
    action: once.action,
    missedPolicy: once.missedPolicy,
  };
  const preview = await api("schedulePreview", { draft, ref });
  await api("scheduleToggle", { ...ref, enabled: true, token: preview.token });
  clock = RealDate.parse("2026-12-01T04:01:00.000Z");
  powerMonitor.emit("resume");
  await pause(100);
  powerMonitor.emit("resume");
  await pause(100);
  store = new Store(data);
  assert.equal(store.board.summaries(project.id).length, 2);
  assert.equal(store.schedules.get(project.id, once.id).enabled, false);
  assert.equal(store.schedules.deliveries(project.id, once.id).length, 1);
  assert.equal(store.runs().length, 0);
  store.close();
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    directory,
    layouts,
    errors,
    counts,
    providerCalls: 0,
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
