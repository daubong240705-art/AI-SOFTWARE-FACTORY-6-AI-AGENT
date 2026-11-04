import { execFile } from "node:child_process";
import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import type { ProjectStatus, ToolStatus } from "../../shared/contracts";

export async function canonicalDirectory(path: string): Promise<string> {
  try {
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isDirectory()) throw new Error();
    await access(canonical, constants.R_OK);
    return canonical;
  } catch {
    throw new Error(
      "Không mở được thư mục. Kiểm tra đường dẫn và quyền truy cập.",
    );
  }
}

function command(
  executable: string,
  args: string[],
  cwd?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        cwd,
        windowsHide: true,
        timeout: 7000,
        maxBuffer: 2 * 1024 * 1024,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: "0",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
    );
  });
}

export async function projectStatus(path: string): Promise<ProjectStatus> {
  await canonicalDirectory(path);
  let root: string;
  try {
    root = await command("git", ["-C", path, "rev-parse", "--show-toplevel"]);
  } catch {
    return {
      gitRoot: null,
      branch: null,
      changedFiles: 0,
      error: "Chưa có Git hoặc thư mục không thuộc Git repository.",
    };
  }
  try {
    const [branch, status] = await Promise.all([
      command("git", [
        "-C",
        path,
        "symbolic-ref",
        "--short",
        "-q",
        "HEAD",
      ]).catch(() =>
        command("git", ["-C", path, "rev-parse", "--short", "HEAD"]),
      ),
      command("git", [
        "-C",
        path,
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=normal",
      ]),
    ]);
    const entries = status.split("\0").filter(Boolean);
    let changedFiles = 0;
    for (let i = 0; i < entries.length; i++) {
      changedFiles++;
      if (/[RC]/.test(entries[i].slice(0, 2))) i++;
    }
    return { gitRoot: root, branch, changedFiles };
  } catch {
    return {
      gitRoot: root,
      branch: null,
      changedFiles: 0,
      error: "Không đọc được trạng thái Git.",
    };
  }
}

export async function checkTools(runtimePath: string): Promise<ToolStatus[]> {
  return Promise.all(
    [
      ["OpenCode", runtimePath || "opencode"],
      ["Git", "git"],
      ["Node.js", "node"],
      ["Python", "python"],
    ].map(async ([name, executable]) => {
      // Never invoke .cmd/.bat through a shell: runtime executables must be native binaries.
      if (/\.(cmd|bat)$/i.test(executable))
        return {
          name,
          path: executable,
          available: false,
          version: "Chọn executable .exe thay cho .cmd/.bat.",
        };
      try {
        const output = await command(executable, ["--version"]);
        return {
          name,
          path: executable,
          available: true,
          version: output.split(/\r?\n/)[0].slice(0, 160),
        };
      } catch {
        return {
          name,
          path: executable,
          available: false,
          version: "Không tìm thấy hoặc không chạy được.",
        };
      }
    }),
  );
}
