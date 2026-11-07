import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { openStorage } from "../dist/storage/database.js";
import { EventHub } from "../dist/events/hub.js";
import { appendAttemptEvent } from "../dist/dispatch/attempts.js";
import { createEffectExecutor } from "../dist/effects/executor.js";
import { runToCompletion } from "../dist/exec/process-group.js";
import { assertInside, runGit, cloneProject, createWorktree, checkpoint } from "../dist/workspace/index.js";

const integration = (name, fn) => test(name, {
  skip: process.platform !== "linux" && "Workspace integration requires Linux/ext4 and /usr/bin/git", timeout: 60_000,
}, fn);
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const digest = (text) => createHash("sha256").update(text).digest("hex");
const clock = () => new Date("2026-11-08T00:00:00.000Z");
function treeHash(root) {
  const hash = createHash("sha256");
  const visit = (directory) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const path = assertInside(root, join(directory, name)); hash.update(path.slice(root.length));
      if (fs.lstatSync(path).isDirectory()) visit(path); else hash.update(fs.readFileSync(path));
    }
  };
  visit(root); return hash.digest("hex");
}
async function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "factory-effect-git-")));
  const executors = []; let storage;
  t.after(async () => {
    for (const executor of executors) await executor.close(); storage?.close();
    fs.rmSync(assertInside(fs.realpathSync(tmpdir()), root), { recursive: true, force: true });
  });
  const source = join(root, "source"); fs.mkdirSync(source);
  await runGit(source, ["init", "--initial-branch=main", "--template="]);
  await runGit(source, ["config", "user.name", "Fixture"]);
  await runGit(source, ["config", "user.email", "fixture@localhost"]);
  fs.writeFileSync(join(source, "base.txt"), "base\n"); await checkpoint(source, "base");
  const remote = join(root, "remote.git"); fs.mkdirSync(remote);
  await runGit(remote, ["init", "--bare", "--initial-branch=main", "--template="]);
  const url = pathToFileURL(remote).href;
  await runGit(source, ["push", url, "refs/heads/main:refs/heads/main", "refs/heads/main:refs/heads/untouched"]);
  const sourceHash = treeHash(source);
  const roots = { projectsRoot: join(root, "projects"), worktreesRoot: join(root, "worktrees") };
  const clone = await cloneProject(roots, { name: "Effect project", source });
  storage = openStorage(":memory:"); storage.migrate({ migrationsDir, backupDir: null });
  const raw = storage.raw; const hub = new EventHub(raw, { clock }); const projectId = randomUUID();
  raw.prepare("INSERT INTO projects VALUES (?, 1, 'Effect project', 'git', ?, 'active')").run(projectId, clone.root);
  hub.ensureStream(projectId); let count = 0;
  const attempt = async () => {
    const taskId = randomUUID(); const attemptId = randomUUID(); const code = `PUSH-${String(++count).padStart(3, "0")}`;
    const workspace = await createWorktree(roots, { projectRoot: clone.root, projectSlug: clone.slug, taskCode: code, epoch: 1 });
    fs.writeFileSync(join(workspace.path, `result-${count}.txt`), `result ${count}\n`);
    await checkpoint(workspace.path, "attempt result");
    const tipSha = (await runGit(clone.root, ["rev-parse", "--verify", `refs/heads/${workspace.branch}`])).stdout.trim();
    raw.prepare(`INSERT INTO tasks (project_id,id,revision,code,title,goal,brief,origin_kind,state,required_capabilities_json,acceptance_json,inputs_json)
      VALUES (?, ?, 1, ?, 'Result', 'Deliver result', '', 'operator', 'done', '[]', '[]', '[]')`).run(projectId, taskId, code);
    raw.prepare(`INSERT INTO attempts (project_id,id,task_id,revision,epoch,state,outcome,runtime,provider,model,effort,ended_at)
      VALUES (?, ?, ?, 1, 1, 'succeeded', 'known', 'fake', 'fake', 'fake', 'low', ?)`)
      .run(projectId, attemptId, taskId, clock().toISOString());
    appendAttemptEvent(raw, { projectId, attemptId, kind: "state", at: clock().toISOString(),
      body: { to: "workspace-ready", branch: workspace.branch, baseSha: workspace.baseSha } });
    return { ...workspace, attemptId, taskId, tipSha };
  };
  const make = (options = {}) => {
    const executor = createEffectExecutor({ raw, hub, clock, newId: randomUUID,
      remotes: [{ name: "operator", url }], projectRootFor: () => clone.root, ...options });
    executors.push(executor); return executor;
  };
  const executor = make(); const first = await attempt();
  const push = (a = first, e = executor) => e.requestPush({ projectId, attemptId: a.attemptId, remote: "operator" });
  const refs = async () => (await runGit(remote, ["for-each-ref", "--format=%(objectname) %(refname)"])).stdout.trim().split("\n").sort();
  const before = await refs();
  const seedPending = (a = first) => {
    const id = randomUUID();
    raw.prepare("INSERT INTO effects VALUES (?, ?, ?, 'git.push-branch', ?, ?, 'pending', NULL, ?, NULL)")
      .run(projectId, id, a.attemptId, digest(`pending-${id}`), JSON.stringify({ remote: "operator", branch: a.branch,
        tipSha: a.tipSha, remoteDigest: digest(url) }), clock().toISOString());
    return id;
  };
  const privateView = () => {
    const rows = raw.prepare("SELECT * FROM effects").all(); const events = raw.prepare("SELECT body_json FROM event_log").all();
    const text = JSON.stringify({ rows, events, views: executor.listEffects(projectId) });
    assert.equal(text.includes(url), false); assert.equal(text.includes(root), false);
  };
  return { root, source, sourceHash, roots, clone, remote, url, raw, hub, projectId, executor, first,
    attempt, make, push, refs, before, seedPending, privateView };
}

integration("real push publishes exactly the accepted attempt branch", async (t) => {
  const f = await fixture(t); const effect = await f.push();
  assert.equal(effect.state, "done"); assert.equal(effect.remote, "operator");
  assert.deepEqual(await f.refs(), [...f.before, `${f.first.tipSha} refs/heads/${f.first.branch}`].sort());
  const row = f.raw.prepare("SELECT * FROM effects").get(); assert.equal(JSON.parse(row.target_json).tipSha, f.first.tipSha);
  assert.equal((await runGit(f.clone.root, ["config", "--get", "remote.origin.pushurl"])).stdout.trim(), "no-push://disabled");
  assert.equal(treeHash(f.source), f.sourceHash); f.privateView();
});
integration("real push is idempotent after completion", async (t) => {
  const f = await fixture(t); const first = await f.push(); const refs = await f.refs(); const again = await f.push();
  assert.equal(first.state, "done"); assert.deepEqual(again, first); assert.deepEqual(await f.refs(), refs);
  assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM effects").get().n, 1);
});
integration("independent accepted attempts publish independently", async (t) => {
  const f = await fixture(t); const second = await f.attempt();
  const effects = await Promise.all([f.push(), f.push(second)]); assert.deepEqual(effects.map((effect) => effect.state), ["done", "done"]);
  assert.deepEqual(await f.refs(), [...f.before, `${f.first.tipSha} refs/heads/${f.first.branch}`, `${second.tipSha} refs/heads/${second.branch}`].sort());
  assert.equal(treeHash(f.source), f.sourceHash);
});
integration("divergent remote history is rejected without changing any remote ref", async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(join(f.source, "divergent.txt"), "independent history\n"); await checkpoint(f.source, "independent commit");
  await runGit(f.source, ["push", f.url, `refs/heads/main:refs/heads/${f.first.branch}`]);
  const before = await f.refs(); const effect = await f.push();
  assert.equal(effect.state, "failed"); assert.equal(effect.error, "rejected"); assert.deepEqual(await f.refs(), before); f.privateView();
});
integration("missing remote is a classified failure with no published data", async (t) => {
  const f = await fixture(t); const missing = pathToFileURL(join(f.root, "missing.git")).href;
  const executor = f.make({ remotes: [{ name: "operator", url: missing }] }); const effect = await f.push(f.first, executor);
  assert.equal(effect.state, "failed"); assert.ok(["network", "other"].includes(effect.error)); assert.deepEqual(await f.refs(), f.before);
  f.privateView(); assert.equal(JSON.stringify(f.raw.prepare("SELECT * FROM effects").all()).includes(missing), false);
});
integration("project pre push hooks cannot execute during publication", async (t) => {
  const f = await fixture(t); const marker = join(f.root, "hook-marker"); const hooks = join(f.clone.root, ".git", "hooks");
  fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(join(hooks, "pre-push"), `#!/bin/sh\nprintf forbidden > '${marker}'\n`, { mode: 0o700 });
  assert.equal((await f.push()).state, "done"); assert.equal(fs.existsSync(marker), false);
  assert.equal(treeHash(f.source), f.sourceHash);
});
integration("crash recovery reconciles an already published branch", async (t) => {
  const f = await fixture(t); await runGit(f.clone.root, ["push", f.url, `refs/heads/${f.first.branch}:refs/heads/${f.first.branch}`]);
  const id = f.seedPending(); f.executor.recoverAtStart();
  assert.equal(f.executor.getEffect(f.projectId, id).state, "unknown");
  assert.equal((await f.push()).id, id); assert.equal((await f.executor.reconcile({ projectId: f.projectId, effectId: id })).state, "done");
  f.privateView();
});
integration("crash recovery reconciles an absent branch before permitting a new push", async (t) => {
  const f = await fixture(t); const id = f.seedPending(); f.executor.recoverAtStart();
  const effect = await f.executor.reconcile({ projectId: f.projectId, effectId: id });
  assert.equal(effect.state, "failed"); assert.equal(effect.error, "not-pushed");
  const pushed = await f.push(); assert.equal(pushed.state, "done"); assert.notEqual(pushed.id, id); f.privateView();
});
integration("uncertain process completion is resolved against the actual remote", async (t) => {
  const f = await fixture(t); const executor = f.make({ runGit: async (options) => {
    const result = await runToCompletion(options);
    if (options.args.includes("push")) throw new Error("synthetic completion interruption");
    return result;
  } });
  const effect = await f.push(f.first, executor); assert.equal(effect.state, "unknown");
  assert.deepEqual(await executor.requestPush({ projectId: f.projectId, attemptId: f.first.attemptId, remote: "operator" }), effect);
  assert.equal((await executor.reconcile({ projectId: f.projectId, effectId: effect.id })).state, "done");
  assert.deepEqual(await f.refs(), [...f.before, `${f.first.tipSha} refs/heads/${f.first.branch}`].sort()); f.privateView();
});
integration("destination rewriting configuration is refused before recording an effect", async (t) => {
  const f = await fixture(t); await runGit(f.clone.root, ["config", "--local", "url.ssh://unconfigured.invalid/.pushInsteadOf", "file:///"]);
  await assert.rejects(f.push(), (error) => error.code === "workspace-unavailable");
  assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM effects").get().n, 0); assert.deepEqual(await f.refs(), f.before);
});
