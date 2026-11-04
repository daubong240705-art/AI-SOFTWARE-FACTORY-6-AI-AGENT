// Real provider/runtime acceptance, production settings read-only, all edits in fixture worktrees.
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
const { execFileSync } = require("node:child_process");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { RunController } = require("../electron/controller/runs.ts");
const { settingsSchema } = require("../shared/contracts.ts");
const { git } = require("../electron/workspace/git-evidence.ts");
const { recoverOwnedJobs } = require("../electron/runtime/owned-process.ts");
const { redact } = require("../electron/runtime/security.ts");
const { Worktrees } = require("../electron/workspace/worktrees.ts");
const artifacts = resolve(
  __dirname,
  "../../../.cache/asf-research/parallel-live",
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
      throw new Error("No model key available; no live request sent.");
    settings.teamExecution = "isolated-pair";
    settings.permissionMode = "full-access";
    settings.maxRequests = 20;
    settings.timeoutMinutes = 4;
    settings.agents.forEach((a) => {
      a.model = "ds/deepseek-v4-flash";
      a.enabled = true;
    });
    const source = join(directory, "source");
    mkdirSync(source);
    const originals = {
      "sum.cjs": "module.exports = (a,b) => a-b;\n",
      "multiply.cjs": "module.exports = (a,b) => a+b;\n",
    };
    for (const [file, content] of Object.entries(originals))
      writeFileSync(join(source, file), content);
    writeFileSync(
      join(source, "sum.test.cjs"),
      "const t=require('node:test'),a=require('node:assert/strict'),f=require('./sum.cjs');t('sum',()=>{a.equal(f(3,2),5);a.equal(f(-3,2),-1)});\n",
    );
    writeFileSync(
      join(source, "multiply.test.cjs"),
      "const t=require('node:test'),a=require('node:assert/strict'),f=require('./multiply.cjs');t('multiply',()=>{a.equal(f(3,2),6);a.equal(f(-3,2),-6)});\n",
    );
    await git(source, ["init"]);
    await git(source, ["config", "user.name", "Fixture"]);
    await git(source, ["config", "user.email", "fixture@example.invalid"]);
    await git(source, ["add", "."]);
    await git(source, ["commit", "-m", "parallel baseline"]);
    store = new Store(directory);
    store.save(settings, undefined);
    const project = store.addProject(source);
    controller = new RunController(store, directory, () => secret);
    const initial = controller.start(
      project.id,
      "Thực hiện hai sửa lỗi ĐỘC LẬP trong chế độ workspace riêng. Lead lập đúng ba task: t1 BE chỉ sửa sum.cjs cho phép cộng, đọc sum.test.cjs và chạy node --test sum.test.cjs, dependsOn=[]; t2 FE chỉ sửa multiply.cjs cho phép nhân, đọc multiply.test.cjs và chạy node --test multiply.test.cjs, dependsOn=[]; t3 TEST kiểm tra source hợp nhất, dependsOn=[t1,t2], chỉ chạy sau tích hợp. Scope t1 chỉ [sum.cjs], scope t2 chỉ [multiply.cjs], scope t3 [.]. Không sửa test, không tạo file, không commit/push/deploy. Mỗi task AC nêu kết quả lệnh tương ứng. Hai task đầu không cần kết quả của nhau. Không thay đổi thứ tự phụ thuộc này.",
      "lead",
      "team",
    );
    while (controller.isBusy()) await new Promise((r) => setTimeout(r, 200));
    const run = store.run(initial.id);
    assert.equal(run.state, "needs_input", run.error);
    assert.equal(run.failure?.code, "integration-pending", run.error);
    const roots = run.tasks.filter(
      (t) => t.kind === "work" && !t.dependsOn.length,
    );
    assert.equal(roots.length, 2);
    assert.ok(
      roots.every(
        (t) => t.state === "completed" && t.workspaceOrigin && t.workspace,
      ),
    );
    assert.ok(
      Date.parse(roots[0].startedAt) < Date.parse(roots[1].endedAt) &&
        Date.parse(roots[1].startedAt) < Date.parse(roots[0].endedAt),
    );
    assert.equal(run.tasks.find((t) => t.id === "t3").sessionId, null);
    assert.equal(run.review, null);
    assert.ok(run.requests > 0 && run.requests <= 20);
    for (const task of roots) {
      const file = task.allowedPaths[0];
      assert.ok(["sum.cjs", "multiply.cjs"].includes(file));
      // Independently verify bytes, rather than trusting a shell wrapper's exit status.
      execFileSync("node", ["--test", file.replace(".cjs", ".test.cjs")], {
        cwd: task.workspace,
        windowsHide: true,
        timeout: 10000,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
        },
      });
      assert.equal(task.changes.length, 1);
      assert.equal(task.changes[0].path, task.allowedPaths[0]);
      assert.ok(
        run.commands.some(
          (c) =>
            c.taskId === task.id &&
            c.exitCode === 0 &&
            c.command.includes("node --test"),
        ),
      );
      assert.equal(store.workspaceReferenced(task.workspace), true);
      await assert.rejects(
        new Worktrees(directory, (path) =>
          store.workspaceReferenced(path),
        ).previewRemoval(task.workspaceOrigin.id),
      );
    }
    for (const [file, content] of Object.entries(originals))
      assert.equal(readFileSync(join(source, file), "utf8"), content);
    assert.equal((await git(source, ["status", "--porcelain"])).toString(), "");
    await recoverOwnedJobs(directory);
    writeFileSync(
      join(artifacts, "result.json"),
      JSON.stringify(
        {
          passed: true,
          kind: "real-9router-opencode-isolated-pair",
          model: "ds/deepseek-v4-flash",
          report: JSON.parse(store.report(run.id, [secret])),
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        passed: true,
        state: run.state,
        model: "ds/deepseek-v4-flash",
        requests: run.requests,
        commands: run.commands.length,
        overlappingTasks: roots.map((t) => t.id),
        originalSourceUnchanged: true,
      }),
    );
  } catch (error) {
    console.error(
      redact(
        error instanceof Error ? error.message : String(error),
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
