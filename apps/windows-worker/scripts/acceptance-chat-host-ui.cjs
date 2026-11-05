// UX-03: real Electron renderer, IPC, SQLite. The held queue prevents model calls.
const { app, BrowserWindow, ipcMain } = require("electron");
const { resolve, join } = require("node:path");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const { channels } = require("../shared/channels.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "chat-host-ui-")),
  data = join(directory, "data");
app.setPath("userData", data);
BrowserWindow.prototype.show = function () {};
const counts = {};
let loseReply = false;
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) =>
  originalHandle(channel, async (...args) => {
    counts[channel] = (counts[channel] || 0) + 1;
    const reply = await listener(...args);
    if (channel === channels.sendChat && loseReply && reply.ok) {
      loseReply = false;
      return { ok: false, error: "Fixture: response lost after commit" };
    }
    return reply;
  });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label = "UI") {
  for (let i = 0; i < 100; i++) {
    const r = await fn();
    if (r) return r;
    await pause(100);
  }
  throw Error(`Timeout ${label}`);
}
let win;
async function main() {
  mkdirSync(join(directory, "other"));
  const store = new Store(data),
    project = store.addProject(directory),
    other = store.addProject(join(directory, "other"));
  store.touch(project.id);
  const settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.forEach((a) => (a.model = "fixture-model"));
  store.save(settings, undefined);
  const item = store.board.create({
    projectId: project.id,
    title: "Ngữ cảnh chat Lead",
    body: "Yêu cầu ban đầu",
    criteria: ["Không mất nháp"],
    priority: 0,
    suggestedRole: null,
    planningState: "ready",
  });
  const context = store.board.workChat({
    projectId: project.id,
    itemId: item.id,
  });
  const base = require("../../../docs/windows-worker/ww3-live.json").run;
  for (let i = 0; i < 12; i++) {
    const run = {
      ...base,
      id: crypto.randomUUID(),
      projectId: project.id,
      projectName: project.name,
      conversationId: context.conversationId,
      workspace: directory,
      settings,
      prompt: `Tin nhắn ${i}`,
      summary: "Phản hồi tiếng Việt ".repeat(70),
      state: "completed",
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
      createdAt: new Date(Date.now() + i).toISOString(),
      endedAt: new Date().toISOString(),
      currentTaskId: null,
    };
    store.createRun(run);
    store.updateRun(run);
  }
  const held = store.queue.add({
    projectId: project.id,
    conversationId: context.conversationId,
    prompt: "Hàng chờ giữ cho fixture",
    role: "lead",
    mode: "team",
    settings,
    afterRunId: null,
    state: "held",
    reason: "Không gọi model",
  });
  store.close();
  require("../out/main/main.js");
  win = await until(() => BrowserWindow.getAllWindows()[0]);
  win.webContents.setBackgroundThrottling(false);
  await until(() => !win.webContents.isLoading());
  const errors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  const js = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code, true);
    } catch (error) {
      console.error("Renderer script failed:", code, errors);
      throw error;
    }
  };
  const click = (label, scope = "document") =>
    js(
      `Array.from(${scope}.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  const setInput = (selector, text, tag = "HTMLInputElement") =>
    js(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${tag}.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  const ref = JSON.stringify({ projectId: project.id, itemId: item.id });
  await until(() => js("!!document.querySelector('.workspace-home')"));
  const reads = counts[channels.runDetail] || 0;
  await pause(500);
  assert.equal(
    counts[channels.runDetail] || 0,
    reads,
    "Hidden ChatHost must not load run details",
  );
  await js(
    `document.querySelector('[data-project-id="${project.id}"]').click()`,
  );
  await until(() => js("!!document.querySelector('.board-card-title')"));
  await setInput(
    '.kanban-workspace:not([hidden]) [aria-label="Tìm công việc"]',
    "W-0001",
  );
  await until(() => js("document.querySelectorAll('.board-task').length===1"));
  await js("document.querySelector('.board-card-title').click()");
  await until(() =>
    js(
      "document.querySelector('.work-panel-header h2')?.textContent==='Ngữ cảnh chat Lead'",
    ),
  );
  await click("Hỏi Lead", "document.querySelector('.work-item-panel')");
  await until(() =>
    js(
      "!!document.querySelector('.chat-host.work-chat .chat-message.assistant')",
    ),
  );
  assert.equal(await js("document.querySelectorAll('.chat-host').length"), 1);
  assert.ok(
    await js(
      "document.querySelector('.chat-context').textContent.includes('W-0001 · v1')",
    ),
  );
  const draft = "Nháp tiếng Việt còn đang nhập";
  await setInput(
    '[aria-label="Nhắn tin cho agent"]',
    draft,
    "HTMLTextAreaElement",
  );
  await until(async () => {
    const r = await js(
      `window.worker.conversation(${JSON.stringify(context.conversationId)})`,
    );
    return r.value.conversation.draft === draft;
  });
  // Preserve the actual composer DOM node, IME composition and scroll state across layout switches.
  await js(
    "window.__composer=document.querySelector('[aria-label=\"Nhắn tin cho agent\"]');window.__composer.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));document.querySelector('.chat-scroll').scrollTop=120",
  );
  const beforeSend = counts[channels.sendChat] || 0;
  await js(
    "window.__composer.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,isComposing:true}))",
  );
  await pause(100);
  assert.equal(counts[channels.sendChat] || 0, beforeSend);
  await js("document.querySelector('[aria-label=\"Mở rộng hồ sơ\"]').click()");
  await until(() => js("!!document.querySelector('.chat-host.fullscreen')"));
  assert.equal(
    await js(
      "window.__composer===document.querySelector('[aria-label=\"Nhắn tin cho agent\"]')",
    ),
    true,
  );
  assert.equal(await js("window.__composer.value"), draft);
  assert.equal(await js("window.__composer.isConnected"), true);
  await js("document.querySelector('[aria-label=\"Thu gọn hồ sơ\"]').click()");
  await until(() => js("!!document.querySelector('.chat-host.work-chat')"));
  assert.equal(
    await js(
      "window.__composer===document.querySelector('[aria-label=\"Nhắn tin cho agent\"]')",
    ),
    true,
  );
  assert.equal(
    await js(
      "document.querySelector('.kanban-workspace:not([hidden]) [aria-label=\"Tìm công việc\"]').value",
    ),
    "W-0001",
  );
  assert.ok(await js("document.querySelector('.chat-scroll').scrollTop>0"));
  await js(
    "window.__composer.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))",
  );
  // A successful commit with lost response must retry using the same durable request key.
  loseReply = true;
  await js("document.querySelector('[aria-label=\"Gửi yêu cầu\"]').click()");
  await until(() =>
    js(
      "document.querySelector('.chat-error')?.textContent.includes('response lost')",
    ),
  );
  let detail = (await js(`window.worker.workItemDetail(${ref})`)).value;
  assert.equal(
    detail.submissions.length,
    0,
    "Lead discussion does not create execution submissions",
  );
  assert.equal(await js("window.__composer.value"), draft);
  await js(
    "document.querySelector('[aria-label=\"Gửi yêu cầu\"]').click();document.querySelector('[aria-label=\"Gửi yêu cầu\"]').click()",
  );
  await until(() => js("window.__composer.value===''"));
  detail = (await js(`window.worker.workItemDetail(${ref})`)).value;
  assert.equal(detail.submissions.length, 0);
  assert.ok(
    await js(
      "document.querySelector('.follow-up-list').textContent.includes('Đã lưu · đang giữ')",
    ),
  );
  // Revision mismatch refuses dispatch, keeps draft, then explicit context refresh permits it.
  const current = (
    await js(`window.worker.boardItem(${JSON.stringify(item.id)})`)
  ).value;
  await js(
    `window.worker.updateBoardItem({id:${JSON.stringify(item.id)},version:${current.version},patch:{body:'Yêu cầu revision 2'}})`,
  );
  await setInput(
    '[aria-label="Nhắn tin cho agent"]',
    "Tiếp tục theo yêu cầu mới",
    "HTMLTextAreaElement",
  );
  await js("document.querySelector('[aria-label=\"Gửi yêu cầu\"]').click()");
  await until(() =>
    js(
      "document.querySelector('.chat-error')?.textContent.includes('phiên bản mới')",
    ),
  );
  assert.equal(
    (await js(`window.worker.workItemDetail(${ref})`)).value.submissions.length,
    0,
  );
  await js(
    "document.querySelector('[aria-label=\"Thay đổi ngữ cảnh\"]').click()",
  );
  await click("Cập nhật yêu cầu");
  await until(() =>
    js("document.querySelector('.chat-context').textContent.includes('v2')"),
  );
  await js("document.querySelector('[aria-label=\"Gửi yêu cầu\"]').click()");
  await until(() => js("window.__composer.value===''"));
  detail = (await js(`window.worker.workItemDetail(${ref})`)).value;
  assert.equal(detail.submissions.length, 0);
  const heldRequests = (
    await js(
      `window.worker.conversation(${JSON.stringify(context.conversationId)})`,
    )
  ).value.queue;
  assert.equal(
    heldRequests.length,
    3,
    "lost reply retry creates just one queue request",
  );
  assert.equal(heldRequests[1].leadAdmission, true);
  assert.equal(heldRequests[1].workContext.revision, 1);
  assert.equal(heldRequests[2].workContext.revision, 2);
  await setInput(
    '[aria-label="Nhắn tin cho agent"]',
    "Nháp giữ sau khi đóng dock",
    "HTMLTextAreaElement",
  );
  await js("document.querySelector('[aria-label=\"Đóng hồ sơ\"]').click()");
  await until(() => js("document.querySelector('.chat-host').hidden"));
  await js("document.querySelector('.board-card-title').click()");
  await until(() => js("!!document.querySelector('.work-item-panel')"));
  await click("Hỏi Lead", "document.querySelector('.work-item-panel')");
  await until(() => js("!document.querySelector('.chat-host').hidden"));
  assert.equal(
    await js("window.__composer.value"),
    "Nháp giữ sau khi đóng dock",
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
    await pause(180);
    const layout = await js(
      `(()=>{const d=document.querySelector('.workspace-detail-host.detail-open'),r=d.getBoundingClientRect(),t=document.querySelector('.chat-composer').getBoundingClientRect();return {viewport:innerWidth,height:innerHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom,composerBottom:t.bottom,overflow:d.scrollWidth>d.clientWidth+2};})()`,
    );
    assert.ok(
      layout.left >= 0 &&
        layout.right <= layout.viewport &&
        layout.top >= 0 &&
        layout.bottom <= layout.height,
    );
    assert.ok(
      layout.composerBottom <= layout.bottom,
      JSON.stringify({ width, height, zoom, ...layout }),
    );
    assert.equal(layout.overflow, false);
    layouts.push(layout);
    writeFileSync(
      join(directory, `dock-${width}-${zoom}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
  }
  // Project switch clears work context; no cross-project criteria are silently carried over.
  win.setSize(1366, 768);
  win.webContents.setZoomFactor(1);
  await pause(100);
  await js("document.querySelector('[aria-label=\"Đóng hồ sơ\"]').click()");
  await until(() => js("document.querySelector('.chat-host').hidden"));
  await js(`document.querySelector('[data-project-id="${other.id}"]').click()`);
  await until(() =>
    js(
      `document.querySelector('[data-project-id="${other.id}"]').getAttribute('aria-current')==='page'`,
    ),
  );
  await click("Trao đổi", "document.querySelector('.project-navigation')");
  await until(() => js("!!document.querySelector('.chat-host.fullscreen')"));
  assert.equal(
    await js(
      "document.querySelector('.chat-context').textContent.includes('W-0001')",
    ),
    false,
  );
  await js(
    `document.querySelector('[data-project-id="${project.id}"]').click()`,
  );
  await until(() =>
    js(
      `document.querySelector('[data-project-id="${project.id}"]').getAttribute('aria-current')==='page'`,
    ),
  );
  await click("Trao đổi", "document.querySelector('.project-navigation')");
  await until(() =>
    js(
      "document.querySelector('[aria-label=\"Nhắn tin cho agent\"]')?.value==='Nháp giữ sau khi đóng dock'",
    ),
  );
  assert.ok(
    await js(
      "document.querySelector('.chat-context').textContent.includes('W-0001 · v2')",
    ),
  );
  const reopened = new Store(data);
  assert.equal(
    reopened.conversations.get(context.conversationId).conversation.draft,
    "Nháp giữ sau khi đóng dock",
  );
  assert.equal(reopened.queue.get(held.id).state, "held");
  assert.equal(
    reopened.board.detail({ projectId: project.id, itemId: item.id })
      .submissions.length,
    0,
  );
  reopened.close();
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
