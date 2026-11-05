import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../electron/storage/database";
import { RunController } from "../electron/controller/runs";
import { defaultSettings } from "../shared/defaults";
import { normalizeRun, type Run } from "../shared/runs";
import { WorkspaceStore } from "../src/lib/workspace-store";
import { resultQuerySchema, type WorkspaceSummary } from "../shared/workspace";

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "asf-workspace-"));
  const store = new Store(join(directory, "data"));
  const projects = ["First", "Second"].map((name) => {
    const path = join(directory, name);
    mkdirSync(path);
    return store.addProject(path);
  });
  const settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.forEach((a) => (a.model = "fixture-model"));
  store.save(settings, undefined);
  function run(index = 0, patch: Partial<Run> = {}) {
    const p = projects[index];
    const run = normalizeRun({
      id: randomUUID(),
      projectId: p.id,
      projectName: p.name,
      workspace: p.path,
      prompt: "Deliverable",
      role: "be",
      model: "fixture",
      mode: "direct",
      state: "completed",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: null,
      endedAt: "2026-01-01T00:01:00.000Z",
      sessionId: null,
      conversationId: store.conversations.create(p.id).id,
      summary: "Kết quả đã tạo",
      error: "",
      settings,
      changes: [{ path: "result.txt", kind: "added" }],
      commands: [],
      permissions: [],
      requests: 0,
      baselineComplete: false,
      toolsCompleted: 0,
      runtimeVersion: "fixture",
      inputTokens: 0,
      outputTokens: 0,
      ...patch,
    } as Run);
    store.createRun(run);
    store.updateRun(run);
    return run;
  }
  return {
    directory,
    store,
    projects,
    settings,
    run,
    close() {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("results index scopes, uses stable cursors at identical timestamps and excludes plain conversation", () => {
  const x = setup();
  try {
    for (let i = 0; i < 43; i++) x.run(i % 2, { prompt: `Báo cáo ${i}` });
    const chat = x.run(0, { prompt: "Only conversation", changes: [] });
    const controller = new RunController(
      x.store,
      x.directory,
      () => "fixture-key",
    );
    const before = x.store.runs().length;
    x.store.evidence.command = () => {
      throw Error("Index must not load artifacts");
    };
    const first = x.store.reports.index({});
    assert.equal(first.items.length, 20);
    assert.ok(first.hasMore && first.next);
    const second = x.store.reports.index({ before: first.next! });
    const third = x.store.reports.index({ before: second.next! });
    const all = [...first.items, ...second.items, ...third.items];
    assert.equal(all.length, 43);
    assert.equal(new Set(all.map((i) => i.id)).size, 43);
    assert.equal(third.hasMore, false);
    assert.ok(!all.some((i) => i.runId === chat.id));
    const scoped = x.store.reports.index({
      projectId: x.projects[1].id,
      search: "BAO CAO",
    });
    assert.ok(scoped.items.length);
    assert.ok(scoped.items.every((i) => i.projectId === x.projects[1].id));
    assert.equal(
      x.store.reports.index({ verification: "pass" }).items.length,
      0,
    );
    const summary = controller.workspaceSummary();
    assert.equal(summary.results.length, 5);
    assert.equal(summary.scope, "all-projects");
    assert.equal(x.store.runs().length, before);
    assert.equal(summary.active, null);
    assert.ok(!JSON.stringify(first).includes("commands"));
    assert.ok(first.items.every((i) => i.state.freshness === "unknown"));
    assert.equal(
      resultQuerySchema.safeParse({ projectId: "wrong" }).success,
      false,
    );
    assert.equal(
      resultQuerySchema.safeParse({ search: "x".repeat(201) }).success,
      false,
    );
  } finally {
    x.close();
  }
});

test("delivery defaults exclude failed changes and read-only commands while history retains reports", () => {
  const x = setup();
  try {
    const document = x.run(0, {
      prompt: "# Architecture document",
      changes: [{ path: "docs/architecture.md", kind: "added" }],
    });
    const failed = x.run(0, { state: "failed", error: "Failed verification" });
    const analysis = x.run(0, {
      changes: [],
      commands: [
        {
          callId: "c1",
          command: "git status",
          status: "completed",
          exitCode: 0,
          output: "clean",
        },
      ],
    });
    const defaults = x.store.reports.index({}).items;
    assert.deepEqual(
      defaults.map((i) => i.runId),
      [document.id],
    );
    assert.equal(defaults[0].title, "Architecture document");
    const history = x.store.reports.index({ includeHistory: true }).items;
    assert.deepEqual(
      new Set(history.map((i) => i.runId)),
      new Set([document.id, failed.id, analysis.id]),
    );
    assert.equal(
      x.store.reports.view(
        { projectId: failed.projectId, runId: failed.id },
        null,
      ).report.runId,
      failed.id,
    );
  } finally {
    x.close();
  }
});

test("results group retries and work submissions before filters and keep previous report explicitly stale", () => {
  const x = setup();
  try {
    const root = x.run(0, { prompt: "Old searchable title" });
    const retry = x.run(0, {
      attemptRoot: root.id,
      retryOf: root.id,
      prompt: "Newest title",
    });
    assert.equal(
      x.store.reports.index({ search: "Old searchable" }).items.length,
      0,
    );
    assert.ok(
      x.store.reports.index({}).items.some((i) => i.runId === retry.id),
    );
    const item = x.store.board.create({
      projectId: x.projects[0].id,
      title: "Công việc có hồ sơ",
      body: "Yêu cầu",
      priority: 0,
      suggestedRole: null,
      planningState: "ready",
    });
    const context = x.store.board.workChat({
      projectId: item.projectId,
      itemId: item.id,
    });
    const work = x.store.board.chatSnapshot(
      item.projectId,
      item.id,
      1,
      context.conversationId,
    );
    const linked = x.run(0, {
      workContext: work,
      conversationId: context.conversationId,
      prompt: "Linked",
    });
    x.store.board.attachChat(randomUUID(), work, {
      runId: linked.id,
      followUpId: null,
    });
    const newRun = x.run(0, {
      workContext: work,
      conversationId: context.conversationId,
      prompt: "Latest linked",
    });
    x.store.board.attachChat(randomUUID(), work, {
      runId: newRun.id,
      followUpId: null,
    });
    let entries = x.store.reports
      .index({})
      .items.filter((i) => i.itemId === item.id);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].runId, newRun.id);
    assert.equal(entries[0].code, item.code);
    const current = x.store.board.item(item.id);
    x.store.board.update({
      id: item.id,
      version: current.version,
      patch: { body: "new revision" },
    });
    entries = x.store.reports
      .index({})
      .items.filter((i) => i.itemId === item.id);
    assert.equal(entries[0].state.freshness, "stale");
  } finally {
    x.close();
  }
});

test("global actionable count exceeds first page, remains after seen and projects active execution without exposing payloads", () => {
  const x = setup();
  try {
    for (let i = 0; i < 53; i++)
      x.run(i % 2, {
        state: "failed",
        error: "fixture-secret",
        prompt: `Attention ${i}`,
        changes: [],
      });
    const controller = new RunController(
      x.store,
      x.directory,
      () => "fixture-secret",
    );
    let summary = controller.workspaceSummary();
    assert.equal(summary.attentionCount, 53);
    assert.equal(summary.attention.length, 5);
    const item = summary.attention[0];
    x.store.inbox.seen({ key: item.key, token: item.token });
    summary = controller.workspaceSummary();
    assert.equal(summary.attentionCount, 53);
    assert.ok(!JSON.stringify(summary).includes("fixture-secret"));
    const active = x.run(1, {
      state: "running",
      endedAt: null,
      changes: [],
      prompt: "Active project two",
      tasks: [
        {
          id: "t1",
          kind: "work",
          state: "running",
          role: "fe",
          title: "Implement",
          model: "fixture",
          dependsOn: [],
          acceptance: [],
          instructions: "Implement",
          allowedPaths: ["."],
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
      commands: [
        {
          callId: "hidden",
          command: "hidden-command",
          output: "hidden-output",
          status: "running",
          exitCode: null,
        },
      ],
    });
    const internal = controller as unknown as { active: unknown };
    internal.active = { run: active, secrets: [] };
    summary = controller.workspaceSummary();
    assert.equal(summary.active!.projectId, x.projects[1].id);
    assert.equal(
      summary.agents.find((a) => a.role === "fe")!.executions.length,
      1,
    );
    assert.ok(!JSON.stringify(summary).includes("hidden-command"));
    assert.ok(!JSON.stringify(summary).includes("hidden-output"));
    internal.active = undefined;
    assert.equal(
      controller
        .workspaceSummary()
        .agents.some((a) => a.availability === "occupied"),
      false,
    );
  } finally {
    x.close();
  }
});

test("workspace feed coalesces readers, rejects wrong scope, preserves last value on error and cancels polling after unsubscribe", async () => {
  let resolve!: (data: WorkspaceSummary) => void,
    calls = 0;
  let fail = false;
  const store = new WorkspaceStore(() => {
    calls++;
    return fail
      ? Promise.reject(Error("Offline"))
      : new Promise((done) => (resolve = done));
  });
  const unsubscribe = store.subscribe(() => {});
  const first = store.refresh();
  assert.equal(first, store.refresh());
  await Promise.resolve();
  assert.equal(calls, 1);
  unsubscribe();
  resolve({
    scope: "all-projects",
    observedAt: "now",
    attentionCount: 0,
    attention: [],
    results: [],
    active: null,
    agents: [],
    progress: {
      currentTasks: 0,
      executedTasks: 0,
      verifiedTasks: 0,
      applicableCriteria: 0,
      passedCriteria: 0,
      unverifiedCriteria: 0,
    },
  });
  await first;
  assert.equal(store.getSnapshot().stale, false);
  fail = true;
  await store.refresh();
  assert.equal(store.getSnapshot().stale, true);
  assert.ok(store.getSnapshot().data);
  const wrong = new WorkspaceStore(
    async () => ({ scope: "wrong" }) as unknown as WorkspaceSummary,
  );
  await wrong.refresh();
  assert.ok(wrong.getSnapshot().error);
});
