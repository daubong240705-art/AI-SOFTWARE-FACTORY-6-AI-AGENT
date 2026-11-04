import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  unlink,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../electron/storage/database";
import { Worktrees } from "../electron/workspace/worktrees";
import { Integration } from "../electron/workspace/integration";
import { git } from "../electron/workspace/git-evidence";
import { snapshot, changes } from "../electron/workspace/snapshot";
import { newTask } from "../electron/team/coordinator";
import { coordinate } from "../electron/team/coordinator";
import { sourceVersion, commandArtifactId } from "../electron/team/evidence";
import { createHash } from "node:crypto";
import type { EvidenceRef } from "../shared/evidence";
import { defaultSettings } from "../shared/defaults";
import type { Run } from "../shared/runs";
import { RunController } from "../electron/controller/runs";
import { readFileSync } from "node:fs";

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "asf-integration-"));
  const source = join(directory, "source"),
    data = join(directory, "data");
  await mkdir(source);
  await writeFile(join(source, "a.txt"), "base-a");
  await writeFile(join(source, "b.txt"), "base-b");
  await git(source, ["init"]);
  await git(source, ["config", "user.name", "Fixture"]);
  await git(source, ["config", "user.email", "fixture@example.invalid"]);
  await git(source, ["add", "."]);
  await git(source, ["commit", "-m", "baseline"]);
  const store = new Store(data),
    project = store.addProject(source);
  const settings = defaultSettings();
  settings.agents.forEach((a) => {
    a.model = "fixture";
  });
  const run = {
    id: crypto.randomUUID(),
    projectId: project.id,
    projectName: "fixture",
    workspace: source,
    mode: "team",
    tasks: [],
    profiles: [],
    currentTaskId: null,
    fixRound: 0,
    review: null,
    role: "lead",
    model: "fixture",
    prompt: "fixture",
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
  } as Run;
  store.createRun(run);
  const manager = new Worktrees(data, (path) =>
    store.workspaceReferenced(path),
  );
  const create = () => manager.create(project.id, source);
  const integration = new Integration(
    store,
    manager,
    run,
    create,
    () => {},
    () => store.updateRun(run),
  );
  await integration.initialize();
  async function task(id: string, paths: string[], seed = true) {
    const owned = await create();
    if (seed) await integration.seed(owned);
    const value = newTask(run, {
      id,
      role: "be",
      title: id,
      instructions: "work",
      allowedPaths: paths,
      acceptance: ["done"],
      dependsOn: [],
      kind: "work",
    });
    value.workspace = owned.path;
    value.workspaceOrigin = { id: owned.id, source, baseHead: owned.head };
    const before = await snapshot(owned.path, true);
    value.baseEvidence = store.evidence.saveTaskSnapshot(before, [], paths);
    run.tasks.push(value);
    store.updateRun(run);
    return {
      value,
      async finish() {
        const after = await snapshot(owned.path, true);
        value.changes = changes(before, after);
        value.evidence = store.evidence.saveTaskSnapshot(
          after,
          value.changes.filter((c) => c.kind === "deleted").map((c) => c.path),
          paths,
        );
        value.state = "completed";
        value.sessionId = id;
        store.updateRun(run);
        return value;
      },
    };
  }
  return {
    directory,
    source,
    store,
    manager,
    run,
    integration,
    task,
    async cleanup() {
      store.close();
      assert.ok(directory.startsWith(join(tmpdir(), "asf-integration-")));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("three-way integration combines isolated additions/modifications/deletions and seeds dependent source without touching original", async () => {
  const s = await setup();
  try {
    const a = await s.task("t1", ["a.txt"]),
      b = await s.task("t2", ["b.txt", "new", "constructor", "__proto__"]);
    await writeFile(join(a.value.workspace!, "a.txt"), "new-a");
    await unlink(join(b.value.workspace!, "b.txt"));
    await mkdir(join(b.value.workspace!, "new"));
    await writeFile(join(b.value.workspace!, "new", "added.txt"), "added");
    await writeFile(
      join(b.value.workspace!, "constructor"),
      "constructor file",
    );
    await writeFile(join(b.value.workspace!, "__proto__"), "prototype file");
    await s.integration.accept(await a.finish());
    await s.integration.accept(await b.finish());
    const integrated = s.run.integration!;
    assert.equal(
      await readFile(join(integrated.workspace, "a.txt"), "utf8"),
      "new-a",
    );
    await assert.rejects(readFile(join(integrated.workspace, "b.txt")));
    assert.equal(
      await readFile(join(integrated.workspace, "new", "added.txt"), "utf8"),
      "added",
    );
    const dependent = await s.task("t3", ["a.txt"]);
    assert.equal(
      await readFile(join(dependent.value.workspace!, "__proto__"), "utf8"),
      "prototype file",
    );
    assert.equal(
      await readFile(join(dependent.value.workspace!, "constructor"), "utf8"),
      "constructor file",
    );
    assert.equal(
      await readFile(join(dependent.value.workspace!, "a.txt"), "utf8"),
      "new-a",
    );
    await writeFile(join(dependent.value.workspace!, "a.txt"), "dependent-a");
    await s.integration.accept(await dependent.finish());
    assert.deepEqual(integrated.taskIds, ["t1", "t2", "t3"]);
    assert.equal(await readFile(join(s.source, "a.txt"), "utf8"), "base-a");
    assert.equal(
      (await git(s.source, ["status", "--porcelain"])).toString(),
      "",
    );
    assert.equal(s.store.workspaceReferenced(integrated.workspace), true);
    await assert.rejects(
      s.manager.previewRemoval(integrated.origin.id),
      /tham chiếu/,
    );
  } finally {
    await s.cleanup();
  }
});

test("coordinator runs dependency tests on integrated source and reruns them after a fix", async () => {
  const s = await setup();
  try {
    s.run.settings.teamExecution = "isolated-pair";
    const make = (
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
      acceptance: [id + " test passes"],
      dependsOn,
    });
    let reviews = 0,
      active = 0,
      peak = 0,
      both!: () => void;
    const barrier = new Promise<void>((resolve) => {
      both = resolve;
    });
    const versions: string[] = [];
    await coordinate(
      s.run,
      async (task, prompt) => {
        if (task.kind === "plan")
          return JSON.stringify({
            blockedReason: null,
            testingReason: "",
            tasks: [
              make("t1", "be", "a.txt"),
              make("t2", "fe", "b.txt"),
              make("t3", "test", ".", ["t1", "t2"]),
            ],
          });
        if (task.kind === "review") {
          const criteria: { criterionId: string; criterion: string }[] =
            JSON.parse(prompt.split("Tiêu chí có ID: ")[1].split("\n")[0]);
          const refs = (
            JSON.parse(prompt.split("Evidence có sẵn: ")[1].split("\n")[0]) as {
              refs: EvidenceRef[];
            }
          ).refs;
          const testRef = refs.find(
            (ref) => ref.kind === "command" && ref.taskId === "t3",
          )!;
          assert.ok(testRef);
          return JSON.stringify({
            version: 2,
            status: reviews++ === 0 ? "fix" : "completed",
            summary: "Verified combined source",
            acceptance: criteria.map((criterion) => ({
              criterionId: criterion.criterionId,
              criterion: criterion.criterion,
              status: "passed",
              evidence: "Combined test",
              method: "command",
              refs: [testRef],
            })),
            fixes:
              reviews === 1
                ? [{ taskId: "t1", instructions: "Fix a again" }]
                : [],
            limitations: [],
          });
        }
        task.sessionId = task.id;
        if (task.role === "test") {
          assert.equal(
            await readFile(join(task.workspace!, "a.txt"), "utf8"),
            task.round ? "fixed-a" : "new-a",
          );
          assert.equal(
            await readFile(join(task.workspace!, "b.txt"), "utf8"),
            "new-b",
          );
          const version = sourceVersion(await snapshot(task.workspace!))!;
          versions.push(version);
          const output = "Actual fixture assertions passed";
          const artifactId = commandArtifactId(
            s.run.id,
            task.id,
            task.sessionId,
            "test",
          );
          s.store.evidence.saveCommand(s.run.id, artifactId, output);
          s.run.commands.push({
            taskId: task.id,
            sessionId: task.sessionId,
            sourceVersion: version,
            artifactId,
            artifactHash: createHash("sha256").update(output).digest("hex"),
            callId: "test",
            command: "fixture assertions",
            status: "completed",
            output,
            exitCode: 0,
          });
        } else {
          if (!task.round) {
            active++;
            peak = Math.max(active, peak);
            if (active === 2) both();
            await barrier;
            active--;
          }
          await writeFile(
            join(task.workspace!, task.allowedPaths[0]),
            task.round ? "fixed-a" : task.role === "be" ? "new-a" : "new-b",
          );
        }
        return "done";
      },
      () => s.store.updateRun(s.run),
      () => {},
      s.store.evidence,
      [],
      undefined,
      {
        prepare: async (task) => {
          const owned = await s.manager.create(s.run.projectId, s.source);
          task.workspace = owned.path;
          task.workspaceOrigin = {
            id: owned.id,
            source: s.source,
            baseHead: owned.head,
          };
          if (!s.run.tasks.includes(task)) s.run.tasks.push(task);
          s.store.updateRun(s.run);
          await s.integration.seed(owned);
        },
        stop: () => {},
        integrate: (task) => s.integration.accept(task),
        currentWorkspace: () => s.run.integration!.workspace,
      },
    );
    assert.equal(peak, 2);
    assert.equal(reviews, 2);
    assert.equal(s.run.state, "completed");
    assert.equal(s.run.review?.status, "completed");
    assert.equal(versions.length, 2);
    assert.notEqual(versions[0], versions[1]);
    assert.equal(versions[1], s.run.integration!.sourceVersion);
    assert.ok(
      s.run.tasks.some((t) => t.id === "t3-retry-1" && t.state === "completed"),
    );
    assert.equal(await readFile(join(s.source, "a.txt"), "utf8"), "base-a");
  } finally {
    await s.cleanup();
  }
});

test("divergent same-file edits report conflict without overwriting the first result or losing task files", async () => {
  const s = await setup();
  try {
    const a = await s.task("t1", ["a.txt"]),
      b = await s.task("t2", ["a.txt", "b.txt"]);
    await writeFile(join(a.value.workspace!, "a.txt"), "first");
    await writeFile(join(b.value.workspace!, "a.txt"), "second");
    await writeFile(join(b.value.workspace!, "b.txt"), "must not apply");
    await s.integration.accept(await a.finish());
    await assert.rejects(s.integration.accept(await b.finish()), /Xung đột/);
    assert.deepEqual(s.run.integration!.conflicts, ["a.txt"]);
    assert.equal(s.run.integration!.state, "conflict");
    await assert.rejects(s.integration.validate(), /không tự phát lại/);
    assert.equal(
      await readFile(join(s.run.integration!.workspace, "b.txt"), "utf8"),
      "base-b",
    );
    assert.equal(
      await readFile(join(s.run.integration!.workspace, "a.txt"), "utf8"),
      "first",
    );
    assert.equal(
      await readFile(join(b.value.workspace!, "a.txt"), "utf8"),
      "second",
    );
  } finally {
    await s.cleanup();
  }
});

test("integrated runs cannot replay recovery or queued work on original source; chat keeps result ownership", async () => {
  const s = await setup();
  const controller = new RunController(
    s.store,
    join(s.directory, "data"),
    () => undefined,
  );
  try {
    s.store.save(s.run.settings, undefined);
    s.run.state = "needs_input";
    s.store.updateRun(s.run);
    assert.throws(() => controller.retry(s.run.id), /Workspace/);
    await assert.rejects(controller.recovery(s.run.id), /Workspace/);
    const conversationId = s.store.run(s.run.id).conversationId!;
    const messages = s.store.conversations.get(conversationId).messages;
    assert.equal(
      messages.find((m) => m.role === "assistant")?.integrationId,
      s.run.integration!.origin.id,
    );
    const queued = s.store.queue.add({
      projectId: s.run.projectId,
      conversationId,
      prompt: "Continue",
      role: "be",
      mode: "team",
      settings: s.run.settings,
      state: "held",
      reason: "result",
      afterRunId: s.run.id,
    });
    assert.throws(() => controller.resume(queued.id), /source gốc/);
    assert.equal(s.store.queue.list().length, 1);
    assert.equal(
      (await git(s.source, ["status", "--porcelain"])).toString(),
      "",
    );
  } finally {
    await controller.shutdown();
    await s.cleanup();
  }
});

test("integration refuses edited captured output, ownership drift and symlink destinations", async () => {
  const s = await setup();
  try {
    const a = await s.task("t1", ["a.txt"]);
    await writeFile(join(a.value.workspace!, "a.txt"), "first");
    const task = await a.finish();
    await writeFile(join(a.value.workspace!, "a.txt"), "late edit");
    await assert.rejects(s.integration.accept(task), /đổi sau/);
    assert.equal(
      await readFile(join(s.run.integration!.workspace, "a.txt"), "utf8"),
      "base-a",
    );
    const b = await s.task("t2", ["new"]);
    await mkdir(join(b.value.workspace!, "new"));
    await writeFile(join(b.value.workspace!, "new", "x.txt"), "owned");
    await b.finish();
    const outside = join(s.directory, "outside");
    await mkdir(outside);
    await symlink(
      outside,
      join(s.run.integration!.workspace, "new"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(s.integration.accept(b.value));
    await assert.rejects(readFile(join(outside, "x.txt")));
    await git(a.value.workspace!, ["worktree", "unlock", a.value.workspace!]);
    await assert.rejects(
      s.manager.verifyTask(
        a.value.workspaceOrigin!.id,
        a.value.workspaceOrigin!.baseHead,
      ),
      /Ownership/,
    );
  } finally {
    await s.cleanup();
  }
});

test("interrupted integration retains partial bytes and ownership and refuses automatic replay", async () => {
  const s = await setup();
  try {
    const task = await s.task("t1", ["a.txt", "b.txt"]);
    await writeFile(join(task.value.workspace!, "a.txt"), "new-a");
    await writeFile(join(task.value.workspace!, "b.txt"), "new-b");
    const result = await task.finish();
    const integration = new Integration(
      s.store,
      s.manager,
      s.run,
      () => {
        throw new Error("must retain original integration");
      },
      () => {
        if (
          readFileSync(join(s.run.integration!.workspace, "a.txt"), "utf8") ===
          "new-a"
        )
          throw new Error("Stop requested");
      },
      () => s.store.updateRun(s.run),
    );
    await assert.rejects(integration.accept(result), /Stop requested/);
    assert.equal(s.run.integration!.state, "conflict");
    assert.equal(
      await readFile(join(s.run.integration!.workspace, "a.txt"), "utf8"),
      "new-a",
    );
    assert.equal(
      await readFile(join(s.run.integration!.workspace, "b.txt"), "utf8"),
      "base-b",
    );
    assert.deepEqual(s.run.integration!.taskIds, []);
    assert.equal(
      s.store.workspaceReferenced(s.run.integration!.workspace),
      true,
    );
    await assert.rejects(s.integration.accept(result), /không tự phát lại/);
    assert.equal(await readFile(join(s.source, "a.txt"), "utf8"), "base-a");
  } finally {
    await s.cleanup();
  }
});
