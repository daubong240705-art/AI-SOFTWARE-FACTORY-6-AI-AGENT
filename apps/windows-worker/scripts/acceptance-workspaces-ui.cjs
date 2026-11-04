// Real Git + isolated Electron IPC/renderer; no provider or production DB.
const { app, BrowserWindow } = require("electron");
const { join, resolve } = require("node:path");
const {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
} = require("node:fs");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const artifacts = resolve(
  __dirname,
  "../../../.cache/asf-research/workspaces-ui",
);
mkdirSync(artifacts, { recursive: true });
const directory = mkdtempSync(join(artifacts, "data-"));
app.setPath("userData", directory);
const source = join(directory, "source");
mkdirSync(source);
writeFileSync(join(source, "source.txt"), "baseline");
const git = (args) =>
  execFileSync("git", ["-C", source, ...args], { windowsHide: true });
git(["init"]);
git(["config", "user.name", "Fixture"]);
git(["config", "user.email", "fixture@example.invalid"]);
git(["add", "."]);
git(["commit", "-m", "baseline"]);
const store = new Store(directory),
  settings = defaultSettings();
settings.agents.forEach((a) => {
  a.model = "fixture";
});
settings.gatewayUrl = "https://unused.example/v1";
store.save(settings, undefined);
store.setModels(["fixture"]);
const project = store.addProject(source);
store.conversations.create(project.id);
store.close();
BrowserWindow.prototype.show = function () {};
require("../out/main/main.js");
async function until(fn) {
  for (let i = 0; i < 150; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Workspaces UI timeout");
}
app.whenReady().then(async () => {
  let code = 0;
  try {
    const win = await until(() => BrowserWindow.getAllWindows()[0]);
    win.webContents.setBackgroundThrottling(false);
    await until(() => !win.webContents.isLoading());
    const js = (source) => win.webContents.executeJavaScript(source, true);
    await until(() =>
      js(`!!document.querySelector('[aria-label="Mở chi tiết"]')`),
    );
    await js(`document.querySelector('[title="Cài đặt"]').click()`);
    await until(() =>
      js(`!!document.querySelector('option[value="isolated-pair"]')`),
    );
    assert.equal(
      await js(
        `document.querySelector('option[value="isolated-pair"]').parentElement.value`,
      ),
      "sequential",
    );
    await js(
      `const select=document.querySelector('option[value="isolated-pair"]').parentElement;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'isolated-pair');select.dispatchEvent(new Event('change',{bubbles:true}));`,
    );
    await until(() =>
      js(
        `!![...document.querySelectorAll('button')].find(e=>e.textContent.includes('Lưu cấu hình')&&!e.disabled)`,
      ),
    );
    await js(
      `[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Lưu cấu hình')).click()`,
    );
    await until(async () => {
      const r = await js(`window.worker.bootstrap()`);
      return r.ok && r.value.settings.teamExecution === "isolated-pair";
    });
    await js(`document.querySelector('[title="Dự án"]').click()`);
    await until(() =>
      js(`!!document.querySelector('[aria-label="Mở chi tiết"]')`),
    );
    await js(`document.querySelector('[aria-label="Mở chi tiết"]').click()`);
    await js(
      `[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='Workspace').click()`,
    );
    await until(() =>
      js(
        `document.querySelector('.workspace-tools')?.textContent.includes('Tạo workspace riêng')`,
      ),
    );
    assert.equal(
      (await js(`window.worker.openWorkspace('../outside')`)).ok,
      false,
    );
    await js(
      `[...document.querySelectorAll('.workspace-tools button')].find(e=>e.textContent==='Tạo workspace riêng').click()`,
    );
    const item = await until(async () => {
      const r = await js(
        `window.worker.workspaces(${JSON.stringify(project.id)})`,
      );
      return r.ok && r.value[0]?.state === "ready" ? r.value[0] : null;
    });
    assert.equal(item.state, "ready");
    await until(() => js(`!!document.querySelector('.command-result')`));
    await js(
      `[...document.querySelectorAll('.workspace-tools button')].find(e=>e.textContent==='Dọn workspace').click()`,
    );
    await until(() =>
      js(
        `!![...document.querySelectorAll('.workspace-tools button')].find(e=>e.textContent==='Xóa worktree sạch'&&!e.disabled)`,
      ),
    );
    writeFileSync(
      join(artifacts, "workspaces.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(
      `[...document.querySelectorAll('.workspace-tools button')].find(e=>e.textContent==='Xóa worktree sạch').click()`,
    );
    await until(async () => {
      const r = await js(
        `window.worker.workspaces(${JSON.stringify(project.id)})`,
      );
      return r.ok && r.value.length === 0;
    });
    await until(() =>
      js(
        `![...document.querySelectorAll('.workspace-tools button')].find(e=>e.textContent==='Tạo workspace riêng').disabled`,
      ),
    );
    await js(
      `[...document.querySelectorAll('.workspace-tools button')].find(e=>e.textContent==='Tạo workspace riêng').click()`,
    );
    const second = await until(async () => {
      const r = await js(
        `window.worker.workspaces(${JSON.stringify(project.id)})`,
      );
      return r.ok && r.value[0]?.state === "ready" ? r.value[0] : null;
    });
    await until(() =>
      js(
        `!![...document.querySelectorAll('.workspace-tools button')].find(e=>e.textContent==='Mở làm dự án'&&!e.disabled)`,
      ),
    );
    await js(
      `[...document.querySelectorAll('.workspace-tools button')].find(e=>e.textContent==='Mở làm dự án').click()`,
    );
    await until(async () => {
      const r = await js(`window.worker.bootstrap()`);
      return r.value.projects.some((p) => p.path === second.path);
    });
    await until(() =>
      js(
        `document.querySelector('.chat-empty')?.textContent.includes('Bạn muốn làm gì')`,
      ),
    );
    assert.equal(readFileSync(join(source, "source.txt"), "utf8"), "baseline");
    assert.equal(
      (
        await js(
          `window.worker.previewWorkspaceRemoval(${JSON.stringify(second.id)})`,
        )
      ).ok,
      false,
      "registered workspace remains protected",
    );
    assert.equal(git(["status", "--porcelain"]).toString(), "");
    writeFileSync(
      join(artifacts, "result.json"),
      JSON.stringify(
        {
          passed: true,
          kind: "real-git-electron-fixture",
          checks: [
            "parallel setting defaults sequential and persists opt-in",
            "narrow IPC validation",
            "create from clean HEAD",
            "preview/remove clean worktree",
            "open as isolated project",
            "protect registered source",
            "original source/index unchanged",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS: real Git/Electron workspace create, removal preview, isolated project open and data protection.",
    );
  } catch (e) {
    console.error(e.stack);
    code = 1;
  }
  app.exit(code);
});
