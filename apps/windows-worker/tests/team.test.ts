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
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Store } from "../electron/storage/database";
import { defaultSettings } from "../shared/defaults";
import { normalizeRun, type Run } from "../shared/runs";
import {
  planSchema,
  safePath,
  validatePlan,
  inScope,
  type TeamReview,
} from "../shared/team";
import {
  coordinate,
  newTask,
  TeamBlocked,
  validateReview,
} from "../electron/team/coordinator";

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
    profiles: [],
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
): TeamReview => ({
  status,
  summary: "Done",
  fixes,
  acceptance: ["t1 AC", "t2 AC", "t3 AC"].map((criterion) => ({
    criterion,
    status: status === "completed" ? "passed" : "failed",
    evidence: "tool evidence",
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
  try {
    const run = fixture(directory);
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
      async (task) => {
        calls.push(task.id);
        assert.equal(task.model, `model-${task.role}`);
        if (task.kind === "plan") return JSON.stringify(plan);
        if (task.kind === "review")
          return JSON.stringify(
            reviews++ === 0
              ? review("fix", [
                  { taskId: "t1", instructions: "Repair backend" },
                ])
              : review("completed"),
          );
        if (task.role === "test")
          run.commands.push({
            taskId: task.id,
            callId: task.id,
            command: "test",
            status: "completed",
            output: "result",
            exitCode: task.round === 0 ? 1 : 0,
          });
        return "Work done";
      },
      () => {},
      () => {},
    );
    assert.equal(run.state, "completed");
    assert.equal(run.fixRound, 1);
    assert.equal(calls.filter((id) => id === "t2").length, 1);
    assert.ok(calls.includes("t1-fix-1"));
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
    rmSync(directory, { recursive: true, force: true });
  }
});

test("TEST cannot pass without command evidence; retries are bounded and cancellation prevents scheduling", async () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-team-limits-"));
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
              acceptance: [
                {
                  criterion: "t1 AC",
                  status: "passed",
                  evidence: "Model says so",
                },
              ],
            });
          executions++;
          return "All tests pass";
        },
        () => {},
        () => {},
      ),
      TeamBlocked,
    );
    assert.equal(executions, 1);
    assert.equal(run.tasks.find((t) => t.id === "t1")!.state, "failed");
    assert.equal(run.tasks.filter((t) => t.kind === "review").length, 2);
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
                  acceptance: [
                    {
                      criterion: "t1 AC",
                      status: "failed",
                      evidence: "Failure",
                    },
                  ],
                })
              : "Work",
        () => {},
        () => {},
      ),
      /hết số vòng/,
    );
    assert.equal(bounded.tasks.filter((t) => t.kind === "fix").length, 0);
  } finally {
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
      "DROP TABLE messages; DROP TABLE conversations; DROP TABLE tasks; CREATE TABLE tasks (id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES runs(id), role TEXT NOT NULL, state TEXT NOT NULL, instructions TEXT NOT NULL); PRAGMA user_version=2",
    );
    const run = fixture(directory);
    run.state = "completed";
    const legacy = { ...run } as Partial<Run>;
    delete legacy.mode;
    delete legacy.tasks;
    delete legacy.profiles;
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
    run.tasks = [
      newTask(run, { ...planned("t1", "be"), kind: "work" }),
      newTask(run, { ...planned("t2", "test", ["t1"]), kind: "work" }),
    ];
    run.tasks[0].state = "completed";
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
