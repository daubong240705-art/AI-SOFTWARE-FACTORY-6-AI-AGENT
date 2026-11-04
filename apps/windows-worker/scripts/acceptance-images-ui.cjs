// Real built Electron, preload, protocol, native decoder and SQLite; no provider.
const { app, BrowserWindow, ipcMain, nativeImage } = require("electron");
const { join, resolve } = require("node:path");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { importImage } = require("../electron/images.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const { channels } = require("../shared/channels.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "images-ui-")),
  data = join(directory, "data");
app.setPath("userData", data);
BrowserWindow.prototype.show = function () {};
let loseReply = false;
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) =>
  handle(channel, async (...args) => {
    const result = await listener(...args);
    if (channel === channels.sendChat && loseReply && result.ok) {
      loseReply = false;
      return { ok: false, error: "Fixture lost reply" };
    }
    return result;
  });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label = "UI") {
  for (let i = 0; i < 100; i++) {
    const result = await fn();
    if (result) return result;
    await pause(100);
  }
  throw Error(`Timeout: ${label}`);
}
let win;
async function main() {
  const store = new Store(data),
    project = store.addProject(directory),
    conversation = store.conversations.create(project.id),
    settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.forEach((a) => (a.model = "fixture-vision"));
  store.save(settings, undefined);
  const width = 360,
    height = 180,
    pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = x < 180 ? 180 : 70;
      pixels[i + 1] = y < 90 ? 120 : 200;
      pixels[i + 2] = 60;
      pixels[i + 3] = 255;
    }
  const bitmap = nativeImage.createFromBitmap(pixels, { width, height }),
    png = bitmap.toPNG(),
    jpeg = bitmap.toJPEG(85);
  const scope = { projectId: project.id, conversationId: conversation.id };
  const image = importImage(store.images, {
    ...scope,
    name: "Thiết kế.png",
    base64: Buffer.concat([png, Buffer.from("UNTRUSTED_TRAILER")]).toString(
      "base64",
    ),
  })[0];
  assert.equal(
    store.images
      .read(project.id, conversation.id, image.id)
      .data.includes(Buffer.from("UNTRUSTED_TRAILER")),
    false,
  );
  const base = require("../../../docs/windows-worker/ww3-live.json").run;
  const run = {
    ...base,
    id: crypto.randomUUID(),
    projectId: project.id,
    projectName: project.name,
    workspace: directory,
    conversationId: conversation.id,
    imageIds: [image.id],
    prompt: "Đánh giá bố cục ảnh",
    summary:
      "Đã lưu ảnh minh họa.\n\n![Không tải ảnh ngoài](https://external-image.invalid/image.png)",
    settings,
    mode: "direct",
    state: "completed",
    tasks: [],
    profiles: [],
    permissions: [],
    changes: [],
    commands: [],
    review: null,
    error: "",
    retryOf: undefined,
    integration: undefined,
    createdAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    currentTaskId: null,
  };
  store.createRun(run);
  store.updateRun(run);
  store.images.sent(project.id, conversation.id, [image.id]);
  importImage(store.images, {
    ...scope,
    name: "Nháp.png",
    base64: png.toString("base64"),
  });
  store.conversations.draft(
    conversation.id,
    "Dựa trên các ảnh này, đề xuất giao diện gọn hơn.",
  );
  store.queue.add({
    ...scope,
    prompt: "Fixture held queue",
    role: "lead",
    mode: "team",
    settings,
    afterRunId: null,
    state: "held",
    reason: "No provider",
  });
  store.close();
  require("../out/main/main.js");
  win = await until(() => BrowserWindow.getAllWindows()[0]);
  win.webContents.setBackgroundThrottling(false);
  const errors = [],
    externalRequests = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  win.webContents.session.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (request, callback) => {
      externalRequests.push(request.url);
      callback({ cancel: true });
    },
  );
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const clickChat = async () => {
    await until(() =>
      js("!!document.querySelector('.project-overview .attention-list')"),
    );
    await pause(150);
    await js(
      "document.querySelector('nav button[title=\"Trò chuyện\"]').click()",
    );
    await until(() =>
      js("!!document.querySelector('.chat-composer textarea:not(:disabled)')"),
    );
  };
  const reload = async () => {
    win.webContents.reload();
    await pause(250);
    await until(() => !win.webContents.isLoading());
    await clickChat();
  };
  await clickChat();
  await until(() =>
    js(
      "document.querySelectorAll('.chat-composer .chat-image-tile').length===1",
    ),
  );
  await until(
    () =>
      js(
        "Array.from(document.querySelectorAll('.chat-images img')).every(i=>i.complete && i.naturalWidth>0)",
      ),
    "local protocol image load",
  );
  assert.equal(
    await js("document.querySelectorAll('.markdown img').length"),
    0,
  );
  const bad = await js(
    `window.worker.importChatImage({...${JSON.stringify(scope)},name:'bad.png',base64:btoa('<svg onload="alert(1)"/>')})`,
  );
  assert.equal(bad.ok, false);
  const inject = async (name, bytes, mime, paste) => {
    await js(
      `(()=>{const data=Uint8Array.from(atob(${JSON.stringify(bytes.toString("base64"))}),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([data],${JSON.stringify(name)},{type:${JSON.stringify(mime)}}));${paste ? 'document.querySelector(".chat-composer textarea").dispatchEvent(new ClipboardEvent("paste",{clipboardData:dt,bubbles:true,cancelable:true}));' : 'const input=document.querySelector(".chat-composer input[type=file]");input.files=dt.files;input.dispatchEvent(new Event("change",{bubbles:true}));'}})()`,
    );
  };
  await inject("Dán ảnh.jpg", jpeg, "image/jpeg", true);
  await until(() =>
    js(
      "document.querySelectorAll('.chat-composer .chat-image-tile').length===2",
    ),
  );
  await inject("Tệp.png", png, "image/png", false);
  await until(() =>
    js(
      "document.querySelectorAll('.chat-composer .chat-image-tile').length===3",
    ),
  );
  await inject(
    "Tên ảnh rất dài để kiểm tra bố cục và xuống dòng.png",
    png,
    "image/png",
    true,
  );
  await until(() =>
    js(
      "document.querySelectorAll('.chat-composer .chat-image-tile').length===4",
    ),
  );
  await reload();
  await until(() =>
    js(
      "document.querySelectorAll('.chat-composer .chat-image-tile').length===4",
    ),
  );
  assert.equal(
    await js(
      "document.querySelector('[aria-label=\"Đính kèm ảnh\"]').disabled",
    ),
    true,
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
    await pause(200);
    await until(() =>
      js(
        "Array.from(document.querySelectorAll('.chat-composer img')).every(i=>i.complete&&i.naturalWidth>0)",
      ),
    );
    const layout = await js(
      `(()=>{const h=document.querySelector('.chat-host'),c=document.querySelector('.chat-composer').getBoundingClientRect(),s=document.querySelector('.chat-send.primary').getBoundingClientRect();return {viewport:innerWidth,height:innerHeight,overflow:h.scrollWidth>h.clientWidth+2,composerBottom:c.bottom,sendBottom:s.bottom};})()`,
    );
    assert.equal(layout.overflow, false);
    assert.ok(
      layout.composerBottom <= layout.height &&
        layout.sendBottom <= layout.height,
    );
    writeFileSync(
      join(directory, `chat-${width}-${zoom}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(
      "document.querySelector('.chat-composer .chat-image-open').click()",
    );
    await until(() =>
      js("document.querySelector('.chat-image-preview')?.matches(':modal')"),
    );
    const preview = await js(
      `(()=>{const r=document.querySelector('.chat-image-preview').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};})()`,
    );
    assert.ok(
      preview.left >= 0 &&
        preview.right <= layout.viewport &&
        preview.top >= 0 &&
        preview.bottom <= layout.height,
    );
    writeFileSync(
      join(directory, `preview-${width}-${zoom}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js("document.querySelector('[aria-label=\"Đóng ảnh\"]').click()");
    layouts.push({ width, height, zoom, ...layout });
  }
  win.setSize(1366, 768);
  win.webContents.setZoomFactor(1);
  await pause(150);
  loseReply = true;
  await js("document.querySelector('[aria-label=\"Gửi yêu cầu\"]').click()");
  await until(() =>
    js(
      "document.querySelector('.chat-error')?.textContent.includes('Fixture lost reply')",
    ),
  );
  await reload();
  await until(
    () =>
      js(
        "document.querySelectorAll('.chat-composer .chat-image-tile').length===4",
      ),
    "restore attachments after lost receipt",
  );
  await js("document.querySelector('[aria-label=\"Gửi yêu cầu\"]').click()");
  await until(() =>
    js("document.querySelector('.chat-composer textarea').value===''"),
  );
  assert.equal(
    await js(
      "document.querySelectorAll('.chat-composer .chat-image-tile').length",
    ),
    0,
  );
  const detail = (
    await js(`window.worker.conversation(${JSON.stringify(conversation.id)})`)
  ).value;
  assert.equal(detail.queue.length, 2);
  assert.equal(detail.queue[1].images.length, 4);
  assert.equal(detail.draftImages.length, 0);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
  writeFileSync(
    join(directory, "acceptance.json"),
    JSON.stringify(
      {
        passed: true,
        providerCalls: 0,
        layouts,
        errors,
        externalRequests,
        checks: [
          "PNG/JPEG native decode",
          "paste and picker",
          "scoped protocol",
          "draft reload",
          "modal preview",
          "lost receipt reload and dedup",
          "queue images",
          "no external images",
        ],
      },
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
