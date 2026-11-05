// Real built Electron + pinned local Mermaid; no provider or production data.
const { app, BrowserWindow } = require("electron");
const { join, resolve } = require("node:path");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "mermaid-ui-")),
  data = join(directory, "data");
app.setPath("userData", data);
BrowserWindow.prototype.show = function () {};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label = "UI") {
  for (let i = 0; i < 150; i++) {
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
  settings.agents.forEach((a) => (a.model = "fixture"));
  store.save(settings, undefined);
  const sources = [
    "flowchart LR\n User[Người dùng] --> Lead[Lead]\n Lead --> Worker[Agent]\n Worker --> Test[Kiểm thử]\n Test --> Report[Báo cáo]",
    "sequenceDiagram\n participant U as Người dùng\n participant L as Lead\n U->>L: Yêu cầu\n L-->>U: Kết quả",
    "classDiagram\n class Project\n class Task\n Project --> Task",
    "stateDiagram-v2\n [*] --> Ready\n Ready --> Running\n Running --> Done\n Done --> [*]",
    "erDiagram\n PROJECT ||--o{ TASK : contains",
    'flowchart LR\n A["<img src=https://external.invalid/i onerror=alert(1)>"]',
    'flowchart LR\n%%{init:{"securityLevel":"loose"}}%%\nA-->B',
    "flowchart LR\n A[invalid",
  ];
  const base = require("../../../docs/windows-worker/ww3-live.json").run;
  const run = {
    ...base,
    id: crypto.randomUUID(),
    projectId: project.id,
    projectName: project.name,
    workspace: directory,
    conversationId: conversation.id,
    settings,
    prompt: "Các sơ đồ minh họa",
    summary:
      sources.map((s) => "```mermaid\n" + s + "\n```").join("\n\n") +
      "\n\n```typescript\nconst value = 1;\n```",
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
  await until(() => js("!!document.querySelector('.project-overview')"));
  await pause(150);
  await js(
    "document.querySelector('nav button[title=\"Trò chuyện\"]').click()",
  );
  await until(() =>
    js("document.querySelectorAll('.mermaid-block').length===8"),
  );
  assert.equal(
    await js("!!window.mermaid"),
    false,
    "No Mermaid library loaded until preview",
  );
  assert.equal(
    await js("document.querySelector('.chat-code code').textContent.trim()"),
    "const value = 1;",
  );
  await js(
    "window.__diagramBlobs=[];window.__originalObjectURL=URL.createObjectURL;URL.createObjectURL=(blob)=>{window.__diagramBlobs.push(blob);return window.__originalObjectURL(blob)};undefined",
  );
  const select = (i) => `document.querySelectorAll('.mermaid-block')[${i}]`;
  for (let i = 0; i < 5; i++) {
    await js(`${select(i)}.querySelector('.diagram-toolbar button').click()`);
    await until(
      () =>
        js(`!!${select(i)}.querySelector('.diagram-image img')?.naturalWidth`),
      `diagram type ${i}`,
    );
    const svg = await js("window.__diagramBlobs.at(-1).text()");
    writeFileSync(join(directory, `diagram-${i}.svg`), svg);
    assert.equal(
      [
        "<script",
        "<foreignobject",
        "<image",
        "<a ",
        "onload=",
        "onerror=",
        "https://",
        "file://",
      ].some((value) => svg.toLowerCase().includes(value)),
      false,
    );
    assert.ok(
      svg.includes("<text") || svg.includes("<tspan"),
      `Diagram ${i} keeps labels`,
    );
    await js(`${select(i)}.querySelector('.diagram-toolbar button').click()`);
  }
  for (let i = 5; i < 8; i++) {
    await js(`${select(i)}.querySelector('.diagram-toolbar button').click()`);
    await until(
      () => js(`!!${select(i)}.querySelector('.diagram-error')`),
      `rejected diagram ${i}`,
    );
    assert.equal(await js(`!!${select(i)}.querySelector('pre')`), true);
  }
  assert.equal(
    await js("document.querySelectorAll('.diagram-staging').length"),
    0,
  );
  // Exercise the final SVG sanitizer with hostile output in the real DOM,
  // using a fixture-only bundle built by the existing esbuild dependency.
  const esbuild = require("esbuild");
  const bundled = esbuild.buildSync({
    entryPoints: [join(__dirname, "../src/lib/diagram-svg.ts")],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__sanitizer",
    platform: "browser",
  }).outputFiles[0].text;
  const result = await js(
    `(()=>{${bundled};const input='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert(1)"><style>@import url(https://external.invalid/a)</style><script>alert(1)</script><foreignObject><div>bad</div></foreignObject><image href="file:///C:/secret"/><a href="javascript:alert(1)"><text>bad</text></a><rect id="good" style="fill:url(https://external.invalid/i)" onclick="alert(1)" width="30" height="20"/><text x="5" y="10">Nhãn</text><path marker-end="url(#missing)" d="M0 0 L1 1"/></svg>';return __sanitizer.sanitizedDiagram(input).svg;})()`,
  );
  assert.equal(
    [
      "<script",
      "<foreignobject",
      "<image",
      "<a ",
      "onload=",
      "onclick=",
      "@import",
      "external.invalid",
      "file:",
      "javascript:",
      "url(#missing)",
    ].some((value) => result.toLowerCase().includes(value)),
    false,
  );
  assert.ok(result.includes("Nhãn"));
  const rejected = await js(`(()=>{${bundled};return [
    '<!DOCTYPE svg [<!ENTITY test "bad">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9000 10"/>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5000 5000"/>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'+ '<g>'.repeat(45) + '</g>'.repeat(45) + '</svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'+ '<rect/>'.repeat(6001) + '</svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'+ 'x'.repeat(600001) + '</svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><broken></svg>'
  ].map(input=>{try{__sanitizer.sanitizedDiagram(input);return false}catch{return true}})})()`);
  assert.deepEqual(rejected, Array(7).fill(true));
  const layouts = [];
  await js(`${select(0)}.querySelector('.diagram-toolbar button').click()`);
  for (const [width, height, zoom] of [
    [1366, 768, 1],
    [850, 700, 1],
    [1366, 768, 1.25],
    [1366, 768, 1.5],
  ]) {
    win.setSize(width, height);
    win.webContents.setZoomFactor(zoom);
    await pause(200);
    await js(`${select(0)}.scrollIntoView({block:'center'})`);
    await pause(100);
    const layout = await js(
      `(()=>{const h=document.querySelector('.chat-host'),r=${select(0)}.getBoundingClientRect();return{viewport:innerWidth,height:innerHeight,left:r.left,right:r.right,overflow:h.scrollWidth>h.clientWidth+2}})()`,
    );
    assert.equal(layout.overflow, false);
    assert.ok(layout.left >= 0 && layout.right <= layout.viewport);
    writeFileSync(
      join(directory, `diagram-${width}-${zoom}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(`${select(0)}.querySelector('.diagram-image').click()`);
    await until(() =>
      js("document.querySelector('.diagram-preview')?.matches(':modal')"),
    );
    const modal = await js(
      "(()=>{const r=document.querySelector('.diagram-preview').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()",
    );
    assert.ok(
      modal.left >= 0 &&
        modal.right <= layout.viewport &&
        modal.top >= 0 &&
        modal.bottom <= layout.height,
    );
    writeFileSync(
      join(directory, `preview-${width}-${zoom}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js("document.querySelector('[aria-label=\"Đóng sơ đồ\"]').click()");
    layouts.push({ width, height, zoom, ...layout });
  }
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
  await js(
    "window.__revoked=[];window.__originalRevoke=URL.revokeObjectURL;URL.revokeObjectURL=url=>{window.__revoked.push(url);window.__originalRevoke(url)};undefined",
  );
  win.setSize(1366, 768);
  win.webContents.setZoomFactor(1);
  await pause(150);
  await js("document.querySelector('.new-conversation').click()");
  await until(
    () =>
      js(
        "document.querySelectorAll('.mermaid-block').length===0 && window.__revoked.length>=5",
      ),
    "object URLs reclaimed on conversation change",
  );
  writeFileSync(
    join(directory, "acceptance.json"),
    JSON.stringify(
      {
        passed: true,
        providerCalls: 0,
        layouts,
        errors,
        externalRequests,
        diagramTypes: 5,
        blockedSources: 3,
        sanitizer: true,
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
