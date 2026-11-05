// R5: production main/preload/renderer, isolated SQLite, synthetic loopback catalog.
const { app, BrowserWindow, ipcMain } = require("electron");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { createServer } = require("node:http");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const { readinessResult } = require("../shared/readiness.ts");
const { channels } = require("../shared/channels.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "settings-ui-")),
  data = join(directory, "data"),
  source = join(directory, "source");
mkdirSync(source);
app.setPath("userData", data);
BrowserWindow.prototype.show = function () {};
const counts = {},
  requests = [];
let mode = "models",
  current = defaultSettings(),
  win,
  readyMode = "missing",
  readinessFailure = false;
current.gatewayUrl = "http://127.0.0.1:1/v1";
current.agents.forEach((a) => (a.model = "saved-model"));
current.agents.find((a) => a.role === "pm").enabled = false;
const toolValues = [
  { name: "OpenCode", available: true, version: "1.19.5", path: "fixture.exe" },
  { name: "Git", available: true, version: "2.50.0", path: "fixture-git" },
  {
    name: "Node.js",
    available: true,
    version: "22.12.0",
    path: "fixture-node",
  },
  { name: "Python", available: false, version: "", path: "" },
];
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) =>
  handle(channel, async (...args) => {
    counts[channel] = (counts[channel] || 0) + 1;
    assert.ok(
      ![
        channels.sendChat,
        channels.startRun,
        channels.enqueue,
        channels.prune,
      ].includes(channel),
      "Settings must not dispatch work or prune",
    );
    if (channel === channels.checkTools) return { ok: true, value: toolValues };
    if (channel === channels.readiness) {
      if (readinessFailure)
        return { ok: false, error: "Fixture readiness unavailable" };
      return {
        ok: true,
        value: readinessResult({
          projectId: args[1].projectId,
          settings: current,
          tools: readyMode === "missing" ? [] : toolValues,
          git: null,
          folder: true,
          ca: true,
          credential: "available",
          busy: false,
        }),
      };
    }
    const reply = await listener(...args);
    if (channel === channels.saveSettings && reply.ok)
      current = reply.value.settings;
    return reply;
  });
const server = createServer((req, res) => {
  requests.push({
    method: req.method,
    path: req.url,
    hasKey: !!req.headers.authorization,
  });
  assert.equal(req.method, "GET");
  assert.equal(req.url, "/v1/models");
  res.setHeader("content-type", "application/json");
  if (mode === "error") {
    res.writeHead(401);
    res.end("{}");
    return;
  }
  res.end(
    JSON.stringify({
      data:
        mode === "empty"
          ? []
          : [
              { id: "deepseek-flash-fixture" },
              { id: "planning-fixture" },
              { id: "coding-fixture" },
            ],
    }),
  );
});
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(fn, label = "UI") {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await pause(100);
  }
  throw Error(`Timeout ${label}`);
}
async function main() {
  const store = new Store(data),
    project = store.addProject(source);
  store.save(current, undefined);
  store.setModels(["saved-model"]);
  store.close();
  require("../out/main/main.js");
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const gateway = `http://127.0.0.1:${server.address().port}/v1`;
  await until(() => (win = BrowserWindow.getAllWindows()[0]));
  win.webContents.setBackgroundThrottling(false);
  const errors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  const js = (code) =>
    win.webContents.executeJavaScript(code, true).catch((error) => {
      throw Error(`${error.message}\n${code}`);
    });
  const click = async (label, scope = "document") => {
    const find = `Array.from(${scope}?.querySelectorAll('button')||[]).find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
    await until(() => js(`!!(${find})`), label);
    await js(`(${find}).click()`);
  };
  const group = (id) =>
    js(`document.getElementById('setup-tab-${id}').click()`);
  const input = (selector, value) =>
    js(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  const option = async (label, text) => {
    await js(
      `document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`,
    );
    await until(() => js("!!document.querySelector('[role=option]')"));
    await js(
      `Array.from(document.querySelectorAll('[role=option]')).find(el=>el.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  };
  const expand = (label) =>
    js(
      `Array.from(document.querySelectorAll('summary')).find(el=>el.textContent.trim()===${JSON.stringify(label)}).parentElement.open=true`,
    );
  const boot = async () => {
    const reply = await js("window.worker.bootstrap()");
    assert.ok(reply.ok);
    return reply.value;
  };
  await until(() => js("!!document.querySelector('.workspace-home')"));
  await js("document.querySelector('button[title=\"Cài đặt\"]').click()");
  await until(() => js("!!document.querySelector('.settings-workspace')"));
  assert.equal(requests.length, 0);
  assert.equal(counts[channels.checkTools] || 0, 0);
  assert.equal(
    await js(
      "document.querySelectorAll('.settings-workspace .primary').length",
    ),
    1,
  );
  assert.equal(
    await js("!!document.querySelector('.settings-workspace [role=status]')"),
    false,
    "Cached catalog is not a connection check",
  );
  await input('[aria-label="Gateway URL"]', gateway);
  await input('[aria-label="API key"]', "fixture-key-only");
  await group("runtime");
  await group("models");
  assert.equal(
    await js("document.querySelector('[aria-label=\"API key\"]').value"),
    "fixture-key-only",
    "Password draft survives group switch",
  );
  await click("Lưu & kiểm tra kết nối");
  await until(
    () =>
      js(
        "document.querySelector('.setup-card [role=status]')?.textContent.includes('Đã kết nối · 3 model')",
      ),
    "Catalog success",
  );
  assert.ok((await boot()).hasKey);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].hasKey, true);
  await click("Xóa key");
  await js("document.querySelector('button[title=\"Tổng quan\"]').click()");
  await until(() => js("!!document.querySelector('.workspace-home')"));
  await js("document.querySelector('button[title=\"Cài đặt\"]').click()");
  await until(() => js("!!document.querySelector('.settings-workspace')"));
  assert.ok((await boot()).hasKey);
  assert.equal(
    await js(
      "Array.from(document.querySelectorAll('.setup-card button')).some(b=>b.textContent==='Giữ key')",
    ),
    false,
    "Leaving settings cancels staged key deletion",
  );
  const beforeOriginChange = requests.length;
  await input(
    '[aria-label="Gateway URL"]',
    gateway.replace("127.0.0.1", "localhost"),
  );
  await click("Lưu & kiểm tra kết nối");
  await until(
    () =>
      js(
        "document.querySelector('.setup-card [role=alert]')?.textContent.includes('Đổi máy chủ')",
      ),
    "Origin credential guard",
  );
  assert.equal(
    requests.length,
    beforeOriginChange,
    "Do not send existing key to changed origin",
  );
  assert.equal((await boot()).settings.gatewayUrl, gateway);
  await input('[aria-label="Gateway URL"]', gateway);
  await option("Model dùng chung", "deepseek-flash-fixture");
  await click("Dùng cho agent đang bật");
  assert.ok(
    (await boot()).settings.agents
      .filter((a) => a.enabled)
      .every((a) => a.model === "saved-model"),
    "Applying model only edits draft",
  );
  await expand("Model & trạng thái từng vai trò");
  assert.equal(
    await js(
      "document.querySelector('[aria-label=\"Model Lead\"]').textContent.includes('deepseek-flash-fixture')",
    ),
    true,
  );
  assert.equal(
    await js(
      "document.querySelector('[aria-label=\"Bật PM\"]').getAttribute('aria-checked')",
    ),
    "false",
  );
  await click("Lưu cấu hình");
  await until(
    async () =>
      (await boot()).settings.agents[0].model === "deepseek-flash-fixture",
  );
  assert.equal(
    (await boot()).settings.agents.find((a) => a.role === "pm").model,
    "saved-model",
  );
  await option("Model BE", "Nhập model ID…");
  await input('[aria-label="Model BE · ID"]', "custom/deepseek-flash");
  await expand("Preset theo nhiệm vụ");
  await option("Model nhanh", "deepseek-flash-fixture");
  await option("Model lập kế hoạch", "planning-fixture");
  await option("Model coding", "coding-fixture");
  await click("Áp dụng preset");
  await click("Lưu cấu hình");
  await until(
    async () => (await boot()).settings.agents[0].model === "planning-fixture",
  );
  assert.equal(
    (await boot()).settings.agents.find((a) => a.role === "pm").enabled,
    false,
  );
  await input('[aria-label="Model BE · ID"]', "custom/deepseek-flash");
  await click("Lưu cấu hình");
  await until(
    async () =>
      (await boot()).settings.agents.find((a) => a.role === "be").model ===
      "custom/deepseek-flash",
  );
  // Editing a connection invalidates its check; failed and empty responses stay distinct.
  await input('[aria-label="Gateway URL"]', gateway + "/");
  await until(() => js("!document.querySelector('.setup-card [role=status]')"));
  mode = "error";
  await click("Lưu & kiểm tra kết nối");
  await until(
    () =>
      js(
        "document.querySelector('.setup-card [role=alert]')?.textContent.includes('từ chối')",
      ),
    "Catalog error",
  );
  mode = "empty";
  await click("Lưu & kiểm tra kết nối");
  await until(
    () =>
      js(
        "document.querySelector('.setup-card [role=status]')?.textContent.includes('chưa cung cấp')",
      ),
    "Empty catalog",
  );
  assert.equal((await boot()).models.length, 0);
  await js("document.querySelector('[aria-label=\"API key\"]').focus()");
  await input('[aria-label="API key"]', "fixture-replacement-only");
  mode = "models";
  await click("Lưu & kiểm tra kết nối");
  await until(() =>
    js(
      "document.querySelector('.setup-card [role=status]')?.textContent.includes('3 model')",
    ),
  );
  await click("Xóa key");
  await until(() =>
    js(
      "document.querySelector('.setup-card [role=status]')?.textContent.includes('sẽ được xóa')",
    ),
  );
  assert.equal(
    (await boot()).hasKey,
    true,
    "Removal remains draft until saved",
  );
  await click("Giữ key");
  await click("Lưu & kiểm tra kết nối");
  await until(() =>
    js(
      "document.querySelector('.setup-card [role=status]')?.textContent.includes('3 model')",
    ),
  );
  await click("Xóa key");
  await click("Lưu cấu hình");
  await until(async () => !(await boot()).hasKey);
  await group("runtime");
  await expand("Giới hạn lượt chạy");
  await input('[aria-label="Timeout phút"]', "55");
  const saves = counts[channels.saveSettings];
  await click("Đọc phiên bản");
  await until(() =>
    js("document.querySelectorAll('.setup-tools li').length===4"),
  );
  assert.equal(
    counts[channels.saveSettings],
    saves,
    "Version probe must not save unrelated draft",
  );
  assert.equal((await boot()).settings.timeoutMinutes, 30);
  await input(
    '[aria-label="OpenCode executable"]',
    "E:\\fixture\\opencode.exe",
  );
  assert.equal(
    await js(
      "Array.from(document.querySelectorAll('#setup-panel-runtime button')).find(b=>b.textContent==='Đọc phiên bản').disabled",
    ),
    true,
  );
  await click("Lưu cấu hình");
  await until(async () =>
    (await boot()).settings.runtimePath.includes("fixture"),
  );
  await click("Đọc phiên bản");
  await until(() => js("!!document.querySelector('.setup-tools')"));
  assert.equal((await boot()).settings.timeoutMinutes, 55);
  await group("data");
  await expand("Dọn lịch sử cũ");
  await click("Xem trước");
  await until(() =>
    js(
      "document.querySelector('.history-tools').textContent.includes('lượt có thể xóa')",
    ),
  );
  assert.equal(counts[channels.prune] || 0, 0);
  // Real project overview, controlled probe results, context-aware destination and compact success.
  await js(
    `document.querySelector('[data-project-id="${project.id}"]').click()`,
  );
  await until(() => js("!!document.querySelector('.project-navigation')"));
  await js(
    "document.querySelector('[aria-label=\"Thêm mục trong dự án\"]').click()",
  );
  await click(
    "Tổng quan dự án",
    "document.querySelector('.project-more .ui-popover-panel')",
  );
  await until(() => js("!!document.querySelector('.project-readiness')"));
  assert.equal(counts[channels.readiness] || 0, 0);
  await expand("Môi trường");
  await until(() => js("!!document.querySelector('.readiness-issues')"));
  await click("Cấu hình OpenCode 1.19.5");
  await until(() =>
    js(
      "document.getElementById('setup-tab-runtime')?.getAttribute('aria-selected')==='true'",
    ),
  );
  // Verify keyboard tab navigation and all groups at four layouts.
  await js(
    "document.getElementById('setup-tab-runtime').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}))",
  );
  assert.equal(await js("document.activeElement.id"), "setup-tab-data");
  const layouts = [];
  for (const page of ["models", "runtime", "data"]) {
    await group(page);
    if (page === "models") {
      await expand("Model & trạng thái từng vai trò");
      await expand("Preset theo nhiệm vụ");
      await expand("Chứng chỉ & kết nối nâng cao");
    }
    if (page === "runtime") await expand("Giới hạn lượt chạy");
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
        "({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+2,mainBottom:document.querySelector('main').getBoundingClientRect().bottom})",
      );
      assert.equal(layout.overflow, false, JSON.stringify({ page, ...layout }));
      assert.ok(layout.mainBottom <= layout.height + 1);
      const fields = await js(
        `Array.from(document.querySelectorAll('#setup-panel-${page} input,#setup-panel-${page} [role=combobox]')).filter(el=>el.getClientRects().length).map(el=>({label:el.getAttribute('aria-label'),width:el.getBoundingClientRect().width,overflow:el.getBoundingClientRect().right>innerWidth+1}))`,
      );
      assert.ok(
        fields.every((f) => f.width >= 100 && !f.overflow),
        JSON.stringify(fields),
      );
      layouts.push({ page, width, height, zoom, ...layout });
      writeFileSync(
        join(directory, `${page}-${width}-${zoom}.png`),
        (await win.webContents.capturePage()).toPNG(),
      );
    }
  }
  win.webContents.setZoomFactor(1);
  win.setSize(1366, 768);
  await js(
    `document.querySelector('[data-project-id="${project.id}"]').click()`,
  );
  await until(() => js("!!document.querySelector('.project-navigation')"));
  await js(
    "document.querySelector('[aria-label=\"Thêm mục trong dự án\"]').click()",
  );
  await click(
    "Tổng quan dự án",
    "document.querySelector('.project-more .ui-popover-panel')",
  );
  readyMode = "ready";
  await until(() => js("!!document.querySelector('.project-readiness')"));
  await expand("Môi trường");
  await until(() =>
    js(
      "document.querySelector('.project-readiness summary').textContent.includes('Đã đủ cấu hình local')",
    ),
  );
  assert.equal(
    await js("!!document.querySelector('.readiness-issues')"),
    false,
  );
  assert.equal(
    await js("document.querySelector('.readiness-details').open"),
    false,
  );
  readinessFailure = true;
  await click("Kiểm tra lại");
  await until(() =>
    js("!!document.querySelector('.project-readiness [role=alert]')"),
  );
  assert.equal(
    await js(
      "document.querySelector('.project-readiness summary').textContent.includes('Đã đủ')",
    ),
    false,
    "Failed recheck must not claim ready",
  );
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    directory,
    layouts,
    requests,
    counts,
    errors,
    providerCalls: 0,
  };
  writeFileSync(
    join(directory, "acceptance.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  server.close();
  app.quit();
}
main().catch(async (error) => {
  console.error(error.stack);
  if (win) {
    writeFileSync(
      join(directory, "failure.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    writeFileSync(
      join(directory, "failure.txt"),
      await win.webContents.executeJavaScript("document.body.innerText"),
    );
  }
  server.close();
  app.exit(1);
});
