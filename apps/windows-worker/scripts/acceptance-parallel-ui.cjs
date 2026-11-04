// Read the completed live fixture through the real renderer/IPC, with no new model requests.
const { app, BrowserWindow } = require("electron");
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { resolve, join, relative, isAbsolute } = require("node:path");
const assert = require("node:assert/strict");
const artifacts = resolve(
  __dirname,
  "../../../.cache/asf-research/parallel-live",
);
const result = JSON.parse(readFileSync(join(artifacts, "result.json"), "utf8"));
assert.equal(result.passed, true);
const tasks = result.report.run.tasks.filter((t) => t.workspace);
const directory = resolve(tasks[0].workspace, "../../..");
const rel = relative(artifacts, directory);
assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel));
const output = resolve(__dirname, "../../../.cache/asf-research/parallel-ui");
mkdirSync(output, { recursive: true });
app.setPath("userData", directory);
BrowserWindow.prototype.show = function () {};
require("../out/main/main.js");
async function until(fn) {
  for (let i = 0; i < 150; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Parallel UI timeout");
}
app.whenReady().then(async () => {
  let code = 0;
  try {
    const win = await until(() => BrowserWindow.getAllWindows()[0]);
    win.webContents.setBackgroundThrottling(false);
    await until(() => !win.webContents.isLoading());
    const js = (source) => win.webContents.executeJavaScript(source, true);
    await until(() => js(`!!document.querySelector('[title="Lịch sử"]')`));
    await until(() =>
      js(
        `if(document.querySelector('.run-history button')) true; else {document.querySelector('[title="Lịch sử"]').click(); false;}`,
      ),
    );
    await js(`document.querySelector('.run-history button').click()`);
    await until(() =>
      js(
        `if(document.querySelector('[role="tab"]')) true; else {document.querySelector('[aria-label="Mở chi tiết"]')?.click(); false;}`,
      ),
    );
    await js(
      `[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='Thay đổi').click()`,
    );
    await until(() =>
      js(
        `document.querySelector('[aria-label="Kết quả workspace riêng"]')?.querySelectorAll('details').length===2`,
      ),
    );
    await js(
      `document.querySelector('[aria-label="Kết quả workspace riêng"] summary').click()`,
    );
    await js(
      `document.querySelector('[aria-label="Kết quả workspace riêng"] button').click()`,
    );
    await until(() =>
      js(
        `document.querySelector('[aria-label="Bằng chứng nghiệm thu"] pre')?.textContent.includes('module.exports')`,
      ),
    );
    await until(() => js(`!!document.querySelector('.source-changes')`));
    await js(
      `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
    );
    assert.equal(
      await js(
        `document.querySelector('[aria-label="Bằng chứng nghiệm thu"] pre').getBoundingClientRect().height>0`,
      ),
      true,
    );
    writeFileSync(
      join(output, "task-evidence.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(
      `[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='Kết quả').click()`,
    );
    await until(() =>
      js(
        `document.querySelector('.run-result')?.textContent.includes('Chưa có thao tác tích hợp tự động')`,
      ),
    );
    assert.equal(
      await js(
        `document.querySelector('.run-result')?.textContent.includes('Kiểm tra để tiếp tục')`,
      ),
      false,
    );
    await js(
      `[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='Workspace').click()`,
    );
    await until(() =>
      js(
        `document.querySelectorAll('.workspace-tools .command-result').length===2`,
      ),
    );
    writeFileSync(
      join(output, "result.json"),
      JSON.stringify(
        {
          passed: true,
          kind: "real-electron-immutable-task-evidence",
          checks: [
            "separate task results visible",
            "immutable source evidence through IPC",
            "pending integration hides recovery replay",
            "both retained workspaces discoverable",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS: Electron task workspace results, immutable evidence and integration-pending UI.",
    );
  } catch (error) {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      console.error(
        await win.webContents.executeJavaScript(
          `document.body.innerText.slice(0,2500)`,
        ),
      );
      writeFileSync(
        join(output, "failure.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
    }
    console.error(error.stack);
    code = 1;
  }
  app.exit(code);
});
