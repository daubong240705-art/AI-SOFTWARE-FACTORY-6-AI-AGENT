import fs from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface WorkspaceRoots { projectsRoot: string; worktreesRoot: string }
export class WorkspaceError extends Error {
  constructor(
    readonly code: "path-escape" | "unsupported-platform" | "invalid-input" | "git-failed" | "exists" | "not-found" | "unsafe-content",
    message: string = code,
  ) { super(message); this.name = "WorkspaceError"; }
}

export function slugify(name: string): string {
  if (typeof name !== "string") throw new WorkspaceError("invalid-input");
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 48).replace(/-+$/g, "") || "project";
}

function absolute(path: string): void {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) throw new WorkspaceError("path-escape");
  // Reject traversal before normalization: resolving a symlink followed by '..' is ambiguous.
  if (path.split(/[\\/]/).includes("..")) throw new WorkspaceError("path-escape");
}

/** Resolve missing descendants without treating dangling links as missing directories. */
export function canonicalPath(path: string): string {
  absolute(path);
  let ancestor = resolve(path);
  const remainder: string[] = [];
  for (;;) {
    try { return join(fs.realpathSync(ancestor), ...remainder); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new WorkspaceError("path-escape");
      try {
        if (fs.lstatSync(ancestor).isSymbolicLink()) throw new WorkspaceError("path-escape");
      } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code !== "ENOENT") throw new WorkspaceError("path-escape");
      }
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new WorkspaceError("path-escape");
      remainder.unshift(ancestor.slice(parent.length).replace(/^[\\/]+/, ""));
      ancestor = parent;
    }
  }
}

function inside(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return difference !== "" && !isAbsolute(difference) && difference !== ".." && !difference.startsWith(`..${sep}`);
}

export function assertInside(root: string, candidate: string): string {
  absolute(root); absolute(candidate);
  if (!inside(resolve(root), resolve(candidate))) throw new WorkspaceError("path-escape");
  const boundary = canonicalPath(root);
  const result = canonicalPath(candidate);
  if (!inside(boundary, result)) throw new WorkspaceError("path-escape");
  return result;
}

export function requireLinux(): void {
  if (process.platform !== "linux") throw new WorkspaceError("unsupported-platform");
}

export function refuseMount(path: string): void {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  if (normalized === "/mnt" || normalized.startsWith("/mnt/")) throw new WorkspaceError("path-escape");
}

/** Standalone repository APIs have an explicit caller-selected directory as their boundary. */
export function checkedDirectory(path: string): string {
  absolute(path);
  const directory = assertInside(dirname(resolve(path)), path);
  if (!fs.statSync(assertInside(dirname(directory), directory)).isDirectory()) throw new WorkspaceError("invalid-input");
  return directory;
}

export function canonicalRoots(roots: WorkspaceRoots): WorkspaceRoots {
  if (!roots || typeof roots !== "object") throw new WorkspaceError("invalid-input");
  for (const path of [roots.projectsRoot, roots.worktreesRoot]) { absolute(path); refuseMount(path); }
  const projectsRoot = canonicalPath(roots.projectsRoot);
  const worktreesRoot = canonicalPath(roots.worktreesRoot);
  for (const path of [projectsRoot, worktreesRoot]) refuseMount(path);
  if (projectsRoot === worktreesRoot || inside(projectsRoot, worktreesRoot) || inside(worktreesRoot, projectsRoot))
    throw new WorkspaceError("path-escape");
  return { projectsRoot, worktreesRoot };
}

export function validateRoots(roots: WorkspaceRoots): WorkspaceRoots {
  const { projectsRoot, worktreesRoot } = canonicalRoots(roots);
  requireLinux();
  for (const path of [projectsRoot, worktreesRoot]) {
    fs.mkdirSync(assertInside(dirname(path), path), { recursive: true, mode: 0o700 });
    if (!fs.statSync(assertInside(dirname(path), path)).isDirectory()) throw new WorkspaceError("invalid-input");
  }
  return { projectsRoot, worktreesRoot };
}
