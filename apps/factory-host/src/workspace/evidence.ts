import { posix } from "node:path";
import { readGitDiff, runGit } from "./git.js";
import { checkedDirectory, refuseMount, requireLinux, WorkspaceError } from "./paths.js";

export interface Evidence {
  baseSha: string; headSha: string | null;
  files: Array<{ path: string; status: "added" | "modified" | "deleted" | "renamed" | "typechange";
    additions: number | null; deletions: number | null; binary: boolean }>;
  totals: { files: number; additions: number; deletions: number };
  flags: Array<{ path: string; kind: "symlink" | "executable" | "workflow" | "git-internal" | "large-file" }>;
  patchBytes: number; patchTruncated: boolean;
}
export const DEFAULT_PATCH_BYTES = 5 * 1024 * 1024;
const badOutput = (): never => { throw new WorkspaceError("git-failed", "git diff failed"); };

function validateBase(baseSha: string): void {
  if (typeof baseSha !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseSha)) throw new WorkspaceError("invalid-input");
}

async function stage(worktree: string): Promise<string> {
  requireLinux();
  const directory = checkedDirectory(worktree);
  refuseMount(directory);
  const top = (await runGit(directory, ["rev-parse", "--show-toplevel"])).stdout.replace(/\n$/, "");
  if (top !== directory) throw new WorkspaceError("invalid-input");
  // `.factory/` is the agents' scratch output (browser screenshots, traces, tool logs); it never becomes a result.
  await runGit(checkedDirectory(directory), ["add", "-A", "--", "."], { excludeScratch: true });
  return directory;
}

export async function checkpoint(worktree: string, message: string): Promise<{ commit: string | null }> {
  if (typeof message !== "string" || message.includes("\0")) throw new WorkspaceError("invalid-input");
  const directory = await stage(worktree);
  const changes = await runGit(checkedDirectory(directory), ["diff", "--cached", "--quiet", "--exit-code", "--no-ext-diff"],
    { acceptExitCodes: [1] });
  if (changes.exitCode === 0) return { commit: null };
  await runGit(checkedDirectory(directory), ["commit", "--no-verify", "--allow-empty-message", "--cleanup=verbatim", "-F", "-"],
    { stdin: message });
  return { commit: (await runGit(checkedDirectory(directory), ["rev-parse", "--verify", "HEAD"])).stdout.trim() };
}

/** Git's -z formats use separate tokens for rename source/destination, never quoted filenames. */
export function parseDiffRecords(nameStatus: string, numstat: string, raw: string): {
  files: Evidence["files"]; flags: Evidence["flags"]; blobs: Array<{ path: string; oid: string }>;
} {
  const counts = new Map<string, { additions: number | null; deletions: number | null; binary: boolean }>();
  const tokens = numstat.split("\0");
  if (tokens.pop() !== "") badOutput();
  for (let i = 0; i < tokens.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(tokens[i] ?? "") ?? badOutput();
    let path = match[3] ?? badOutput();
    if (path === "") { i++; if (tokens[i] === undefined) badOutput(); path = tokens[++i] ?? badOutput(); }
    counts.set(path, { additions: match[1] === "-" ? null : Number(match[1]),
      deletions: match[2] === "-" ? null : Number(match[2]), binary: match[1] === "-" || match[2] === "-" });
  }
  const flags: Evidence["flags"] = [];
  const flagged = new Set<string>();
  const flag = (path: string, kind: Evidence["flags"][number]["kind"]): void => {
    const key = `${kind}\0${path}`;
    if (!flagged.has(key)) { flagged.add(key); flags.push({ path, kind }); }
  };
  const pathFlags = (path: string): void => {
    if (path.startsWith(".github/workflows/")) flag(path, "workflow");
    if (path.split("/").some((part) => part.toLowerCase() === ".git")) flag(path, "git-internal");
  };
  const files: Evidence["files"] = [];
  const names = nameStatus.split("\0");
  if (names.pop() !== "") badOutput();
  for (let i = 0; i < names.length; i++) {
    const status = names[i] ?? badOutput();
    let path = names[++i] ?? badOutput();
    pathFlags(path);
    if (/^[RC]\d+$/.test(status)) { path = names[++i] ?? badOutput(); pathFlags(path); }
    const statuses = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "added", T: "typechange" } as const;
    const kind = statuses[status[0] as keyof typeof statuses] ?? badOutput();
    files.push({ path, status: kind, ...(counts.get(path) ?? badOutput()) });
  }
  const blobs: Array<{ path: string; oid: string }> = [];
  const metadata = raw.split("\0");
  if (metadata.pop() !== "") badOutput();
  for (let i = 0; i < metadata.length; i++) {
    const match = /^:(\d{6}) (\d{6}) ([a-f0-9]+) ([a-f0-9]+) ([A-Z]\d*)$/.exec(metadata[i] ?? "") ?? badOutput();
    const oldPath = metadata[++i] ?? badOutput();
    const path = /^[RC]/.test(match[5] ?? "") ? metadata[++i] ?? badOutput() : oldPath;
    for (const record of [[match[1], match[3], oldPath], [match[2], match[4], path]]) {
      const mode = record[0] ?? badOutput(); const oid = record[1] ?? badOutput(); const name = record[2] ?? badOutput();
      if (mode === "120000") flag(name, "symlink");
      if (mode === "100755") flag(name, "executable");
      if ((mode === "100644" || mode === "100755" || mode === "120000") && !/^0+$/.test(oid)) blobs.push({ path: name, oid });
    }
  }
  return { files, flags, blobs };
}

export async function collectEvidence(worktree: string, baseSha: string): Promise<Evidence> {
  validateBase(baseSha);
  const directory = await stage(worktree);
  const diff = ["diff", "--cached", "--find-renames", "--no-ext-diff", "--no-textconv"];
  const names = await runGit(checkedDirectory(directory), [...diff, "--name-status", "-z", baseSha, "--"]);
  const counts = await runGit(checkedDirectory(directory), [...diff, "--numstat", "-z", baseSha, "--"]);
  const raw = await runGit(checkedDirectory(directory), [...diff, "--raw", "--no-abbrev", "-z", baseSha, "--"]);
  const parsed = parseDiffRecords(names.stdout, counts.stdout, raw.stdout);
  const objects = [...new Set(parsed.blobs.map((blob) => blob.oid))];
  if (objects.length) {
    const sizes = await runGit(checkedDirectory(directory), ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
      { stdin: objects.join("\n") + "\n" });
    const large = new Set<string>();
    for (const line of sizes.stdout.trimEnd().split("\n")) {
      const match = /^([a-f0-9]+) blob (\d+)$/.exec(line) ?? badOutput();
      if (Number(match[2]) > DEFAULT_PATCH_BYTES) large.add(match[1] ?? badOutput());
    }
    for (const blob of parsed.blobs) if (large.has(blob.oid) &&
      !parsed.flags.some((flag) => flag.path === blob.path && flag.kind === "large-file"))
      parsed.flags.push({ path: blob.path, kind: "large-file" });
  }
  const head = await runGit(checkedDirectory(directory), ["rev-parse", "--verify", "HEAD"], { acceptExitCodes: [128] });
  const patch = await readGitDiff(checkedDirectory(directory), baseSha, DEFAULT_PATCH_BYTES);
  return {
    baseSha, headSha: head.exitCode === 0 ? head.stdout.trim() : null, files: parsed.files,
    totals: { files: parsed.files.length, additions: parsed.files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
      deletions: parsed.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0) },
    flags: parsed.flags, patchBytes: patch.patchBytes, patchTruncated: patch.truncated,
  };
}

export async function buildPatch(worktree: string, baseSha: string, maxBytes = DEFAULT_PATCH_BYTES): Promise<{
  patch: string; truncated: boolean;
}> {
  validateBase(baseSha);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new WorkspaceError("invalid-input");
  const directory = await stage(worktree);
  const { patch, truncated } = await readGitDiff(checkedDirectory(directory), baseSha, maxBytes);
  return { patch, truncated };
}

/** Decode Git's C-quoted UTF-8 path format, including three-digit octal byte escapes. */
function unquote(value: string): string {
  if (!value.startsWith('"')) return value;
  if (!value.endsWith('"')) throw new Error("invalid quoting");
  const body = value.slice(1, -1);
  const bytes: number[] = [];
  const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  for (let i = 0; i < body.length;) {
    if (body[i] !== "\\") {
      const point = body.codePointAt(i);
      if (point === undefined) throw new Error("invalid quoting");
      const character = String.fromCodePoint(point);
      bytes.push(...Buffer.from(character)); i += character.length;
    } else {
      i++;
      const octal = /^[0-7]{1,3}/.exec(body.slice(i))?.[0];
      if (octal) { bytes.push(parseInt(octal, 8)); i += octal.length; }
      else {
        const escaped = escapes[body[i] ?? ""];
        if (escaped === undefined) throw new Error("invalid quoting");
        bytes.push(escaped); i++;
      }
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

export function patchIsSafeToApply(patch: string): { ok: boolean; reasons: string[] } {
  const reasons = new Set<string>();
  if (typeof patch !== "string" || patch.includes("\0")) return { ok: false, reasons: ["invalid patch"] };
  const checkPath = (value: string, prefixed: boolean): void => {
    let path = unquote(value);
    if (path === "/dev/null") return;
    if (/^(?:[\\/]|[a-z]:)/i.test(path)) reasons.add("absolute path");
    if (prefixed && /^[ab]\//.test(path)) path = path.slice(2);
    if (/^(?:[\\/]|[a-z]:)/i.test(path)) reasons.add("absolute path");
    const parts = path.split(/[\\/]/);
    if (parts.includes("..")) reasons.add("parent path");
    if (parts.some((part) => part.toLowerCase() === ".git")) reasons.add("git internal path");
    if (!path) reasons.add("invalid path");
  };
  let symlink = false;
  let hunk = false;
  let target: string[] = [];
  const finish = (): void => {
    if (!symlink) return;
    const link = target.join("\n");
    if (!link || /^(?:[\\/]|[a-z]:)/i.test(link) || link.split(/[\\/]/).includes("..") || posix.isAbsolute(link))
      reasons.add("unsafe symlink target");
  };
  try {
    for (const line of patch.split("\n")) {
      if (line.startsWith("diff --git ")) {
        finish(); symlink = false; hunk = false; target = [];
        const body = line.slice(11);
        if (body.startsWith('"')) {
          const first = /^"(?:[^"\\]|\\.)*"/.exec(body)?.[0];
          if (!first || body[first.length] !== " ") throw new Error("invalid header");
          checkPath(first, true); checkPath(body.slice(first.length + 1), true);
        } else {
          // Spaces need no quoting in Git's diff header. Check every possible separator.
          const separators = [...body.matchAll(/ (?=b\/|"b\/)/g)];
          if (!separators.length) {
            const split = body.indexOf(" ");
            if (split < 0) throw new Error("invalid header");
            checkPath(body.slice(0, split), true); checkPath(body.slice(split + 1), true);
          } else for (const match of separators) {
            checkPath(body.slice(0, match.index), true); checkPath(body.slice(match.index + 1), true);
          }
        }
      } else if (!hunk && /^(?:rename|copy) (?:from|to) /.test(line)) checkPath(line.replace(/^(?:rename|copy) (?:from|to) /, ""), false);
      else if (!hunk && /^(?:---|\+\+\+) /.test(line)) checkPath(line.slice(4).split("\t", 1)[0] ?? "", true);
      else if (!hunk && /^(?:new file mode|new mode) 120000$/.test(line)) symlink = true;
      else if (!hunk && /^index \S+ 120000$/.test(line)) symlink = true;
      else if (line.startsWith("@@")) hunk = true;
      else if (hunk && symlink && line.startsWith("+")) target.push(line.slice(1));
      else if (hunk && symlink && line.startsWith(" ")) target.push(line.slice(1));
    }
    finish();
  } catch { reasons.add("invalid patch header"); }
  return { ok: reasons.size === 0, reasons: [...reasons] };
}
