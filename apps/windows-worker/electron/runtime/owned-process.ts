import { spawn, type ChildProcess } from "node:child_process";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile, readdir, readFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";

const scriptPath = () =>
  resolve(__dirname, "../../electron/runtime/owned-job.cs");
const ps = () =>
  join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
const quoted = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const encoded = (s: string) => Buffer.from(s, "utf16le").toString("base64");
const load = () =>
  `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Add-Type -TypeDefinition ([IO.File]::ReadAllText(${quoted(scriptPath())}));`;
const ownerSession = randomUUID();

export async function recoverOwnedJobs(directory: string): Promise<void> {
  const root = join(directory, "owned-jobs");
  await mkdir(root, { recursive: true });
  for (const file of await readdir(root)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue;
    const path = join(root, file);
    const data = JSON.parse(await readFile(path, "utf8"));
    if (data.owner === ownerSession) continue;
    if (!/^Local\\ASF-[a-f0-9-]{36}$/.test(data.name))
      throw new Error("Job ownership metadata không hợp lệ.");
    if (process.platform === "win32") {
      // The crashed parent's pipe closes the host. Inspect only a random named job,
      // never adopt or terminate a process by a historical PID.
      const source =
        load() +
        `if (-not [AsfOwnedJob]::Empty(${quoted(data.name)})) { exit 9 }`;
      await new Promise<void>((ok, bad) =>
        execFile(
          ps(),
          ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded(source)],
          { windowsHide: true, timeout: 20000 },
          (error) =>
            error
              ? bad(
                  new Error(
                    "Còn process thuộc lượt trước hoặc chưa xác minh được job. Chưa chạy công việc mới; kiểm tra tiến trình và mở lại app.",
                  ),
                )
              : ok(),
        ),
      );
    }
    await unlink(path);
  }
}

export async function spawnOwned(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  directory: string,
): Promise<ChildProcess> {
  if (process.platform !== "win32")
    return spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  readFileSync(scriptPath()); // Fail before creating ownership metadata if resource is missing.
  const id = randomUUID(),
    name = `Local\\ASF-${id}`;
  const path = join(directory, "owned-jobs", id + ".json");
  await mkdir(join(directory, "owned-jobs"), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({
      name,
      owner: ownerSession,
      createdAt: new Date().toISOString(),
    }),
    { flag: "wx" },
  );
  const source =
    load() +
    `$code = [AsfOwnedJob]::Run(${quoted(executable)}, [string[]]@(${args.map(quoted).join(",")}), ${quoted(cwd)}, ${quoted(name)}); exit $code`;
  const child = spawn(
    ps(),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded(source)],
    { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  // A caller can cancel while awaiting spawn setup, before attaching its hooks.
  // Keep the error observable to later hooks without an unhandled process event.
  child.once("error", () => {});
  child.once("close", () => {
    void unlink(path).catch(() => {});
  });
  return child;
}
