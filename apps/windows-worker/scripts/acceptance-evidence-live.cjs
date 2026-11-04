// Read-only acceptance on the product source, with one explicitly allowed node --version command.
const { app } = require("electron");
const { join, resolve } = require("node:path");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { Store } = require("../electron/storage/database.ts");
const { RunController } = require("../electron/controller/runs.ts");
const { defaultSettings } = require("../shared/defaults.ts");
const directory = mkdtempSync(join(tmpdir(), "asf-ww4c-live-"));
app.setPath("userData", directory);
app.whenReady().then(async () => {
  let store,
    controller,
    code = 0;
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
    controller = new RunController(store, directory, () => key);
    const run = controller.start(
      project.id,
      "Chỉ đọc shared/evidence.ts để hiểu các kiểu snapshot. Chạy đúng một lệnh shell: node --version. Không dùng lệnh shell khác, không sửa file, không commit. Tóm tắt ngắn ba kiểu dữ liệu chính và báo phiên bản Node thực tế bằng tiếng Việt.",
      "be",
    );
    const replied = new Set();
    while (controller.view().activeId) {
      const detail = controller.detail(run.id);
      for (const p of detail.run.permissions)
        if (!replied.has(p.id)) {
          replied.add(p.id);
          const allow =
            p.permission === "bash" &&
            p.patterns.length > 0 &&
            p.patterns.every((v) =>
              /^node(?:\.exe)? --version$/.test(v.trim()),
            );
          await controller.reply(run.id, p.id, allow);
        }
      await new Promise((r) => setTimeout(r, 200));
    }
    const detail = controller.detail(run.id);
    assert.equal(detail.run.state, "completed");
    assert.equal(detail.run.changes.length, 0);
    assert.ok(detail.run.commands.length > 0);
    const artifacts = detail.run.commands.map((c) => ({
      callId: c.callId,
      output: store.evidence.command(run.id, c.callId),
    }));
    assert.ok(
      detail.run.commands.every(
        (c) =>
          c.cwd === project.path &&
          c.startedAt &&
          c.endedAt &&
          c.exitCode === 0,
      ),
    );
    assert.ok(artifacts.some((a) => /v\d+\.\d+\.\d+/.test(a.output)));
    const view = store.evidence.view(run.id);
    assert.equal(view.finished, true);
    const target = resolve(__dirname, "../../../docs/windows-worker/ww4c");
    mkdirSync(target, { recursive: true });
    writeFileSync(
      join(target, "live-evidence.json"),
      JSON.stringify(
        {
          passed: true,
          model: "ds/deepseek-v4-flash",
          detail,
          view,
          artifacts,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        passed: true,
        state: detail.run.state,
        requests: detail.run.requests,
        commands: detail.run.commands.length,
        changes: detail.run.changes.length,
        preExisting: view.preExistingCount,
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
