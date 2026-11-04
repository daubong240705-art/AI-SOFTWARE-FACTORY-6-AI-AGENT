import { readdir, readFile, lstat } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import type { ChangedFile } from "../../shared/runs";

export type Snapshot = { files: Record<string, string>; complete: boolean };
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
export async function snapshot(root: string): Promise<Snapshot> {
  const result: Snapshot = { files: {}, complete: true };
  let bytes = 0;
  let entries = 0;
  async function walk(directory: string): Promise<void> {
    let items;
    try {
      items = await readdir(directory, { withFileTypes: true });
    } catch {
      result.complete = false;
      return;
    }
    for (const item of items) {
      if (excluded.has(item.name) || sensitive.test(item.name)) continue;
      if (++entries > 8000) {
        result.complete = false;
        return;
      }
      const path = join(directory, item.name);
      if (item.isSymbolicLink()) {
        result.complete = false;
        continue;
      }
      if (item.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!item.isFile()) continue;
      try {
        const info = await lstat(path);
        if (info.size > 1024 * 1024 || bytes + info.size > 48 * 1024 * 1024) {
          result.complete = false;
          continue;
        }
        const data = await readFile(path);
        bytes += data.length;
        result.files[relative(root, path).replaceAll("\\", "/")] = createHash(
          "sha256",
        )
          .update(data)
          .digest("hex");
      } catch {
        result.complete = false;
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
