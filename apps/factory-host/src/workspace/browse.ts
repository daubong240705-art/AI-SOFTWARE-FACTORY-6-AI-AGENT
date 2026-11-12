import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, sep } from "node:path";

export const BROWSE_MAX_ENTRIES = 500;
export type BrowseErrorCode = "invalid-path" | "outside-roots" | "not-found" | "not-directory";
export class BrowseError extends Error {
  constructor(readonly code: BrowseErrorCode) { super(code); this.name = "BrowseError"; }
}
export interface BrowseResult {
  path: string;
  /** Null when the directory is itself a browse root: the operator cannot go above it. */
  parent: string | null;
  roots: string[];
  entries: { name: string; isGit: boolean }[];
  truncated: boolean;
}

const within = (root: string, path: string): boolean => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

/**
 * Lists the sub-directories of a directory below one of the allowed roots so the operator can pick a
 * project folder. Only directory names are returned: no files, no hidden entries, no symbolic links, and
 * never anything outside the roots (the requested path is resolved through realpath first).
 */
export function browseDirectory(allowedRoots: readonly string[], requested?: string): BrowseResult {
  const roots = allowedRoots.map((root) => { try { return realpathSync(root); } catch { return null; } })
    .filter((root): root is string => root !== null && isAbsolute(root));
  if (roots.length === 0) throw new BrowseError("outside-roots");
  const target = requested === undefined || requested === "" ? roots[0]! : requested;
  // POSIX is the production platform; on Windows (tests only) a backslash is a normal separator.
  if (!isAbsolute(target) || target.includes("\0") || (sep === "/" && target.includes("\\")) || target.length > 4096
    || target.split(/[\\/]/).some((part) => part === "..")) throw new BrowseError("invalid-path");
  let real: string;
  try { real = realpathSync(target); } catch { throw new BrowseError("not-found"); }
  const root = roots.find((candidate) => within(candidate, real));
  if (root === undefined) throw new BrowseError("outside-roots");
  let stat;
  try { stat = statSync(real); } catch { throw new BrowseError("not-found"); }
  if (!stat.isDirectory()) throw new BrowseError("not-directory");
  const entries: BrowseResult["entries"] = [];
  let truncated = false;
  let names: string[] = [];
  try { names = readdirSync(real); } catch { names = []; }
  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    if (name.startsWith(".") || name.includes("\0")) continue;
    const child = join(real, name);
    try {
      if (!lstatSync(child).isDirectory()) continue;
    } catch { continue; }
    if (entries.length >= BROWSE_MAX_ENTRIES) { truncated = true; break; }
    let isGit = false;
    try { isGit = lstatSync(join(child, ".git")).isDirectory() || lstatSync(join(child, ".git")).isFile(); } catch { isGit = false; }
    entries.push({ name, isGit });
  }
  return { path: real, parent: real === root ? null : dirname(real), roots, entries, truncated };
}
