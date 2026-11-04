// Explicit live acceptance against the real product controller and 9Router.
// Launch via scripts/run-acceptance.cjs; credentials are read from the parent environment only.
const { app, safeStorage } = require("electron");
const { resolve, join } = require("node:path");
const { writeFileSync, mkdirSync } = require("node:fs");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { RunController } = require("../electron/controller/runs.ts");
const { fetchModels } = require("../electron/gateway/client.ts");
const { resolveRuntime } = require("../electron/runtime/security.ts");
app.setName("ASF Windows Worker");
if (!app.requestSingleInstanceLock()) {
  console.error(
    "Đóng Windows Worker trước khi chạy acceptance để tránh hai controller dùng chung DB.",
  );
  app.exit(1);
}
app.whenReady().then(async () => {
  let store, controller;
  let code = 0;
  try {
    if (!process.env.NINE_ROUTER_API_KEY)
      throw new Error("NINE_ROUTER_API_KEY is required; it is never printed.");
    store = new Store(app.getPath("userData"));
    const settings = store.settings();
    settings.gatewayUrl = "https://ai.lazy.local/v1";
    settings.caPath = resolve(__dirname, "../../../caddy-root.crt");
    settings.runtimePath = resolveRuntime(settings.runtimePath);
    const model = "ds/deepseek-v4-flash";
    const models = await fetchModels(settings, process.env.NINE_ROUTER_API_KEY);
    if (!models.includes(model))
      throw new Error(
        "Requested DeepSeek Flash model is absent from gateway catalog.",
      );
    settings.agents = settings.agents.map((agent) => ({
      ...agent,
      model: agent.model || model,
    }));
    settings.agents.find((agent) => agent.role === "be").model = model;
    settings.maxRequests = 20;
    settings.timeoutMinutes = 8;
    store.save(
      settings,
      safeStorage.encryptString(process.env.NINE_ROUTER_API_KEY),
    );
    store.setModels(models);
    const project = store.addProject(resolve(__dirname, ".."));
    controller = new RunController(store, app.getPath("userData"), () =>
      safeStorage.decryptString(store.encryptedKey()),
    );
    const prompt =
      'Trong ứng dụng Windows Worker này, tạo duy nhất hai file mới: src/lib/formatDuration.ts và tests/duration.test.ts. Dùng read/glob để đọc package.json và tests/core.test.ts; KHÔNG dùng bash để liệt kê hoặc đọc file. Export hàm formatDuration(milliseconds: number): string: input âm hoặc không hữu hạn trả "0s"; làm tròn xuống số giây; dưới 60 giây trả "Xs", từ 60 giây trở lên trả "Xm Ys". Ví dụ 61000 -> "1m 1s", 3600000 -> "60m 0s". Tạo test node:test + assert cho 0, 999, 1000, 61000, 3600000, -1, NaN, Infinity. Không sửa file khác, không commit. Sau khi viết hãy chạy đúng lệnh npm test và báo exit code. Shell chỉ được cấp quyền cho npm test, không ghép thêm lệnh. Đây là sản phẩm thật, không phải repo mẫu.';
    const run = controller.start(project.id, prompt, "be");
    console.log(
      JSON.stringify({ runId: run.id, model, workspace: project.path }),
    );
    const replied = new Set();
    let last = 0;
    while (controller.view().activeId) {
      const detail = controller.detail(run.id);
      for (const event of detail.events.filter(
        (event) => event.sequence > last,
      )) {
        last = event.sequence;
        console.log(event.type + ": " + event.text.slice(0, 220));
      }
      for (const permission of detail.run.permissions)
        if (!replied.has(permission.id)) {
          replied.add(permission.id);
          const allow =
            permission.permission === "bash" &&
            permission.patterns.every((pattern) =>
              /^npm test\s*$/.test(pattern),
            );
          console.log(
            "Permission " +
              permission.permission +
              ": " +
              (allow ? "allow exact npm test" : "reject"),
          );
          await controller.reply(run.id, permission.id, allow);
        }
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    const result = controller.detail(run.id);
    const evidence = resolve(__dirname, "../../../docs/windows-worker");
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      join(evidence, `ww2-${run.id}.json`),
      JSON.stringify(result, null, 2),
    );
    writeFileSync(
      join(evidence, "ww2-live.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          state: result.run.state,
          requests: result.run.requests,
          toolsCompleted: result.run.toolsCompleted,
          changes: result.run.changes,
          commands: result.run.commands.map(({ command, exitCode }) => ({
            command,
            exitCode,
          })),
          error: result.run.error,
        },
        null,
        2,
      ),
    );
    if (
      result.run.state !== "completed" ||
      !result.run.commands.some((command) => command.exitCode === 0)
    )
      code = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Acceptance failed");
    code = 1;
  } finally {
    await controller?.shutdown().catch(() => {});
    store?.close();
    app.exit(code);
  }
});
