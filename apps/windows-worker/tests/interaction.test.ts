import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { settingsSchema } from "../shared/contracts";
import { defaultSettings } from "../shared/defaults";
import type { Run, RunDetail } from "../shared/runs";
import { Store } from "../electron/storage/database";
import { RunController } from "../electron/controller/runs";
import { RunPanel } from "../src/features/RunPanel";
import { TaskTimeline } from "../src/features/TaskTimeline";

test("legacy settings and queued requests default to ask; Full access persists and is snapshotted for new runs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-access-settings-"));
  let store = new Store(directory);
  try {
    const { permissionMode: _, ...legacy } = defaultSettings();
    assert.equal(settingsSchema.parse(legacy).permissionMode, "ask");
    assert.equal(
      settingsSchema.safeParse({ ...legacy, permissionMode: "unknown" })
        .success,
      false,
    );
    const settings = defaultSettings();
    settings.gatewayUrl = "https://unused.example/v1";
    settings.agents.find((agent) => agent.role === "be")!.model = "test";
    store.save(settings, undefined);
    const project = store.addProject(directory);
    const conversation = store.conversations.create(project.id);
    const controller = new RunController(store, directory, () => undefined);
    const queued = controller.enqueue(
      project.id,
      conversation.id,
      "Docs",
      "be",
      "direct",
    );
    const { permissionMode: omitted, ...oldSettings } = settings;
    store.queue.save({ ...queued, settings: oldSettings as typeof settings });
    const oldRun = controller.resume(queued.id);
    assert.equal(oldRun.settings.permissionMode, "ask");
    await controller.stop(oldRun.id);
    settings.permissionMode = "full-access";
    store.save(settings, undefined);
    const run = controller.start(project.id, "Docs", "be");
    assert.equal(run.settings.permissionMode, "full-access");
    settings.permissionMode = "ask";
    store.save(settings, undefined);
    await controller.stop(run.id);
    assert.equal(store.run(run.id).settings.permissionMode, "full-access");
    const fullSettings = {
      ...settings,
      permissionMode: "full-access" as const,
    };
    store.save(fullSettings, undefined);
    store.close();
    store = new Store(directory);
    assert.equal(store.settings().permissionMode, "full-access");
    assert.equal(store.run(run.id).settings.permissionMode, "full-access");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("activity shows work and command status while technical telemetry and internal Lead phases stay collapsed", () => {
  const run = {
    id: "run",
    mode: "team",
    role: "lead",
    model: "test-model",
    state: "completed",
    settings: defaultSettings(),
    fixRound: 0,
    permissions: [],
    currentTaskId: null,
    error: "",
    tasks: [
      { id: "plan", kind: "plan", title: "INTERNAL_PLAN", state: "completed" },
      {
        id: "review",
        kind: "review",
        title: "INTERNAL_REVIEW",
        state: "completed",
      },
      {
        id: "t1",
        kind: "work",
        title: "Sửa hiển thị",
        role: "fe",
        state: "completed",
        allowedPaths: ["src"],
        dependsOn: [],
        acceptance: ["Gọn gàng"],
      },
    ],
    commands: [{ command: "npm test", status: "completed", exitCode: 0 }],
  } as unknown as Run;
  const detail: RunDetail = {
    run,
    events: [
      {
        sequence: 1,
        runId: run.id,
        at: new Date().toISOString(),
        type: "MODEL_STEP",
        text: "TECHNICAL_TOKEN_PAYLOAD",
      },
    ],
  };
  const render = (tab: string) =>
    renderToStaticMarkup(
      createElement(RunPanel, {
        detail,
        tab,
        onPermission: () => {},
        busy: false,
      }),
    );
  const html = render("activity");
  assert.match(html, /Sửa hiển thị/);
  assert.match(html, /npm test/);
  assert.match(html, /Đạt/);
  assert.match(html, /Chi tiết kỹ thuật/);
  assert.doesNotMatch(
    html,
    /TECHNICAL_TOKEN_PAYLOAD|MODEL_STEP|INTERNAL_PLAN|INTERNAL_REVIEW|Vòng sửa 0/,
  );
  run.error = "Gateway đang giới hạn request";
  assert.match(render("activity"), /Gateway đang giới hạn request/);
});

test("compact timeline keeps failure and finish milestones while hiding routine tool activity", () => {
  const run = { role: "lead", tasks: [] } as unknown as Run;
  const detail: RunDetail = {
    run,
    events: ["TOOL_STARTED", "TOOL_FAILED", "RUN_COMPLETED"].map((type, i) => ({
      sequence: i + 1,
      runId: "run",
      at: new Date().toISOString(),
      type,
      text: "Internal payload",
      metadata: {
        version: 1 as const,
        taskId: null,
        activity: "reading" as const,
      },
    })),
  };
  const html = renderToStaticMarkup(createElement(TaskTimeline, { detail }));
  assert.doesNotMatch(html, /Đang đọc source|Internal payload/);
  assert.match(html, /Công cụ thất bại/);
  assert.match(html, /2 mốc còn lưu/);
});
