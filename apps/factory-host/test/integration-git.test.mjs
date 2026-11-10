import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import { INTEGRATION_BRANCH, integrationExists, mergeIntoIntegration, runGit, validateRoots, createWorktree, checkpoint, WorkspaceError } from "../dist/workspace/index.js";
import { createWorkspaceProvider } from "../dist/dispatch/workspace-provider.js";
import { createFakeRuntime } from "../dist/dispatch/index.js";
import { integrationFixture, success } from "./integration-fixture.mjs";

const integration = (name, fn) => test(name, { skip: process.platform !== "linux" && "Workspace integration requires Linux/ext4 and /usr/bin/git", timeout: 60_000 }, fn);
async function gitFixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "factory-integration-")));
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(fs.realpathSync(tmpdir())) + sep + "factory-integration-")); fs.rmSync(root, { recursive: true, force: true }); });
  const roots = validateRoots({ projectsRoot: join(root, "projects"), worktreesRoot: join(root, "worktrees") });
  const projectRoot = join(roots.projectsRoot, "project"); fs.mkdirSync(projectRoot);
  const git = async args => (await runGit(projectRoot, args)).stdout.trim();
  await git(["init", "--initial-branch=main", "--template="]);
  await git(["config", "user.name", "Fixture User"]); await git(["config", "user.email", "fixture@localhost"]);
  fs.writeFileSync(join(projectRoot, "base.txt"), "base\n"); await checkpoint(projectRoot, "Base");
  const base = await git(["rev-parse", "HEAD"]);
  let next = 0;
  const branch = async (name = `factory/task-${++next}`, file = `file-${next}.txt`, content = "accepted\n") => {
    const work = await createWorktree(roots, { projectRoot, projectSlug: "project", taskCode: `TSK-${String(++next).padStart(3, "0")}`, epoch: 1, startFromBranch: undefined, preferIntegration: false });
    fs.writeFileSync(join(work.path, file), content); await checkpoint(work.path, "Task work");
    const tip = (await runGit(work.path, ["rev-parse", "HEAD"])).stdout.trim();
    await git(["branch", name, tip]); return { ...work, branch: name, tip };
  };
  const merge = taskBranch => mergeIntoIntegration(roots, { projectRoot, taskBranch, message: "Accepted task" });
  return { root, roots, projectRoot, git, base, branch, merge };
}
integration("integration branch is absent initially", async t => { const f = await gitFixture(t); assert.equal(await integrationExists(f.roots, f.projectRoot), false); });
integration("branch is created at HEAD even when the task is identical", async t => {
  const f = await gitFixture(t); await f.git(["branch", "factory/empty", f.base]); const r = await f.merge("factory/empty");
  assert.deepEqual(r, { outcome: "merged", sha: f.base }); assert.equal(await integrationExists(f.roots, f.projectRoot), true);
});
integration("clean merge includes accepted content", async t => {
  const f = await gitFixture(t), task = await f.branch("factory/first", "first.txt"); const r = await f.merge(task.branch);
  assert.equal(r.outcome, "merged"); assert.equal(await f.git(["show", `${INTEGRATION_BRANCH}:first.txt`]), "accepted");
  assert.equal(await f.git(["rev-parse", "HEAD"]), f.base); assert.equal(fs.existsSync(join(f.projectRoot, "first.txt")), false);
});
integration("second non-overlapping branch preserves both tasks", async t => {
  const f = await gitFixture(t), first = await f.branch("factory/first", "first.txt"), second = await f.branch("factory/second", "second.txt");
  await f.merge(first.branch); const r = await f.merge(second.branch); assert.equal(r.outcome, "merged");
  assert.equal(await f.git(["show", `${INTEGRATION_BRANCH}:first.txt`]), "accepted"); assert.equal(await f.git(["show", `${INTEGRATION_BRANCH}:second.txt`]), "accepted");
});
integration("merge commit has exactly the pinned integration and task parents", async t => {
  const f = await gitFixture(t), task = await f.branch(); const r = await f.merge(task.branch); assert.equal(r.outcome, "merged");
  assert.equal(await f.git(["show", "-s", "--format=%P", r.sha]), `${f.base} ${task.tip}`);
});
integration("merge identity explicitly overrides the repository user identity", async t => {
  const f = await gitFixture(t), task = await f.branch(); const r = await f.merge(task.branch);
  assert.equal(await f.git(["show", "-s", "--format=%an <%ae>|%cn <%ce>", r.sha]), "Factory <factory@localhost>|Factory <factory@localhost>");
  assert.equal(await f.git(["config", "user.name"]), "Fixture User");
});
integration("same resulting tree returns the old tip without a commit", async t => {
  const f = await gitFixture(t), task = await f.branch(); const first = await f.merge(task.branch), count = await f.git(["rev-list", "--count", INTEGRATION_BRANCH]);
  assert.deepEqual(await f.merge(task.branch), first); assert.equal(await f.git(["rev-list", "--count", INTEGRATION_BRANCH]), count);
});
integration("merge conflict leaves integration tip and working tree untouched", async t => {
  const f = await gitFixture(t), one = await f.branch("factory/one", "base.txt", "one\n"), two = await f.branch("factory/two", "base.txt", "two\n");
  const first = await f.merge(one.branch); assert.deepEqual(await f.merge(two.branch), { outcome: "conflict" });
  assert.equal(await f.git(["rev-parse", INTEGRATION_BRANCH]), first.sha); assert.equal(fs.readFileSync(join(f.projectRoot, "base.txt"), "utf8"), "base\n"); assert.equal(await f.git(["status", "--porcelain"]), "");
});
integration("CAS refuses a concurrently moved integration tip with git-failed", async t => {
  const f = await gitFixture(t), task = await f.branch(); await f.git(["branch", INTEGRATION_BRANCH, f.base]);
  const original = childProcess.spawn; let moved = false;
  t.mock.method(childProcess, "spawn", (command, args, options) => {
    const i = args.indexOf("update-ref");
    if (!moved && i >= 0 && args[i + 1] === `refs/heads/${INTEGRATION_BRANCH}` && args[i + 3] === f.base) {
      moved = true; const movedArgs = [...args]; movedArgs[i + 2] = task.tip; movedArgs.splice(i + 3, 1);
      assert.equal(childProcess.spawnSync(command, movedArgs, options).status, 0);
    }
    return original(command, args, options);
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(f.merge(task.branch), e => e instanceof WorkspaceError && e.code === "git-failed");
  assert.equal(moved, true); assert.equal(await f.git(["rev-parse", INTEGRATION_BRANCH]), task.tip);
});
for (const branch of ["main", "", "--all", "factory/../escape", "factory/work..bad", "factory/bad name", "factory/bad\0name", "factory/branch.lock"]) integration(`merge refuses invalid task branch ${JSON.stringify(branch)}`, async t => {
  const f = await gitFixture(t); await assert.rejects(f.merge(branch)); assert.equal(await integrationExists(f.roots, f.projectRoot), false);
});
integration("unknown factory branch reports git-failed", async t => { const f = await gitFixture(t); await assert.rejects(f.merge("factory/missing"), e => e.code === "git-failed"); });
integration("first worktree starts at integration tip", async t => {
  const f = await gitFixture(t), task = await f.branch("factory/accepted", "accepted.txt"), r = await f.merge(task.branch);
  const work = await createWorktree(f.roots, { projectRoot: f.projectRoot, projectSlug: "later", taskCode: "TSK-100", epoch: 1 });
  assert.equal(work.baseSha, r.sha); assert.equal(fs.readFileSync(join(work.path, "accepted.txt"), "utf8"), "accepted\n");
});
integration("provider epoch one starts from integration", async t => {
  const f = await gitFixture(t), task = await f.branch(), r = await f.merge(task.branch), provider = createWorkspaceProvider({ roots: f.roots, evidenceDir: join(f.root, "evidence") });
  const work = await provider.prepare({ projectId: randomUUID(), taskCode: "TSK-100", epoch: 1, projectRoot: f.projectRoot, startFromBranch: null }); assert.equal(work.baseSha, r.sha);
});
integration("rerun continues its previous task branch despite newer integration", async t => {
  const f = await gitFixture(t), previous = await f.branch("factory/previous", "previous.txt"), accepted = await f.branch("factory/accepted", "accepted.txt"); await f.merge(accepted.branch);
  const provider = createWorkspaceProvider({ roots: f.roots, evidenceDir: join(f.root, "evidence") });
  const work = await provider.prepare({ projectId: randomUUID(), taskCode: "TSK-100", epoch: 2, projectRoot: f.projectRoot, startFromBranch: previous.branch });
  assert.equal(work.baseSha, previous.tip); assert.equal(fs.existsSync(join(work.path, "previous.txt")), true); assert.equal(fs.existsSync(join(work.path, "accepted.txt")), false);
});
integration("no integration branch still starts from HEAD", async t => {
  const f = await gitFixture(t); const work = await createWorktree(f.roots, { projectRoot: f.projectRoot, projectSlug: "later", taskCode: "TSK-100", epoch: 1 }); assert.equal(work.baseSha, f.base);
});
integration("real accepted dependency merges before the later task workspace is prepared", async t => {
  const git = await gitFixture(t), provider = createWorkspaceProvider({ roots: git.roots, evidenceDir: join(git.root, "evidence") });
  const runtime = createFakeRuntime({ stepMs: 0 });
  // Use the actual dispatcher, runtime workspace, acceptance command, worker, and provider.
  const f = integrationFixture(t, { workspace: provider, runtime, projectRootFor: () => git.projectRoot });
  const first = f.task({ state: "in-review" }), work = await provider.prepare({ projectId: f.projectId, taskCode: f.getTask(first).code,
    epoch: 1, projectRoot: git.projectRoot, startFromBranch: null });
  fs.writeFileSync(join(work.path, "accepted-first.txt"), "first task accepted\n"); await checkpoint(work.path, "First task result");
  const attempt = f.attempt(first, { branch: work.branch });
  const { requestTaskReview } = await import("../dist/approvals/service.js");
  const approval = f.hub.transaction(() => requestTaskReview({ raw: f.raw, hub: f.hub, now: f.clock, newId: randomUUID }, { projectId: f.projectId, taskId: first, attemptId: attempt }));
  const later = f.task({ state: "accepted", dependsOn: [first], requiresGo: false }); success(f.accept(first, approval));
  assert.equal(f.row(first).state, "pending"); await f.dispatcher.idle(); assert.equal(f.row(first).state, "merged");
  const context = runtime.started.find(x => x.task.id === later); assert.ok(context?.workspace);
  assert.equal(context.workspace.baseSha, f.row(first).merge_sha); assert.equal(fs.readFileSync(join(context.workspace.path, "accepted-first.txt"), "utf8"), "first task accepted\n");
});
