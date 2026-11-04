import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  rename,
  unlink,
  mkdir,
  symlink,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applyPatch } from "diff";
import { Store } from "../electron/storage/database";
import { snapshot, changes } from "../electron/workspace/snapshot";
import { captureGit, git } from "../electron/workspace/git-evidence";
import { WorkspaceFiles } from "../electron/workspace/files";
import { RunController } from "../electron/controller/runs";
import { defaultSettings } from "../shared/defaults";
import type { Run } from "../shared/runs";

async function setup(withGit = true) {
  const directory = await mkdtemp(join(tmpdir(), "asf-evidence-"));
  const root = join(directory, "source");
  await mkdir(root);
  const store = new Store(join(directory, "data"));
  const project = store.addProject(root);
  const run: Run = {
    id: crypto.randomUUID(),
    projectId: project.id,
    projectName: "Evidence",
    workspace: root,
    prompt: "Change source",
    role: "be",
    model: "fixture",
    mode: "direct",
    tasks: [],
    profiles: [],
    currentTaskId: null,
    fixRound: 0,
    review: null,
    state: "completed",
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
    sessionId: null,
    summary: "",
    error: "",
    settings: defaultSettings(),
    changes: [],
    commands: [],
    permissions: [],
    requests: 0,
    baselineComplete: true,
    toolsCompleted: 0,
    runtimeVersion: "",
    inputTokens: 0,
    outputTokens: 0,
  };
  store.createRun(run);
  if (withGit) {
    await git(root, ["init"]);
    await git(root, ["config", "user.email", "fixture@example.invalid"]);
    await git(root, ["config", "user.name", "Fixture"]);
    await git(root, ["config", "core.autocrlf", "false"]);
  }
  const begin = async () =>
    store.evidence.begin(
      run.id,
      root,
      await snapshot(root, true),
      await captureGit(root, true),
    );
  const finish = async () =>
    store.evidence.finish(
      run.id,
      await snapshot(root, true),
      await captureGit(root, true),
    );
  const files = new WorkspaceFiles(
    store,
    () => {},
    async (fn) => await fn(),
  );
  const cleanup = async () => {
    store.close();
    assert.ok(directory.startsWith(join(tmpdir(), "asf-evidence-")));
    await rm(directory, { recursive: true, force: true });
  };
  return {
    directory,
    root,
    store,
    project,
    run,
    begin,
    finish,
    files,
    cleanup,
  };
}
test("credential content omission preserves hash-based detection of added source files", async () => {
  const x = await setup(false);
  try {
    await writeFile(
      join(x.root, "settings.ts"),
      "const password = 'synthetic';\n",
    );
    const before = await snapshot(x.root, true);
    assert.equal(before.complete, true);
    assert.equal(before.contentComplete, false);
    await writeFile(
      join(x.root, "feature.ts"),
      "export const feature = true;\n",
    );
    const after = await snapshot(x.root, true);
    assert.ok(
      changes(before, after).some(
        (f) => f.path === "feature.ts" && f.kind === "added",
      ),
    );
  } finally {
    await x.cleanup();
  }
});
test("persistent run diff separates staged/unstaged and pre-existing edits; restore keeps index and user baseline", async () => {
  const x = await setup();
  try {
    await writeFile(join(x.root, "feature.txt"), "base\n");
    await git(x.root, ["add", "."]);
    await git(x.root, ["commit", "-m", "base"]);
    await writeFile(join(x.root, "feature.txt"), "staged\n");
    await git(x.root, ["add", "feature.txt"]);
    await writeFile(join(x.root, "feature.txt"), "user baseline\n");
    await writeFile(join(x.root, "notes.txt"), "existing untracked\n");
    await x.begin();
    await writeFile(
      join(x.root, "feature.txt"),
      "user baseline\nagent change\n",
    );
    await x.finish();
    const view = x.store.evidence.view(x.run.id);
    assert.equal(view.files.length, 1);
    assert.equal(view.files[0].preExisting, true);
    assert.equal(view.preExistingCount, 2);
    const staged = x.store.evidence.diff(
      x.run.id,
      "feature.txt",
      "staged",
      "before",
    ).patch;
    assert.ok(staged.includes("-base"));
    assert.ok(staged.includes("+staged"));
    const unstaged = x.store.evidence.diff(
      x.run.id,
      "feature.txt",
      "unstaged",
      "before",
    ).patch;
    assert.ok(unstaged.includes("-staged"));
    assert.ok(unstaged.includes("+user baseline"));
    const diff = x.store.evidence.diff(x.run.id, "feature.txt");
    assert.ok(diff.patch.includes("+agent change"));
    assert.equal(
      applyPatch("user baseline\n", diff.patch),
      "user baseline\nagent change\n",
    );
    const index = (await captureGit(x.root)).state!.indexHash;
    const preview = await x.files.preview(x.run.id, "feature.txt");
    assert.ok(preview.patch.includes("-agent change"));
    await x.files.restore(preview.token);
    assert.equal(
      await readFile(join(x.root, "feature.txt"), "utf8"),
      "user baseline\n",
    );
    assert.equal((await captureGit(x.root)).state!.indexHash, index);
    assert.equal(
      await readFile(join(x.root, "notes.txt"), "utf8"),
      "existing untracked\n",
    );
    assert.equal(
      x.store.evidence.diff(x.run.id, "feature.txt").patch,
      diff.patch,
    );
    assert.ok(x.store.events(x.run.id).some((e) => e.type === "FILE_RESTORED"));
    await assert.rejects(x.files.restore(preview.token), /hết hạn/);
    x.store.close();
    const reopened = new Store(join(x.directory, "data"));
    try {
      assert.equal(
        reopened.evidence.diff(x.run.id, "feature.txt").patch,
        diff.patch,
      );
    } finally {
      reopened.close();
    }
  } finally {
    await x.cleanup();
  }
});
test("restore rejects edits after preview, index changes, traversal and active runs", async () => {
  const x = await setup();
  try {
    await writeFile(join(x.root, "a.txt"), "old\n");
    await git(x.root, ["add", "."]);
    await git(x.root, ["commit", "-m", "base"]);
    await x.begin();
    await writeFile(join(x.root, "a.txt"), "new\n");
    await x.finish();
    let p = await x.files.preview(x.run.id, "a.txt");
    await writeFile(join(x.root, "a.txt"), "external edit\n");
    await assert.rejects(x.files.restore(p.token), /Không ghi đè/);
    assert.equal(
      await readFile(join(x.root, "a.txt"), "utf8"),
      "external edit\n",
    );
    await writeFile(join(x.root, "a.txt"), "new\n");
    p = await x.files.preview(x.run.id, "a.txt");
    await git(x.root, ["add", "a.txt"]);
    await assert.rejects(x.files.restore(p.token), /Không ghi đè/);
    await assert.rejects(x.files.resolve(x.run.id, "../outside"), /snapshot/);
    const locked = new WorkspaceFiles(
      x.store,
      () => {
        throw new Error("active run");
      },
      async () => {
        throw new Error("active run");
      },
    );
    await assert.rejects(locked.preview(x.run.id, "a.txt"), /active run/);
  } finally {
    await x.cleanup();
  }
});
test("added/deleted/renamed/binary/CRLF and limited files use stored bytes, never reset repository", async () => {
  const x = await setup(false);
  try {
    await writeFile(join(x.root, "gone.txt"), "deleted content\r\n");
    await writeFile(join(x.root, "old-name.txt"), "renamed content\n");
    await writeFile(join(x.root, "binary.dat"), Buffer.from([0, 1, 2]));
    await writeFile(join(x.root, "large.txt"), "x".repeat(1024 * 1024 + 1));
    await writeFile(join(x.root, ".env"), "SECRET=do-not-capture");
    await writeFile(
      join(x.root, "inline.ts"),
      "const password = 'synthetic-secret';",
    );
    await x.begin();
    await unlink(join(x.root, "gone.txt"));
    await rename(join(x.root, "old-name.txt"), join(x.root, "new-name.txt"));
    await writeFile(join(x.root, "added.txt"), "new file\n");
    await writeFile(join(x.root, "binary.dat"), Buffer.from([0, 3, 4]));
    await writeFile(join(x.root, "large.txt"), "y".repeat(1024 * 1024 + 2));
    await x.finish();
    const view = x.store.evidence.view(x.run.id);
    assert.equal(view.complete, false);
    assert.equal(
      view.files.find((f) => f.path === "new-name.txt")!.renamedFrom,
      "old-name.txt",
    );
    assert.equal(x.store.evidence.diff(x.run.id, "binary.dat").binary, true);
    assert.equal(
      x.store.evidence.diff(x.run.id, "large.txt").canRestore,
      false,
    );
    assert.ok(!x.store.evidence.get(x.run.id).before.files[".env"]);
    assert.ok(x.store.evidence.get(x.run.id).before.files["inline.ts"].reason);
    assert.equal(
      x.store.evidence.get(x.run.id).before.files["inline.ts"].hash?.length,
      64,
    );
    for (const path of ["gone.txt", "added.txt", "binary.dat"]) {
      const p = await x.files.preview(x.run.id, path);
      await x.files.restore(p.token);
    }
    assert.equal(
      await readFile(join(x.root, "gone.txt"), "utf8"),
      "deleted content\r\n",
    );
    assert.equal(existsSync(join(x.root, "added.txt")), false);
    assert.deepEqual(
      await readFile(join(x.root, "binary.dat")),
      Buffer.from([0, 1, 2]),
    );
    const before = Buffer.from("first\r\nlast\r\n"),
      after = Buffer.from("first\r\nchanged\r\n");
    const { patchFor } = await import("../electron/storage/evidence");
    assert.equal(
      applyPatch(before.toString(), patchFor("crlf.txt", before, after).patch),
      after.toString(),
    );
  } finally {
    await x.cleanup();
  }
});
test("parent junction replacement cannot redirect restore outside workspace", async () => {
  const x = await setup(false);
  try {
    await mkdir(join(x.root, "nested"));
    await writeFile(join(x.root, "nested", "a.txt"), "old");
    await x.begin();
    await writeFile(join(x.root, "nested", "a.txt"), "new");
    await x.finish();
    const p = await x.files.preview(x.run.id, "nested/a.txt");
    await rename(join(x.root, "nested"), join(x.root, "saved"));
    const outside = join(x.directory, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "a.txt"), "outside");
    await symlink(
      outside,
      join(x.root, "nested"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(x.files.restore(p.token), /liên kết/);
    assert.equal(await readFile(join(outside, "a.txt"), "utf8"), "outside");
  } finally {
    await x.cleanup();
  }
});
test("schema5 backup preserves history before evidence migration; workspace action blocks runs and shutdown waits", async () => {
  const x = await setup(false);
  try {
    x.store.close();
    const db = new Database(join(x.directory, "data", "worker.sqlite"));
    db.exec(
      "DROP TABLE work_comments; DROP TABLE work_attempts; DROP TABLE work_submissions; DROP TABLE work_revisions; DROP TABLE work_counters; DROP TABLE board_links; DROP TABLE board_items; DROP TABLE command_artifacts;DROP TABLE file_recoveries;DROP TABLE workspace_evidence;DROP TABLE workspace_blobs;PRAGMA user_version=5",
    );
    db.close();
    const migrated = new Store(join(x.directory, "data"));
    try {
      assert.ok(
        existsSync(join(x.directory, "data", "worker.schema5.backup.sqlite")),
      );
      assert.equal(migrated.run(x.run.id).id, x.run.id);
      const controller = new RunController(
        migrated,
        x.directory,
        () => undefined,
      );
      let release!: () => void;
      const task = controller.workspaceAction(
        () =>
          new Promise<void>((r) => {
            release = r;
          }),
      );
      assert.throws(
        () => controller.start(x.project.id, "work", "be"),
        /khôi phục/,
      );
      let shutdown = false;
      const closing = controller.shutdown().then(() => {
        shutdown = true;
      });
      await Promise.resolve();
      assert.equal(shutdown, false);
      release();
      await task;
      await closing;
      assert.equal(shutdown, true);
    } finally {
      migrated.close();
    }
  } finally {
    await x.cleanup();
  }
});
