import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../electron/storage/database";
import { Worktrees } from "../electron/workspace/worktrees";
import { git } from "../electron/workspace/git-evidence";
import { defaultSettings, settingsSchema } from "../shared/contracts";
import { loadProfiles } from "../electron/team/profiles";
import { loadSkillCatalog } from "../electron/team/skills";
import { coordinate, TeamBlocked } from "../electron/team/coordinator";
import { RunController } from "../electron/controller/runs";
import {
  OpenCodeRuntime,
  type RuntimeHooks,
} from "../electron/runtime/opencode";
import type { Run, Permission } from "../shared/runs";
import type { TeamTask } from "../shared/team";
import type { Event } from "@opencode-ai/sdk/v2/client";

test("old settings default to sequential and reject unbounded parallel modes", () => {
  const old = { ...defaultSettings() } as Record<string, unknown>;
  delete old.teamExecution;
  assert.equal(settingsSchema.parse(old).teamExecution, "sequential");
  assert.equal(
    settingsSchema.safeParse({ ...old, teamExecution: "unlimited" }).success,
    false,
  );
});

test("real Git task workspaces overlap two Controller steps, route evidence/permissions and retain dependency outputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "asf-parallel-"));
  const source = join(directory, "source"),
    data = join(directory, "data");
  await mkdir(source);
  await writeFile(join(source, "a.txt"), "baseline-a");
  await writeFile(join(source, "b.txt"), "baseline-b");
  await git(source, ["init"]);
  await git(source, ["config", "user.email", "fixture@example.invalid"]);
  await git(source, ["config", "user.name", "Fixture"]);
  await git(source, ["add", "."]);
  await git(source, ["commit", "-m", "baseline"]);
  const store = new Store(data),
    project = store.addProject(source);
  const settings = defaultSettings();
  settings.gatewayUrl = "http://127.0.0.1:1/v1";
  settings.teamExecution = "isolated-pair";
  settings.agents.forEach((a) => {
    a.model = "fixture";
  });
  const run: Run = {
    id: randomUUID(),
    projectId: project.id,
    projectName: "fixture",
    workspace: source,
    role: "lead",
    model: "fixture",
    mode: "team",
    prompt: "Edit independent files",
    tasks: [],
    profiles: loadProfiles(),
    skillCatalog: loadSkillCatalog(),
    currentTaskId: null,
    fixRound: 0,
    review: null,
    state: "running",
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
    sessionId: null,
    summary: "",
    error: "",
    settings,
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
  store.createRun(run);
  const controller = new RunController(store, data, () => undefined);
  const active = { run, secrets: [], seen: new Set() };
  const internal = controller as unknown as {
    active: typeof active | undefined;
    step(
      active: unknown,
      key: undefined,
      executable: string,
      task: TeamTask,
      prompt: string,
    ): Promise<string>;
  };
  internal.active = active;
  const manager = new Worktrees(data, (path) =>
    store.workspaceReferenced(path),
  );
  const original = {
    start: OpenCodeRuntime.prototype.start,
    prompt: OpenCodeRuntime.prototype.prompt,
    close: OpenCodeRuntime.prototype.close,
    reply: OpenCodeRuntime.prototype.reply,
  };
  type MockRuntime = { run: Run; hooks: RuntimeHooks; session: string };
  let count = 0,
    max = 0,
    closed = 0;
  const waiting = new Map<string, () => void>();
  const replies: string[] = [];
  const late: { hooks: RuntimeHooks; event: Event }[] = [];
  let both!: () => void;
  const barrier = new Promise<void>((resolve) => {
    both = resolve;
  });
  try {
    OpenCodeRuntime.prototype.start = async function () {
      const runtime = this as unknown as MockRuntime;
      runtime.session = runtime.run.role + "-session";
      return runtime.session;
    };
    OpenCodeRuntime.prototype.reply = async function (id, allow) {
      const runtime = this as unknown as MockRuntime;
      assert.equal(id, "same-permission");
      assert.equal(allow, true);
      replies.push(runtime.run.role);
      waiting.get(runtime.run.role)!();
    };
    OpenCodeRuntime.prototype.close = async function () {
      closed++;
    };
    OpenCodeRuntime.prototype.prompt = async function () {
      const runtime = this as unknown as MockRuntime;
      count++;
      max = Math.max(max, count);
      if (count === 2) both();
      await barrier;
      const role = runtime.run.role,
        file = role === "be" ? "a.txt" : "b.txt";
      await writeFile(join(runtime.run.workspace, file), "edited-" + role);
      const permission = new Promise<void>((resolve) => {
        waiting.set(role, resolve);
      });
      runtime.hooks.permission({
        id: "same-permission",
        permission: "edit",
        patterns: ["test"],
      });
      await permission;
      const usage = {
        id: "usage-" + role,
        type: "message.part.updated",
        properties: {
          sessionID: runtime.session,
          time: Date.now(),
          part: {
            id: "same-usage",
            type: "step-finish",
            sessionID: runtime.session,
            messageID: "msg",
            reason: "stop",
            cost: 0,
            tokens: {
              input: role === "be" ? 11 : 22,
              output: 3,
              total: 14,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        },
      } as Event;
      await runtime.hooks.event(usage);
      await runtime.hooks.event(usage);
      late.push({
        hooks: runtime.hooks,
        event: {
          ...usage,
          properties: {
            ...usage.properties,
            part: {
              ...(usage.properties as { part: object }).part,
              id: "late-usage",
            },
          },
        } as Event,
      });
      await runtime.hooks.event({
        id: "event-" + role,
        type: "message.part.updated",
        properties: {
          sessionID: runtime.session,
          time: Date.now(),
          part: {
            messageID: "message-" + role,
            id: "same-part",
            type: "tool",
            sessionID: runtime.session,
            callID: "same-call",
            tool: "bash",
            state: {
              status: "completed",
              input: { command: "test" },
              output: role,
              title: "test",
              metadata: { exit: 0 },
              time: { start: Date.now(), end: Date.now() },
            },
          },
        },
      } as Event);
      count--;
      return { text: "done " + role, error: null };
    };
    const planned = (
      id: string,
      role: string,
      path: string,
      dependsOn: string[] = [],
    ) => ({
      id,
      role,
      title: id,
      instructions: "Work",
      allowedPaths: [path],
      acceptance: ["Done"],
      dependsOn,
    });
    const execution = coordinate(
      run,
      async (task, prompt) => {
        if (task.kind === "plan")
          return JSON.stringify({
            blockedReason: null,
            testingReason: "",
            tasks: [
              planned("t1", "be", "a.txt"),
              planned("t2", "fe", "b.txt"),
              planned("t3", "test", ".", ["t1", "t2"]),
            ],
          });
        return internal.step(active, undefined, "fixture", task, prompt);
      },
      () => store.updateRun(run),
      () => {},
      store.evidence,
      [],
      undefined,
      {
        prepare: async (task) => {
          const owned = await manager.create(project.id, source);
          task.workspace = owned.path;
          task.workspaceOrigin = { id: owned.id, source, baseHead: owned.head };
          store.updateRun(run);
        },
        stop: () => {
          throw new Error("Unexpected stop");
        },
      },
    );
    const result = assert.rejects(
      execution,
      (error: unknown) =>
        error instanceof TeamBlocked && /chờ tích hợp/.test(error.message),
    );
    for (let i = 0; run.permissions.length !== 2 && i < 500; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(run.permissions.length, 2);
    assert.notEqual(run.permissions[0].id, run.permissions[1].id);
    const monitor = controller.monitor({ projectId: project.id });
    assert.equal(monitor.unchanged, false);
    if (!monitor.unchanged) {
      const executions = monitor.snapshot.agents.flatMap(
        (agent) => agent.executions,
      );
      assert.equal(executions.length, 2);
      assert.equal(new Set(executions.map((item) => item.executionId)).size, 2);
      assert.ok(executions.every((item) => item.activity === "waiting_input"));
      assert.ok(
        store
          .events(run.id)
          .filter((event) => event.type === "PERMISSION_REQUESTED")
          .every((event) => event.metadata?.activity === "waiting_input"),
      );
    }
    for (const p of [...run.permissions])
      await controller.reply(run.id, p.id, true);
    await result;
    assert.equal(max, 2);
    assert.equal(closed, 2);
    assert.deepEqual(replies.sort(), ["be", "fe"]);
    const work = run.tasks.filter((t) => t.kind === "work");
    assert.deepEqual(
      work.map((t) => t.state),
      ["completed", "completed", "blocked"],
    );
    assert.equal(work[2].sessionId, null);
    assert.equal(run.review, null);
    assert.equal(run.commands.length, 2);
    assert.equal(run.inputTokens, 33);
    assert.equal(work[0].metrics?.inputTokens, 11);
    assert.equal(work[1].metrics?.inputTokens, 22);
    for (const item of late) {
      await item.hooks.event(item.event);
      item.hooks.permission({ id: "late", permission: "bash", patterns: [] });
    }
    assert.equal(run.inputTokens, 33);
    assert.equal(run.permissions.length, 0);
    const monitorEvents = store
      .events(run.id)
      .filter((event) => event.metadata?.executionId);
    assert.ok(monitorEvents.length > 0);
    assert.ok(monitorEvents.every((event) => event.metadata!.taskId));
    assert.notEqual(run.commands[0].artifactId, run.commands[1].artifactId);
    for (const task of work.slice(0, 2)) {
      assert.equal(task.changes.length, 1);
      assert.equal(task.changes[0].path, task.allowedPaths[0]);
      const command = run.commands.find((c) => c.taskId === task.id)!;
      assert.equal(command.cwd, task.workspace);
      assert.equal(command.sessionId, task.sessionId);
      assert.equal(command.output, task.role);
      assert.ok(task.evidence?.sourceVersion);
      assert.equal(store.workspaceReferenced(task.workspace!), true);
      await assert.rejects(manager.previewRemoval(task.workspaceOrigin!.id));
    }
    assert.equal(await readFile(join(source, "a.txt"), "utf8"), "baseline-a");
    assert.equal((await git(source, ["status", "--porcelain"])).toString(), "");
    const exported = JSON.parse(store.report(run.id));
    assert.equal(
      exported.run.tasks.find((t: TeamTask) => t.id === "t1").workspaceOrigin
        .id,
      work[0].workspaceOrigin!.id,
    );
    store.interruptRuns();
    assert.equal(store.run(run.id).state, "interrupted");
    assert.equal(store.workspaceReferenced(work[0].workspace!), true);
  } finally {
    Object.assign(OpenCodeRuntime.prototype, original);
    internal.active = undefined;
    store.close();
    assert.ok(directory.startsWith(join(tmpdir(), "asf-parallel-")));
    await rm(directory, { recursive: true, force: true });
  }
});
