import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { editScopes } from "../electron/runtime/scope";
import { ExecutionStopped } from "../electron/runtime/stopped";
import { taskReport } from "../electron/team/handoff";
import { loadProfiles } from "../electron/team/profiles";
import { loadSkillCatalog } from "../electron/team/skills";
import { commandArtifactId, sourceVersion } from "../electron/team/evidence";
import { snapshot } from "../electron/workspace/snapshot";
import type { EvidenceRef } from "../shared/evidence";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { Store } from "../electron/storage/database";
import { defaultSettings } from "../shared/defaults";
import { normalizeRun, type Run } from "../shared/runs";
import {
  planSchema,
  leadDecisionSchema,
  safePath,
  validatePlan,
  inScope,
  type TeamReview,
  type EvidenceReview,
} from "../shared/team";
import {
  coordinate,
  newTask,
  TeamBlocked,
  validateReview,
} from "../electron/team/coordinator";
import { runtimeContext } from "../electron/team/policy";

test("Lead conversations finish with one decision, preserve history and ask naturally without scheduling workers", async () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-lead-chat-"));
  const source = join(directory, "source");
  mkdirSync(source);
  const store = new Store(join(directory, "data"));
  try {
    const project = store.addProject(source);
    const conversation = store.conversations.create(project.id);
    const turns = [
      ["hi", "Chào bạn! Bạn muốn trao đổi gì hôm nay?"],
      [
        "Tôi muốn làm app quản lý",
        "Bạn muốn quản lý công việc hay khách hàng?",
      ],
    ];
    for (const [prompt, reply] of turns) {
      const run = fixture(source);
      run.projectId = project.id;
      run.conversationId = conversation.id;
      run.prompt = prompt;
      run.context = store.conversations.context(conversation.id, project.id);
      store.createRun(run);
      let calls = 0;
      await coordinate(
        run,
        async (task, instructions) => {
          calls++;
          assert.equal(task.kind, "plan");
          const context = runtimeContext(run, task, instructions);
          if (prompt !== "hi") assert.match(context.prompt, /Chào bạn!/);
          return JSON.stringify({ reply });
        },
        () => {},
        () => {},
      );
      store.updateRun(run);
      assert.equal(calls, 1);
      assert.equal(run.summary, reply);
      assert.equal(run.state, "completed");
      assert.equal(run.review, null);
      assert.equal(run.tasks.length, 1);
      assert.equal(run.tasks[0].state, "completed");
    }
    const messages = store.conversations.get(conversation.id).messages;
    assert.equal(messages.length, 4);
    assert.equal(messages[3].content, turns[1][1]);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Lead reply cannot smuggle work or bypass the existing single schema repair", async () => {
  for (const reply of ["", "   ", "x".repeat(12001)])
    assert.equal(leadDecisionSchema.safeParse({ reply }).success, false);
  assert.equal(
    leadDecisionSchema.safeParse({ reply: "OK", tasks: [] }).success,
    false,
  );
  const directory = mkdtempSync(join(tmpdir(), "asf-lead-schema-"));
  try {
    const run = fixture(directory);
    let calls = 0;
    await coordinate(
      run,
      async () => {
        calls++;
        return JSON.stringify(
          calls === 1
            ? { reply: "OK", tasks: [] }
            : { reply: "Bạn muốn bắt đầu ở đâu?" },
        );
      },
      () => {},
      () => {},
    );
    assert.equal(calls, 2);
    assert.equal(run.tasks[0].failure?.code, "invalid-output");
    assert.equal(run.summary, "Bạn muốn bắt đầu ở đâu?");
    assert.ok(run.tasks.every((task) => task.kind === "plan"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a readonly source change preserves the reply and blocks dispatch without attributing its origin", async () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-lead-readonly-"));
  try {
    const run = fixture(directory);
    await assert.rejects(
      coordinate(
        run,
        async () => {
          writeFileSync(join(directory, "unexpected.txt"), "change");
          return JSON.stringify({ reply: "Xong" });
        },
        () => {},
        () => {},
      ),
      TeamBlocked,
    );
    assert.equal(run.summary, "Xong");
    assert.equal(run.tasks[0].failure?.code, "workspace-changed");
    assert.equal(run.tasks.length, 1);
    assert.equal(run.tasks[0].state, "blocked");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a concurrent README edit preserves Lead's proposal without dispatching a stale plan", async () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-plan-concurrent-"));
  try {
    writeFileSync(join(directory, "README.md"), "Before");
    const run = fixture(directory);
    let calls = 0;
    await assert.rejects(
      coordinate(
        run,
        async () => {
          calls++;
          writeFileSync(join(directory, "README.md"), "External edit");
          return JSON.stringify({
            blockedReason: null,
            testingReason: "Evaluation",
            tasks: [{ ...planned("t1", "be"), role: "pm" }],
          });
        },
        () => {},
        () => {},
      ),
      TeamBlocked,
    );
    assert.equal(calls, 1);
    assert.equal(run.tasks[0].failure?.code, "workspace-changed");
    assert.match(run.summary, /Đề xuất chưa thực hiện/);
    assert.match(run.summary, /PM:/);
    assert.equal(run.tasks.length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(workspace: string): Run {
  const settings = defaultSettings();
  settings.agents = settings.agents.map((a) => ({
    ...a,
    model: `model-${a.role}`,
  }));
  return normalizeRun({
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    projectName: "team",
    workspace,
    prompt: "Implement",
    role: "lead",
    model: "model-lead",
    mode: "team",
    tasks: [],
    profiles: loadProfiles(),
    skillCatalog: loadSkillCatalog(),
    currentTaskId: null,
    fixRound: 0,
    review: null,
    state: "running",
    settings,
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
    runtimeVersion: "",
    inputTokens: 0,
    outputTokens: 0,
  } as Run);
}
test("edit scopes are relative to the Git worktree, including nested apps and non-Git folders", () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-scope-root-"));
  try {
    const workspace = join(directory, "apps", "worker");
    mkdirSync(workspace, { recursive: true });
    assert.equal(editScopes(workspace, ["src"])["src"], "allow");
    mkdirSync(join(directory, ".git"));
    assert.deepEqual(editScopes(workspace, ["src/a.ts"]), {
      "*": "deny",
      "apps/worker/src/a.ts": "allow",
      "apps/worker/src/a.ts/**": "allow",
    });
    assert.equal(editScopes(workspace, ["."])["*"], "deny");
    assert.equal(editScopes(workspace, ["."])["apps/worker/**"], "allow");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
const planned = (
  id: string,
  role: "be" | "fe" | "test",
  dependsOn: string[] = [],
) => ({
  id,
  role,
  dependsOn,
  title: id,
  instructions: "Work",
  allowedPaths: ["src"],
  acceptance: [`${id} AC`],
});
const review = (
  status: "completed" | "fix",
  fixes: TeamReview["fixes"] = [],
): EvidenceReview => ({
  version: 2,
  status,
  summary: "Done",
  fixes,
  acceptance: ["t1 AC", "t2 AC", "t3 AC"].map((criterion, i) => ({
    criterionId: `t${i + 1}:ac1`,
    criterion,
    status: status === "completed" ? "passed" : "failed",
    evidence: "tool evidence",
    method: i === 2 ? "command" : "source",
    refs: [],
  })),
  limitations: [],
});

test("plans reject cycles, disabled roles and unsafe scopes without silently changing models", () => {
  const run = fixture("unused");
  const plan = planSchema.parse({
    blockedReason: null,
    testingReason: "",
    tasks: [planned("t1", "be"), planned("t2", "test", ["t1"])],
  });
  validatePlan(plan, run.settings);
  assert.equal(
    newTask(run, { ...plan.tasks[0], kind: "work" }).model,
    "model-be",
  );
  run.settings.agents.find((a) => a.role === "be")!.enabled = false;
  assert.throws(() => validatePlan(plan, run.settings), /chưa bật/);
  assert.throws(
    () =>
      validatePlan(
        { ...plan, tasks: [planned("t1", "test", ["t1"])] },
        run.settings,
      ),
    /Dependency/,
  );
  for (const scope of [
    "../src",
    "C:/data",
    "/absolute",
    ".git/config",
    ".env.local",
    "src/*",
  ])
    assert.equal(safePath.safeParse(scope).success, false);
  assert.equal(inScope("src2/a.ts", ["src"]), false);
  assert.equal(inScope("src/lib/a.ts", ["src"]), true);
  assert.equal(safePath.parse("./src//lib/"), "src/lib");
});

test("failed TEST is repaired selectively with per-role models, fresh evidence and preserved audit", async () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-team-fix-"));
  const source = join(directory, "source");
  mkdirSync(join(source, "src"), { recursive: true });
  writeFileSync(join(source, "src", "a.ts"), "export const a = 1;");
  const store = new Store(join(directory, "data"));
  try {
    const run = fixture(source);
    store.createRun(run);
    const calls: string[] = [];
    const plan = {
      blockedReason: null,
      testingReason: "",
      tasks: [
        planned("t1", "be"),
        planned("t2", "fe"),
        planned("t3", "test", ["t1"]),
      ],
    };
    let reviews = 0;
    await coordinate(
      run,
      async (task, prompt) => {
        task.sessionId = `session-${task.id}`;
        calls.push(task.id);
        assert.ok(task.skillSelection);
        assert.ok(task.skillSelection.skills.length <= 3);
        if (task.kind === "plan")
          assert.deepEqual(task.skillSelection.skills, []);
        if (task.kind === "review")
          assert.deepEqual(
            task.skillSelection.skills.map((s) => s.id),
            ["testing"],
          );
        if (task.kind === "fix")
          assert.deepEqual(
            task.skillSelection.skills.map((s) => s.id),
            ["fix-bug", "testing"],
          );
        assert.equal(task.model, `model-${task.role}`);
        if (task.kind === "plan") return JSON.stringify(plan);
        if (task.kind === "review") {
          const packet = JSON.parse(
            prompt.split("D\u1eef li\u1ec7u review: ")[1].split("\n")[0],
          );
          const backend = packet.tasks.find(
            (t: { taskId: string }) => t.taskId === "t1",
          );
          assert.equal(backend.attemptId, reviews === 0 ? "t1" : "t1-fix-1");
          const tested = packet.tasks.find(
            (t: { taskId: string }) => t.taskId === "t3",
          );
          assert.equal(tested.attemptId, reviews === 0 ? "t3" : "t3-retry-1");
          const result =
            reviews++ === 0
              ? review("fix", [
                  { taskId: "t1", instructions: "Repair backend" },
                ])
              : review("completed");
          const response = {
            ...result,
            version: 3,
            acceptance: result.acceptance.map((ac) => {
              const criterion = packet.criteria.find(
                (c: { criterionId: string }) =>
                  c.criterionId === ac.criterionId,
              );
              return {
                criterionId: ac.criterionId,
                status: ac.status,
                evidence: ac.evidence,
                method: ac.method,
                refs:
                  result.status === "completed"
                    ? criterion.evidenceIds
                        .filter(
                          (id: string) =>
                            packet.evidence.find(
                              (e: { id: string; kind: string }) => e.id === id,
                            )?.kind ===
                            (ac.method === "command" ? "command" : "file"),
                        )
                        .slice(0, 1)
                    : [],
              };
            }),
          };
          return JSON.stringify(response);
        }
        if (task.id === "t3-retry-1") {
          const packet = JSON.parse(
            prompt.split("Bàn giao: ")[1].split("\n")[0],
          );
          assert.equal(packet.tasks.length, 1);
          assert.equal(packet.tasks[0].taskId, "t1");
          assert.equal(packet.tasks[0].attemptId, "t1-fix-1");
          assert.equal(packet.tasks[0].report.format, "legacy");
          assert.equal(packet.tasks[0].report.verified, false);
        }
        if (task.role === "test") {
          const artifactId = commandArtifactId(
            run.id,
            task.id,
            task.sessionId!,
            task.id,
          );
          store.evidence.saveCommand(run.id, artifactId, "result");
          run.commands.push({
            artifactId,
            artifactHash: createHash("sha256").update("result").digest("hex"),
            sessionId: task.sessionId!,
            sourceVersion: sourceVersion(await snapshot(source)),
            taskId: task.id,
            callId: task.id,
            command: "test",
            status: "completed",
            output: "result",
            exitCode: task.round === 0 ? 1 : 0,
          });
        }
        return "Work done";
      },
      () => {},
      () => {},
      store.evidence,
    );
    assert.equal(run.state, "completed");
    assert.equal(run.fixRound, 1);
    assert.equal(calls.length, 8); // No report parsing/formatting model round trips.
    assert.equal(calls.filter((id) => id === "t2").length, 1);
    assert.ok(calls.includes("t1-fix-1"));
    for (const task of run.tasks.filter((t) =>
      ["work", "fix"].includes(t.kind),
    )) {
      assert.ok(
        task.baseEvidence?.sourceVersion,
        `Missing baseline for ${task.id}`,
      );
    }
    assert.ok(calls.includes("t3-retry-1"));
    assert.equal(run.tasks.find((t) => t.id === "t3")!.state, "failed");
    assert.equal(
      run.tasks.find((t) => t.id === "t3-retry-1")!.state,
      "completed",
    );
    assert.deepEqual(
      run.commands.map((c) => c.exitCode),
      [1, 0],
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("TEST cannot pass without command evidence; retries are bounded and cancellation prevents scheduling", async () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-team-limits-"));
  const evidenceDirectory = mkdtempSync(join(tmpdir(), "asf-team-proof-"));
  const store = new Store(evidenceDirectory);
  try {
    const run = fixture(directory);
    let executions = 0;
    await assert.rejects(
      coordinate(
        run,
        async (task) => {
          if (task.kind === "plan")
            return JSON.stringify({
              blockedReason: null,
              testingReason: "",
              tasks: [planned("t1", "test")],
            });
          if (task.kind === "review")
            return JSON.stringify({
              ...review("completed"),
              version: 3,
              acceptance: [
                {
                  criterionId: "t1:ac1",
                  status: "passed",
                  evidence: "Model says so",
                  method: "command",
                  refs: [],
                },
              ],
            });
          executions++;
          return "All tests pass";
        },
        () => {},
        () => {},
        store.evidence,
      ),
      TeamBlocked,
    );
    assert.equal(executions, 1);
    assert.equal(run.tasks.find((t) => t.id === "t1")!.state, "failed");
    assert.equal(run.tasks.filter((t) => t.kind === "review").length, 1);
    let stopped = false;
    await assert.rejects(
      coordinate(
        fixture(directory),
        async () => {
          stopped = true;
          return "{}";
        },
        () => {},
        () => {
          if (stopped) throw new Error("cancelled");
        },
      ),
      /cancelled/,
    );
    const bounded = fixture(directory);
    bounded.settings.maxFixRounds = 0;
    await assert.rejects(
      coordinate(
        bounded,
        async (task) =>
          task.kind === "plan"
            ? JSON.stringify({
                blockedReason: null,
                testingReason: "Small change",
                tasks: [planned("t1", "be")],
              })
            : task.kind === "review"
              ? JSON.stringify({
                  ...review("fix", [{ taskId: "t1", instructions: "Fix" }]),
                  version: 3,
                  acceptance: [
                    {
                      criterionId: "t1:ac1",
                      status: "failed",
                      evidence: "Failure",
                      method: "source",
                      refs: [],
                    },
                  ],
                })
              : "Work",
        () => {},
        () => {},
        store.evidence,
      ),
      /hết số vòng/,
    );
    assert.equal(bounded.tasks.filter((t) => t.kind === "fix").length, 0);
  } finally {
    store.close();
    rmSync(evidenceDirectory, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  }
});

test("scope drift blocks run without reverting external changes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-team-scope-"));
  try {
    const run = fixture(directory);
    await assert.rejects(
      coordinate(
        run,
        async (task) => {
          if (task.kind === "plan")
            return JSON.stringify({
              blockedReason: null,
              testingReason: "Small change",
              tasks: [planned("t1", "be")],
            });
          writeFileSync(join(directory, "outside.ts"), "outside");
          return "Done";
        },
        () => {},
        () => {},
      ),
      /ngoài phạm vi/,
    );
    assert.ok(existsSync(join(directory, "outside.ts")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schema2 migration backs up history and persists independent task states", () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-team-migrate-"));
  let store: Store | undefined;
  try {
    store = new Store(directory);
    store.close();
    store = undefined;
    const db = new Database(join(directory, "worker.sqlite"));
    db.exec(
      "DROP TABLE work_comments; DROP TABLE work_attempts; DROP TABLE work_submissions; DROP TABLE work_revisions; DROP TABLE work_counters; DROP TABLE board_links; DROP TABLE board_items; DROP TABLE command_artifacts; DROP TABLE file_recoveries; DROP TABLE workspace_evidence; DROP TABLE workspace_blobs; DROP TABLE follow_ups; DROP TABLE messages; DROP TABLE conversations; DROP TABLE tasks; CREATE TABLE tasks (id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES runs(id), role TEXT NOT NULL, state TEXT NOT NULL, instructions TEXT NOT NULL); PRAGMA user_version=2",
    );
    const run = fixture(directory);
    run.state = "completed";
    const legacy = { ...run } as Partial<Run>;
    delete legacy.mode;
    delete legacy.tasks;
    delete legacy.profiles;
    delete legacy.skillCatalog;
    db.prepare("INSERT INTO runs VALUES (?,?,?,?,?)").run(
      run.id,
      run.projectId,
      run.state,
      run.createdAt,
      JSON.stringify(legacy),
    );
    db.prepare("INSERT INTO tasks VALUES (?,?,?,?,?)").run(
      "old",
      run.id,
      "be",
      "completed",
      "Legacy",
    );
    db.close();
    store = new Store(directory);
    assert.ok(existsSync(join(directory, "worker.schema2.backup.sqlite")));
    assert.equal(store.run(run.id).mode, "direct");
    assert.equal(store.run(run.id).skillCatalog, undefined);
    run.tasks = [
      newTask(run, { ...planned("t1", "be"), kind: "work" }),
      newTask(run, { ...planned("t2", "test", ["t1"]), kind: "work" }),
    ];
    run.tasks[0].state = "completed";
    run.tasks[0].summary =
      "Trạng thái: done\nKết quả: Đã sửa src/api.ts\nBlocker: —\nChưa xác minh: Chưa mở UI";
    run.tasks[1].summary = "Legacy report must remain intact";
    store.updateRun(run);
    store.close();
    store = undefined;
    const inspect = new Database(join(directory, "worker.sqlite"));
    assert.deepEqual(
      (
        inspect
          .prepare("SELECT state FROM tasks WHERE run_id=? ORDER BY id")
          .all(run.id) as { state: string }[]
      ).map((t) => t.state),
      ["completed", "queued"],
    );
    inspect.close();
    store = new Store(directory);
    assert.equal(store.run(run.id).tasks.length, 2);
    const stored = store.run(run.id);
    assert.equal(stored.tasks[0].summary, run.tasks[0].summary);
    assert.equal(taskReport(stored.tasks[0].summary).status, "done");
    assert.equal(stored.tasks[1].summary, "Legacy report must remain intact");
    assert.equal(taskReport(stored.tasks[1].summary).format, "legacy");
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("review cannot claim success with incomplete acceptance or assign fixes to TEST", () => {
  const run = fixture("unused");
  const task = newTask(run, { ...planned("t1", "test"), kind: "work" });
  assert.throws(() => validateReview(review("completed"), [task]), /Không thể/);
  assert.throws(
    () =>
      validateReview(
        review("fix", [{ taskId: "t1", instructions: "Fake pass" }]),
        [task],
      ),
    /BE\/FE/,
  );
});
test("isolated batch drains its failing sibling and never schedules later work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-isolated-fail-"));
  try {
    const source = join(directory, "source");
    mkdirSync(source);
    const run = fixture(source);
    run.settings.teamExecution = "isolated-pair";
    let started = 0,
      stopped = false,
      drained = false;
    let both!: () => void, abort!: () => void;
    const barrier = new Promise<void>((resolve) => {
      both = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      abort = resolve;
    });
    const check = () => {
      if (stopped) throw new ExecutionStopped("failed");
    };
    await assert.rejects(
      coordinate(
        run,
        async (task) => {
          if (task.kind === "plan")
            return JSON.stringify({
              blockedReason: null,
              testingReason: "fixture",
              tasks: [
                { ...planned("t1", "be"), allowedPaths: ["a.txt"] },
                { ...planned("t2", "fe"), allowedPaths: ["b.txt"] },
                { ...planned("t3", "be"), allowedPaths: ["c.txt"] },
              ],
            });
          started++;
          if (started === 2) both();
          await barrier;
          writeFileSync(
            join(task.workspace!, task.allowedPaths[0]),
            "partial work",
          );
          if (task.id === "t1") throw new Error("Primary lane failure");
          await aborted;
          drained = true;
          check();
          return "unreachable";
        },
        () => {},
        check,
        undefined,
        [],
        undefined,
        {
          prepare: async (task) => {
            task.workspace = join(directory, task.id);
            mkdirSync(task.workspace);
          },
          stop: () => {
            stopped = true;
            abort();
          },
        },
      ),
      /Primary lane failure/,
    );
    assert.equal(started, 2);
    assert.equal(drained, true);
    assert.equal(run.tasks.find((t) => t.id === "t3")!.state, "queued");
    for (const task of run.tasks.filter((t) => t.workspace)) {
      assert.equal(task.state, "failed");
      assert.equal(task.changes.length, 1);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed worker retains edits as immutable evidence without changing its failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-team-failed-"));
  const source = join(directory, "source");
  mkdirSync(join(source, "src"), { recursive: true });
  const store = new Store(join(directory, "data"));
  try {
    const run = fixture(source);
    store.createRun(run);
    await assert.rejects(
      coordinate(
        run,
        async (task) => {
          if (task.kind === "plan")
            return JSON.stringify({
              blockedReason: null,
              testingReason: "fixture",
              tasks: [planned("t1", "be")],
            });
          writeFileSync(join(source, "src", "kept.txt"), "partial work");
          throw new Error("Original runtime failure");
        },
        () => {},
        () => {},
        store.evidence,
      ),
      /Original runtime failure/,
    );
    const failed = run.tasks.find((t) => t.id === "t1")!;
    assert.equal(failed.state, "failed");
    assert.equal(failed.error, "Original runtime failure");
    assert.deepEqual(failed.changes, [{ path: "src/kept.txt", kind: "added" }]);
    assert.ok(failed.evidence?.files["src/kept.txt"]?.hash);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cancellation marks the active team task cancelled and never schedules another session", async () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-team-cancel-"));
  try {
    const run = fixture(directory);
    let stopped = false;
    let calls = 0;
    await assert.rejects(
      coordinate(
        run,
        async () => {
          calls++;
          stopped = true;
          throw new ExecutionStopped("cancelled");
        },
        () => {},
        () => {
          if (stopped) throw new ExecutionStopped("cancelled");
        },
      ),
      ExecutionStopped,
    );
    assert.equal(calls, 1);
    assert.equal(run.tasks[0].state, "cancelled");
    assert.equal(run.currentTaskId, null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
