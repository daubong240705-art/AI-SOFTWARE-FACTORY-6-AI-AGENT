// One read-only Lead turn against the user's configured 9Router.
// Read the live DB without migration; persist results only in an isolated fixture.
const { app, safeStorage } = require("electron");
const { join, resolve } = require("node:path");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
require("tsx/cjs");
const Database = require("better-sqlite3");
const { Store } = require("../electron/storage/database.ts");
const { RunController } = require("../electron/controller/runs.ts");
const cache = resolve(__dirname, "../.cache");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "chat-context-live-"));
const livePath = join(
  app.getPath("appData"),
  "ASF Windows Worker",
  "worker.sqlite",
);
app.setPath("userData", join(directory, "data"));
app.whenReady().then(async () => {
  let store, controller;
  let exitCode = 0;
  try {
    const db = new Database(livePath, { readonly: true, fileMustExist: true });
    let settings, ciphertext;
    try {
      settings = JSON.parse(
        db.prepare("SELECT value FROM settings WHERE id=1").get().value,
      );
      ciphertext = db
        .prepare("SELECT encrypted FROM credentials WHERE id=1")
        .get()?.encrypted;
    } finally {
      db.close();
    }
    let key = process.env.NINE_ROUTER_API_KEY;
    if (!key) {
      assert.ok(
        ciphertext && safeStorage.isEncryptionAvailable(),
        "Configured secure key required",
      );
      try {
        key = safeStorage.decryptString(ciphertext);
      } catch {
        throw new Error(
          "Isolated process cannot decrypt the app's saved key. Provide NINE_ROUTER_API_KEY to run this optional live check; credentials were not changed.",
        );
      }
    }
    const model = settings.agents.find((agent) =>
      /deepseek.*flash/i.test(agent.model),
    )?.model;
    assert.ok(model, "A configured DeepSeek Flash model is required");
    settings.agents = settings.agents.map((agent) => ({ ...agent, model }));
    settings.maxRequests = 4;
    settings.timeoutMinutes = 2;
    settings.permissionMode = "ask";
    store = new Store(join(directory, "data"));
    store.save(settings, undefined);
    const project = store.addProject(directory);
    const item = store.board.create({
      projectId: project.id,
      title: "Giữ bản nháp chat",
      body: "Người dùng mở rộng hoặc thu gọn chat vẫn giữ nội dung đang soạn.",
      criteria: ["Không mất nháp tiếng Việt"],
      priority: 0,
      suggestedRole: null,
      planningState: "backlog",
    });
    const context = store.board.workChat({
      projectId: project.id,
      itemId: item.id,
    });
    controller = new RunController(store, join(directory, "data"), () => key);
    const receipt = controller.sendChat({
      requestId: crypto.randomUUID(),
      projectId: project.id,
      conversationId: context.conversationId,
      prompt:
        "Mình đang trao đổi ý tưởng thôi. Bạn hiểu mục tiêu công việc hiện tại là gì? Trả lời tối đa hai câu tiếng Việt, không lập plan, không dùng tool hay thay đổi file.",
      mode: "team",
      role: "lead",
      workContext: { itemId: item.id, revision: 1 },
    });
    const deadline = Date.now() + 150000;
    while (controller.view().activeId && Date.now() < deadline) {
      for (const permission of controller.detail(receipt.runId).run.permissions)
        await controller.reply(receipt.runId, permission.id, false);
      await new Promise((done) => setTimeout(done, 500));
    }
    assert.equal(
      controller.view().activeId,
      null,
      "Lead turn exceeded deadline",
    );
    const run = store.run(receipt.runId);
    assert.equal(run.state, "completed", run.error);
    assert.ok(run.requests > 0 && run.summary.trim());
    assert.equal(run.workContext.itemId, item.id);
    assert.equal(run.tasks.length, 0);
    assert.equal(run.changes.length, 0);
    assert.equal(run.commands.length, 0);
    assert.equal(
      run.profiles.find((profile) => profile.role === "lead").version,
      "1.3.1",
    );
    const evidence = {
      passed: true,
      model,
      requests: run.requests,
      state: run.state,
      summary: run.summary,
      context: { code: context.code, revision: context.revision },
      tasks: 0,
      commands: 0,
      changes: 0,
    };
    writeFileSync(
      join(directory, "acceptance.json"),
      JSON.stringify(evidence, null, 2),
    );
    console.log(JSON.stringify({ ...evidence, directory }));
  } catch (error) {
    console.error(error.message);
    exitCode = 1;
  } finally {
    await controller?.shutdown().catch(() => {});
    store?.close();
    app.exit(exitCode);
  }
});
