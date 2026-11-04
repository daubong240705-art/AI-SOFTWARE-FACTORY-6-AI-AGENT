import { readdir, readFile, lstat, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import type { ChangedFile } from "../../shared/runs";
import type { FileVersion } from "../../shared/evidence";
import { redact } from "../runtime/security";

export type Snapshot = {
  problems?: { path: string; reason: string }[];
  latestMtime?: number;
  files: Record<string, string>;
  complete: boolean;
  entries?: Record<string, FileVersion>;
  blobs?: Map<string, Buffer>;
  enumerationComplete?: boolean;
  contentComplete?: boolean;
};
const excluded = new Set([
  ".git",
  "node_modules",
  "out",
  "dist",
  "build",
  ".next",
  ".venv",
  "__pycache__",
  ".cache",
  ".idea",
]);
const sensitive =
  /(^\.env($|\.)|\.(pem|key|pfx|p12)$|^(auth|credentials)\.json$)/i;
export const includeSourcePath = (path: string) =>
  path.split("/").every((part) => !excluded.has(part) && !sensitive.test(part));
export async function snapshot(
  root: string,
  capture = false,
  secrets: string[] = [],
): Promise<Snapshot> {
  const result: Snapshot = {
    problems: [],
    files: Object.create(null),
    complete: true,
    ...(capture
      ? {
          entries: Object.create(null),
          blobs: new Map<string, Buffer>(),
          enumerationComplete: true,
          contentComplete: true,
        }
      : {}),
  };
  let bytes = 0;
  let entries = 0;
  async function walk(directory: string): Promise<void> {
    let items;
    try {
      items = await readdir(directory, { withFileTypes: true });
    } catch {
      if (result.problems!.length < 16)
        result.problems!.push({
          path: relative(root, directory) || ".",
          reason: "Không đọc được thư mục.",
        });
      result.complete = false;
      result.enumerationComplete = false;
      return;
    }
    for (const item of items) {
      if (excluded.has(item.name) || sensitive.test(item.name)) continue;
      if (++entries > 8000) {
        if (result.problems!.length < 16)
          result.problems!.push({
            path: relative(root, join(directory, item.name)),
            reason: "Vượt 8.000 entry.",
          });
        result.complete = false;
        result.enumerationComplete = false;
        return;
      }
      const path = join(directory, item.name);
      const name = relative(root, path).replaceAll("\\", "/");
      if (item.isSymbolicLink()) {
        if (result.problems!.length < 16)
          result.problems!.push({
            path: name,
            reason: "Symlink không được theo dõi.",
          });
        result.complete = false;
        if (result.entries)
          result.entries[name] = {
            hash: null,
            size: 0,
            mode: 0,
            reason: "Liên kết tượng trưng: không đọc hoặc khôi phục.",
          };
        continue;
      }
      if (item.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!item.isFile()) continue;
      try {
        const info = await lstat(path);
        result.latestMtime = Math.max(result.latestMtime ?? 0, info.mtimeMs);
        if (!info.isFile() || info.isSymbolicLink())
          throw new Error("File type changed");
        if (info.size > 1024 * 1024 || bytes + info.size > 48 * 1024 * 1024) {
          if (result.problems!.length < 16)
            result.problems!.push({
              path: name,
              reason: "Vượt 1 MB/file hoặc 48 MB snapshot.",
            });
          result.complete = false;
          if (result.entries)
            result.entries[name] = {
              hash: null,
              size: info.size,
              mode: info.mode,
              stamp: `${info.size}:${info.mtimeMs}`,
              reason: "Vượt giới hạn snapshot (1 MB/file, 48 MB/lượt).",
            };
          continue;
        }
        const data = await readFile(path);
        bytes += data.length;
        const hash = createHash("sha256").update(data).digest("hex");
        result.files[name] = hash;
        const after = await lstat(path);
        const real = relative(root, await realpath(path));
        const unstable =
          real.startsWith("..") ||
          isAbsolute(real) ||
          after.isSymbolicLink() ||
          after.size !== info.size ||
          after.mtimeMs !== info.mtimeMs ||
          after.ino !== info.ino;
        if (unstable) {
          result.complete = false;
          if (result.problems!.length < 16)
            result.problems!.push({
              path: name,
              reason: "File thay đổi trong lúc chụp.",
            });
        }
        if (result.entries) {
          const secret =
            redact(data.toString("utf8"), secrets, Infinity) !==
            data.toString("utf8");
          const reason = unstable
            ? "File thay đổi trong lúc chụp."
            : secret
              ? "Nội dung có mẫu credential; chỉ lưu hash."
              : undefined;
          result.entries[name] = {
            hash,
            size: data.length,
            mode: info.mode,
            reason,
          };
          if (!reason) result.blobs!.set(hash, data);
          else {
            result.contentComplete = false;
            if (unstable) result.complete = false;
          }
        }
      } catch {
        if (result.problems!.length < 16)
          result.problems!.push({
            path: name,
            reason: "File bị khóa, thay loại hoặc không đọc được.",
          });
        result.complete = false;
        result.enumerationComplete = false;
      }
    }
  }
  await walk(root);
  return result;
}
export function changes(before: Snapshot, after: Snapshot): ChangedFile[] {
  return [
    ...new Set([...Object.keys(before.files), ...Object.keys(after.files)]),
  ]
    .filter((path) => before.files[path] !== after.files[path])
    .filter(
      (path) =>
        (before.files[path] && after.files[path]) ||
        (!before.files[path] && before.complete) ||
        (!after.files[path] && after.complete),
    )
    .map((path) => ({
      path,
      kind: !before.files[path]
        ? "added"
        : !after.files[path]
          ? "deleted"
          : "modified",
    }));
}
