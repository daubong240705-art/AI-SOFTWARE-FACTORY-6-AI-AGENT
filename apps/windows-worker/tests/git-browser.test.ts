import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readFile,
  unlink,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { git } from "../electron/workspace/git-evidence";
import { browseGit, browseGitDiff } from "../electron/workspace/git-browser";
import { Store } from "../electron/storage/database";

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "asf-git-browser-"));
  const repo = join(directory, "repo"),
    subdir = join(repo, "app"),
    data = join(directory, "data");
  await mkdir(subdir, { recursive: true });
  await writeFile(join(repo, ".gitignore"), "ignored.txt\n");
  await writeFile(join(repo, "app", "main.txt"), "one\ntwo\n");
  await writeFile(join(repo, "ignored.txt"), "ignored\n");
  await git(repo, ["init"]);
  await git(repo, ["config", "user.email", "fixture@example.invalid"]);
  await git(repo, ["config", "user.name", "Fixture"]);
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "Initial"]);
  const store = new Store(data),
    project = store.addProject(subdir);
  const cleanup = async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  };
  return { directory, repo, subdir, project, store, cleanup };
}

test("Git browser scopes a monorepo project, excludes ignored files, links W codes and paginates history", async () => {
  const x = await setup();
  try {
    const item = x.store.board.create({
      projectId: x.project.id,
      title: "Link",
      body: "",
      criteria: [],
      suggestedRole: null,
      planningState: "backlog",
      priority: 0,
    });
    const initial = await browseGit(x.subdir, {
      projectId: x.project.id,
      offset: 0,
    });
    assert.equal(initial.available, true);
    assert.ok(initial.branch);
    assert.equal(initial.files.length, 0);
    assert.equal(initial.commits.length, 1);
    await writeFile(join(x.subdir, "main.txt"), "one\nchanged\n");
    await writeFile(join(x.subdir, "new.txt"), "new\n");
    let current = await browseGit(x.subdir, { projectId: x.project.id });
    assert.deepEqual(current.files.map((f) => f.path).sort(), [
      "main.txt",
      "new.txt",
    ]);
    assert.equal(
      current.files.some((f) => f.path === "ignored.txt"),
      false,
    );
    await git(x.repo, ["add", "app/main.txt"]);
    await git(x.repo, ["commit", "-m", `Implement ${item.code}`]);
    current = await browseGit(x.subdir, { projectId: x.project.id });
    assert.equal(current.commits[0].subject, `Implement ${item.code}`);
    // The browser resolves references through the controller/IPC layer; the pure browser remains bounded.
    assert.equal(current.commits[0].workItems.length, 0);
    assert.deepEqual(
      x.store.board.gitReferences(
        x.project.id,
        current.commits.map((c) => c.subject),
      ),
      [{ id: item.id, code: item.code }],
    );
    assert.deepEqual(
      x.store.board.gitReferences(
        randomUUID(),
        current.commits.map((c) => c.subject),
      ),
      [],
    );
    assert.equal(
      (await browseGit(x.subdir, { projectId: x.project.id, offset: 1 }))
        .commits.length,
      1,
    );
    await writeFile(join(x.repo, "older.txt"), "older\n");
    await git(x.repo, ["add", "older.txt"]);
    await git(x.repo, ["commit", "-m", "Older"]).then(() => undefined);
    const page = await browseGit(x.subdir, {
      projectId: x.project.id,
      offset: 0,
    });
    assert.equal(page.hasMore, false);
    assert.equal(page.commits.length, 2);
    await assert.rejects(
      () =>
        browseGit(x.subdir, { projectId: x.project.id, head: initial.head! }),
      /HEAD đã thay đổi/,
    );
  } finally {
    await x.cleanup();
  }
});

test("Git browser returns exact staged and unstaged diffs, bounds content and preserves source/index", async () => {
  const x = await setup();
  try {
    await writeFile(join(x.subdir, "main.txt"), "one\nstaged\n");
    await git(x.repo, ["add", "app/main.txt"]);
    await writeFile(join(x.subdir, "main.txt"), "one\nstaged\nworking\n");
    const indexBefore = await readFile(join(x.repo, ".git", "index"));
    const snapshot = await browseGit(x.subdir, { projectId: x.project.id });
    assert.equal(snapshot.files[0].path, "main.txt");
    const staged = await browseGitDiff(x.subdir, {
      projectId: x.project.id,
      path: "main.txt",
      comparison: "staged",
    });
    const unstaged = await browseGitDiff(x.subdir, {
      projectId: x.project.id,
      path: "main.txt",
      comparison: "unstaged",
    });
    assert.match(staged.patch, /staged/);
    assert.doesNotMatch(staged.patch, /working/);
    assert.match(unstaged.patch, /working/);
    assert.equal(staged.binary, false);
    assert.equal(staged.reason, "");
    assert.ok(
      indexBefore.equals(await readFile(join(x.repo, ".git", "index"))),
    );
    assert.equal(
      await readFile(join(x.subdir, "main.txt"), "utf8"),
      "one\nstaged\nworking\n",
    );
    await assert.rejects(
      () =>
        browseGitDiff(x.subdir, {
          projectId: x.project.id,
          path: "../.git/config",
          comparison: "unstaged",
        }),
      /không hợp lệ/,
    );
    await writeFile(join(x.subdir, "big.txt"), "x".repeat(300000));
    await assert.rejects(
      () =>
        browseGitDiff(x.subdir, {
          projectId: x.project.id,
          path: "big.txt",
          comparison: "unstaged",
        }),
      /250 KB/,
    );
    await writeFile(join(x.subdir, "main.txt"), "changed-after-snapshot\n");
    const updated = await browseGitDiff(x.subdir, {
      projectId: x.project.id,
      path: "main.txt",
      comparison: "unstaged",
    });
    assert.match(updated.patch, /changed-after-snapshot/);
  } finally {
    await x.cleanup();
  }
});

test("Git browser supports unborn and detached HEAD, Unicode, binary, deleted and renamed files", async () => {
  const x = await setup();
  try {
    const current = (await git(x.repo, ["rev-parse", "HEAD"]))
      .toString()
      .trim();
    await git(x.repo, ["checkout", "--detach", current]);
    assert.equal(
      (await browseGit(x.subdir, { projectId: x.project.id })).branch,
      null,
    );
    await writeFile(join(x.subdir, "tài liệu.txt"), "password=private-value\n");
    const text = await browseGitDiff(x.subdir, {
      projectId: x.project.id,
      path: "tài liệu.txt",
      comparison: "unstaged",
    });
    assert.match(text.patch, /REDACTED/);
    assert.doesNotMatch(text.patch, /private-value/);
    await writeFile(join(x.subdir, "binary.bin"), Buffer.from([0, 1, 2]));
    assert.equal(
      (
        await browseGitDiff(x.subdir, {
          projectId: x.project.id,
          path: "binary.bin",
          comparison: "unstaged",
        })
      ).binary,
      true,
    );
    await rename(join(x.subdir, "main.txt"), join(x.subdir, "renamed.txt"));
    await git(x.repo, ["add", "app/main.txt", "app/renamed.txt"]);
    const state = await browseGit(x.subdir, { projectId: x.project.id });
    assert.equal(state.files.find((f) => f.path === "main.txt")?.index, "D");
    const deletion = await browseGitDiff(x.subdir, {
      projectId: x.project.id,
      path: "main.txt",
      comparison: "staged",
    });
    assert.match(deletion.patch, /-one/);
    const addition = await browseGitDiff(x.subdir, {
      projectId: x.project.id,
      path: "renamed.txt",
      comparison: "staged",
    });
    assert.match(addition.patch, /\+one/);
    const empty = join(x.directory, "unborn");
    await mkdir(empty);
    await git(empty, ["init"]);
    const unborn = await browseGit(empty, { projectId: randomUUID() });
    assert.equal(unborn.head, null);
    assert.deepEqual(unborn.commits, []);
    await writeFile(join(empty, "first.txt"), "first\n");
    await git(empty, ["add", "."]);
    assert.match(
      (
        await browseGitDiff(empty, {
          projectId: randomUUID(),
          path: "first.txt",
          comparison: "staged",
        })
      ).patch,
      /\+first/,
    );
    await unlink(join(x.subdir, "renamed.txt"));
  } finally {
    await x.cleanup();
  }
});

test("Git history pages 50 commits on a pinned HEAD and bounds changed file projection", async () => {
  const x = await setup();
  try {
    const initial = (await git(x.repo, ["rev-parse", "HEAD"]))
      .toString()
      .trim();
    const treeA = (await git(x.repo, ["rev-parse", "HEAD^{tree}"]))
      .toString()
      .trim();
    await writeFile(join(x.subdir, "main.txt"), "alternate tree\n");
    await git(x.repo, ["add", "."]);
    const treeB = (await git(x.repo, ["write-tree"])).toString().trim();
    let parent = initial;
    for (let i = 0; i < 51; i++)
      parent = (
        await git(x.repo, [
          "commit-tree",
          i % 2 ? treeA : treeB,
          "-p",
          parent,
          "-m",
          `History ${i}`,
        ])
      )
        .toString()
        .trim();
    await git(x.repo, ["update-ref", "HEAD", parent]);
    for (let i = 0; i < 205; i++)
      await writeFile(join(x.subdir, `untracked-${i}.txt`), "fixture");
    const first = await browseGit(x.subdir, { projectId: x.project.id });
    assert.equal(first.commits.length, 50);
    assert.equal(first.hasMore, true);
    assert.equal(first.nextOffset, 50);
    assert.equal(first.files.length, 200);
    assert.equal(first.filesTruncated, true);
    const second = await browseGit(x.subdir, {
      projectId: x.project.id,
      head: first.head!,
      offset: first.nextOffset!,
    });
    assert.equal(second.commits.length, 2);
    assert.equal(second.hasMore, false);
    assert.equal(
      new Set([...first.commits, ...second.commits].map((c) => c.hash)).size,
      52,
    );
    assert.ok(JSON.stringify(first).length < 100000);
  } finally {
    await x.cleanup();
  }
});

test("Git browser reports non-repository and refuses configured filter without touching source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "asf-git-empty-"));
  try {
    const id = randomUUID();
    const noRepo = await browseGit(directory, { projectId: id });
    assert.equal(noRepo.available, false);
    await assert.rejects(
      () =>
        browseGitDiff(directory, {
          projectId: id,
          path: "x.txt",
          comparison: "unstaged",
        }),
      /repository/,
    );
    const repo = join(directory, "repo");
    await mkdir(repo);
    await writeFile(join(repo, "x.txt"), "x\n");
    await git(repo, ["init"]);
    await git(repo, ["config", "user.email", "fixture@example.invalid"]);
    await git(repo, ["config", "user.name", "Fixture"]);
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "baseline"]);
    await git(repo, ["config", "filter.fixture.clean", "cat"]);
    await git(repo, ["config", "filter.fixture.smudge", "cat"]);
    await git(repo, ["config", "filter.fixture.required", "true"]);
    await git(repo, [
      "config",
      "core.attributesfile",
      join(repo, ".gitattributes"),
    ]);
    await writeFile(join(repo, ".gitattributes"), "x.txt filter=fixture\n");
    await assert.rejects(() => browseGit(repo, { projectId: id }), /filter/);
    assert.equal(await readFile(join(repo, "x.txt"), "utf8"), "x\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
