import fs from "node:fs";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import type { TokenGrant } from "../proxy/tokens.js";
import { assertInside, canonicalPath } from "../workspace/paths.js";

export class McpToolError extends Error {
  constructor(readonly reason: "attempt is not active" | "tool limit reached" | "output could not be registered") {
    super(reason);
  }
}

export function assertActiveGrant(raw: Database, grant: TokenGrant): void {
  if (!raw.prepare(`SELECT 1 FROM attempts WHERE project_id = ? AND task_id = ? AND id = ? AND epoch = ?
    AND state IN ('running', 'waiting-input')`).get(grant.projectId, grant.taskId, grant.attemptId, grant.epoch))
    throw new McpToolError("attempt is not active");
}

export function sanitizeAgentText(text: string): string {
  return text.replace(/fpx_[A-Za-z0-9_-]+|\bsk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/[A-Za-z]:[\\/][^\s<>"'`]+|(?<![\w:])\/(?:[^\s<>"'`]+\/)*[^\s<>"'`]+/g, "[path]")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ");
}

/** Check every component before opening. Linux directory descriptors anchor traversal across renames. */
export function readWorkspaceOutput(grant: TokenGrant, path: string): Buffer {
  const descriptors: number[] = [];
  const limit = 8 * 1024 * 1024;
  try {
    const parts = path.split("/");
    if (!grant.workspacePath || !path || path.length > 4096 || /[\\\0:]/.test(path)
      || parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) throw new Error();
    const root = canonicalPath(grant.workspacePath);
    if (root !== resolve(grant.workspacePath) || fs.lstatSync(root).isSymbolicLink()) throw new Error();
    const target = join(root, ...parts);
    // lstat before canonicalization refuses even links that point back inside the workspace.
    let current = root;
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new Error();
    }
    if (assertInside(root, target) !== target) throw new Error();
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    let file = target;
    if (process.platform === "linux") {
      let parent = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | noFollow);
      descriptors.push(parent);
      for (const part of parts.slice(0, -1)) {
        parent = fs.openSync(`/proc/self/fd/${parent}/${part}`, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | noFollow);
        descriptors.push(parent);
      }
      file = `/proc/self/fd/${parent}/${parts.at(-1) ?? ""}`;
    }
    const before = fs.lstatSync(target);
    const fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow | (fs.constants.O_NONBLOCK ?? 0));
    descriptors.push(fd);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit || stat.dev !== before.dev || stat.ino !== before.ino
      || assertInside(root, target) !== target) throw new Error();
    const chunks: Buffer[] = [];
    let size = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(65536, limit + 1 - size));
      const read = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!read) break;
      size += read;
      if (size > limit) throw new Error();
      chunks.push(chunk.subarray(0, read));
    }
    const after = fs.fstatSync(fd);
    if (!after.isFile() || after.size > limit || after.size !== size) throw new Error();
    return Buffer.concat(chunks, size);
  } catch { throw new McpToolError("output could not be registered"); }
  finally { for (const fd of descriptors.reverse()) fs.closeSync(fd); }
}
