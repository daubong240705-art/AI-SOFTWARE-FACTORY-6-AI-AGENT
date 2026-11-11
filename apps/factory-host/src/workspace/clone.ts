import fs from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { runGit } from "./git.js";
import { assertInside, canonicalRoots, checkedDirectory, requireLinux, slugify, validateRoots, WorkspaceError, type WorkspaceRoots } from "./paths.js";

export function validateSource(source: string): { source: string; local: boolean } {
  const invalid = (): never => { throw new WorkspaceError("invalid-input"); };
  if (typeof source !== "string" || !source || /[\0\r\n]/.test(source) || source.startsWith("-")) invalid();
  if (source.startsWith("https://")) {
    if (/\s/.test(source) || source.includes("\\")) invalid();
    try {
      const url = new URL(source);
      // Even empty userinfo is rejected; credentials must never reach git or diagnostics.
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
        source.slice(8).split(/[/?#]/, 1)[0]?.includes("@") || url.hash) invalid();
    } catch { invalid(); }
    return { source, local: false };
  }
  if (!isAbsolute(source)) invalid();
  try { return { source: checkedDirectory(source), local: true }; }
  catch { return invalid(); }
}

export async function cloneProject(roots: WorkspaceRoots, input: { name: string; source: string }): Promise<{
  root: string; slug: string; baseBranch: string; headSha: string;
}> {
  const source = validateSource(input.source);
  const stem = slugify(input.name);
  const boundaries = canonicalRoots(roots);
  if (source.local) {
    // Creating a clone anywhere within its source would itself modify the original repository.
    for (const boundary of [boundaries.projectsRoot, boundaries.worktreesRoot]) {
      const difference = relative(source.source, boundary);
      if (!difference || (!isAbsolute(difference) && difference !== ".." && !difference.startsWith(`..${sep}`)))
        throw new WorkspaceError("path-escape");
    }
    requireLinux();
    try {
      await runGit(checkedDirectory(source.source), ["rev-parse", "--git-dir"], { allowSafeDirectory: source.source });
    } catch { throw new WorkspaceError("invalid-input"); }
  }
  const safe = validateRoots(boundaries);
  let slug = stem;
  let destination: string;
  for (let suffix = 1; ; suffix++) {
    slug = suffix === 1 ? stem : `${stem}-${suffix}`;
    destination = assertInside(safe.projectsRoot, join(safe.projectsRoot, slug));
    try { fs.mkdirSync(assertInside(safe.projectsRoot, destination), { mode: 0o700 }); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new WorkspaceError("git-failed", "git clone failed"); }
  }
  // Retain inode ownership so a replaced destination is never cleaned up by this invocation.
  const owned = fs.lstatSync(assertInside(safe.projectsRoot, destination));
  try {
    await runGit(checkedDirectory(safe.projectsRoot), ["clone", "--no-local", "--no-hardlinks", "--template=", "--",
      source.source, assertInside(safe.projectsRoot, destination)],
    source.local ? { allowSafeDirectory: source.source } : {});
    const directory = assertInside(safe.projectsRoot, destination);
    for (const [key, value] of [
      ["remote.origin.pushurl", "no-push://disabled"], ["user.name", "Factory"],
      ["user.email", "factory@localhost"], ["core.autocrlf", "false"],
    ] as const) await runGit(assertInside(safe.projectsRoot, directory), ["config", "--local", "--replace-all", key, value]);
    const headSha = (await runGit(assertInside(safe.projectsRoot, directory), ["rev-parse", "--verify", "HEAD"])).stdout.trim();
    const baseBranch = (await runGit(assertInside(safe.projectsRoot, directory), ["symbolic-ref", "--quiet", "--short", "HEAD"],
      { acceptExitCodes: [1] })).stdout.trim();
    return { root: directory, slug, baseBranch, headSha };
  } catch (error) {
    const target = assertInside(safe.projectsRoot, destination);
    const current = fs.lstatSync(assertInside(safe.projectsRoot, target));
    if (!current.isSymbolicLink() && current.dev === owned.dev && current.ino === owned.ino)
      fs.rmSync(assertInside(safe.projectsRoot, target), { recursive: true, force: true });
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError("git-failed", "git clone failed");
  }
}
