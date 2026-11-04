// Two real turns in the same conversation. Does not modify project source.
const { app } = require("electron");
const { join, resolve } = require("node:path");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { RunController } = require("../electron/controller/runs.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const directory = mkdtempSync(join(tmpdir(), "asf-chat-live-"));
app.setPath("userData", directory);
app.whenReady().then(async () => {
  let store, controller;
  let exitCode = 0;
  try {
    const key = process.env.NINE_ROUTER_API_KEY;
    if (!key) throw new Error("NINE_ROUTER_API_KEY is required.");
    store = new Store(directory);
    const settings = defaultSettings();
    settings.gatewayUrl = "https://ai.lazy.local/v1";
    settings.caPath = resolve(__dirname, "../../../caddy-root.crt");
    settings.maxRequests = 12;
    settings.timeoutMinutes = 4;
    settings.agents = settings.agents.map((a) => ({
      ...a,
      model: "ds/deepseek-v4-flash",
    }));
    store.save(settings, undefined);
    const project = store.addProject(resolve(__dirname, ".."));
    const conversation = store.conversations.create(project.id);
    controller = new RunController(store, directory, () => key);
    const marker = "WW4A-" + crypto.randomUUID().slice(0, 8);
    const outputs = [];
    for (const prompt of [
      `Chỉ đọc src/features/ChatWorkspace.tsx và shared/chat.ts trong source Windows Worker. Nêu ba phần UI mới và cách bản nháp gắn với hội thoại. Ghi nhớ nhãn ${marker} cho cuộc trò chuyện này. Không shell, không sửa file, không commit. Trả lời ngắn bằng tiếng Việt.`,
      "Nhắc lại chính xác nhãn hội thoại tôi đã cung cấp ở lượt trước, kèm một điều về bản nháp. Không đọc file hoặc dùng công cụ, không sửa source. Chỉ trả lời hai câu.",
    ]) {
      const run = controller.start(
        project.id,
        prompt,
        "be",
        "direct",
        conversation.id,
      );
      console.log("Started " + run.id);
      const replied = new Set();
      while (controller.view().activeId) {
        const detail = controller.detail(run.id);
        for (const permission of detail.run.permissions)
          if (!replied.has(permission.id)) {
            replied.add(permission.id);
            await controller.reply(run.id, permission.id, false);
          }
        await new Promise((r) => setTimeout(r, 500));
      }
      const detail = controller.detail(run.id);
      outputs.push(detail);
      console.log(
        JSON.stringify({
          state: detail.run.state,
          requests: detail.run.requests,
          contextRuns: detail.run.context?.runIds ?? [],
          error: detail.run.error,
        }),
      );
      assert.equal(detail.run.state, "completed");
      assert.equal(detail.run.changes.length, 0);
    }
    assert.ok(
      outputs[1].run.summary.includes(marker),
      "Second turn must recall context from the first turn",
    );
    assert.ok(outputs[1].run.context.runIds.includes(outputs[0].run.id));
    assert.equal(store.conversations.get(conversation.id).messages.length, 4);
    const evidence = resolve(__dirname, "../../../docs/windows-worker/ww4a");
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      join(evidence, "live-chat.json"),
      JSON.stringify(
        {
          passed: true,
          model: "ds/deepseek-v4-flash",
          conversationId: conversation.id,
          marker,
          runs: outputs,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS: two real model turns, persisted messages and previous-turn context; no file changes.",
    );
  } catch (error) {
    console.error(error.stack);
    exitCode = 1;
  } finally {
    await controller?.shutdown().catch(() => {});
    store?.close();
    app.exit(exitCode);
  }
});
