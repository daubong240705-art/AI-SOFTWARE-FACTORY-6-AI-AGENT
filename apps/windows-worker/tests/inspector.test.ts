import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { RunDetailStore } from "../src/lib/run-detail-store";
import {
  compactTimeline,
  inspectSelection,
  runCapabilities,
} from "../shared/inspector";
import { defaultSettings } from "../shared/defaults";
import type { RunDetail, Run, RunEvent } from "../shared/runs";
import type { TeamTask } from "../shared/team";
import { mkdtemp, mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Store } from "../electron/storage/database";
import { snapshot, changes } from "../electron/workspace/snapshot";
import type { EvidenceRef } from "../shared/evidence";

function task(id: string, patch: Partial<TeamTask> = {}): TeamTask {
  return {
    id,
    role: "be",
    title: id,
    instructions: "Work",
    allowedPaths: ["src"],
    acceptance: ["Works"],
    dependsOn: [],
    state: "completed",
    model: "snapshot-be",
    kind: "work",
    round: 0,
    sessionId: null,
    startedAt: null,
    endedAt: null,
    summary: "",
    error: "",
    changes: [],
    commandIds: [],
    ...patch,
  };
}
function fixture(): RunDetail {
  return {
    run: {
      id: randomUUID(),
      projectId: randomUUID(),
      projectName: "Fixture",
      workspace: ".",
      prompt: "Implement",
      role: "lead",
      model: "snapshot-lead",
      mode: "team",
      tasks: [
        task("t1"),
        task("fix-1", { originalTaskId: "t1", kind: "fix", round: 1 }),
        task("t2", { role: "test", dependsOn: ["t1"] }),
      ],
      profiles: [],
      currentTaskId: null,
      fixRound: 1,
      review: null,
      state: "completed",
      settings: defaultSettings(),
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
      sessionId: null,
      summary: "",
      error: "",
      changes: [],
      commands: [],
      permissions: [],
      requests: 0,
      baselineComplete: true,
      toolsCompleted: 0,
      runtimeVersion: "fixture",
      inputTokens: 0,
      outputTokens: 0,
    },
    events: [],
  };
}
test("inspector rejects wrong project/run/task/execution and keeps exact attempt/model and current dependencies", () => {
  const detail = fixture(),
    selection = {
      projectId: detail.run.projectId,
      runId: detail.run.id,
      taskId: "t1",
    };
  assert.equal(inspectSelection(detail, selection).supersededBy, "fix-1");
  assert.equal(inspectSelection(detail, selection).task?.model, "snapshot-be");
  assert.deepEqual(
    inspectSelection(detail, { ...selection, taskId: "t2" }).dependencies,
    [{ id: "t1", attemptId: "fix-1", state: "completed" }],
  );
  for (const patch of [
    { projectId: randomUUID() },
    { runId: randomUUID() },
    { taskId: "missing" },
    { executionId: randomUUID() },
  ])
    assert.throws(() => inspectSelection(detail, { ...selection, ...patch }));
  const preparing = `${detail.run.id}:t1:preparing`;
  assert.equal(
    inspectSelection(detail, { ...selection, executionId: preparing }).task?.id,
    "t1",
  );
  detail.run.tasks[0].observation = {
    executionId: randomUUID(),
    startedAt: "",
    at: "",
    pendingModels: 0,
    tools: {},
  };
  // A preparing selection is pinned to the task attempt, even once runtime metadata arrives.
  assert.ok(inspectSelection(detail, { ...selection, executionId: preparing }));
  assert.ok(
    inspectSelection(detail, {
      ...selection,
      executionId: detail.run.tasks[0].observation.executionId,
    }),
  );
});
test("capabilities target actual whole run and do not offer retry/recovery during other work or integration", () => {
  const { run } = fixture();
  run.state = "running";
  assert.equal(runCapabilities(run, run.id).stop, true);
  assert.equal(runCapabilities(run, "other").stop, false);
  run.state = "cancelling";
  assert.equal(runCapabilities(run, run.id).permission, false);
  run.state = "failed";
  assert.equal(runCapabilities(run, null).retry, true);
  assert.equal(runCapabilities(run, "other").recovery, false);
  run.integration = {} as Run["integration"];
  assert.equal(runCapabilities(run, null).retry, false);
  assert.equal(runCapabilities(run, null).recovery, false);
  run.integration = undefined;
  run.state = "completed";
  assert.equal(runCapabilities(run, null).retry, false);
});
test("timeline hides payload/token noise, deduplicates replay and coalesces only one execution with explicit legacy ownership", () => {
  const detail = fixture();
  const event = (
    sequence: number,
    type: string,
    taskId: string | null | undefined = "t1",
    activity?: "reading" | "editing",
    executionId = "lane-a",
  ): RunEvent => ({
    runId: detail.run.id,
    sequence,
    type,
    text: 'SECRET RAW JSON {"tasks":[]}',
    at: new Date(sequence * 1000).toISOString(),
    metadata:
      taskId === undefined
        ? undefined
        : { version: 1, taskId, executionId, activity },
  });
  detail.events = [
    event(1, "TASK_STARTED"),
    event(2, "TOOL_STARTED", "t1", "reading"),
    event(3, "TOOL_STARTED", "t1", "reading"),
    event(4, "TOOL_STARTED", "t1", "reading", "lane-b"),
    event(5, "MODEL_STEP"),
    event(6, "MODEL_REQUEST"),
    event(7, "PLAN_ACCEPTED", null),
    event(8, "TASK_FINISHED"),
    event(9, "RUN_COMPLETED", null),
  ];
  detail.events.push({ ...event(10, "RUN_STARTED"), metadata: undefined });
  detail.events.push(detail.events[1]);
  detail.events.reverse();
  const rows = compactTimeline(detail);
  assert.equal(rows.find((r) => r.sequence === 2)?.count, 2);
  assert.equal(rows.find((r) => r.sequence === 4)?.count, 1);
  assert.ok(!JSON.stringify(rows).includes("SECRET"));
  assert.ok(!rows.some((r) => [5, 6].includes(r.sequence)));
  assert.equal(rows.at(-1)?.legacy, true);
  assert.equal(rows.at(-1)?.role, null);
  assert.ok(
    compactTimeline(detail, { taskId: "t1" }).every((r) => r.taskId === "t1"),
  );
  assert.equal(compactTimeline(detail, { role: "test" }).length, 0);
  assert.equal(compactTimeline(detail, { role: "lead" }).length, 2);
});
test("shared run feed deduplicates concurrent reads, validates identity and refreshes source/evidence without stale cache", async () => {
  const detail = fixture();
  let calls = 0;
  let resolveRead: (detail: RunDetail) => void = () => {};
  const store = new RunDetailStore(detail.run.projectId, detail.run.id, () => {
    calls++;
    return new Promise((resolve) => {
      resolveRead = resolve;
    });
  });
  const a = store.refresh(),
    b = store.refresh();
  assert.equal(a, b);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveRead(detail);
  await a;
  assert.equal(store.getSnapshot().detail, detail);
  const updated = structuredClone(detail);
  updated.run.tasks[0].model = "snapshot-new";
  const next = store.refresh();
  await Promise.resolve();
  resolveRead(updated);
  await next;
  assert.equal(store.getSnapshot().detail?.run.tasks[0].model, "snapshot-new");
  const invalid = store.refresh();
  await Promise.resolve();
  resolveRead({ ...detail, run: { ...detail.run, projectId: randomUUID() } });
  await invalid;
  assert.match(store.getSnapshot().error, /không đúng/);
  assert.equal(store.getSnapshot().detail, updated);
});
test("shared subscriptions use one fetch, stop polling without listeners and flag hung feed without overlap", async () => {
  const detail = fixture();
  let calls = 0,
    resolveRead: (detail: RunDetail) => void = () => {};
  const store = new RunDetailStore(detail.run.projectId, detail.run.id, () => {
    calls++;
    return new Promise((resolve) => {
      resolveRead = resolve;
    });
  });
  const first = store.subscribe(() => {}),
    second = store.subscribe(() => {});
  await Promise.resolve();
  assert.equal(calls, 1);
  const pending = store.refresh();
  await new Promise((resolve) => setTimeout(resolve, 3050));
  assert.equal(store.getSnapshot().stale, true);
  assert.equal(calls, 1);
  first();
  second();
  assert.equal(store.hasSubscribers(), false);
  resolveRead(detail);
  await pending;
  assert.equal(store.getSnapshot().stale, false);
  await new Promise((resolve) => setTimeout(resolve, 650));
  assert.equal(calls, 1);
});

test("task diff resolves immutable attempt snapshots, validates ref identity and handles additions/deletions/legacy", async () => {
  const parent = resolve(".cache");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "inspector-evidence-"));
  const source = join(directory, "source");
  await mkdir(source);
  const store = new Store(join(directory, "data"));
  try {
    await writeFile(join(source, "changed.ts"), "export const value = 1;\n");
    await writeFile(join(source, "removed.ts"), "old\n");
    const before = await snapshot(source, true);
    await writeFile(join(source, "changed.ts"), "export const value = 2;\n");
    await writeFile(join(source, "added.ts"), "new\n");
    await unlink(join(source, "removed.ts"));
    const after = await snapshot(source, true);
    const { run } = fixture(),
      t = run.tasks[0];
    t.sessionId = "session-immutable";
    t.allowedPaths = ["."];
    t.changes = changes(before, after);
    t.baseEvidence = store.evidence.saveTaskSnapshot(before);
    t.evidence = store.evidence.saveTaskSnapshot(after, ["removed.ts"]);
    const ref = (path: string): EvidenceRef => ({
      kind: "file",
      runId: run.id,
      taskId: t.id,
      attemptId: t.id,
      sessionId: t.sessionId!,
      sourceVersion: t.evidence!.sourceVersion,
      path,
      hash: t.evidence!.files[path]?.hash ?? null,
    });
    await writeFile(join(source, "changed.ts"), "UNRELATED CURRENT CONTENT");
    const diff = store.evidence.taskDiff(run, ref("changed.ts"));
    assert.match(diff.patch, /-export const value = 1;/);
    assert.match(diff.patch, /\+export const value = 2;/);
    assert.ok(!diff.patch.includes("UNRELATED"));
    assert.match(store.evidence.taskDiff(run, ref("added.ts")).patch, /\+new/);
    assert.match(store.evidence.taskDiff(run, ref("removed.ts")).patch, /-old/);
    for (const patch of [
      { runId: randomUUID() },
      { attemptId: "fix-1" },
      { sessionId: "other" },
      { sourceVersion: "0".repeat(64) },
      { path: "../outside.ts" },
      { hash: "0".repeat(64) },
    ])
      assert.throws(() =>
        store.evidence.taskDiff(run, {
          ...ref("changed.ts"),
          ...patch,
        } as EvidenceRef),
      );
    t.baseEvidence = undefined;
    assert.match(
      store.evidence.taskDiff(run, ref("changed.ts")).reason,
      /chưa lưu baseline/,
    );
  } finally {
    store.close();
  }
});
