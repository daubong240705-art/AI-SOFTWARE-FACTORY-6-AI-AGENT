import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { Worktrees } from "../electron/workspace/worktrees";
import { git } from "../electron/workspace/git-evidence";
import { Store } from "../electron/storage/database";
import { RunController } from "../electron/controller/runs";
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "asf-worktrees-")),
    repo = join(directory, "repository"),
    data = join(directory, "data"),
    projectId = randomUUID();
  await mkdir(join(repo, "app"), { recursive: true });
  await writeFile(join(repo, "app", "source.txt"), "baseline");
  await writeFile(join(repo, ".gitignore"), "cache/\n");
  await git(repo, ["init"]);
  await git(repo, ["config", "user.email", "fixture@example.invalid"]);
  await git(repo, ["config", "user.name", "Fixture"]);
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "baseline"]);
  const manager = new Worktrees(data);
  return {
    directory,
    repo,
    data,
    projectId,
    manager,
    async cleanup() {
      assert.ok(directory.startsWith(join(tmpdir(), "asf-worktrees-")));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
test("worktrees isolate source and index, preserve monorepo project scope, use detached locked HEAD and reopen", async () => {
  const s = await setup();
  try {
    const before = (await git(s.repo, ["rev-parse", "HEAD"])).toString().trim();
    const value = await s.manager.create(s.projectId, join(s.repo, "app"));
    assert.equal(value.head, before);
    assert.equal(
      await readFile(join(value.path, "source.txt"), "utf8"),
      "baseline",
    );
    await writeFile(join(value.path, "source.txt"), "isolated edit");
    await git(value.path, ["add", "source.txt"]);
    assert.equal(
      await readFile(join(s.repo, "app", "source.txt"), "utf8"),
      "baseline",
    );
    assert.equal((await git(s.repo, ["status", "--porcelain"])).toString(), "");
    const reopened = new Worktrees(s.data);
    assert.equal((await reopened.list(s.projectId))[0].id, value.id);
    assert.equal((await reopened.open(value.id)).path, value.path);
    assert.match(
      (await git(s.repo, ["worktree", "list", "--porcelain"])).toString(),
      /detached[\s\S]*locked ASF workspace/,
    );
    await assert.rejects(reopened.previewRemoval(value.id), /file sửa/);
  } finally {
    await s.cleanup();
  }
});
test("dirty, unborn and non-Git sources are rejected without touching caller source", async () => {
  const s = await setup();
  try {
    await writeFile(join(s.repo, "untracked.txt"), "user data");
    await assert.rejects(s.manager.create(s.projectId, s.repo), /chưa commit/);
    assert.equal(
      await readFile(join(s.repo, "untracked.txt"), "utf8"),
      "user data",
    );
    await assert.rejects(s.manager.create(s.projectId, s.directory), /Git/);
    const empty = join(s.directory, "empty");
    await mkdir(empty);
    await git(empty, ["init"]);
    await assert.rejects(s.manager.create(s.projectId, empty), /Git/);
    assert.deepEqual(await s.manager.list(s.projectId), []);
  } finally {
    await s.cleanup();
  }
});
test("cleanup previews are one-time, refuse changed/ignored files, new commits and foreign locks", async () => {
  const s = await setup();
  try {
    const value = await s.manager.create(s.projectId, s.repo),
      preview = await s.manager.previewRemoval(value.id);
    await writeFile(join(value.path, "late.txt"), "keep");
    await assert.rejects(s.manager.remove(preview.token), /file sửa/);
    await assert.rejects(s.manager.remove(preview.token), /hết hạn/);
    await unlink(join(value.path, "late.txt"));
    await mkdir(join(value.path, "cache"));
    await writeFile(join(value.path, "cache", "artifact"), "keep ignored");
    await assert.rejects(s.manager.previewRemoval(value.id), /ignored/);
    await rm(join(value.path, "cache"), { recursive: true });
    await writeFile(join(value.path, "commit.txt"), "new commit");
    await git(value.path, ["add", "."]);
    await git(value.path, ["commit", "-m", "owned changes"]);
    await assert.rejects(s.manager.previewRemoval(value.id), /commit\/branch/);
    await git(s.repo, ["worktree", "unlock", value.path]);
    await git(s.repo, [
      "worktree",
      "lock",
      "--reason",
      "foreign owner",
      value.path,
    ]);
    await assert.rejects(s.manager.recover(value.id), /Ownership lock/);
    assert.equal(
      await readFile(join(value.path, "commit.txt"), "utf8"),
      "new commit",
    );
  } finally {
    await s.cleanup();
  }
});
test("clean worktree removal touches no foreign worktree and no source branch/index", async () => {
  const s = await setup();
  try {
    const value = await s.manager.create(s.projectId, s.repo);
    const foreign = join(s.directory, "foreign");
    await git(s.repo, ["worktree", "add", "--detach", foreign, "HEAD"]);
    const preview = await s.manager.previewRemoval(value.id);
    await s.manager.remove(preview.token);
    assert.deepEqual(await s.manager.list(s.projectId), []);
    assert.equal(
      await readFile(join(foreign, "app", "source.txt"), "utf8"),
      "baseline",
    );
    assert.equal((await git(s.repo, ["status", "--porcelain"])).toString(), "");
  } finally {
    await s.cleanup();
  }
});
test("recovery recognizes creating manifest and re-locks an interrupted cleanup without resetting edits", async () => {
  const s = await setup();
  try {
    const value = await s.manager.create(s.projectId, s.repo);
    const manifest = join(dirname(value.path), "manifest.json");
    await writeFile(manifest, JSON.stringify({ ...value, state: "creating" }));
    await git(s.repo, ["worktree", "unlock", value.path]);
    const reopened = new Worktrees(s.data);
    assert.equal((await reopened.list(s.projectId))[0].state, "retained");
    assert.equal((await reopened.recover(value.id)).state, "ready");
    assert.equal((await reopened.open(value.id)).id, value.id);
    const preview = await reopened.previewRemoval(value.id);
    await reopened.remove(preview.token);
  } finally {
    await s.cleanup();
  }
});
test("registered project and historical run references protect worktree data", async () => {
  const s = await setup();
  const store = new Store(s.data);
  try {
    const manager = new Worktrees(s.data, (path) =>
      store.workspaceReferenced(path),
    );
    const value = await manager.create(s.projectId, s.repo);
    const project = store.addProject(join(value.path, "app"));
    await assert.rejects(manager.previewRemoval(value.id), /tham chiếu/);
    store.removeProject(project.id);
    const preview = await manager.previewRemoval(value.id);
    await manager.remove(preview.token);
  } finally {
    store.close();
    await s.cleanup();
  }
});

test("create is exclusive; checkout hooks never execute and external Git filters/submodules are rejected", async () => {
  const s = await setup();
  try {
    const hook = join(s.repo, ".git", "hooks", "post-checkout");
    await writeFile(hook, "#!/bin/sh\nprintf unsafe > hook-executed\n", {
      mode: 0o755,
    });
    const pending = s.manager.create(s.projectId, s.repo);
    await assert.rejects(s.manager.create(s.projectId, s.repo), /Đang xử lý/);
    const value = await pending;
    await assert.rejects(readFile(join(value.path, "hook-executed")));
    await assert.rejects(readFile(join(s.repo, "hook-executed")));
    await git(s.repo, ["config", "filter.custom.smudge", "echo unsafe"]);
    await writeFile(join(s.repo, ".gitattributes"), "*.txt filter=custom\n");
    await git(s.repo, ["add", ".gitattributes"]);
    await git(s.repo, ["commit", "-m", "filter fixture"]);
    await assert.rejects(s.manager.create(s.projectId, s.repo), /filter/);
    await git(s.repo, ["config", "--unset", "filter.custom.smudge"]);
    await unlink(join(s.repo, ".gitattributes"));
    await git(s.repo, ["add", ".gitattributes"]);
    await git(s.repo, ["commit", "-m", "remove filter fixture"]);
    const head = (await git(s.repo, ["rev-parse", "HEAD"])).toString().trim();
    await git(s.repo, [
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${head},vendor/sub`,
    ]);
    await git(s.repo, ["commit", "-m", "gitlink fixture"]);
    await mkdir(join(s.repo, "vendor", "sub"), { recursive: true });
    await assert.rejects(s.manager.create(s.projectId, s.repo), /submodule/);
  } finally {
    await s.cleanup();
  }
});

test("missing interrupted creation can clean only its manifest, and references protect all history beyond 50 runs", async () => {
  const s = await setup();
  const store = new Store(s.data);
  try {
    const value = await s.manager.create(s.projectId, s.repo),
      manifest = join(dirname(value.path), "manifest.json");
    await git(s.repo, ["worktree", "unlock", value.path]);
    await git(s.repo, ["worktree", "remove", value.path]);
    await writeFile(manifest, JSON.stringify({ ...value, state: "creating" }));
    const reopened = new Worktrees(s.data);
    assert.equal((await reopened.recover(value.id)).state, "missing");
    const preview = await reopened.previewRemoval(value.id);
    await reopened.remove(preview.token);
    assert.deepEqual(await reopened.list(s.projectId), []);
    const settings = store.settings();
    const { normalizeRun } = await import("../shared/runs");
    for (let i = 0; i < 55; i++) {
      store.createRun(
        normalizeRun({
          id: randomUUID(),
          projectId: s.projectId,
          projectName: "fixture",
          workspace: i === 0 ? join(s.directory, "referenced", "app") : s.repo,
          prompt: "fixture",
          role: "be",
          mode: "direct",
          tasks: [],
          profiles: [],
          currentTaskId: null,
          fixRound: 0,
          review: null,
          model: "fixture",
          state: "completed",
          createdAt: `2020-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
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
          inputTokens: 0,
          outputTokens: 0,
          toolsCompleted: 0,
          runtimeVersion: "",
          baselineComplete: true,
        } as import("../shared/runs").Run),
      );
    }
    assert.equal(
      store.workspaceReferenced(join(s.directory, "referenced")),
      true,
    );
    assert.equal(
      store.workspaceReferenced(join(s.directory, "referenced-other")),
      false,
    );
  } finally {
    store.close();
    await s.cleanup();
  }
});
test("manifest path traversal or junction replacement never adopts/removes outside directories", async () => {
  const s = await setup();
  try {
    const value = await s.manager.create(s.projectId, s.repo);
    const manifest = join(dirname(value.path), "manifest.json");
    await writeFile(manifest, JSON.stringify({ ...value, path: s.repo }));
    await assert.rejects(s.manager.open(value.id), /ngoài/);
    assert.deepEqual(await s.manager.list(s.projectId), []);
    await writeFile(manifest, JSON.stringify(value));
    const tree = value.path;
    await git(s.repo, ["worktree", "unlock", tree]);
    await git(s.repo, ["worktree", "remove", tree]);
    await symlink(
      s.repo,
      tree,
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(s.manager.previewRemoval(value.id));
    assert.equal(
      await readFile(join(s.repo, "app", "source.txt"), "utf8"),
      "baseline",
    );
  } finally {
    await s.cleanup();
  }
});

test("Controller validates owned source before runtime and persists workspace provenance; invalid ownership sends no model requests", async () => {
  const s = await setup();
  const store = new Store(s.data);
  let controller: RunController | undefined;
  try {
    const value = await s.manager.create(s.projectId, s.repo),
      project = store.addProject(value.path),
      settings = store.settings();
    settings.gatewayUrl = "https://unused.example/v1";
    settings.runtimePath = join(s.directory, "missing-runtime.exe");
    settings.agents.forEach((a) => {
      a.model = "fixture";
    });
    store.save(settings, undefined);
    controller = new RunController(store, s.data, () => undefined);
    const first = controller.start(project.id, "Read source", "be");
    while (controller.isBusy()) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(store.run(first.id).workspaceOrigin, {
      id: value.id,
      source: s.repo,
      baseHead: value.head,
    });
    assert.equal(store.run(first.id).requests, 0);
    assert.equal(await new Worktrees(s.data).owner(s.repo), null);
    await git(s.repo, ["worktree", "unlock", value.path]);
    await git(s.repo, ["worktree", "lock", "--reason", "foreign", value.path]);
    const second = controller.start(project.id, "Read source", "be");
    while (controller.isBusy()) await new Promise((r) => setTimeout(r, 10));
    assert.equal(store.run(second.id).state, "failed");
    assert.match(store.run(second.id).error, /Ownership lock/);
    assert.equal(store.run(second.id).requests, 0);
  } finally {
    await controller?.shutdown();
    store.close();
    await s.cleanup();
  }
});
