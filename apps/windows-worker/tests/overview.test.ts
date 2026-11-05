import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { Store } from "../electron/storage/database";
import { RunController } from "../electron/controller/runs";
import { projectOverview } from "../electron/controller/overview";
import { attentionItems } from "../shared/overview";
import { defaultSettings } from "../shared/defaults";
import { normalizeRun, type Run } from "../shared/runs";
import type { FollowUp } from "../shared/chat";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { projectMonitor } from "../electron/controller/monitor";
import { ProjectOverview } from "../src/features/ProjectOverview";
import { workStateView } from "../shared/work-state";
import type { ReportView } from "../shared/reports";

function fixture(
  projectId: string = randomUUID(),
  patch: Partial<Run> = {},
): Run {
  return normalizeRun({
    id: randomUUID(),
    projectId,
    projectName: "Fixture",
    workspace: ".",
    prompt: "Cải thiện ứng dụng",
    role: "lead",
    model: "fixture-model",
    state: "completed",
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: new Date().toISOString(),
    sessionId: null,
    summary: "Kết quả",
    error: "",
    settings: defaultSettings(),
    changes: [],
    commands: [],
    permissions: [],
    requests: 0,
    baselineComplete: true,
    toolsCompleted: 0,
    runtimeVersion: "fixture",
    inputTokens: 0,
    outputTokens: 0,
    ...patch,
  } as Run);
}

test("work state distinguishes conversation, actual work, permissions, pending questions and report evidence freshness", () => {
  const run = fixture(undefined, { mode: "team", tasks: [] });
  assert.equal(workStateView(run).label, "Lead đã trả lời");
  run.tasks.push({
    id: "t1",
    kind: "work",
    state: "completed",
  } as Run["tasks"][number]);
  assert.equal(workStateView(run).label, "Có kết quả · Chưa xác minh");
  const report = {
    report: { runId: run.id, projectId: run.projectId, verification: "pass" },
    freshness: "current",
    policy: { required: true },
    decision: null,
  } as ReportView;
  assert.equal(workStateView(run, { report }).label, "Chờ nghiệm thu");
  report.decision = { action: "accept", comment: "", createdAt: "now" };
  assert.equal(workStateView(run, { report }).label, "Hoàn thành");
  assert.equal(
    workStateView(run, { report, stale: true }).label,
    "Kết quả phiên bản trước",
  );
  report.report.runId = crypto.randomUUID();
  assert.equal(
    workStateView(run, { report }).label,
    "Có kết quả · Chưa xác minh",
  );
  run.state = "blocked";
  run.permissions = [{ id: "p", permission: "bash", patterns: [] }];
  assert.equal(workStateView(run).label, "Chờ cấp quyền");
  const questions = workStateView(run, {
    questionState: "pending",
    stale: true,
  });
  assert.equal(questions.label, "Cần bạn trả lời");
  assert.equal(questions.freshness, "stale");
  run.state = "cancelling";
  assert.equal(
    workStateView(run, { questionState: "pending" }).label,
    "Đang dừng",
  );
});

test("overview scopes and bounds data, redacts secrets and does not equate executed with verified", () => {
  const run = fixture(),
    other = fixture(),
    secret = "synthetic-overview-secret";
  const input = fixture(run.projectId, {
    prompt: `Fix ${secret}`,
    summary: `api_key=${secret}`,
    error: secret,
  });
  const q: FollowUp = {
    id: randomUUID(),
    projectId: other.projectId,
    conversationId: randomUUID(),
    prompt: "Other project",
    role: "lead",
    mode: "team",
    settings: defaultSettings(),
    state: "held",
    reason: "secret",
    createdAt: run.createdAt,
    afterRunId: null,
  };
  const data = projectOverview(
    run.projectId,
    [input, other, ...Array.from({ length: 20 }, () => fixture(run.projectId))],
    [q],
    other,
    [],
    [secret],
  );
  assert.equal(data.runs.length, 12);
  assert.equal(data.runs[0].verified, false);
  assert.equal(data.queue.length, 0);
  assert.equal(data.timelineRunId, null);
  assert.ok(!JSON.stringify(data).includes(secret));
  assert.ok(!JSON.stringify(data).includes("gatewayUrl"));
  assert.ok(!JSON.stringify(data).includes("commands"));
});

test("attention deduplicates each run, prioritizes permissions, excludes normal waits and terminal stale permissions", () => {
  const first = fixture(undefined, { state: "needs_input" }),
    projectId = first.projectId;
  const data = projectOverview(
    projectId,
    [
      first,
      fixture(projectId, {
        state: "blocked",
        permissions: [{ id: "p", permission: "bash", patterns: [] }],
      }),
      fixture(projectId, {
        state: "completed",
        permissions: [{ id: "stale", permission: "bash", patterns: [] }],
      }),
      fixture(projectId, { state: "cancelled" }),
      fixture(projectId, { state: "interrupted" }),
    ],
    [],
    null,
    [],
  );
  data.queue = [
    {
      id: "held",
      conversationId: randomUUID(),
      prompt: "Held",
      state: "held",
      reason: "Chờ quyết định",
      createdAt: first.createdAt,
    },
    {
      id: "wait",
      conversationId: randomUUID(),
      prompt: "Waiting",
      state: "waiting",
      reason: "Chờ slot",
      createdAt: first.createdAt,
    },
  ];
  const items = attentionItems(data);
  assert.equal(items.length, 4);
  assert.equal(items[0].label, "Chờ cấp quyền");
  assert.equal(
    items.find((i) => i.runId === first.id)?.action,
    "Bổ sung ngữ cảnh",
  );
  assert.equal(items.filter((i) => i.key === "queue:wait").length, 0);
  assert.equal(items.filter((i) => i.key === "queue:held").length, 1);
});

test("work results require recorded work while retaining read-only analysis tasks and failed attention", () => {
  const chat = fixture(),
    projectId = chat.projectId;
  const changed = fixture(projectId, {
    changes: [{ path: "src/sample.ts", kind: "modified" }],
  });
  const analysis = fixture(projectId, {
    tasks: [
      {
        kind: "work",
        id: "analysis",
        role: "ba",
        title: "Đọc kiến trúc",
        instructions: "Phân tích",
        acceptance: [],
        allowedPaths: ["src"],
        dependsOn: [],
        state: "completed",
        model: "fixture",
        round: 0,
        sessionId: null,
        startedAt: null,
        endedAt: null,
        summary: "",
        error: "",
        changes: [],
        commandIds: [],
      },
    ],
  });
  const failed = fixture(projectId, { state: "failed" });
  const data = projectOverview(
    projectId,
    [chat, changed, analysis, failed],
    [],
    null,
    [],
  );
  assert.equal(data.runs.find((r) => r.id === chat.id)!.hasWork, false);
  assert.equal(data.runs.find((r) => r.id === changed.id)!.hasWork, true);
  // Only test the marker here: actual evidence verification is covered separately.
  assert.equal(data.runs.find((r) => r.id === analysis.id)!.hasWork, true);
  assert.equal(
    attentionItems(data).some((item) => item.runId === failed.id),
    true,
  );
});

test("overview renders current execution, permission attention and another project's occupied slot without mixing work", () => {
  const run = fixture(undefined, {
    state: "blocked",
    mode: "direct",
    role: "fe",
    startedAt: new Date().toISOString(),
    endedAt: null,
    permissions: [{ id: "p", permission: "edit", patterns: [] }],
  });
  function render(projectId: string) {
    return renderToStaticMarkup(
      createElement(ProjectOverview, {
        projectId,
        onSettings() {},
        state: {
          snapshot: {
            ...projectMonitor(
              projectId,
              run.settings,
              projectId === run.projectId ? run : null,
              run,
            ),
            overview: projectOverview(projectId, [run], [], null, []),
            epoch: randomUUID(),
            revision: 1,
            observedAt: new Date().toISOString(),
          },
          stale: false,
          error: "",
          receivedAt: Date.now(),
        },
        onRefresh() {},
        onInspect() {},
        onChat() {},
        onConversation() {},
      }),
    );
  }
  const current = render(run.projectId);
  assert.match(current, /Chờ cấp quyền/);
  assert.match(current, /overview-execution/);
  assert.match(current, />FE</);
  const other = render(randomUUID());
  assert.match(other, /Slot đang dùng ở/);
  assert.doesNotMatch(other, /overview-execution|Cải thiện ứng dụng/);
});

test("native storage overview keeps milestones beyond noisy detail window, scopes runs and survives restart without migration", () => {
  const dir = mkdtempSync(join(resolve(".cache"), "overview-db-"));
  let store = new Store(dir);
  try {
    const p = store.addProject(dir),
      other = store.addProject(resolve("src"));
    const older = fixture(p.id, {
      createdAt: "2026-11-01T00:00:00.000Z",
      state: "needs_input",
    });
    store.createRun(older);
    const newer = fixture(p.id, {
      attemptRoot: older.id,
      retryOf: older.id,
      createdAt: "2026-11-02T00:00:00.000Z",
    });
    store.createRun(newer);
    const wrong = fixture(other.id, { prompt: "OTHER PROJECT" });
    store.createRun(wrong);
    store.event(newer.id, "RUN_STARTED", "Start");
    store.event(newer.id, "PLAN_ACCEPTED", "Tasks", {
      version: 1,
      taskId: null,
    });
    for (let i = 0; i < 350; i++)
      store.event(newer.id, "TOOL_STARTED", "Noisy read", {
        version: 1,
        taskId: null,
        activity: "reading",
      });
    assert.ok(!store.events(newer.id).some((e) => e.type === "RUN_STARTED"));
    const controller = new RunController(store, dir, () => undefined);
    const reply = controller.monitor({ projectId: p.id, overview: true });
    assert.equal(reply.unchanged, false);
    if (reply.unchanged) throw new Error("Missing snapshot");
    const d = reply.snapshot.overview!;
    assert.equal(d.runs.length, 1);
    assert.equal(d.runs[0].id, newer.id);
    assert.ok(!JSON.stringify(d).includes("OTHER PROJECT"));
    assert.ok(d.timeline.some((e) => e.title === "Bắt đầu lượt chạy"));
    assert.ok(!d.timeline.some((e) => e.title === "Đang đọc source"));
    assert.equal(attentionItems(d).length, 0);
    const request = {
      projectId: p.id,
      overview: true,
      epoch: reply.snapshot.epoch,
      sinceRevision: reply.snapshot.revision,
    };
    controller.monitor({ projectId: p.id });
    assert.equal(
      controller.monitor(request).unchanged,
      true,
      "roster and overview revisions should not invalidate each other",
    );
    assert.ok(Buffer.byteLength(JSON.stringify(reply)) < 100000);
    store.close();
    store = new Store(dir);
    assert.equal(store.recentProjectRuns(p.id)[0].id, newer.id);
    assert.equal(store.recentProjectRuns(other.id).length, 1);
  } finally {
    store.close();
  }
});
