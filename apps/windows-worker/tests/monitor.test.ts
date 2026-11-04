import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { defaultSettings } from "../shared/defaults";
import type { Run } from "../shared/runs";
import type { TeamTask } from "../shared/team";
import type { ExecutionObservation, MonitorReply } from "../shared/monitor";
import { monitorRequestSchema } from "../shared/monitor";
import {
  projectMonitor,
  MonitorProjection,
  observeTool,
  observationActivity,
  toolActivity,
} from "../electron/controller/monitor";
import { Store } from "../electron/storage/database";
import { RunController } from "../electron/controller/runs";
import { MonitorStore } from "../src/lib/monitor-store";

function fixture(): Run {
  const settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.forEach((agent) => {
    agent.model = `model-${agent.role}`;
  });
  return {
    id: randomUUID(),
    projectId: randomUUID(),
    projectName: "Project",
    workspace: ".",
    prompt: "Implement",
    role: "lead",
    model: "model-lead",
    mode: "team",
    tasks: [],
    profiles: [],
    currentTaskId: null,
    fixRound: 0,
    review: null,
    state: "running",
    settings,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
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
  };
}
function observation(): ExecutionObservation {
  return {
    executionId: randomUUID(),
    startedAt: new Date().toISOString(),
    at: new Date().toISOString(),
    pendingModels: 0,
    tools: {},
  };
}
function task(id: string, patch: Partial<TeamTask> = {}): TeamTask {
  return {
    id,
    role: "be",
    title: id,
    instructions: "Work",
    allowedPaths: ["src"],
    acceptance: ["Done"],
    dependsOn: [],
    state: "running",
    model: "model-be",
    kind: "work",
    round: 0,
    sessionId: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    summary: "",
    error: "",
    changes: [],
    commandIds: [],
    observation: observation(),
    ...patch,
  };
}
const roster = (run: Run, active: Run | null = run) =>
  projectMonitor(run.projectId, run.settings, run, active);

test("same-role executions, tool ends, permission and stop remain scoped to their lanes", () => {
  const run = fixture();
  run.tasks = [task("t1"), task("t2")];
  observeTool(run.tasks[0].observation!, "a", "editing", "running", false);
  observeTool(run.tasks[1].observation!, "b", "reading", "running", false);
  let agent = roster(run).agents.find((a) => a.role === "be")!;
  assert.equal(agent.executions.length, 2);
  assert.deepEqual(
    agent.executions.map((e) => e.activity),
    ["editing", "reading"],
  );
  assert.notEqual(
    agent.executions[0].executionId,
    agent.executions[1].executionId,
  );
  run.permissions = [
    { id: "p1", permission: "edit", patterns: [], taskId: "t1" },
  ];
  run.state = "blocked";
  agent = roster(run).agents.find((a) => a.role === "be")!;
  assert.deepEqual(
    agent.executions.map((e) => e.activity),
    ["waiting_input", "reading"],
  );
  run.tasks[0].state = "completed";
  assert.equal(
    roster(run).agents.find((a) => a.role === "be")!.executions.length,
    1,
  );
  run.state = "cancelling";
  assert.equal(
    roster(run).agents.find((a) => a.role === "be")!.executions[0].activity,
    "stopping",
  );
});

test("overlapping tools, duplicate and reconciled events never invent or close another live call", () => {
  const o = observation();
  o.pendingModels = 1;
  observeTool(o, "a", "reading", "running", false);
  observeTool(o, "b", "editing", "running", false);
  observeTool(o, "a", "reading", "running", false);
  assert.equal(observationActivity(o), "editing");
  observeTool(o, "a", "reading", "completed", false);
  assert.equal(observationActivity(o), "editing");
  observeTool(o, "late", "command", "running", true);
  assert.equal(observationActivity(o), "editing");
  observeTool(o, "b", "editing", "error", false);
  observeTool(o, "b", "editing", "running", false);
  assert.equal(observationActivity(o), "waiting_model");
  o.closed = true;
  observeTool(o, "late", "command", "running", false);
  assert.equal(observationActivity(o), "finished");
  assert.equal(toolActivity("bash"), "command");
  assert.equal(toolActivity("bash", task("t1", { role: "test" })), "testing");
});

test("availability distinguishes disabled, unconfigured, busy and available; waiting tasks do not occupy roles", () => {
  const run = fixture();
  run.settings.agents.find((a) => a.role === "pm")!.enabled = false;
  run.settings.agents.find((a) => a.role === "ba")!.model = "";
  run.tasks = [
    task("t1"),
    task("t2", { role: "fe", state: "queued", dependsOn: ["t1"] }),
  ];
  const agents = roster(run).agents;
  assert.equal(agents.find((a) => a.role === "pm")!.availability, "disabled");
  assert.equal(
    agents.find((a) => a.role === "ba")!.availability,
    "unconfigured",
  );
  assert.equal(agents.find((a) => a.role === "be")!.availability, "occupied");
  assert.equal(agents.find((a) => a.role === "fe")!.availability, "available");
  assert.equal(
    agents.find((a) => a.role === "fe")!.waiting[0].reason,
    "Chờ dependency",
  );
  run.tasks[0].state = "failed";
  assert.equal(
    roster(run).agents.find((a) => a.role === "fe")!.waiting[0].reason,
    "Dependency cần xử lý",
  );
  run.tasks[0].state = "completed";
  run.tasks.push(task("t1-fix-1", { originalTaskId: "t1", kind: "fix" }));
  assert.equal(
    roster(run).agents.find((a) => a.role === "fe")!.waiting[0].reason,
    "Chờ dependency",
  );
});

test("direct runs and another project's active run preserve scope; interrupted observation cannot show busy", () => {
  const run = fixture();
  run.mode = "direct";
  run.role = "fe";
  run.observation = observation();
  const direct = roster(run);
  assert.equal(
    direct.agents.find((a) => a.role === "fe")!.executions[0].taskId,
    null,
  );
  const other = projectMonitor(randomUUID(), run.settings, null, run);
  assert.ok(other.activeRun);
  assert.equal(other.agents.flatMap((a) => a.executions).length, 0);
  run.state = "interrupted";
  assert.equal(
    roster(run, null).agents.find((a) => a.role === "fe")!.availability,
    "available",
  );
  assert.equal(roster(run, null).progress.verifiedTasks, 0);
});

test("progress deduplicates fixes and never equates executed work with verified acceptance", () => {
  const run = fixture();
  run.tasks = [
    task("plan", { kind: "plan", role: "lead", state: "completed" }),
    task("t1", { originalTaskId: "t1", state: "completed" }),
    task("t1-fix-1", { kind: "fix", originalTaskId: "t1", state: "completed" }),
  ];
  assert.equal(roster(run).progress.currentTasks, 1);
  assert.equal(roster(run).progress.executedTasks, 1);
  assert.equal(roster(run).progress.verifiedTasks, 0);
  run.state = "completed";
  run.endedAt = new Date().toISOString();
  run.review = {
    version: 2,
    status: "completed",
    summary: "Done",
    acceptance: [
      {
        criterionId: "t1:ac1",
        criterion: "Done",
        status: "passed",
        evidence: "source",
        method: "source",
        refs: [],
      },
    ],
    fixes: [],
    limitations: [],
    verification: { verified: true, issues: [] },
  };
  assert.equal(roster(run, null).progress.verifiedTasks, 1);
  run.state = "running";
  assert.equal(
    roster(run).progress.verifiedTasks,
    0,
    "stale completed review during a new execution is not verified",
  );
});

test("snapshot version includes settings and state, unchanged is scoped by epoch, payload excludes secrets/output", () => {
  const run = fixture();
  run.prompt = "Implement Bearer sensitive-token";
  run.commands = [
    {
      callId: "secret",
      command: "hidden-command",
      status: "completed",
      output: "hidden-output",
      exitCode: 0,
    },
  ];
  const projection = new MonitorProjection();
  const request = { projectId: run.projectId };
  const first = projection.snapshot(request, roster(run));
  assert.equal(first.unchanged, false);
  if (first.unchanged) return;
  const { epoch, revision } = first.snapshot;
  assert.equal(
    projection.snapshot(
      { ...request, epoch, sinceRevision: revision },
      roster(run),
    ).unchanged,
    true,
  );
  run.settings.agents[1].enabled = false;
  const next = projection.snapshot(
    { ...request, epoch, sinceRevision: revision },
    roster(run),
  );
  assert.equal(next.unchanged, false);
  assert.equal(
    projection.snapshot(
      { ...request, epoch: randomUUID(), sinceRevision: revision },
      roster(run),
    ).unchanged,
    false,
  );
  assert.ok(!JSON.stringify(first).includes("hidden-output"));
  assert.ok(!JSON.stringify(first).includes("sensitive-token"));
  assert.ok(!JSON.stringify(first).includes("gatewayUrl"));
  assert.equal(
    monitorRequestSchema.safeParse({ ...request, arbitrarySQL: "delete" })
      .success,
    false,
  );
});

test("schema6 backup/migration retains chats/credentials/legacy events, while state advances past event cap", () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-monitor-db-"));
  let store = new Store(directory);
  try {
    const project = store.addProject(directory);
    const chat = store.conversations.create(project.id);
    store.conversations.draft(chat.id, "Giữ bản nháp");
    const run = fixture();
    run.projectId = project.id;
    run.state = "completed";
    store.createRun(run);
    store.updateRun(run);
    store.close();
    const db = new Database(join(directory, "worker.sqlite"));
    db.exec(
      "DROP TABLE question_sets; DROP TABLE chat_requests; DROP TABLE work_comments; DROP TABLE work_attempts; DROP TABLE work_submissions; DROP TABLE work_revisions; DROP TABLE work_counters; DROP TABLE board_links; DROP TABLE board_items; ALTER TABLE events DROP COLUMN metadata; PRAGMA user_version=6;",
    );
    db.prepare("INSERT INTO credentials VALUES (1,?)").run(
      Buffer.from("ciphertext-fixture"),
    );
    db.close();
    store = new Store(directory);
    assert.ok(
      existsSync(join(directory, "worker.schema6.pre-monitor.backup.sqlite")),
    );
    const backup = new Database(
      join(directory, "worker.schema6.pre-monitor.backup.sqlite"),
      { readonly: true },
    );
    assert.equal(backup.pragma("user_version", { simple: true }), 6);
    backup.close();
    assert.equal(
      store.conversations.get(chat.id).conversation.draft,
      "Giữ bản nháp",
    );
    assert.equal(store.encryptedKey()?.toString(), "ciphertext-fixture");
    assert.equal(store.events(run.id)[0].metadata, undefined);
    store.event(run.id, "TOOL_STARTED", "Đọc", {
      version: 1,
      taskId: "t1",
      executionId: randomUUID(),
      activity: "reading",
    });
    assert.equal(store.events(run.id).at(-1)!.metadata!.activity, "reading");
    for (let i = 0; i < 2001; i++) store.event(run.id, "CAP", "cap");
    const controller = new RunController(store, directory, () => undefined);
    const before = controller.monitor({ projectId: project.id });
    assert.equal(before.unchanged, false);
    run.state = "failed";
    store.updateRun(run, { type: "RUN_FAILED", text: "after cap" });
    const after = controller.monitor({ projectId: project.id });
    assert.equal(after.unchanged, false);
    if (!before.unchanged && !after.unchanged) {
      assert.ok(after.snapshot.revision > before.snapshot.revision);
      assert.equal(after.snapshot.runState, "failed");
    }
    assert.throws(
      () => controller.monitor({ projectId: randomUUID() }),
      /Không tìm thấy/,
    );
  } finally {
    store.close();
    assert.ok(directory.startsWith(join(tmpdir(), "asf-monitor-db-")));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("shared renderer store deduplicates subscriptions and in-flight requests, recovers epochs and retains state on failure", async () => {
  const run = fixture();
  const projection = new MonitorProjection();
  let reads = 0;
  let resolveRead!: (reply: MonitorReply) => void;
  let pending: Promise<MonitorReply> = new Promise((resolve) => {
    resolveRead = resolve;
  });
  const store = new MonitorStore(run.projectId, () => {
    reads++;
    return pending;
  });
  const off1 = store.subscribe(() => {});
  const off2 = store.subscribe(() => {});
  await store.refresh();
  assert.equal(reads, 1);
  resolveRead(projection.snapshot({ projectId: run.projectId }, roster(run)));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(store.getSnapshot().snapshot);
  pending = Promise.reject(new Error("IPC failed"));
  await store.refresh();
  assert.ok(store.getSnapshot().snapshot);
  const newProjection = new MonitorProjection();
  pending = Promise.resolve(
    newProjection.snapshot({ projectId: run.projectId }, roster(run)),
  );
  await store.refresh();
  assert.equal(store.getSnapshot().snapshot!.epoch, newProjection.epoch);
  off1();
  off2();
});

test("stalled snapshot becomes stale without starting a second request; unchanged success restores freshness", async () => {
  const run = fixture();
  const projection = new MonitorProjection();
  let pending = Promise.resolve(
    projection.snapshot({ projectId: run.projectId }, roster(run)),
  );
  let resolveRead!: (value: MonitorReply) => void;
  let reads = 0;
  const store = new MonitorStore(run.projectId, () => {
    reads++;
    return pending;
  });
  await store.refresh();
  const snapshot = store.getSnapshot().snapshot!;
  pending = new Promise((resolve) => {
    resolveRead = resolve;
  });
  const refresh = store.refresh();
  await new Promise((resolve) => setTimeout(resolve, 3100));
  assert.equal(store.getSnapshot().stale, true);
  await store.refresh();
  assert.equal(
    reads,
    2,
    "a stalled request remains the only in-flight request",
  );
  resolveRead(
    projection.snapshot(
      {
        projectId: run.projectId,
        epoch: snapshot.epoch,
        sinceRevision: snapshot.revision,
      },
      roster(run),
    ),
  );
  await refresh;
  assert.equal(store.getSnapshot().stale, false);
  assert.equal(store.getSnapshot().snapshot!.revision, snapshot.revision);
});
