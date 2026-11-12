import { spawn } from "node:child_process";

// Keep this list explicit: API keys, proxy credentials, NODE_OPTIONS and arbitrary Host
// variables must never reach an operator CLI. Login files remain owned/read by the CLI.
export function localCliEnv(token?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.create(null) as NodeJS.ProcessEnv;
  for (const key of ["PATH", "Path", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
    "APPDATA", "LOCALAPPDATA", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME",
    "XDG_DATA_HOME", "LANG", "LC_ALL", "TEMP", "TMP", "TMPDIR", "SystemRoot", "WINDIR", "PATHEXT"])
    if (process.env[key] !== undefined) env[key] = process.env[key];
  Object.defineProperty(env, "NODE_V8_COVERAGE", { value: undefined });
  if (token) env.FACTORY_MCP_TOKEN = token;
  return env;
}

export function cliProcess(command: readonly string[], args: readonly string[], options: {
  cwd?: string; token?: string; output(stream: "stdout" | "stderr", chunk: string): void;
}) {
  const child = spawn(command[0]!, [...command.slice(1), ...args], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }), env: localCliEnv(options.token),
    shell: false, windowsHide: true, detached: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let errorCode: string | undefined;
  let closed = false;
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => options.output("stdout", chunk));
  child.stderr.on("data", (chunk: string) => options.output("stderr", chunk));
  child.stdout.on("error", () => {}); child.stderr.on("error", () => {});
  child.once("error", (error: NodeJS.ErrnoException) => { errorCode = error.code ?? "spawn"; });
  const killGroup = (): void => {
    if (child.pid && process.platform !== "win32") {
      try { process.kill(-child.pid, "SIGKILL"); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw new Error("Runtime stop failed");
      }
    }
  };
  child.once("exit", () => { if (process.platform !== "win32") killGroup(); });
  const result = new Promise<{ code: number | null; errorCode?: string }>((resolve) => {
    child.once("close", (code) => { closed = true; resolve({ code, ...(errorCode ? { errorCode } : {}) }); });
  });
  let stopping: Promise<void> | undefined;
  return { pid: child.pid, result, stop(): Promise<void> {
    stopping ??= (async () => {
      if (closed) return;
      if (child.pid) {
        if (process.platform === "win32") {
          await new Promise<void>((resolve, reject) => {
            const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
              shell: false, windowsHide: true, stdio: "ignore", env: localCliEnv(),
            });
            const timer = setTimeout(() => { killer.kill(); reject(new Error("Runtime stop failed")); }, 5_000);
            killer.once("error", () => { clearTimeout(timer); reject(new Error("Runtime stop failed")); });
            killer.once("close", (code) => {
              clearTimeout(timer);
              if (code === 0 || closed) resolve(); else reject(new Error("Runtime stop failed"));
            });
          });
        } else killGroup();
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([result, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Runtime stop failed")), 5_000);
      })]); } finally { clearTimeout(timer); }
    })();
    void stopping.catch(() => {});
    return stopping;
  } };
}

export function validateCliCommand(value: readonly string[]): void {
  if (!Array.isArray(value) || !value.length || value.length > 64
    || value.some((part) => typeof part !== "string" || !part || part.includes("\0")))
    throw new Error("Local CLI command configuration invalid");
}
