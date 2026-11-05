// R1 shell: real Electron/IPC/SQLite with isolated data, no provider calls.
const { app, BrowserWindow, ipcMain, nativeImage } = require("electron");
const { resolve, join } = require("node:path");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { channels } = require("../shared/channels.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "workspace-shell-ui-"));
const data = join(directory, "data");
const empty = process.argv.includes("--empty");
app.setPath("userData", data);
BrowserWindow.prototype.show = function () {};
let rejectDraft = false;
const monitors = [],
  mutations = [];
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) =>
  originalHandle(channel, async (...args) => {
    if (channel === channels.saveConversationDraft && rejectDraft)
      return { ok: false, error: "Fixture: không lưu được nháp" };
    if (channel === channels.monitorSnapshot) monitors.push(args[1]);
    if (channel === channels.createBoardItem) mutations.push(args[1]);
    assert.ok(
      ![channels.startRun, channels.sendChat, channels.enqueue].includes(
        channel,
      ),
      "Shell must not dispatch work",
    );
    return listener(...args);
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
  const store = new Store(data);
  let project, other;
  if (!empty) {
    const path = join(
      directory,
      "Dự án rất dài để kiểm tra hiển thị tên và phạm vi công việc",
    );
    mkdirSync(path);
    mkdirSync(join(directory, "other"));
    project = store.addProject(path);
    other = store.addProject(join(directory, "other"));
    for (let i = 0; i < 24; i++)
      store.board.create({
        projectId: project.id,
        title: `Công việc mẫu ${i}`,
        body: "Nội dung",
        criteria: [],
        priority: 0,
        suggestedRole: null,
        planningState: "backlog",
      });
  }
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
      `Array.from(${scope}.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  const global = (label) =>
    click(label, "document.querySelector('nav[aria-label=\"Toàn ứng dụng\"]')");
  const select = (p) =>
    js(`document.querySelector('[data-project-id="${p.id}"]').click()`);
  const board = "document.querySelector('.kanban-workspace:not([hidden])')";
  const input = (selector, text, tag = "HTMLInputElement") =>
    js(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${tag}.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  await until(() => js("!!document.querySelector('.workspace-home')"), "Home");
  await pause(250);
  writeFileSync(
    join(directory, "home.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  assert.equal(
    await js("!!document.querySelector('.project-navigation')"),
    false,
  );
  await global("Cần xử lý");
  await until(() =>
    js("document.querySelector('h1')?.textContent==='Cần xử lý'"),
  );
  await click(
    "Cài đặt",
    "document.querySelector('nav[aria-label=\"Tiện ích\"]')",
  );
  await until(
    () => js("!!document.querySelector('.settings-grid')"),
    "Settings",
  );
  await global("Tổng quan");
  await until(() => js("!!document.querySelector('.workspace-home')"));
  if (empty) {
    assert.equal(await js("!!document.querySelector('.home-empty')"), true);
    assert.equal(
      await js("document.querySelectorAll('[data-project-id]').length"),
      0,
    );
  } else {
    await select(project);
    await until(
      () => js(`${board}?.querySelectorAll('.board-task').length===24`),
      "Project board",
    );
    assert.equal(
      await js(
        "document.querySelectorAll('.workspace-topbar .primary').length",
      ),
      1,
    );
    await click("Tạo công việc", "document.querySelector('.workspace-topbar')");
    await until(() => js("!!document.querySelector('.board-editor[open]')"));
    await input(
      '.board-editor[open] [aria-label="Tiêu đề công việc"]',
      "Việc tạo từ header",
    );
    await click("Lưu", "document.querySelector('.board-editor[open]')");
    await until(() => js("!document.querySelector('.board-editor[open]')"));
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].projectId, project.id);
    // Filters and list view survive project/tab switches without per-project polling.
    await click("Danh sách", board);
    await input(
      '.kanban-workspace:not([hidden]) [aria-label="Tìm công việc"]',
      "Công việc mẫu",
    );
    await until(
      () => js(`${board}?.querySelectorAll('.work-list tbody tr').length===24`),
      "Filtered list",
    );
    await js(`${board}.querySelector('.work-list').scrollTop=180`);
    await pause(120);
    const scroll = await js(`${board}.querySelector('.work-list').scrollTop`);
    assert.ok(scroll > 0, "Fixture must scroll");
    await select(other);
    await until(() =>
      js(
        `document.querySelector('[data-project-id="${other.id}"]').getAttribute('aria-current')==='page'`,
      ),
    );
    const start = monitors.length;
    await pause(2300);
    assert.ok(monitors.length > start, "Visible board polls");
    assert.ok(
      monitors.slice(start).every((request) => request.projectId === other.id),
      "Hidden project must stop polling",
    );
    await select(project);
    await until(() =>
      js(
        `${board}?.querySelector('[aria-label="Tìm công việc"]')?.value==='Công việc mẫu'`,
      ),
    );
    assert.equal(
      await js(
        `${board}.querySelector('.work-view-switch button[aria-pressed="true"]').textContent`,
      ),
      "Danh sách",
    );
    assert.equal(
      await js(`${board}.querySelector('.work-list').scrollTop`),
      scroll,
    );
    await click("Trao đổi", "document.querySelector('.project-navigation')");
    await until(() => js("!!document.querySelector('.chat-host.fullscreen')"));
    const composer = '[aria-label="Nhắn tin cho agent"]';
    await until(
      () =>
        js(
          `document.querySelector(${JSON.stringify(composer)})?.disabled===false`,
        ),
      "Loaded conversation",
    );
    await input(composer, "Nháp dự án gốc", "HTMLTextAreaElement");
    const png = nativeImage
      .createFromBitmap(Buffer.from([40, 80, 120, 255]), {
        width: 1,
        height: 1,
      })
      .toPNG()
      .toString("base64");
    await js(
      `(()=>{const data=Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([data],'Thiết kế.png',{type:'image/png'}));document.querySelector('.chat-composer textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));})()`,
    );
    await until(
      () =>
        js(
          "document.querySelectorAll('.chat-composer .chat-image-tile').length===1",
        ),
      "Image draft",
    );
    await js(
      `window.__composer=document.querySelector(${JSON.stringify(composer)});window.__composer.focus();window.__composer.setSelectionRange(3,7)`,
    );
    await click("Công việc", "document.querySelector('.project-navigation')");
    await until(() => js("document.querySelector('.chat-host').hidden"));
    await click("Trao đổi", "document.querySelector('.project-navigation')");
    await until(() => js("!document.querySelector('.chat-host').hidden"));
    assert.equal(
      await js(
        `window.__composer===document.querySelector(${JSON.stringify(composer)})`,
      ),
      true,
    );
    assert.equal(await js("window.__composer.value"), "Nháp dự án gốc");
    assert.equal(
      await js(
        "document.querySelectorAll('.chat-composer .chat-image-tile').length",
      ),
      1,
    );
    assert.equal(await js("window.__composer.selectionStart"), 3);
    // A failed durable save must leave both current page and project untouched.
    rejectDraft = true;
    await input(composer, "Nháp chưa lưu", "HTMLTextAreaElement");
    await global("Tổng quan");
    await until(
      () =>
        js(
          "document.querySelector('.notice.error')?.textContent.includes('Chưa lưu được nháp')",
        ),
      "Failed save notice",
    );
    assert.equal(
      await js("!!document.querySelector('.workspace-home')"),
      false,
    );
    await select(other);
    await pause(150);
    assert.equal(
      await js(
        `document.querySelector('[data-project-id="${project.id}"]').getAttribute('aria-current')`,
      ),
      "page",
    );
    rejectDraft = false;
    await input(composer, "Nháp đã lưu lại", "HTMLTextAreaElement");
    await select(other);
    await until(() =>
      js(
        `document.querySelector('[data-project-id="${other.id}"]').getAttribute('aria-current')==='page'`,
      ),
    );
    await click("Trao đổi", "document.querySelector('.project-navigation')");
    await until(() =>
      js(
        `document.querySelector(${JSON.stringify(composer)})?.disabled===false && document.querySelector(${JSON.stringify(composer)}).value===''`,
      ),
    );
    await select(project);
    await until(() =>
      js(
        `document.querySelector('[data-project-id="${project.id}"]').getAttribute('aria-current')==='page'`,
      ),
    );
    await click("Trao đổi", "document.querySelector('.project-navigation')");
    await until(() =>
      js(
        `document.querySelector(${JSON.stringify(composer)})?.value==='Nháp đã lưu lại'`,
      ),
    );
    await until(
      () =>
        js(
          "document.querySelectorAll('.chat-composer .chat-image-tile').length===1",
        ),
      "Image restored to original project",
    );
    // Custom project menu supports Escape/focus, and old project pages remain reachable.
    await js(
      "document.querySelector('[aria-label=\"Thêm mục trong dự án\"]').click()",
    );
    await until(() =>
      js("!!document.querySelector('.project-more .ui-popover-panel')"),
    );
    await js(
      "document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))",
    );
    await until(() =>
      js("!document.querySelector('.project-more .ui-popover-panel')"),
    );
    assert.equal(
      await js("document.activeElement.getAttribute('aria-label')"),
      "Thêm mục trong dự án",
    );
    for (const [label, selector] of [
      ["Tổng quan dự án", ".project-overview"],
      ["Đội ngũ dự án", ".agent-monitor"],
      ["Git local", ".git-workspace"],
    ]) {
      await js(
        "document.querySelector('[aria-label=\"Thêm mục trong dự án\"]').click()",
      );
      await click(
        label,
        "document.querySelector('.project-more .ui-popover-panel')",
      );
      await until(() => js(`!!document.querySelector('${selector}')`), label);
    }
    await click("Công việc", "document.querySelector('.project-navigation')");
  }
  const layouts = [];
  for (const [width, height, zoom] of [
    [1366, 768, 1],
    [850, 700, 1],
    [1366, 768, 1.25],
    [1366, 768, 1.5],
  ]) {
    win.setSize(width, height);
    win.webContents.setZoomFactor(zoom);
    await pause(200);
    const layout = await js(
      `(()=>{const header=document.querySelector('.workspace-topbar').getBoundingClientRect();return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+2,headerRight:header.right,headerBottom:header.bottom,mainBottom:document.querySelector('main').getBoundingClientRect().bottom}})()`,
    );
    assert.equal(layout.overflow, false, JSON.stringify(layout));
    assert.ok(
      layout.headerRight <= layout.width + 1 &&
        layout.headerBottom < layout.height &&
        layout.mainBottom <= layout.height + 1,
      JSON.stringify(layout),
    );
    layouts.push({ width, height, zoom, ...layout });
    writeFileSync(
      join(directory, `shell-${width}-${zoom}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
  }
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    empty,
    directory,
    layouts,
    errors,
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
