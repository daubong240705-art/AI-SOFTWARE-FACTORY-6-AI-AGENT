// Real 9Router/OpenCode acceptance. Production settings/key are read-only;
// all execution state and source edits stay in an isolated workspace fixture.
const { app, safeStorage } = require("electron");
const Database = require("better-sqlite3");
const {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
} = require("node:fs");
const { join, resolve } = require("node:path");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { RunController } = require("../electron/controller/runs.ts");
const { settingsSchema } = require("../shared/contracts.ts");
const { git } = require("../electron/workspace/git-evidence.ts");
const { recoverOwnedJobs } = require("../electron/runtime/owned-process.ts");
const { redact } = require("../electron/runtime/security.ts");
const artifacts = resolve(
  __dirname,
  "../../../.cache/asf-research/lifecycle-live",
);
mkdirSync(artifacts, { recursive: true });
const directory = mkdtempSync(join(artifacts, "data-"));
app.setPath("userData", directory);
app.whenReady().then(async () => {
  let store,
    controller,
    secret,
    code = 0;
  try {
    const previous = new Database(
      join(process.env.APPDATA, "ASF Windows Worker", "worker.sqlite"),
      { readonly: true, fileMustExist: true },
    );
    let settings;
    try {
      settings = settingsSchema.parse(
        JSON.parse(
          previous.prepare("SELECT value FROM settings WHERE id=1").get().value,
        ),
      );
      const encrypted = previous
        .prepare("SELECT encrypted FROM credentials WHERE id=1")
        .get()?.encrypted;
      secret =
        process.env.NINE_ROUTER_API_KEY ||
        (encrypted ? safeStorage.decryptString(encrypted) : undefined);
    } finally {
      previous.close();
    }
    if (!secret)
      throw new Error(
        "No configured model key available; no live request sent.",
      );
    settings.permissionMode = "full-access";
    settings.maxRequests = 12;
    settings.timeoutMinutes = 3;
    settings.agents.forEach((a) => {
      a.model = "ds/deepseek-v4-flash";
    });
    store = new Store(directory);
    store.save(settings, undefined);
    const source = join(directory, "source");
    mkdirSync(source);
    writeFileSync(
      join(source, "sum.cjs"),
      "module.exports = (a, b) => a - b;\n",
    );
    writeFileSync(
      join(source, "sum.test.cjs"),
      "const test=require('node:test');const assert=require('node:assert/strict');const sum=require('./sum.cjs');test('adds positive and negative numbers',()=>{assert.equal(sum(3,2),5);assert.equal(sum(-3,2),-1);});\n",
    );
    await git(source, ["init"]);
    await git(source, ["config", "user.name", "Fixture"]);
    await git(source, ["config", "user.email", "fixture@example.invalid"]);
    await git(source, ["add", "."]);
    await git(source, ["commit", "-m", "fixture baseline"]);
    const project = store.addProject(source);
    const conversation = store.conversations.create(project.id);
    controller = new RunController(store, directory, () => secret);
    async function wait(run) {
      while (controller.view().activeId) {
        await new Promise((r) => setTimeout(r, 200));
      }
      const detail = controller.detail(run.id);
      if (detail.run.state !== "completed")
        throw new Error(
          "Live attempt ended " + detail.run.state + ": " + detail.run.error,
        );
      return detail.run;
    }
    const first = await wait(
      controller.start(
        project.id,
        "Sửa đúng file sum.cjs để hàm cộng hai số thay vì trừ. Đọc sum.test.cjs, sửa xong mới chạy đúng lệnh node --test sum.test.cjs để xác minh. Không sửa test, không commit, không tạo file khác. Báo cáo ngắn kết quả thực tế.",
        "be",
        "direct",
        conversation.id,
      ),
    );
    assert.ok(
      first.commands.some(
        (c) =>
          c.status === "completed" &&
          c.exitCode === 0 &&
          c.command.includes("sum.test.cjs"),
      ),
    );
    assert.ok(first.checkpoints.length >= 2);
    assert.deepEqual(
      first.changes.map((c) => c.path),
      ["sum.cjs"],
    );
    assert.ok(first.metrics.requests > 0);
    const altered = readFileSync(join(source, "sum.cjs"), "utf8");
    const stopped = controller.start(
      project.id,
      "Đọc sum.cjs hiện tại và trả lời ngắn chức năng. Không shell, không sửa file.",
      "be",
      "direct",
      conversation.id,
    );
    await controller.stop(stopped.id);
    const inspected = await controller.recovery(stopped.id);
    const recovered = await wait(
      await controller.continueRecovery(inspected.token),
    );
    assert.equal(recovered.recoveryOf, stopped.id);
    assert.equal(recovered.changes.length, 0);
    assert.equal(readFileSync(join(source, "sum.cjs"), "utf8"), altered);
    const third = await wait(
      controller.start(
        project.id,
        "Chào Lead, hãy trả lời đúng một câu ngắn bằng tiếng Việt và không dùng công cụ.",
        "lead",
        "team",
        conversation.id,
      ),
    );
    assert.equal(third.tasks.length, 1);
    assert.ok(third.tasks.every((t) => t.kind === "plan"));
    assert.equal(third.changes.length, 0);
    await recoverOwnedJobs(directory);
    const reports = [first, recovered, third].map((r) =>
      JSON.parse(store.report(r.id, [secret])),
    );
    writeFileSync(
      join(artifacts, "result.json"),
      JSON.stringify(
        {
          passed: true,
          kind: "real-9router-opencode",
          model: "ds/deepseek-v4-flash",
          reports,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        passed: true,
        model: "ds/deepseek-v4-flash",
        runs: reports.map((r) => ({
          id: r.run.id,
          state: r.run.state,
          requests: r.run.metrics.requests,
          commands: r.run.commands.length,
          checkpoints: r.run.checkpoints.length,
        })),
      }),
    );
  } catch (error) {
    console.error(
      redact(
        error instanceof Error ? error.message : "Live acceptance failed",
        secret ? [secret] : [],
      ),
    );
    code = 1;
  } finally {
    await controller?.shutdown().catch(() => {});
    store?.close();
    secret = undefined;
    app.exit(code);
  }
});
