import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runToCompletion } from "../dist/exec/process-group.js";
import { buildSafeEnv } from "../dist/exec/safe-env.js";
import {
  WorkspaceError, assertInside, slugify, canonicalRoots, validateRoots, validateSource, validateAttempt,
  runGit, cloneProject, createWorktree, removeWorktree, listWorktrees, checkpoint, collectEvidence,
  parseDiffRecords, buildPatch, patchIsSafeToApply, applyPatchToRepo,
} from "../dist/workspace/index.js";

const linux = process.platform === "linux";
const linuxOptions = { skip: linux ? false : "Workspace integration requires Linux/ext4 and /usr/bin/git" };
const integration = (name, fn) => test(name, linuxOptions, fn);
const code = (expected) => (error) => error instanceof WorkspaceError && error.code === expected;
const cli = fileURLToPath(new URL("../dist/workspace/cli.js", import.meta.url));
const baseOid = "1".repeat(40);
const nextOid = "2".repeat(40);

function temp(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "factory-workspace-test-")));
  t.after(() => {
    assert.ok(root.includes("factory-workspace-test-"));
    fs.rmSync(assertInside(fs.realpathSync(tmpdir()), root), { recursive: true, force: true });
  });
  return root;
}

function treeHash(directory, includeGit = true) {
  const hash = createHash("sha256");
  function visit(path, name) {
    const stat = fs.lstatSync(path);
    // The root directory itself is created by different code paths (clone vs worktree): its own mode is not content.
    hash.update(JSON.stringify([name, name === "" ? "root" : stat.mode]));
    if (stat.isSymbolicLink()) hash.update(fs.readlinkSync(path));
    else if (stat.isDirectory()) {
      for (const child of fs.readdirSync(path).sort()) if (includeGit || child !== ".git") visit(join(path, child), `${name}/${child}`);
    } else hash.update(fs.readFileSync(path));
  }
  visit(directory, "");
  return hash.digest("hex");
}

async function init(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  await runGit(directory, ["init", "--initial-branch=main", "--template="]);
  await runGit(directory, ["config", "--local", "user.name", "Fixture"]);
  await runGit(directory, ["config", "--local", "user.email", "fixture@localhost"]);
  fs.writeFileSync(join(directory, "base.txt"), "base\n");
  fs.writeFileSync(join(directory, "remove.txt"), "remove\n");
  fs.writeFileSync(join(directory, "rename.txt"), "rename content\n".repeat(8));
  await runGit(directory, ["add", "-A"]);
  await runGit(directory, ["commit", "-m", "base"]);
  return (await runGit(directory, ["rev-parse", "HEAD"])).stdout.trim();
}

async function fixture(t, withWorktree = true) {
  const root = temp(t);
  const source = join(root, "source");
  await init(source);
  const sourceHash = treeHash(source);
  const roots = { projectsRoot: join(root, "projects"), worktreesRoot: join(root, "worktrees") };
  const project = await cloneProject(roots, { name: "Example Project", source });
  const attempt = withWorktree ? await createWorktree(roots, {
    projectRoot: project.root, projectSlug: project.slug, taskCode: "DEV-001", epoch: 1,
  }) : undefined;
  return { root, source, sourceHash, roots, project, attempt };
}

function change(worktree) {
  fs.writeFileSync(join(worktree, "base.txt"), "changed\nsecond\n");
  fs.unlinkSync(join(worktree, "remove.txt"));
  fs.renameSync(join(worktree, "rename.txt"), join(worktree, "renamed.txt"));
  fs.writeFileSync(join(worktree, "added.txt"), "new\n");
}

async function invokeCli(t, args, home) {
  const cwd = fs.realpathSync(dirname(cli));
  const env = buildSafeEnv(home ? { HOME: home } : {});
  if (!home) t.after(() => fs.rmdirSync(assertInside(fs.realpathSync(tmpdir()), env.HOME)));
  return runToCompletion({ command: process.execPath, args: [cli, ...args], cwd, env, maxOutputBytes: 1024 * 1024 });
}

for (const [input, expected] of [
  ["Example Project", "example-project"], ["ABC", "abc"], ["  a  b  ", "a-b"],
  ["a___b---c", "a-b-c"], [".hidden", "hidden"], ["---lead", "lead"], ["trailing---", "trailing"],
  ["", "project"], ["...", "project"], ["你好", "project"], ["ÄBC", "bc"], ["123", "123"],
  ["a/b\\c", "a-b-c"], ["A\nB\tC", "a-b-c"], ["x".repeat(70), "x".repeat(48)],
  ["a".repeat(47) + "-zzz", "a".repeat(47)], ["A..B", "a-b"], ["a🔥b", "a-b"],
]) test(`slugify ${JSON.stringify(input)}`, () => assert.equal(slugify(input), expected));

test("slugify rejects a non-string", () => assert.throws(() => slugify(null), code("invalid-input")));

for (const [name, candidate] of [
  ["root itself", (root) => root], ["sibling prefix", (root) => `${root}c/file`],
  ["parent traversal", (root) => join(root, "..", "outside")],
  ["un-normalized traversal", (root) => `${root}/inner/../../outside`],
  ["absolute outside", (root) => join(dirname(root), "outside")],
  ["relative path", () => "relative/file"], ["NUL", (root) => `${root}/a\0b`],
]) test(`assertInside rejects ${name}`, (t) => {
  const root = join(temp(t), "b");
  assert.throws(() => assertInside(root, candidate(root)), code("path-escape"));
});

test("assertInside accepts a canonical existing child", (t) => {
  const root = temp(t); const child = join(root, "child"); fs.mkdirSync(child);
  assert.equal(assertInside(root, child), fs.realpathSync(child));
});
test("assertInside accepts missing descendants and trailing separators", (t) => {
  const root = temp(t);
  assert.equal(assertInside(`${root}/`, `${root}/missing/deep/`), join(root, "missing", "deep"));
});
test("assertInside rejects POSIX sibling-prefix lexical tricks on every platform", () => {
  assert.throws(() => assertInside("/a/b", "/a/bc/file"), code("path-escape"));
});
test("assertInside uses the filesystem's case rules", (t) => {
  const parent = temp(t); const root = join(parent, "CaseRoot"); fs.mkdirSync(root);
  const candidate = join(parent, "caseroot", "child");
  if (process.platform === "win32") assert.equal(assertInside(root, candidate).toLowerCase(), join(fs.realpathSync(root), "child").toLowerCase());
  else assert.throws(() => assertInside(root, candidate), code("path-escape"));
});
integration("assertInside refuses a symlink pointing outside", (t) => {
  const parent = temp(t); const root = join(parent, "root"); const outside = join(parent, "outside");
  fs.mkdirSync(root); fs.mkdirSync(outside); fs.symlinkSync(outside, join(root, "link"));
  assert.throws(() => assertInside(root, join(root, "link", "missing")), code("path-escape"));
});
integration("assertInside resolves an internal symlink and missing remainder", (t) => {
  const root = temp(t); fs.mkdirSync(join(root, "real")); fs.symlinkSync("real", join(root, "link"));
  assert.equal(assertInside(root, join(root, "link", "missing")), join(root, "real", "missing"));
});
integration("assertInside refuses dangling symlinks", (t) => {
  const root = temp(t); fs.symlinkSync("/missing-factory-workspace-target", join(root, "link"));
  assert.throws(() => assertInside(root, join(root, "link", "missing")), code("path-escape"));
});

for (const source of ["file:///tmp/repo", "ssh://host/repo", "git://host/repo", "http://host/repo", "ext::bad",
  "relative/repo", "../repo", "-bad", "", "https://user:password@example.test/repo", "https://user@example.test/repo",
  "https://@example.test/repo", "https://example.test/a b", "https://example.test/a\nb", "https://", "https://host/repo#fragment",
  "https://host\\evil/repo", "https://host/a\0b"]) test(`source rejects ${JSON.stringify(source)}`, () => {
  assert.throws(() => validateSource(source), code("invalid-input"));
});
test("source validation permits a credential-free HTTPS URL", () => {
  assert.deepEqual(validateSource("https://example.test/repo.git"), { source: "https://example.test/repo.git", local: false });
});
test("source validation accepts a canonical existing absolute directory", (t) => {
  const root = temp(t); assert.deepEqual(validateSource(root), { source: root, local: true });
});
test("source validation refuses missing absolute paths", (t) => {
  assert.throws(() => validateSource(join(temp(t), "missing")), code("invalid-input"));
});
test("source validation refuses regular files", (t) => {
  const path = join(temp(t), "file"); fs.writeFileSync(path, "x");
  assert.throws(() => validateSource(path), code("invalid-input"));
});

for (const taskCode of ["dev-001", "A-001", "ABCDEFG-001", "DEV-01", "DEV-1234567", "DEV-001/../../x", "", "DEV-001\n"])
  test(`attempt validation rejects taskCode ${JSON.stringify(taskCode)} before platform checks`, async () => {
    await assert.rejects(createWorktree({}, { projectSlug: "project", taskCode, epoch: 1 }), code("invalid-input"));
  });
for (const epoch of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null])
  test(`attempt validation rejects epoch ${String(epoch)} before platform checks`, async () => {
    await assert.rejects(createWorktree({}, { projectSlug: "project", taskCode: "DEV-001", epoch }), code("invalid-input"));
  });
for (const projectSlug of ["../x", "/absolute", ".git", "-lead", "UPPER", "a/b"])
  test(`attempt refuses unsafe project slug ${projectSlug}`, () => {
    assert.throws(() => validateAttempt({ projectSlug, taskCode: "DEV-001", epoch: 1 }), code("invalid-input"));
  });
test("attempt accepts task code and epoch boundaries", () => {
  for (const taskCode of ["AB-000", "ABCDEF-123456"])
    validateAttempt({ projectSlug: "project-2", taskCode, epoch: Number.MAX_SAFE_INTEGER });
});

for (const projectsRoot of ["/mnt/e/projects", "/mnt", "/mnt//d/projects"])
  test(`roots reject mounted directory ${projectsRoot}`, () => {
    assert.throws(() => canonicalRoots({ projectsRoot, worktreesRoot: "/tmp/workspace-worktrees" }), code("path-escape"));
  });
test("roots reject nested, reverse-nested, equal, and relative roots", (t) => {
  const root = temp(t);
  for (const roots of [
    { projectsRoot: root, worktreesRoot: join(root, "nested") },
    { projectsRoot: join(root, "nested"), worktreesRoot: root },
    { projectsRoot: root, worktreesRoot: root },
    { projectsRoot: "relative", worktreesRoot: join(root, "worktrees") },
  ]) assert.throws(() => canonicalRoots(roots), code("path-escape"));
});
integration("roots are canonical and newly created directories have mode 0700", (t) => {
  const root = temp(t); const roots = validateRoots({ projectsRoot: join(root, "projects"), worktreesRoot: join(root, "worktrees") });
  for (const path of Object.values(roots)) {
    assert.equal(path, fs.realpathSync(path)); assert.equal(fs.statSync(path).mode & 0o777, 0o700);
  }
});
integration("roots reject a symlink to a mounted directory", (t) => {
  const root = temp(t); fs.symlinkSync("/mnt", join(root, "mount"));
  assert.throws(() => canonicalRoots({ projectsRoot: join(root, "mount", "e"), worktreesRoot: join(root, "worktrees") }), code("path-escape"));
});
test("valid Git operations explicitly refuse non-Linux platforms", { skip: linux }, async () => {
  await assert.rejects(runGit(fs.realpathSync(process.cwd()), ["version"]), code("unsupported-platform"));
});

integration("runGit disables hooks even when repository config points at them", async (t) => {
  const root = temp(t); await init(root);
  const marker = join(root, "hook-marker"); const hooks = join(root, ".git", "hooks"); fs.mkdirSync(hooks);
  fs.writeFileSync(join(hooks, "pre-commit"), '#!/bin/sh\nprintf ran > "$PWD/hook-marker"\n', { mode: 0o755 });
  await runGit(root, ["config", "--local", "core.hooksPath", hooks]);
  fs.writeFileSync(join(root, "new"), "x"); await runGit(root, ["add", "-A"]); await runGit(root, ["commit", "-m", "test"]);
  assert.equal(fs.existsSync(marker), false);
});
integration("runGit ignores the calling process's synthetic global configuration", async (t) => {
  const root = temp(t); const home = join(root, "home"); const repo = join(root, "repo"); fs.mkdirSync(home); await init(repo);
  fs.writeFileSync(join(home, ".gitconfig"), '[factory]\n probe = global-should-be-ignored\n');
  const module = new URL("../dist/workspace/git.js", import.meta.url).href;
  const script = `import {runGit} from ${JSON.stringify(module)}; const r=await runGit(${JSON.stringify(repo)},["config","--get","factory.probe"],{acceptExitCodes:[1]}); process.stdout.write(JSON.stringify(r));`;
  const result = await runToCompletion({ command: process.execPath, args: ["--input-type=module", "-e", script], cwd: root,
    env: buildSafeEnv({ HOME: home }) });
  assert.equal(result.exitCode, 0); assert.equal(JSON.parse(result.stdout).exitCode, 1); assert.equal(JSON.parse(result.stdout).stdout, "");
});
integration("runGit overrides fsmonitor and clears credential helpers from repository configuration", async (t) => {
  const root = temp(t); await init(root);
  await runGit(root, ["config", "--local", "core.fsmonitor", "evil-helper"]);
  await runGit(root, ["config", "--local", "credential.helper", "evil-helper"]);
  assert.equal((await runGit(root, ["config", "--get", "core.fsmonitor"])).stdout.trim(), "false");
  const helpers = (await runGit(root, ["config", "--get-all", "credential.helper"])).stdout.split("\n");
  assert.deepEqual(helpers.slice(-2), ["", ""]);
});
integration("runGit errors reveal only the subcommand and accepted exit codes are returned", async (t) => {
  const root = temp(t);
  await assert.rejects(runGit(root, ["rev-parse", "--verify", "SECRET-PATH"]), (error) => {
    assert.equal(error.code, "git-failed"); assert.equal(error.message, "git rev-parse failed"); return true;
  });
  await init(root);
  assert.equal((await runGit(root, ["config", "--get", "missing.value"], { acceptExitCodes: [1] })).exitCode, 1);
});
integration("runGit fails closed on bounded output overflow", async (t) => {
  const root = temp(t); await init(root);
  await assert.rejects(runGit(root, ["log", "--format=%H"], { maxOutputBytes: 4 }), code("git-failed"));
});

integration("clone owns independent non-hardlinked objects and preserves every source byte", async (t) => {
  const f = await fixture(t, false); const { project, source } = f;
  assert.equal(fs.existsSync(join(project.root, ".git", "objects", "info", "alternates")), false);
  const sourceObjects = new Set();
  function inodes(path, into) {
    for (const name of fs.readdirSync(path)) {
      const child = join(path, name); const stat = fs.lstatSync(child);
      if (stat.isDirectory()) inodes(child, into); else into.add(`${stat.dev}:${stat.ino}`);
    }
  }
  inodes(join(source, ".git", "objects"), sourceObjects); const clonedObjects = new Set(); inodes(join(project.root, ".git", "objects"), clonedObjects);
  assert.ok(clonedObjects.size > 0); for (const inode of clonedObjects) assert.equal(sourceObjects.has(inode), false);
  assert.equal(project.baseBranch, "main"); assert.equal(project.headSha, (await runGit(source, ["rev-parse", "HEAD"])).stdout.trim());
  assert.equal(treeHash(source), f.sourceHash);
});
integration("clone disables pushes and configures a local identity and LF behavior", async (t) => {
  const f = await fixture(t, false);
  for (const [key, value] of [["remote.origin.pushurl", "no-push://disabled"], ["user.name", "Factory"], ["user.email", "factory@localhost"], ["core.autocrlf", "false"]])
    assert.equal((await runGit(f.project.root, ["config", "--local", "--get", key])).stdout.trim(), value);
  await assert.rejects(runGit(f.project.root, ["push", "origin", "HEAD"]), code("git-failed"));
  assert.equal(treeHash(f.source), f.sourceHash);
});
integration("clone collisions reserve -2 and -3 without reusing existing destinations", async (t) => {
  const f = await fixture(t, false); const oldHash = treeHash(f.project.root);
  const second = await cloneProject(f.roots, { name: "Example Project", source: f.source });
  const third = await cloneProject(f.roots, { name: "Example Project", source: f.source });
  assert.equal(second.slug, "example-project-2"); assert.equal(third.slug, "example-project-3");
  assert.equal(treeHash(f.project.root), oldHash); assert.equal(treeHash(f.source), f.sourceHash);
});
integration("concurrent clones reserve distinct destinations", async (t) => {
  const f = await fixture(t, false);
  const results = await Promise.all([1, 2].map(() => cloneProject(f.roots, { name: "Concurrent", source: f.source })));
  assert.deepEqual(results.map((r) => r.slug).sort(), ["concurrent", "concurrent-2"]);
});
integration("clone refuses a non-repository directory before creating destinations", async (t) => {
  const root = temp(t); const source = join(root, "source"); fs.mkdirSync(source);
  const roots = { projectsRoot: join(root, "projects"), worktreesRoot: join(root, "worktrees") };
  await assert.rejects(cloneProject(roots, { name: "bad", source }), code("invalid-input"));
  assert.equal(fs.existsSync(roots.projectsRoot), false);
});
integration("clone failure removes only the destination reserved by that call", async (t) => {
  const root = temp(t); const source = join(root, "empty"); fs.mkdirSync(source);
  await runGit(source, ["init", "--initial-branch=main", "--template="]);
  const before = treeHash(source); const roots = validateRoots({ projectsRoot: join(root, "projects"), worktreesRoot: join(root, "worktrees") });
  const existing = join(roots.projectsRoot, "broken"); fs.mkdirSync(existing); fs.writeFileSync(join(existing, "keep"), "preserve");
  await assert.rejects(cloneProject(roots, { name: "Broken", source }), code("git-failed"));
  assert.deepEqual(fs.readdirSync(roots.projectsRoot), ["broken"]); assert.equal(treeHash(source), before);
});
integration("clone refuses roots inside the original before any directory is created", async (t) => {
  const root = temp(t); const source = join(root, "source"); await init(source); const before = treeHash(source);
  await assert.rejects(cloneProject({ projectsRoot: join(source, "projects"), worktreesRoot: join(root, "worktrees") },
    { name: "bad", source }), code("path-escape"));
  assert.equal(treeHash(source), before);
});

integration("worktree starts at current HEAD on its own named branch and path", async (t) => {
  const f = await fixture(t); const a = f.attempt;
  assert.equal(a.branch, "factory/dev-001-e1"); assert.equal(a.path, join(f.roots.worktreesRoot, f.project.slug, "dev-001-e1"));
  assert.equal(a.baseSha, f.project.headSha); assert.equal((await runGit(a.path, ["symbolic-ref", "--short", "HEAD"])).stdout.trim(), a.branch);
  assert.equal((await runGit(f.project.root, ["symbolic-ref", "--short", "HEAD"])).stdout.trim(), "main");
});
integration("attempt epochs get separate worktrees, branches, and the project's latest base", async (t) => {
  const f = await fixture(t); fs.writeFileSync(join(f.project.root, "later"), "later"); const latest = await checkpoint(f.project.root, "later");
  const second = await createWorktree(f.roots, { projectRoot: f.project.root, projectSlug: f.project.slug, taskCode: "DEV-001", epoch: 2 });
  assert.notEqual(second.path, f.attempt.path); assert.notEqual(second.branch, f.attempt.branch); assert.equal(second.baseSha, latest.commit);
  assert.equal((await listWorktrees(f.project.root)).length, 3);
});
integration("worktree refuses existing attempt paths", async (t) => {
  const f = await fixture(t);
  await assert.rejects(createWorktree(f.roots, { projectRoot: f.project.root, projectSlug: f.project.slug, taskCode: "DEV-001", epoch: 1 }), code("exists"));
});
integration("worktree refuses project roots outside projectsRoot", async (t) => {
  const f = await fixture(t, false);
  await assert.rejects(createWorktree(f.roots, { projectRoot: f.source, projectSlug: f.project.slug, taskCode: "DEV-001", epoch: 1 }), code("path-escape"));
});
integration("remove deletes a registered attempt and optionally its factory branch", async (t) => {
  const f = await fixture(t);
  await removeWorktree(f.roots, { projectRoot: f.project.root, path: f.attempt.path, deleteBranch: true });
  assert.equal(fs.existsSync(f.attempt.path), false);
  assert.equal((await runGit(f.project.root, ["show-ref", "--verify", "--quiet", `refs/heads/${f.attempt.branch}`], { acceptExitCodes: [1] })).exitCode, 1);
  await assert.rejects(removeWorktree(f.roots, { projectRoot: f.project.root, path: f.attempt.path }), code("not-found"));
});
integration("remove preserves the branch unless explicitly requested", async (t) => {
  const f = await fixture(t); await removeWorktree(f.roots, { projectRoot: f.project.root, path: f.attempt.path });
  assert.equal((await runGit(f.project.root, ["show-ref", "--verify", `refs/heads/${f.attempt.branch}`])).exitCode, 0);
});
integration("remove never deletes branches outside factory/", async (t) => {
  const f = await fixture(t); await runGit(f.attempt.path, ["branch", "-m", "operator-branch"]);
  await removeWorktree(f.roots, { projectRoot: f.project.root, path: f.attempt.path, deleteBranch: true });
  assert.equal((await runGit(f.project.root, ["show-ref", "--verify", "refs/heads/operator-branch"])).exitCode, 0);
});
integration("remove refuses outside paths, the main project root, and unregistered directories", async (t) => {
  const f = await fixture(t); const unregistered = join(f.roots.worktreesRoot, "unregistered"); fs.mkdirSync(unregistered);
  const before = treeHash(unregistered);
  for (const path of [f.source, f.project.root, f.roots.worktreesRoot])
    await assert.rejects(removeWorktree(f.roots, { projectRoot: f.project.root, path }), code("path-escape"));
  await assert.rejects(removeWorktree(f.roots, { projectRoot: f.project.root, path: unregistered }), code("not-found"));
  assert.equal(treeHash(unregistered), before);
});
integration("remove refuses registered worktrees belonging to another project", async (t) => {
  const f = await fixture(t); const second = await cloneProject(f.roots, { name: "second", source: f.source });
  await assert.rejects(removeWorktree(f.roots, { projectRoot: second.root, path: f.attempt.path }), code("not-found"));
  assert.ok(fs.existsSync(f.attempt.path));
});
integration("remove refuses a symlink escaping the worktree root", async (t) => {
  const f = await fixture(t); const alias = join(f.roots.worktreesRoot, "alias"); fs.symlinkSync(f.source, alias);
  await assert.rejects(removeWorktree(f.roots, { projectRoot: f.project.root, path: alias }), code("path-escape"));
  assert.equal(treeHash(f.source), f.sourceHash);
});
integration("remove leaves other attempts, project working content, main ref, and source byte-identical", async (t) => {
  const f = await fixture(t); const second = await createWorktree(f.roots, { projectRoot: f.project.root, projectSlug: f.project.slug, taskCode: "DEV-001", epoch: 2 });
  const otherHash = treeHash(second.path); const projectHash = treeHash(f.project.root, false);
  const mainRef = (await runGit(f.project.root, ["rev-parse", "main"])).stdout;
  await removeWorktree(f.roots, { projectRoot: f.project.root, path: f.attempt.path, deleteBranch: true });
  assert.equal(treeHash(second.path), otherHash); assert.equal(treeHash(f.project.root, false), projectHash);
  assert.equal((await runGit(f.project.root, ["rev-parse", "main"])).stdout, mainRef); assert.equal(treeHash(f.source), f.sourceHash);
});

integration("checkpoint commits all worktree changes and returns null when clean", async (t) => {
  const f = await fixture(t); change(f.attempt.path);
  const result = await checkpoint(f.attempt.path, "checkpoint\n\nbody"); assert.match(result.commit, /^[a-f0-9]{40}$/);
  assert.notEqual(result.commit, f.attempt.baseSha); assert.deepEqual(await checkpoint(f.attempt.path, "clean"), { commit: null });
  assert.equal((await runGit(f.project.root, ["rev-parse", "HEAD"])).stdout.trim(), f.project.headSha);
  assert.equal(treeHash(f.source), f.sourceHash);
});
integration("checkpoint permits empty messages and never runs commit hooks", async (t) => {
  const f = await fixture(t); const hooks = join(f.project.root, ".git", "hooks"); fs.mkdirSync(hooks);
  fs.writeFileSync(join(hooks, "pre-commit"), '#!/bin/sh\nprintf ran > "$PWD/hook-marker"\n', { mode: 0o755 });
  fs.writeFileSync(join(f.attempt.path, "new"), "x"); assert.ok((await checkpoint(f.attempt.path, "")).commit);
  assert.equal(fs.existsSync(join(f.attempt.path, "hook-marker")), false);
});
integration("evidence includes added, modified, deleted, renamed, and untracked files with totals", async (t) => {
  const f = await fixture(t); change(f.attempt.path); const evidence = await collectEvidence(f.attempt.path, f.attempt.baseSha);
  assert.deepEqual(Object.fromEntries(evidence.files.map((file) => [file.path, file.status])), {
    "added.txt": "added", "base.txt": "modified", "remove.txt": "deleted", "renamed.txt": "renamed",
  });
  assert.deepEqual(evidence.totals, { files: 4, additions: 3, deletions: 2 });
  assert.equal(evidence.baseSha, f.attempt.baseSha); assert.equal(evidence.headSha, f.attempt.baseSha);
  assert.ok(evidence.patchBytes > 0); assert.equal(evidence.patchTruncated, false);
});
integration("evidence reports binary stats as null and includes unusual UTF-8 filenames", async (t) => {
  const f = await fixture(t); const names = ["with spaces.txt", "with\nnewline.txt", 'with"quotes.txt', "日本語-🔥.txt", "with\\backslash.txt"];
  for (const name of names) fs.writeFileSync(join(f.attempt.path, name), "content\n");
  fs.writeFileSync(join(f.attempt.path, "binary.bin"), Buffer.from([0, 255, 10, 0, 123]));
  const e = await collectEvidence(f.attempt.path, f.attempt.baseSha);
  for (const name of names) assert.ok(e.files.some((file) => file.path === name));
  const binary = e.files.find((file) => file.path === "binary.bin");
  assert.equal(binary.binary, true); assert.equal(binary.additions, null); assert.equal(binary.deletions, null);
});
integration("evidence parses rename paths containing tabs and newlines", async (t) => {
  const f = await fixture(t); const target = 'renamed\twith\n"quotes🔥'; fs.renameSync(join(f.attempt.path, "rename.txt"), join(f.attempt.path, target));
  const e = await collectEvidence(f.attempt.path, f.attempt.baseSha); assert.equal(e.files[0].path, target); assert.equal(e.files[0].status, "renamed");
});
integration("evidence flags executable modes, symlinks, and workflows", async (t) => {
  const f = await fixture(t); const dir = f.attempt.path; fs.chmodSync(join(dir, "base.txt"), 0o755);
  fs.symlinkSync("base.txt", join(dir, "link")); fs.mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "name: ci\n");
  const e = await collectEvidence(dir, f.attempt.baseSha);
  for (const [path, kind] of [["base.txt", "executable"], ["link", "symlink"], [".github/workflows/ci.yml", "workflow"]])
    assert.ok(e.flags.some((flag) => flag.path === path && flag.kind === kind));
});
integration("evidence recognizes type changes", async (t) => {
  const f = await fixture(t); fs.unlinkSync(join(f.attempt.path, "base.txt")); fs.symlinkSync("rename.txt", join(f.attempt.path, "base.txt"));
  const e = await collectEvidence(f.attempt.path, f.attempt.baseSha); assert.equal(e.files[0].status, "typechange");
});
integration("evidence flags blobs strictly larger than 5 MiB and measures full oversized patches", async (t) => {
  const f = await fixture(t); fs.writeFileSync(join(f.attempt.path, "large.txt"), "x".repeat(5 * 1024 * 1024 + 1));
  const e = await collectEvidence(f.attempt.path, f.attempt.baseSha);
  assert.ok(e.flags.some((flag) => flag.path === "large.txt" && flag.kind === "large-file"));
  assert.equal(e.patchTruncated, true); assert.ok(e.patchBytes > 5 * 1024 * 1024);
});
integration("evidence leaves branch history, working content, and the entire original unchanged", async (t) => {
  const f = await fixture(t); change(f.attempt.path); await checkpoint(f.attempt.path, "first"); fs.writeFileSync(join(f.attempt.path, "extra"), "extra");
  const before = treeHash(f.attempt.path); const history = (await runGit(f.attempt.path, ["log", "--format=%H"])).stdout;
  await collectEvidence(f.attempt.path, f.attempt.baseSha);
  assert.equal(treeHash(f.attempt.path), before); assert.equal((await runGit(f.attempt.path, ["log", "--format=%H"])).stdout, history);
  assert.equal((await runGit(f.attempt.path, ["merge-base", "--is-ancestor", f.attempt.baseSha, "HEAD"])).exitCode, 0);
  assert.equal(treeHash(f.source), f.sourceHash);
});
integration("clean evidence has empty files, flags, totals, and patch", async (t) => {
  const f = await fixture(t); const e = await collectEvidence(f.attempt.path, f.attempt.baseSha);
  assert.deepEqual(e.files, []); assert.deepEqual(e.flags, []); assert.deepEqual(e.totals, { files: 0, additions: 0, deletions: 0 });
  assert.equal(e.patchBytes, 0); assert.deepEqual(await buildPatch(f.attempt.path, f.attempt.baseSha), { patch: "", truncated: false });
});

test("NUL diff parser flags .git-named components that Git itself refuses to stage", () => {
  const path = "safe/.git/config";
  const parsed = parseDiffRecords(`A\0${path}\0`, `1\t0\t${path}\0`, `:000000 100644 ${"0".repeat(40)} ${nextOid} A\0${path}\0`);
  assert.deepEqual(parsed.flags, [{ path, kind: "git-internal" }]);
});
test("NUL parser preserves rename source and destination safety flags", () => {
  const parsed = parseDiffRecords("R100\0.github/workflows/old\0new name\0", "0\t0\t\0.github/workflows/old\0new name\0",
    `:100644 100644 ${baseOid} ${nextOid} R100\0.github/workflows/old\0new name\0`);
  assert.equal(parsed.files[0].path, "new name"); assert.equal(parsed.files[0].status, "renamed");
  assert.ok(parsed.flags.some((f) => f.path === ".github/workflows/old" && f.kind === "workflow"));
});
test("NUL parser fails closed on malformed or truncated records", () => {
  assert.throws(() => parseDiffRecords("A\0x", "1\t0\tx\0", ""), code("git-failed"));
  assert.throws(() => parseDiffRecords("A\0x\0", "broken\0", ""), code("git-failed"));
});

function textPatch(path, content = "new") {
  return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+${content}\n`;
}
function linkPatch(target) {
  return `diff --git a/link b/link\nnew file mode 120000\n--- /dev/null\n+++ b/link\n@@ -0,0 +1 @@\n+${target}\n\\ No newline at end of file\n`;
}
for (const [name, patch] of [
  ["git config", textPatch(".git/config")], ["nested git component", textPatch("dir/.git/hooks/pre-commit")],
  ["case trick", textPatch(".GiT/config")], ["parent", textPatch("../x")], ["nested parent", textPatch("dir/../../x")],
  ["absolute", "--- /dev/null\n+++ /etc/passwd\n@@ -0,0 +1 @@\n+x\n"],
  ["absolute after prefix stripping", textPatch("/etc/passwd")],
  ["Windows absolute", "--- /dev/null\n+++ C:\\Windows\\file\n@@ -0,0 +1 @@\n+x\n"],
  ["symlink parent", linkPatch("../../etc/passwd")], ["absolute symlink", linkPatch("/etc/passwd")],
  ["Windows symlink", linkPatch("C:\\outside")], ["backslash symlink", linkPatch("..\\..\\etc\\passwd")],
  ["rename into git", "diff --git a/ok b/.git/config\nsimilarity index 100%\nrename from ok\nrename to .git/config\n"],
  ["copy into git", "diff --git a/ok b/.git/config\ncopy from ok\ncopy to .git/config\n"],
  ["quoted git", 'diff --git "a/ok" "b/\\056git/config"\n'],
  ["quoted parent", '--- /dev/null\n+++ "b/\\056\\056/evil"\n'],
  ["NUL", "bad\0patch"],
]) test(`patch safety rejects ${name}`, () => {
  const result = patchIsSafeToApply(patch); assert.equal(result.ok, false); assert.ok(result.reasons.length);
});
for (const [name, patch] of [["normal text", textPatch("src/file.txt")], ["spaces", textPatch("with spaces")],
  ["relative symlink", linkPatch("src/file")], ["empty patch", ""],
  ["quoted unicode", 'diff --git "a/\\346\\227\\245.txt" "b/\\346\\227\\245.txt"\n']])
  test(`patch safety accepts ${name}`, () => assert.deepEqual(patchIsSafeToApply(patch), { ok: true, reasons: [] }));

integration("patch round-trips text, binary, renames, symlinks, modes, and unusual names exactly", async (t) => {
  const f = await fixture(t); change(f.attempt.path);
  for (const name of ["spaces here", "new\nline", 'a"quote', "日本語.txt"])
    fs.writeFileSync(join(f.attempt.path, name), "unusual\n");
  fs.writeFileSync(join(f.attempt.path, "binary.bin"), Buffer.from(Array.from({ length: 1024 }, (_, i) => i % 256)));
  fs.chmodSync(join(f.attempt.path, "base.txt"), 0o755); fs.symlinkSync("base.txt", join(f.attempt.path, "link"));
  const result = await buildPatch(f.attempt.path, f.attempt.baseSha); assert.equal(result.truncated, false); assert.equal(patchIsSafeToApply(result.patch).ok, true);
  const target = await cloneProject(f.roots, { name: "target", source: f.source });
  assert.deepEqual(await applyPatchToRepo({ repo: target.root, patch: result.patch }), { applied: true, checked: true });
  assert.equal(treeHash(target.root, false), treeHash(f.attempt.path, false));
  await runGit(target.root, ["add", "-A"]);
  assert.equal((await runGit(target.root, ["write-tree"])).stdout, (await runGit(f.attempt.path, ["write-tree"])).stdout);
});
integration("patch truncation always returns an empty patch, including a zero limit", async (t) => {
  const f = await fixture(t); change(f.attempt.path); const full = await buildPatch(f.attempt.path, f.attempt.baseSha);
  for (const max of [0, 1, Buffer.byteLength(full.patch) - 1])
    assert.deepEqual(await buildPatch(f.attempt.path, f.attempt.baseSha, max), { patch: "", truncated: true });
  assert.deepEqual(await buildPatch(f.attempt.path, f.attempt.baseSha, Buffer.byteLength(full.patch)), full);
});
integration("apply dry run checks first and changes neither files, index, nor commits", async (t) => {
  const f = await fixture(t); change(f.attempt.path); const result = await buildPatch(f.attempt.path, f.attempt.baseSha);
  const before = treeHash(f.project.root);
  assert.deepEqual(await applyPatchToRepo({ repo: f.project.root, patch: result.patch, dryRun: true }), { applied: false, checked: true });
  assert.equal(treeHash(f.project.root), before);
});
integration("apply never stages or commits a successful patch", async (t) => {
  const f = await fixture(t); fs.writeFileSync(join(f.attempt.path, "base.txt"), "changed\n");
  const patch = await buildPatch(f.attempt.path, f.attempt.baseSha);
  const indexBefore = fs.readFileSync(join(f.project.root, ".git", "index"));
  await applyPatchToRepo({ repo: f.project.root, patch: patch.patch });
  assert.deepEqual(fs.readFileSync(join(f.project.root, ".git", "index")), indexBefore);
  assert.equal((await runGit(f.project.root, ["diff", "--cached", "--quiet"])).exitCode, 0);
  assert.equal((await runGit(f.project.root, ["rev-parse", "HEAD"])).stdout.trim(), f.project.headSha);
  assert.equal(fs.readFileSync(join(f.project.root, "base.txt"), "utf8"), "changed\n");
});
integration("apply rejects unsafe content and leaves the entire destination untouched", async (t) => {
  const f = await fixture(t); const before = treeHash(f.project.root);
  await assert.rejects(applyPatchToRepo({ repo: f.project.root, patch: textPatch(".git/config") }), code("unsafe-content"));
  assert.equal(treeHash(f.project.root), before);
});
integration("apply conflicting patch fails its check atomically before any valid hunk is written", async (t) => {
  const f = await fixture(t); change(f.attempt.path); const result = await buildPatch(f.attempt.path, f.attempt.baseSha);
  fs.writeFileSync(join(f.project.root, "base.txt"), "conflict\n"); const before = treeHash(f.project.root);
  await assert.rejects(applyPatchToRepo({ repo: f.project.root, patch: result.patch }), code("git-failed"));
  assert.equal(treeHash(f.project.root), before); assert.equal(fs.existsSync(join(f.project.root, "added.txt")), false);
});

integration("CLI clones successfully and prints only the JSON result", async (t) => {
  const root = temp(t); const source = join(root, "source"); await init(source); const before = treeHash(source);
  const result = await invokeCli(t, ["clone", "--projects-root", join(root, "projects"), "--name", "CLI Project", "--source", source]);
  assert.equal(result.exitCode, 0); assert.equal(result.stderr, ""); const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.slug, "cli-project"); assert.equal(parsed.baseBranch, "main"); assert.equal(treeHash(source), before);
});
integration("CLI failures are single-line generic errors and never echo input", async (t) => {
  const root = temp(t); const secret = "SYNTHETIC-NOT-A-REAL-SECRET";
  const result = await invokeCli(t, ["clone", "--projects-root", join(root, "projects"), "--name", secret,
    "--source", `https://user:${secret}@example.test/repo`]);
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.equal(result.stderr, "Workspace clone failed: invalid-input\n");
  assert.equal(result.stderr.includes(secret), false);
});
integration("CLI refuses missing, duplicate, and unknown options generically", async (t) => {
  for (const args of [[], ["other"], ["clone", "--projects-root", "/tmp/x", "--name", "x", "--name", "duplicate"],
    ["clone", "--projects-root", "/tmp/x", "--unknown", "x", "--source", "/tmp/y"]]) {
    const result = await invokeCli(t, args); assert.equal(result.exitCode, 1); assert.equal(result.stderr, "Workspace clone failed: invalid-input\n");
  }
});

integration("continuation worktree starts at the earlier factory branch tip", async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(join(f.attempt.path, "continuation.txt"), "previous work\n");
  const { commit } = await checkpoint(f.attempt.path, "previous work");
  const next = await createWorktree(f.roots, { projectRoot: f.project.root, projectSlug: f.project.slug,
    taskCode: "DEV-001", epoch: 2, startFromBranch: f.attempt.branch });
  assert.equal(next.baseSha, commit);
  assert.equal(fs.readFileSync(join(next.path, "continuation.txt"), "utf8"), "previous work\n");
  assert.equal(treeHash(f.source), f.sourceHash);
  assert.equal(fs.existsSync(join(f.project.root, "continuation.txt")), false);
});

for (const branch of ["main", "factory/missing", "factory/../main", "factory/bad..name"])
  integration(`continuation refuses invalid or missing branch ${branch}`, async (t) => {
    const f = await fixture(t, false);
    await assert.rejects(createWorktree(f.roots, { projectRoot: f.project.root, projectSlug: f.project.slug,
      taskCode: "DEV-001", epoch: 1, startFromBranch: branch }), (error) => error instanceof WorkspaceError);
  });
