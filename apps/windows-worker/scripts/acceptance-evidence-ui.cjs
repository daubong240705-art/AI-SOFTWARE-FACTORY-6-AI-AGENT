// Isolated fixture workspace: built main/preload/renderer with real IPC, Git and SQLite.
const { app, BrowserWindow } = require("electron");
const { join, resolve } = require("node:path");
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { snapshot, changes } = require("../electron/workspace/snapshot.ts");
const { git, captureGit } = require("../electron/workspace/git-evidence.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const directory = mkdtempSync(join(tmpdir(), "asf-ww4c-ui-"));
app.setPath("userData", directory);
const source = join(directory, "source");
mkdirSync(source);
const store = new Store(directory),
  project = store.addProject(source),
  chat = store.conversations.create(project.id);
const settings = defaultSettings();
settings.gatewayUrl = "https://unused.example/v1";
settings.agents = settings.agents.map((a) => ({
  ...a,
  model: "ds/deepseek-v4-flash",
}));
store.save(settings, undefined);
const beforeText = "export const title = 'Bản nháp của tôi';\n";
const afterText = beforeText + "export const showChanges = true;\n";
const path = join(source, "feature.ts");
const run = {
  ...require("../../../docs/windows-worker/ww3-live.json").run,
  id: crypto.randomUUID(),
  conversationId: chat.id,
  projectId: project.id,
  projectName: project.name,
  workspace: source,
  prompt: "Xem diff và giữ phần source tôi đã sửa sẵn",
  summary:
    "Dữ liệu fixture dùng kiểm tra giao diện diff và khôi phục từng file.",
  state: "completed",
  settings,
  tasks: [],
  createdAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  commands: [
    {
      callId: "fixture-command",
      command: "npm test",
      status: "completed",
      output: "Fixture command output\n",
      exitCode: 0,
      cwd: source,
      startedAt: 1000,
      endedAt: 1500,
    },
  ],
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 120; i++) {
    const value = await fn();
    if (value) return value;
    await pause(100);
  }
  throw new Error("UI timeout");
}
async function seed() {
  await git(source, ["init"]);
  await git(source, ["config", "user.email", "fixture@example.invalid"]);
  await git(source, ["config", "user.name", "Fixture"]);
  await git(source, ["config", "core.autocrlf", "false"]);
  writeFileSync(path, "export const title = 'Gốc';\n");
  await git(source, ["add", "."]);
  await git(source, ["commit", "-m", "fixture"]);
  writeFileSync(path, "export const title = 'Đã staged';\n");
  await git(source, ["add", "feature.ts"]);
  writeFileSync(path, beforeText);
  store.createRun(run);
  const before = await snapshot(source, true);
  store.evidence.begin(run.id, source, before, await captureGit(source, true));
  writeFileSync(path, afterText);
  const after = await snapshot(source, true);
  store.evidence.finish(run.id, after, await captureGit(source, true));
  run.changes = changes(before, after);
  store.updateRun(run);
  store.evidence.saveCommand(
    run.id,
    "fixture-command",
    "Fixture command output\n",
  );
  store.close();
}
seed()
  .then(() => {
    BrowserWindow.prototype.show = function () {};
    require("../out/main/main.js");
    app.whenReady().then(async () => {
      try {
        const win = await until(() => BrowserWindow.getAllWindows()[0]);
        win.webContents.setBackgroundThrottling(false);
        await until(() => !win.webContents.isLoading());
        const js = (code) => win.webContents.executeJavaScript(code, true);
        await until(() =>
          js(`!!document.querySelector('.chat-message.assistant')`),
        );
        await js(
          `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Thay đổi').click()`,
        );
        await until(() =>
          js(
            `document.querySelector('.unified-diff')?.textContent.includes('+export const showChanges')`,
          ),
        );
        const select = async (value) => {
          await require("./ui-select-test.cjs").selectValue(
            win,
            "Kiểu so sánh",
            value,
          );
        };
        const click = (label) =>
          js(
            `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
          );
        await select("staged");
        await until(() =>
          js(
            `document.querySelector('.unified-diff')?.textContent.includes('Đã staged')`,
          ),
        );
        await select("unstaged");
        await until(() =>
          js(
            `document.querySelector('.unified-diff')?.textContent.includes('Bản nháp của tôi')`,
          ),
        );
        await select("run");
        await until(() =>
          js(
            `document.querySelector('.unified-diff')?.textContent.includes('+export const showChanges')`,
          ),
        );
        const target = process.env.ASF_UI_ARTIFACT_DIR
          ? resolve(process.env.ASF_UI_ARTIFACT_DIR)
          : resolve(__dirname, "../../../docs/windows-worker/ww4c");
        mkdirSync(target, { recursive: true });
        win.setSize(1280, 860);
        await pause(500);
        await js(
          `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
        );
        writeFileSync(
          join(target, "diff-with-panel.png"),
          (await win.webContents.capturePage()).toPNG(),
        );
        await click("Xem trước khôi phục");
        await until(() => js(`!!document.querySelector('.restore-preview')`));
        assert.equal(
          await js(
            `document.querySelector('.restore-preview').textContent.includes('-export const showChanges')`,
          ),
          true,
        );
        await pause(200);
        writeFileSync(
          join(target, "restore-preview.png"),
          (await win.webContents.capturePage()).toPNG(),
        );
        writeFileSync(path, "external editor change\n");
        await click("Khôi phục file này");
        await until(() =>
          js(
            `document.querySelector('.source-changes [role="alert"]')?.textContent.includes('Không ghi đè')`,
          ),
        );
        assert.equal(readFileSync(path, "utf8"), "external editor change\n");
        writeFileSync(path, afterText);
        const index = (await captureGit(source)).state.indexHash;
        await click("Xem trước khôi phục");
        await until(() => js(`!!document.querySelector('.restore-preview')`));
        await click("Khôi phục file này");
        await until(() =>
          js(
            `document.querySelector('.source-changes [role="status"]')?.textContent.includes('Đã khôi phục')`,
          ),
        );
        assert.equal(readFileSync(path, "utf8"), beforeText);
        assert.equal((await captureGit(source)).state.indexHash, index);
        assert.equal(
          await js(
            `document.querySelector('.unified-diff').textContent.includes('+export const showChanges')`,
          ),
          true,
        );
        win.setSize(850, 700);
        await pause(400);
        assert.equal(
          await js(`document.documentElement.scrollWidth<=window.innerWidth`),
          true,
        );
        assert.equal(
          await js(
            `document.querySelector('.chat-detail-panel').getBoundingClientRect().right<=window.innerWidth+1`,
          ),
          true,
        );
        writeFileSync(
          join(target, "diff-small.png"),
          (await win.webContents.capturePage()).toPNG(),
        );
        await js(
          `Array.from(document.querySelectorAll('[role="tab"]')).find(b=>b.textContent==='Kết quả').click()`,
        );
        await until(() =>
          js(`!!document.querySelector('details.command-result')`),
        );
        await js(`document.querySelector('details.command-result').open=true`);
        await until(() =>
          js(
            `document.querySelector('details.command-result')?.textContent.includes('Fixture command output')`,
          ),
        );
        await pause(200);
        writeFileSync(
          join(target, "command-evidence.png"),
          (await win.webContents.capturePage()).toPNG(),
        );
        const result = {
          passed: true,
          fixture: true,
          checks: [
            "Built Electron main/preload/renderer with real SQLite and Git",
            "Stored run diff and staged/unstaged snapshots",
            "Restore preview through validated IPC",
            "Post-preview external edit rejected and retained",
            "Per-file restore preserves user baseline and index",
            "Historical diff remains after restore",
            "850x700 panel stays within window",
            "Command output, cwd, timing and exit code",
          ],
        };
        writeFileSync(
          join(target, "ui-acceptance.json"),
          JSON.stringify(result, null, 2),
        );
        console.log(JSON.stringify(result));
        app.quit();
      } catch (error) {
        console.error(error.stack);
        app.exit(1);
      }
    });
  })
  .catch((error) => {
    console.error(error.stack);
    app.exit(1);
  });
