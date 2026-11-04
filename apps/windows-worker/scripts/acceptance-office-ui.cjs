// D-01/02: production Electron WebGL, isolated SQLite; no provider calls.
const { app, BrowserWindow } = require("electron");
const { resolve, join } = require("node:path");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "office-ui-"));
app.setPath("userData", directory);
const output = process.env.ASF_UI_ARTIFACT_DIR
  ? resolve(process.env.ASF_UI_ARTIFACT_DIR)
  : resolve(__dirname, "../../../docs/windows-worker/office-3d");
mkdirSync(output, { recursive: true });
const store = new Store(directory),
  project = store.addProject(join(directory, "source")),
  settings = defaultSettings();
settings.gatewayUrl = "https://unused.example/v1";
settings.agents.forEach((agent) => {
  agent.model = "fixture-model";
});
store.save(settings, undefined);
store.conversations.create(project.id);
store.close();
BrowserWindow.prototype.show = function () {};
require("../out/main/main.js");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const value = await fn();
    if (value) return value;
    await pause(100);
  }
  throw new Error("Timed out waiting for office UI");
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
    assert.equal(
      await js(
        "performance.getEntriesByType('resource').some(item=>item.name.includes('/OfficeScene-'))",
      ),
      false,
      "3D chunk must not load in Chat",
    );
    const nav = async (title) => {
      await js(
        `document.querySelector('.sidebar nav button[title=${JSON.stringify(title)}]').click()`,
      );
      await pause(180);
    };
    const click = async (label) => {
      await js(
        `Array.from(document.querySelectorAll('button')).find(el=>el.getAttribute('aria-label')===${JSON.stringify(label)}||el.textContent.trim()===${JSON.stringify(label)}).click()`,
      );
      await pause(120);
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
    const measures = [];
    for (const scenario of [
      { width: 1440, height: 960, zoom: 1 },
      { width: 850, height: 700, zoom: 1 },
      { width: 1100, height: 800, zoom: 1.25 },
    ]) {
      win.setSize(scenario.width, scenario.height);
      win.webContents.setZoomFactor(scenario.zoom);
      await nav("Văn phòng");
      await until(() =>
        js("document.querySelector('.office-stage')?.dataset.ready==='true'"),
      );
      await pause(250);
      const measurement = await js(
        `(()=>{const stage=document.querySelector('.office-stage'),r=stage.getBoundingClientRect(),labels=Array.from(document.querySelectorAll('.office-seat-label')).map(el=>{const box=el.getBoundingClientRect();return {role:el.querySelector('strong').textContent,visible:getComputedStyle(el).visibility==='visible',inside:box.left>=r.left&&box.right<=r.right&&box.top>=r.top&&box.bottom<=r.bottom,text:el.textContent};});const canvas=stage.querySelector('canvas'),gl=canvas.getContext('webgl2');return {width:r.width,height:r.height,right:r.right,viewport:innerWidth,labels,canvas:{width:canvas.width,height:canvas.height},webgl:gl?.getParameter(gl.VERSION),rootOverflow:document.documentElement.scrollWidth>innerWidth};})()`,
      );
      assert.ok(
        measurement.webgl?.includes("WebGL 2"),
        "Actual WebGL2 renderer must run",
      );
      assert.equal(measurement.rootOverflow, false);
      assert.ok(measurement.right <= measurement.viewport);
      assert.equal(measurement.labels.length, 7);
      assert.ok(
        measurement.labels.every((label) => label.visible && label.inside),
        "Every default seat label must fit",
      );
      assert.ok(
        measurement.labels.every((label) => label.text.includes("Rảnh")),
        "Configured idle fixture is never shown working",
      );
      const before = await js(
        "document.querySelector('.office-seat-label').getBoundingClientRect().left",
      );
      await click("Phóng to văn phòng");
      await until(
        async () =>
          Math.abs(
            (await js(
              "document.querySelector('.office-seat-label').getBoundingClientRect().left",
            )) - before,
          ) > 1,
      );
      const after = await js(
        "document.querySelector('.office-seat-label').getBoundingClientRect().left",
      );
      assert.ok(
        Math.abs(after - before) > 1,
        "Zoom changes the projected scene",
      );
      await click("Dịch góc nhìn sang phải");
      await until(
        async () =>
          Math.abs(
            (await js(
              "document.querySelector('.office-seat-label').getBoundingClientRect().left",
            )) - after,
          ) > 1,
      );
      await click("Đặt lại góc nhìn");
      await until(
        async () =>
          Math.abs(
            (await js(
              "document.querySelector('.office-seat-label').getBoundingClientRect().left",
            )) - before,
          ) < 2,
      );
      const reset = await js(
        "document.querySelector('.office-seat-label').getBoundingClientRect().left",
      );
      assert.ok(
        Math.abs(reset - before) < 2,
        `Reset restores default camera: ${JSON.stringify({ before, after, reset })}`,
      );
      await js(
        "(()=>{const canvas=document.querySelector('.office-stage canvas'),r=canvas.getBoundingClientRect();canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:-160,clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true,cancelable:true}));})()",
      );
      await until(
        async () =>
          Math.abs(
            (await js(
              "document.querySelector('.office-seat-label').getBoundingClientRect().left",
            )) - before,
          ) > 1,
      );
      await click("Đặt lại góc nhìn");
      await until(
        async () =>
          Math.abs(
            (await js(
              "document.querySelector('.office-seat-label').getBoundingClientRect().left",
            )) - before,
          ) < 2,
      );
      await capture(
        scenario.width === 1440
          ? "office-desktop"
          : scenario.width === 850
            ? "office-small"
            : "office-zoom125",
      );
      await nav("Đội ngũ");
      assert.equal(
        await js("document.querySelectorAll('canvas').length"),
        0,
        "Leaving Office unmounts renderer",
      );
      measures.push({
        window: scenario,
        scene: measurement,
        zoomChangesScene: true,
        panChangesScene: true,
        wheelChangesScene: true,
        resetRestoresCamera: true,
      });
    }
    await nav("Văn phòng");
    await until(() =>
      js("document.querySelector('.office-stage')?.dataset.ready==='true'"),
    );
    await js(
      "document.querySelector('.office-stage canvas').dispatchEvent(new Event('webglcontextlost',{cancelable:true}))",
    );
    await until(() => js("!!document.querySelector('.office-fallback')"));
    await click("Mở đội ngũ 2D");
    await until(() =>
      js("document.querySelectorAll('.agent-card').length===7"),
    );
    assert.deepEqual(errors, []);
    const result = {
      passed: true,
      version: "1.3.0-alpha.6",
      scope: "D-01/D-02",
      fixture: true,
      providerCalls: 0,
      lazyLoaded: true,
      unmountVerified: true,
      contextLossNavigationVerified: true,
      gpu: app.getGPUFeatureStatus(),
      scenarios: measures,
      rendererErrors: errors,
    };
    writeFileSync(
      join(output, "d01-d02-ui.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(
      JSON.stringify({
        passed: true,
        scenarios: measures.length,
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
