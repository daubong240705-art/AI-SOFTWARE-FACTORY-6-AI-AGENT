import { execFile } from "node:child_process";
import { lstat, open, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { constants } from "node:fs";
import {
  gitSnapshotSchema,
  gitDiffSchema,
  type GitSnapshot,
  type GitSnapshotRequest,
  type GitDiffRequest,
  type GitDiff,
} from "../../shared/git";
import { canonicalDirectory } from "./projects";
import { patchFor } from "../storage/evidence";
import { redact } from "../runtime/security";

// Only fixed read commands. No pager, shell, hooks, textconv, external diff or fsmonitor.
function readGit(
  root: string,
  args: string[],
  stdin?: Buffer,
  limit = 2 * 1024 * 1024,
): Promise<Buffer> {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.toUpperCase().startsWith("GIT_")) delete env[key];
  Object.assign(env, {
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_LITERAL_PATHSPECS: "1",
  });
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      [
        "--no-pager",
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=",
        "-c",
        "status.renames=false",
        "-C",
        root,
        ...args,
      ],
      {
        env,
        windowsHide: true,
        timeout: 7000,
        maxBuffer: limit,
        encoding: "buffer",
      },
      (error, out) =>
        error
          ? reject(
              new Error(
                "Không đọc được Git; kiểm tra repository hoặc giới hạn dữ liệu (2 MB/7 giây).",
              ),
            )
          : resolve(out),
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(stdin);
  });
}
const same = (a: string, b: string) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
async function repository(path: string) {
  const root = await canonicalDirectory(path);
  const top = await readGit(root, ["rev-parse", "--show-toplevel"])
    .then((b) => b.toString().trim())
    .catch(() => null);
  if (!top) return null;
  const prefix = relative(await realpath(top), root).replaceAll("\\", "/");
  if (prefix === ".." || prefix.startsWith("../") || isAbsolute(prefix))
    throw Error("Dự án nằm ngoài Git repository.");
  return { root, top, prefix };
}
async function head(root: string) {
  return readGit(root, ["rev-parse", "--verify", "HEAD"]).then(
    (b) => b.toString().trim(),
    () => null,
  );
}
function localPath(path: string, prefix: string) {
  return prefix
    ? path.startsWith(prefix + "/")
      ? path.slice(prefix.length + 1)
      : null
    : path;
}
async function status(root: string, prefix: string) {
  const tracked = await readGit(root, ["ls-files", "-z", "--", "."]);
  // status may invoke clean filters. Reject configured filters before reading it.
  const attributes = (
    await readGit(root, ["check-attr", "-z", "--stdin", "filter"], tracked)
  )
    .toString()
    .split("\0");
  if (
    attributes.some(
      (value, i) => i % 3 === 2 && !["unspecified", "unset"].includes(value),
    )
  )
    throw Error(
      "Repository dùng Git filter (ví dụ LFS); chưa hỗ trợ đọc working tree này.",
    );
  const raw = await readGit(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=all",
    "--",
    ".",
  ]);
  const files = raw
    .toString()
    .split("\0")
    .filter(Boolean)
    .flatMap((row) => {
      const path = localPath(row.slice(3), prefix);
      return path ? [{ path, index: row[0], worktree: row[1] }] : [];
    });
  return { raw, files };
}
function safePath(path: string) {
  if (
    isAbsolute(path) ||
    path
      .split("/")
      .some(
        (p) =>
          !p ||
          p === "." ||
          p === ".." ||
          /[\\:\x00-\x1f]/.test(p) ||
          p.endsWith(".") ||
          p.endsWith(" ") ||
          /^(\.git|con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(p),
      )
  )
    throw Error("Đường dẫn file không hợp lệ.");
}
async function workingFile(root: string, path: string): Promise<Buffer | null> {
  safePath(path);
  let target = root;
  for (const [i, part] of path.split("/").entries()) {
    target = join(target, part);
    const info = await lstat(target).catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if (!info) return null;
    if (
      info.isSymbolicLink() ||
      (i < path.split("/").length - 1 ? !info.isDirectory() : !info.isFile())
    )
      throw Error("Không đọc qua liên kết hoặc file đặc biệt.");
  }
  if (!same(await realpath(target), target))
    throw Error("Đường dẫn file đã thay đổi.");
  const file = await open(
    target,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > 256000)
      throw Error("File quá lớn để hiển thị diff (250 KB).");
    const bytes = Buffer.alloc(256001),
      { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    const after = await file.stat();
    if (
      bytesRead > 256000 ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    )
      throw Error("File đã thay đổi khi đọc. Cập nhật và thử lại.");
    return bytes.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}
async function treeFile(
  root: string,
  path: string,
  current: string | null,
): Promise<Buffer | null> {
  if (!current) return null;
  const row = (await readGit(root, ["ls-tree", "-z", current, "--", path]))
    .toString()
    .split("\0")[0];
  if (!row) return null;
  const match = row.match(/^(\d+) blob ([a-f0-9]+)\t/);
  if (!match) throw Error("Không hiển thị diff thư mục hoặc submodule.");
  return readGit(root, ["cat-file", "blob", match[2]], undefined, 256000);
}
async function indexFile(root: string, path: string) {
  const raw = await readGit(root, ["ls-files", "--stage", "-z", "--", path]);
  const row = raw.toString().split("\0")[0];
  if (!row) return { raw, data: null };
  const match = row.match(/^(\d+) ([a-f0-9]+) 0\t/);
  if (!match || match[1] === "160000")
    throw Error("Không hiển thị diff submodule hoặc file xung đột.");
  return {
    raw,
    data: await readGit(
      root,
      ["cat-file", "blob", match[2]],
      undefined,
      256000,
    ),
  };
}

export async function browseGit(
  path: string,
  input: GitSnapshotRequest,
  secrets: string[] = [],
): Promise<GitSnapshot> {
  const query = gitSnapshotSchema.parse(input),
    repo = await repository(path);
  const base = {
    projectId: query.projectId,
    checkedAt: new Date().toISOString(),
    files: [],
    filesTruncated: false,
    commits: [],
    hasMore: false,
    nextOffset: null,
    head: null,
    branch: null,
  };
  if (!repo)
    return {
      ...base,
      available: false,
      reason: "Chưa có Git hoặc thư mục không thuộc repository.",
    };
  const current = await head(repo.root);
  if (query.head && current !== query.head)
    throw Error("HEAD đã thay đổi. Cập nhật Git để xem lịch sử mới.");
  const branch = await readGit(repo.root, [
    "symbolic-ref",
    "--short",
    "-q",
    "HEAD",
  ]).then(
    (b) => redact(b.toString().trim(), secrets, 200),
    () => null,
  );
  const changed = await status(repo.root, repo.prefix);
  const raw = current
    ? await readGit(repo.root, [
        "log",
        current,
        "--format=%H%x00%aI%x00%an%x00%s%x00",
        "-z",
        `--max-count=51`,
        `--skip=${query.offset}`,
        "--",
        ".",
      ])
    : Buffer.alloc(0);
  const records = raw.toString().split("\0");
  const commits: GitSnapshot["commits"] = [];
  for (let i = 0; i + 3 < records.length; ) {
    if (!records[i]) {
      i++;
      continue;
    }
    const [hash, at, author, subject] = records.slice(i, i + 4);
    i += 4;
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(hash))
      throw Error("Không đọc được định dạng lịch sử Git.");
    commits.push({
      hash,
      at,
      author: redact(author, secrets, 120),
      subject: redact(subject, secrets, 300),
      workItems: [],
    });
  }
  if ((await head(repo.root)) !== current)
    throw Error("HEAD đã thay đổi. Cập nhật Git và thử lại.");
  const more = commits.length > 50 && query.offset + 50 <= 10000;
  return {
    ...base,
    available: true,
    reason: "",
    head: current,
    branch,
    files: changed.files.slice(0, 200),
    filesTruncated: changed.files.length > 200,
    commits: commits.slice(0, 50),
    hasMore: more,
    nextOffset: more ? query.offset + 50 : null,
  };
}

export async function browseGitDiff(
  path: string,
  input: GitDiffRequest,
  secrets: string[] = [],
): Promise<GitDiff> {
  const query = gitDiffSchema.parse(input);
  safePath(query.path);
  const repo = await repository(path);
  if (!repo) throw Error("Không tìm thấy Git repository.");
  const beforeHead = await head(repo.root),
    changed = await status(repo.root, repo.prefix);
  const entry = changed.files.find((f) => f.path === query.path);
  if (!entry)
    throw Error("File không còn trong danh sách thay đổi. Cập nhật Git.");
  if (
    entry.index === "U" ||
    entry.worktree === "U" ||
    ["AA", "DD"].includes(entry.index + entry.worktree)
  )
    throw Error("File đang xung đột; cần xử lý thủ công.");
  const index = await indexFile(repo.root, query.path);
  const a =
    query.comparison === "staged"
      ? await treeFile(repo.root, query.path, beforeHead)
      : index.data;
  const b =
    query.comparison === "staged"
      ? index.data
      : await workingFile(repo.root, query.path);
  const nextIndex = await readGit(repo.root, [
    "ls-files",
    "--stage",
    "-z",
    "--",
    query.path,
  ]);
  const nextFile =
    query.comparison === "unstaged"
      ? await workingFile(repo.root, query.path)
      : b;
  if (
    beforeHead !== (await head(repo.root)) ||
    !index.raw.equals(nextIndex) ||
    (b === null ? nextFile !== null : !nextFile || !b.equals(nextFile)) ||
    !changed.raw.equals((await status(repo.root, repo.prefix)).raw)
  )
    throw Error("Git đã thay đổi khi đọc. Cập nhật và thử lại.");
  const patch = patchFor(query.path, a, b);
  return {
    path: query.path,
    checkedAt: new Date().toISOString(),
    ...patch,
    patch: redact(patch.patch, secrets, 512000),
  };
}
