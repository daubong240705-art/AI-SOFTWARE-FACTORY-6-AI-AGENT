import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { createHash } from "node:crypto";
import type { FileVersion, GitEvidence } from "../../shared/evidence";
import { redact } from "../runtime/security";
import { includeSourcePath } from "./snapshot";
export const hashBytes = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");
export function git(
  root: string,
  args: string[],
  maxBuffer = 2 * 1024 * 1024,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    execFile(
      "git",
      ["--no-optional-locks", "-C", root, ...args],
      {
        windowsHide: true,
        timeout: 7000,
        maxBuffer,
        encoding: "buffer",
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: "0",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
      (error, out) => (error ? reject(error) : resolve(out)),
    ),
  );
}
export type GitCapture = {
  state: GitEvidence | null;
  versions: Record<
    string,
    { head: FileVersion | null; index: FileVersion | null }
  >;
  blobs: Map<string, Buffer>;
};
export async function captureGit(
  root: string,
  contents = false,
  secrets: string[] = [],
): Promise<GitCapture> {
  const result: GitCapture = {
    state: null,
    versions: Object.create(null),
    blobs: new Map(),
  };
  let gitRoot: string;
  try {
    gitRoot = (await git(root, ["rev-parse", "--show-toplevel"]))
      .toString("utf8")
      .trim();
  } catch {
    return result;
  }
  const state: GitEvidence = {
    root: gitRoot,
    head: null,
    indexHash: null,
    status: Object.create(null),
    complete: true,
  };
  result.state = state;
  try {
    state.head = await git(root, ["rev-parse", "--verify", "HEAD"])
      .then((b) => b.toString().trim())
      .catch(() => null);
    const indexPath = (await git(root, ["rev-parse", "--git-path", "index"]))
      .toString()
      .trim();
    state.indexHash = await readFile(
      isAbsolute(indexPath) ? indexPath : join(root, indexPath),
    )
      .then(hashBytes)
      .catch((e) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
    const status = (
      await git(root, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--",
        ".",
      ])
    )
      .toString("utf8")
      .split("\0");
    const prefix = relative(gitRoot, root).replaceAll("\\", "/");
    const local = (p: string) =>
      prefix
        ? p.startsWith(prefix + "/")
          ? p.slice(prefix.length + 1)
          : null
        : p;
    for (let i = 0; i < status.length; i++) {
      const row = status[i];
      if (!row) continue;
      const path = local(row.slice(3));
      const original = /[RC]/.test(row.slice(0, 2))
        ? local(status[++i] ?? "")
        : undefined;
      if (path)
        state.status[path] = {
          index: row[0],
          worktree: row[1],
          ...(original ? { originalPath: original } : {}),
        };
    }
    state.metadataComplete = true;
    if (!contents) return result;
    let bytes = 0;
    const deadline = Date.now() + 10000;
    const paths = Object.keys(state.status).slice(0, 100);
    if (Object.keys(state.status).length > 100) state.complete = false;
    for (const path of paths) {
      if (Date.now() > deadline) {
        state.complete = false;
        break;
      }
      if (!includeSourcePath(path)) continue;
      const entry = state.status[path];
      const read = async (ref: string): Promise<FileVersion | null> => {
        try {
          const data = await git(root, ["cat-file", "blob", ref], 1024 * 1024);
          const hash = hashBytes(data);
          bytes += data.length;
          const secret =
            redact(data.toString("utf8"), secrets, Infinity) !==
            data.toString("utf8");
          const reason =
            bytes > 16 * 1024 * 1024
              ? "Vượt giới hạn nội dung Git (16 MB)."
              : secret
                ? "Nội dung có mẫu credential; chỉ lưu hash."
                : undefined;
          if (!reason) result.blobs.set(hash, data);
          else state.complete = false;
          return { hash, size: data.length, mode: 0, reason };
        } catch {
          state.complete = false;
          return {
            hash: null,
            size: 0,
            mode: 0,
            reason: "Không lưu được nội dung Git (tối đa 1 MB/file).",
          };
        }
      };
      const repoPath = prefix ? prefix + "/" + path : path;
      const oldPath = entry.originalPath
        ? prefix
          ? prefix + "/" + entry.originalPath
          : entry.originalPath
        : repoPath;
      result.versions[path] = {
        head:
          entry.index === "?" || entry.index === "A" || !state.head
            ? null
            : await read(`HEAD:${oldPath}`),
        index:
          entry.index === "?" || entry.index === "D"
            ? null
            : await read(`:${repoPath}`),
      };
    }
    // Detect HEAD/index edits while reading blobs; never present a mixed snapshot as complete.
    const check = await captureGit(root, false);
    if (
      check.state?.head !== state.head ||
      check.state?.indexHash !== state.indexHash
    ) {
      state.complete = false;
      state.metadataComplete = false;
    }
  } catch {
    state.complete = false;
  }
  return result;
}
