import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildHandoff,
  handoffMaxChars,
  taskReport,
} from "../electron/team/handoff";
import type { Run, CommandResult } from "../shared/runs";
import type { TeamTask } from "../shared/team";

function task(id: string, patch: Partial<TeamTask> = {}): TeamTask {
  return {
    id,
    role: "be",
    title: id,
    instructions: "Work",
    allowedPaths: ["src"],
    acceptance: ["Behavior works"],
    dependsOn: [],
    state: "completed",
    model: "synthetic-model",
    kind: "work",
    round: 0,
    sessionId: null,
    startedAt: null,
    endedAt: null,
    summary: "Legacy response",
    error: "",
    changes: [],
    commandIds: [],
    ...patch,
  };
}
function runWith(tasks: TeamTask[], commands: CommandResult[] = []): Run {
  return { id: "run-test", tasks, commands } as Run;
}
function command(
  taskId: string,
  patch: Partial<CommandResult> = {},
): CommandResult {
  return {
    taskId,
    callId: "shared-id",
    command: "npm test",
    status: "completed",
    output: "passed",
    exitCode: 0,
    ...patch,
  };
}
const report = (patch: Record<string, unknown> = {}) =>
  JSON.stringify({
    status: "done",
    summary: "Implemented behavior",
    blockers: [],
    unverified: [],
    ...patch,
  });

test("structured reports are unverified claims; malformed and legacy responses remain intact without repair", () => {
  const valid = taskReport(
    "```json\n" +
      report({ status: "blocked", blockers: ["Missing fixture"] }) +
      "\n```",
  );
  assert.equal(valid.format, "structured");
  assert.equal(valid.status, "blocked");
  assert.equal(valid.verified, false);
  assert.deepEqual(valid.blockers, ["Missing fixture"]);
  const readable = taskReport(
    "Trạng thái: done_with_concerns\r\nKết quả: Đã sửa src/api.ts; npm test exit 0\r\nBlocker: —\r\nChưa xác minh:\r\n- UI chưa mở\r\n- Chưa chạy build",
  );
  assert.equal(readable.format, "structured");
  assert.equal(readable.status, "done_with_concerns");
  assert.equal(readable.summary, "Đã sửa src/api.ts; npm test exit 0");
  assert.deepEqual(readable.blockers, []);
  assert.deepEqual(readable.unverified, ["UI chưa mở", "Chưa chạy build"]);
  for (const text of [
    "All tests pass",
    "{broken",
    report({ status: "passed" }),
    report({ fabricatedEvidence: ["id"] }),
  ]) {
    const parsed = taskReport(text);
    assert.equal(parsed.format, "legacy");
    assert.equal(parsed.status, null);
    assert.equal(parsed.summary, text);
    assert.equal(parsed.verified, false);
  }
});

test("handoff uses requested latest attempt and exact command ownership even when call IDs collide", () => {
  const original = task("t1", {
    summary: "stale original",
    commandIds: ["shared-id"],
  });
  const fixed = task("t1-fix-1", {
    kind: "fix",
    round: 1,
    summary: report(),
    commandIds: ["shared-id"],
  });
  const unrelated = task("t2", { summary: "unrelated source" });
  const run = runWith(
    [original, fixed, unrelated],
    [
      command(original.id, { output: "stale failure", exitCode: 1 }),
      command(unrelated.id, { output: "unrelated command" }),
      command(fixed.id, { output: "current evidence" }),
    ],
  );
  const before = structuredClone(run);
  const packet = buildHandoff(
    run,
    new Map([
      ["t1", fixed],
      ["t2", unrelated],
    ]),
    ["t1", "t1"],
  );
  assert.equal(packet.tasks.length, 1);
  const entry = packet.tasks[0];
  assert.equal(entry.taskId, "t1");
  assert.equal(entry.attemptId, "t1-fix-1");
  assert.equal(entry.round, 1);
  assert.deepEqual(entry.source, { runId: run.id, taskId: fixed.id });
  assert.equal(entry.commands.items.length, 1);
  assert.equal(entry.commands.items[0].output.text, "current evidence");
  assert.deepEqual(entry.commands.items[0].source, {
    runId: run.id,
    taskId: fixed.id,
    callId: "shared-id",
  });
  assert.ok(!JSON.stringify(packet).includes("stale failure"));
  assert.ok(!JSON.stringify(packet).includes("unrelated"));
  assert.deepEqual(run, before);
});

test("truncated handoffs retain blockers and failed command heads/tails, counts and stored source refs", () => {
  const originalSummary = report({
    summary: "Long summary ".repeat(400),
    blockers: ["Missing DB fixture"],
    unverified: ["UI was not opened"],
  });
  const work = task("t1", {
    summary: originalSummary,
    error: "Known failure",
    state: "failed",
    changes: Array.from({ length: 30 }, (_, i) => ({
      path: `src/${i}.ts`,
      kind: "modified" as const,
    })),
  });
  const commands = Array.from({ length: 8 }, (_, i) =>
    command(work.id, { callId: `pass-${i}` }),
  );
  commands.push(
    command(work.id, {
      callId: "failed-command",
      exitCode: 1,
      output: "ASSERTION ERROR\n" + "noise".repeat(3000) + "\nFAILURE AT END",
      outputTruncated: true,
    }),
  );
  const packet = buildHandoff(
    runWith([work], commands),
    new Map([[work.id, work]]),
    [work.id],
  );
  const item = packet.tasks[0];
  assert.equal(packet.truncated, true);
  assert.equal(item.report.blockers[0].text, "Missing DB fixture");
  assert.equal(item.report.unverified[0].text, "UI was not opened");
  assert.equal(item.report.summary.truncated, true);
  assert.equal(item.error.text, "Known failure");
  assert.equal(item.commands.items[0].callId, "failed-command");
  assert.ok(item.commands.items[0].output.text.startsWith("ASSERTION ERROR"));
  assert.ok(item.commands.items[0].output.text.endsWith("FAILURE AT END"));
  assert.equal(item.commands.items[0].outputTruncated, true);
  assert.equal(item.commands.omitted, 3);
  assert.equal(item.commands.failedTotal, 1);
  assert.equal(item.files.omitted, 18);
  assert.equal(work.summary, originalSummary);
  assert.equal(commands[8].output.length > 1200, true);
});

test("JSON packet budget includes escaping and bounds dense review context without inventing evidence", () => {
  const tasks = Array.from({ length: 10 }, (_, i) =>
    task(`t${i + 1}`, {
      state: "failed",
      error: "Build failed " + "\u0000".repeat(2000),
      summary: report({
        summary: "x".repeat(6000),
        blockers: Array.from(
          { length: 8 },
          () => "Missing dependency " + "\u0000".repeat(500),
        ),
        unverified: ["No browser"],
      }),
      allowedPaths: Array.from(
        { length: 12 },
        (_, i) => "src/" + "a".repeat(230) + i,
      ),
      changes: Array.from({ length: 50 }, (_, i) => ({
        path: "src/" + "b".repeat(220) + i,
        kind: "modified",
      })),
    }),
  );
  const commands = tasks.flatMap((t) =>
    Array.from({ length: 8 }, (_, i) =>
      command(t.id, {
        callId: `${t.id}-cmd-${i}`,
        command: "x".repeat(1000),
        exitCode: 1,
        output: "FAIL\n" + "\u0000".repeat(12000) + "\nEND",
      }),
    ),
  );
  const packet = buildHandoff(
    runWith(tasks, commands),
    new Map(tasks.map((t) => [t.id, t])),
    tasks.map((t) => t.id),
  );
  assert.ok(JSON.stringify(packet).length <= handoffMaxChars);
  assert.equal(packet.tasks.length, 10);
  assert.equal(packet.truncated, true);
  for (const t of packet.tasks) {
    assert.equal(t.state, "failed");
    assert.equal(t.report.status, "done");
    assert.equal(t.report.verified, false);
    assert.equal(t.commands.failedTotal, 8);
    assert.ok(t.commands.failedOmitted > 0);
    assert.equal(t.source.taskId, t.attemptId);
    assert.ok(t.report.blockers[0].text.startsWith("Missing dependency"));
  }
});

test("task caps prioritize blockers and signal omitted or missing dependencies", () => {
  const tasks = Array.from({ length: 12 }, (_, i) => task(`t${i + 1}`));
  tasks[11].summary = report({
    status: "needs_context",
    blockers: ["Missing contract"],
  });
  const latest = new Map(tasks.map((t) => [t.id, t]));
  const packet = buildHandoff(
    runWith(tasks),
    latest,
    tasks.map((t) => t.id),
  );
  assert.equal(packet.tasks.length, 10);
  assert.equal(packet.omittedTasks, 2);
  assert.equal(packet.tasks[0].taskId, "t12");
  const missing = buildHandoff(runWith(tasks), latest, ["missing"]);
  assert.deepEqual(missing.missingTaskIds, ["missing"]);
  assert.equal(missing.tasks.length, 0);
});
