// Real 9Router calls on this source workspace; no shell, edits or deployment.
const { app } = require("electron");
const { join, resolve } = require("node:path");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { RunController } = require("../electron/controller/runs.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const directory = mkdtempSync(join(tmpdir(), "asf-ww4b-live-"));
app.setPath("userData", directory);
app.whenReady().then(async () => {
  let store, controller;
  let code = 0;
  try {
    const key = process.env.NINE_ROUTER_API_KEY;
    if (!key) throw new Error("NINE_ROUTER_API_KEY required");
    store = new Store(directory);
    const settings = defaultSettings();
    settings.gatewayUrl = "https://ai.lazy.local/v1";
    settings.caPath = resolve(__dirname, "../../../caddy-root.crt");
    settings.maxRequests = 8;
    settings.timeoutMinutes = 4;
    settings.agents = settings.agents.map((a) => ({
      ...a,
      model: "ds/deepseek-v4-flash",
    }));
    store.save(settings, undefined);
    const project = store.addProject(resolve(__dirname, ".."));
    const chat = store.conversations.create(project.id);
    controller = new RunController(store, directory, () => key);
    const marker = "WW4B-" + crypto.randomUUID().slice(0, 8);
    const first = controller.start(
      project.id,
      `Ghi nhớ nhãn ${marker}. Không dùng công cụ, không đọc hoặc sửa file, không shell. Viết 30 dòng ngắn đánh số về cách tổ chức chat có hàng chờ. Mỗi dòng một ý, tối đa 15 từ. Trả lời bằng tiếng Việt.`,
      "be",
      "direct",
      chat.id,
    );
    const queued = controller.enqueue(
      project.id,
      chat.id,
      "Không dùng công cụ hoặc sửa file. Nhắc lại chính xác nhãn tôi đã cung cấp ở lượt trước và một ý về hàng chờ. Trả lời đúng hai câu.",
      "be",
      "direct",
    );
    const streamed = new Map();
    const startedAt = Date.now();
    async function waitIdle() {
      while (controller.view().activeId) {
        if (Date.now() - startedAt > 480000)
          throw new Error("Acceptance deadline exceeded");
        const id = controller.view().activeId;
        const run = controller.detail(id).run;
        if (
          run.partialText &&
          ["running", "blocked"].includes(run.state) &&
          (streamed.get(id)?.characters ?? 0) < run.partialText.length
        )
          streamed.set(id, {
            characters: run.partialText.length,
            state: run.state,
            at: new Date().toISOString(),
          });
        for (const p of run.permissions)
          await controller.reply(id, p.id, false);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await waitIdle();
    const runs = controller
      .view()
      .runs.filter((r) => r.conversationId === chat.id)
      .map((r) => controller.detail(r.id));
    const second = runs.find((r) => r.run.id !== first.id);
    assert.ok(
      second,
      "Queued follow-up must automatically start after success",
    );
    assert.equal(store.queue.list().length, 0);
    assert.equal(controller.detail(first.id).run.state, "completed");
    assert.equal(second.run.state, "completed");
    assert.ok(second.run.summary.includes(marker));
    assert.ok(second.run.context.runIds.includes(first.id));
    assert.ok(
      Date.parse(second.run.startedAt) >=
        Date.parse(controller.detail(first.id).run.endedAt),
    );
    assert.ok(
      streamed.has(first.id),
      "Must observe visible text before the first run ends",
    );
    const cancelled = controller.start(
      project.id,
      "Không dùng công cụ. Trả lời một câu ngắn về bản nháp trong chat.",
      "be",
      "direct",
      chat.id,
    );
    await controller.stop(cancelled.id);
    const retry = controller.retry(cancelled.id);
    await waitIdle();
    const result = controller.detail(retry.id);
    assert.equal(result.run.state, "completed");
    assert.equal(result.run.retryOf, cancelled.id);
    assert.equal(store.run(cancelled.id).state, "cancelled");
    const outputs = [...runs, controller.detail(cancelled.id), result];
    assert.ok(outputs.every((r) => r.run.changes.length === 0));
    const evidence = resolve(__dirname, "../../../docs/windows-worker/ww4b");
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      join(evidence, "live-chat.json"),
      JSON.stringify(
        {
          passed: true,
          model: "ds/deepseek-v4-flash",
          marker,
          queuedId: queued.id,
          streamed: Object.fromEntries(streamed),
          runs: outputs,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        passed: true,
        states: outputs.map((r) => r.run.state),
        streamed: Object.fromEntries(streamed),
        requests: outputs.map((r) => r.run.requests),
      }),
    );
  } catch (error) {
    console.error(error.stack);
    code = 1;
  } finally {
    await controller?.shutdown().catch(() => {});
    store?.close();
    app.exit(code);
  }
});
