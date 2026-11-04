// Live WW-3 acceptance: real Electron, controller, OpenCode and configured 9Router model.
const { app } = require("electron");
const { resolve, join } = require("node:path");
const { mkdtempSync, writeFileSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { RunController } = require("../electron/controller/runs.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const { fetchModels } = require("../electron/gateway/client.ts");
const directory = mkdtempSync(join(tmpdir(), "asf-ww3-live-"));
app.setPath("userData", directory);
app.whenReady().then(async () => {
  let store, controller;
  let code = 0;
  try {
    const key = process.env.NINE_ROUTER_API_KEY;
    if (!key)
      throw new Error("NINE_ROUTER_API_KEY required; value is never printed.");
    const settings = defaultSettings();
    settings.gatewayUrl = "https://ai.lazy.local/v1";
    settings.caPath = resolve(__dirname, "../../../caddy-root.crt");
    settings.maxRequests = 45;
    settings.timeoutMinutes = 12;
    const model = "ds/deepseek-v4-flash";
    const catalog = await fetchModels(settings, key);
    if (!catalog.includes(model))
      throw new Error("Exact DeepSeek Flash model absent.");
    settings.agents = settings.agents.map((a) => ({ ...a, model }));
    store = new Store(directory);
    store.save(settings, undefined);
    const project = store.addProject(resolve(__dirname, ".."));
    controller = new RunController(store, directory, () => key);
    const prompt =
      process.env.ASF_TEAM_PROMPT ||
      `Hoàn thiện hiển thị ngân sách request của sản phẩm Windows Worker này. Giao ba nhiệm vụ tuần tự BE -> FE -> TEST, không gọi PM/BA/DEVOPS. BE tạo src/lib/formatRequestUsage.ts và tests/requestUsage.test.ts: export formatRequestUsage(used:number,limit:number):string trả "X/Y request". used: hữu hạn thì floor và tối thiểu 0, không hữu hạn thành 0. limit: hữu hạn thì floor và tối thiểu 1, không hữu hạn thành 1. Không clamp used theo limit để thấy over-budget. Test node:test/assert cho (3,40),(0,40),(41,40),(-1,0),(2.9,40.9),(NaN,Infinity). FE chỉ sửa src/features/RunPanel.tsx để import helper và dùng cho hai chỗ hiển thị request (header và task-board); giữ vòng sửa và các thông tin khác. TEST chỉ đọc và chạy đúng lệnh npm test, không sửa file. Scope BE chỉ hai file mới, FE chỉ RunPanel.tsx, TEST dùng . . Chỉ dùng read/glob/grep để đọc, không bash để đọc/liệt kê. Chỉ lệnh shell npm test được chấp nhận. Không commit/push. Review phải bao phủ nguyên văn mọi AC của plan và dựa trên command evidence. Tóm tắt ngắn bằng tiếng Việt.`;
    const run = controller.start(project.id, prompt, "lead", "team");
    console.log(JSON.stringify({ runId: run.id, model, mode: run.mode }));
    const replied = new Set();
    let last = 0;
    while (controller.view().activeId) {
      const detail = controller.detail(run.id);
      for (const event of detail.events.filter((e) => e.sequence > last)) {
        last = event.sequence;
        console.log(event.type + ": " + event.text.slice(0, 180));
      }
      for (const permission of detail.run.permissions)
        if (!replied.has(permission.id)) {
          replied.add(permission.id);
          const allow =
            permission.permission === "bash" &&
            permission.patterns.every((p) => /^npm test\s*$/.test(p));
          console.log(
            "PERMISSION: " + (allow ? "allow exact npm test" : "reject"),
          );
          await controller.reply(run.id, permission.id, allow);
        }
      await new Promise((r) => setTimeout(r, 700));
    }
    const result = controller.detail(run.id);
    const evidence = resolve(__dirname, "../../../docs/windows-worker");
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      join(evidence, `ww3-${run.id}.json`),
      JSON.stringify(result, null, 2),
    );
    writeFileSync(
      join(evidence, "ww3-live.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          state: result.run.state,
          requests: result.run.requests,
          tasks: result.run.tasks.map((t) => ({
            id: t.id,
            role: t.role,
            state: t.state,
            model: t.model,
          })),
          changes: result.run.changes,
          commands: result.run.commands.map((c) => ({
            taskId: c.taskId,
            command: c.command,
            exitCode: c.exitCode,
          })),
          error: result.run.error,
        },
        null,
        2,
      ),
    );
    if (
      result.run.state !== "completed" ||
      !result.run.commands.some((c) => c.exitCode === 0)
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
