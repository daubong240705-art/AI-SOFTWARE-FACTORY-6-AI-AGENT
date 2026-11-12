import { spawn } from "node:child_process";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
// Never passed, even when the operator lists them: they change how the CLI process itself runs.
const NEVER_PASSED = new Set(["NODE_OPTIONS", "NODE_V8_COVERAGE", "LD_PRELOAD", "LD_LIBRARY_PATH", "FACTORY_MCP_TOKEN"]);

/** Names the operator allows through to every local CLI (FACTORY_CLI_PASS_ENV), for example a CLI's own provider key. */
export function validatePassEnv(names: readonly string[]): void {
  if (!Array.isArray(names) || names.length > 32 || names.some((name) => typeof name !== "string" || !ENV_NAME.test(name) || NEVER_PASSED.has(name)))
    throw new Error("Local CLI environment configuration invalid");
}

// Keep this list explicit: API keys, proxy credentials, NODE_OPTIONS and arbitrary Host
// variables must never reach an operator CLI unless the operator names them in passEnv.
// Login files remain owned/read by the CLI.
export function localCliEnv(token?: string, passEnv: readonly string[] = []): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.create(null) as NodeJS.ProcessEnv;
  for (const key of ["PATH", "Path", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
    "APPDATA", "LOCALAPPDATA", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME",
    "XDG_DATA_HOME", "LANG", "LC_ALL", "TEMP", "TMP", "TMPDIR", "SystemRoot", "WINDIR", "PATHEXT", ...passEnv])
    if (!NEVER_PASSED.has(key) && process.env[key] !== undefined) env[key] = process.env[key];
  Object.defineProperty(env, "NODE_V8_COVERAGE", { value: undefined });
  if (token) env.FACTORY_MCP_TOKEN = token;
  return env;
}

export function cliProcess(command: readonly string[], args: readonly string[], options: {
  cwd?: string; token?: string; passEnv?: readonly string[]; input?: string;
  output(stream: "stdout" | "stderr", chunk: string): void;
}) {
  const child = spawn(command[0]!, [...command.slice(1), ...args], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }), env: localCliEnv(options.token, options.passEnv),
    shell: false, windowsHide: true, detached: true, stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (options.input !== undefined && child.stdin) {
    child.stdin.on("error", () => {});
    child.stdin.end(options.input, "utf8");
  }
  let errorCode: string | undefined;
  let closed = false;
  // stdout and stderr are always piped above.
  const stdout = child.stdout!, stderr = child.stderr!;
  stdout.setEncoding("utf8"); stderr.setEncoding("utf8");
  stdout.on("data", (chunk: string) => options.output("stdout", chunk));
  stderr.on("data", (chunk: string) => options.output("stderr", chunk));
  stdout.on("error", () => {}); stderr.on("error", () => {});
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
