import fs from "node:fs";
import { join, resolve } from "node:path";
import { runGit } from "./git.js";
import { assertInside, checkedDirectory, refuseMount, requireLinux, validateRoots, WorkspaceError, type WorkspaceRoots } from "./paths.js";

export interface WorktreeInfo { path: string; branch: string | null; headSha: string | null }

async function checkedProject(projectsRoot: string, candidate: string): Promise<string> {
  const project = assertInside(projectsRoot, candidate);
  checkedDirectory(assertInside(projectsRoot, project));
  // A project must own its Git metadata. A .git file could redirect writes to the original.
  const metadata = assertInside(project, join(project, ".git"));
  if (!fs.lstatSync(assertInside(project, metadata)).isDirectory()) throw new WorkspaceError("path-escape");
  const common = (await runGit(assertInside(projectsRoot, project),
    ["rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.replace(/\n$/, "");
  if (assertInside(project, common) !== metadata) throw new WorkspaceError("path-escape");
  return project;
}

export function validateAttempt(input: { projectSlug: string; taskCode: string; epoch: number }): void {
  if (typeof input.projectSlug !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(input.projectSlug) || input.projectSlug.length > 64 ||
    typeof input.taskCode !== "string" || !/^[A-Z]{2,6}-\d{3,6}$/.test(input.taskCode) ||
    !Number.isSafeInteger(input.epoch) || input.epoch < 1) throw new WorkspaceError("invalid-input");
}

export async function listWorktrees(projectRoot: string): Promise<WorktreeInfo[]> {
  requireLinux();
  const directory = checkedDirectory(projectRoot);
  refuseMount(directory);
  const output = (await runGit(directory, ["worktree", "list", "--porcelain", "-z"])).stdout;
  const result: WorktreeInfo[] = [];
  let entry: WorktreeInfo | undefined;
  for (const field of output.split("\0")) {
    if (field.startsWith("worktree ")) {
      entry = { path: field.slice(9), branch: null, headSha: null };
      result.push(entry);
    } else if (entry && field.startsWith("HEAD ")) entry.headSha = field.slice(5);
    else if (entry && field.startsWith("branch refs/heads/")) entry.branch = field.slice(18);
  }
  return result;
}

export async function createWorktree(roots: WorkspaceRoots, input: {
  projectRoot: string; projectSlug: string; taskCode: string; epoch: number;
}): Promise<{ path: string; branch: string; baseSha: string }> {
  validateAttempt(input);
  const safe = validateRoots(roots);
  const project = await checkedProject(safe.projectsRoot, input.projectRoot);
  const stem = `${input.taskCode.toLowerCase()}-e${input.epoch}`;
  const branch = `factory/${stem}`;
  const parent = assertInside(safe.worktreesRoot, join(safe.worktreesRoot, input.projectSlug));
  const path = assertInside(safe.worktreesRoot, join(parent, stem));
  try {
    fs.lstatSync(assertInside(safe.worktreesRoot, path));
    throw new WorkspaceError("exists");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const baseSha = (await runGit(assertInside(safe.projectsRoot, project), ["rev-parse", "--verify", "HEAD"])).stdout.trim();
  fs.mkdirSync(assertInside(safe.worktreesRoot, parent), { recursive: true, mode: 0o700 });
  await runGit(assertInside(safe.projectsRoot, project), ["worktree", "add", "-b", branch,
    assertInside(safe.worktreesRoot, path), baseSha]);
  checkedDirectory(assertInside(safe.worktreesRoot, path));
  const head = (await runGit(assertInside(safe.worktreesRoot, path), ["rev-parse", "--verify", "HEAD"])).stdout.trim();
  if (head !== baseSha) throw new WorkspaceError("git-failed", "git worktree failed");
  return { path, branch, baseSha };
}

export async function removeWorktree(roots: WorkspaceRoots, input: {
  projectRoot: string; path: string; deleteBranch?: boolean;
}): Promise<void> {
  const safe = validateRoots(roots);
  const path = assertInside(safe.worktreesRoot, input.path);
  const project = await checkedProject(safe.projectsRoot, input.projectRoot);
  // Do not let an alias select a different registered directory for deletion.
  if (path !== resolve(input.path)) throw new WorkspaceError("path-escape");
  const registered = (await listWorktrees(assertInside(safe.projectsRoot, project)))
    .find((entry) => entry.path === path);
  if (!registered) throw new WorkspaceError("not-found");
  try { checkedDirectory(assertInside(safe.worktreesRoot, path)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new WorkspaceError("not-found");
    throw error;
  }
  await runGit(assertInside(safe.projectsRoot, project), ["worktree", "remove", "--force", "--",
    assertInside(safe.worktreesRoot, path)]);
  await runGit(assertInside(safe.projectsRoot, project), ["worktree", "prune"]);
  if (input.deleteBranch && registered.branch?.startsWith("factory/"))
    await runGit(assertInside(safe.projectsRoot, project), ["branch", "-D", "--", registered.branch]);
}
