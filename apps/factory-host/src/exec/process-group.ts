import { spawn } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";

export interface RunOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  stdin?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  killGraceMs?: number;
  killDeadlineMs?: number;
  onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
}

export interface RunResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stopped: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  groupGone: boolean;
}

export interface RunHandle {
  /** Zero when an asynchronous spawn failure did not allocate a PID. */
  readonly pid: number;
  readonly result: Promise<RunResult>;
  stop(reason?: "operator" | "shutdown"): Promise<void>;
}

export class ExecError extends Error {
  constructor(
    readonly code: "unsupported-platform" | "invalid-options" | "spawn-failed" | "stop-failed",
    message: string = code,
  ) {
    super(message);
    this.name = "ExecError";
  }
}

const MAX_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const invalid = (): never => { throw new ExecError("invalid-options"); };

function integer(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  const result = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) invalid();
  return result;
}

function validate(options: RunOptions) {
  if (!options || typeof options !== "object") invalid();
  const { command, args, cwd, env, stdin, onOutput } = options;
  if (typeof command !== "string" || !command.trim() || /[\0\\]/.test(command)
    || command.split("/").some((part) => part === "." || part === "..")
    || (!isAbsolute(command) && command.includes("/"))) invalid();
  if (!Array.isArray(args) || args.length > 256) invalid();
  for (const arg of args) if (typeof arg !== "string" || arg.includes("\0")) invalid();
  if (typeof cwd !== "string" || cwd.includes("\0") || !isAbsolute(cwd)) invalid();
  let directory: string;
  try {
    directory = realpathSync(cwd);
    // With no separate workspace boundary in this API, refuse any symlink redirection.
    if (directory !== resolve(cwd) || !statSync(directory).isDirectory()) invalid();
  } catch { return invalid(); }
  if (!env || typeof env !== "object" || Array.isArray(env)) invalid();
  const childEnv: Record<string, string> = Object.create(null) as Record<string, string>;
  let envBytes = 0;
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || value.includes("\0")) invalid();
    envBytes += Buffer.byteLength(key) + Buffer.byteLength(value) + 2; // '=' and trailing NUL
    if (envBytes > 64 * 1024) invalid();
    childEnv[key] = value;
  }
  // libuv searches the explicitly supplied PATH. Without it libuv would use a default PATH.
  if (!isAbsolute(command) && !Object.hasOwn(childEnv, "PATH")) invalid();
  // Node 22 copies the Host's NODE_V8_COVERAGE even with an explicit env unless the
  // property is owned. An undefined, non-enumerable guard suppresses that exception
  // without adding a variable to the child's environment or reading the Host's env.
  if (!Object.hasOwn(childEnv, "NODE_V8_COVERAGE")) {
    Object.defineProperty(childEnv, "NODE_V8_COVERAGE", { value: undefined });
  }
  if (stdin !== undefined && typeof stdin !== "string") invalid();
  if (onOutput !== undefined && typeof onOutput !== "function") invalid();
  return {
    // Fail closed if a Node runtime feature tries to inject any additional variables.
    command, args: [...args], cwd: directory, env: Object.freeze(childEnv), stdin, onOutput,
    timeoutMs: integer(options.timeoutMs, 600_000, 1, MAX_TIMEOUT_MS),
    maxOutputBytes: integer(options.maxOutputBytes, 1024 * 1024, 0, 16 * 1024 * 1024),
    killGraceMs: integer(options.killGraceMs, 2_000, 0, 2_147_483_647),
    killDeadlineMs: integer(options.killDeadlineMs, 8_000, 1, 2_147_483_647),
  };
}

function groupPresent(pid: number): boolean {
  if (pid <= 0) return false;
  try { process.kill(-pid, 0); return true; }
  catch (error) {
    // EPERM (and any unexpected probing error) must never be interpreted as completion.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function signalGroup(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  if (pid <= 0) return;
  try { process.kill(-pid, signal); } catch { /* Only the subsequent probe proves completion. */ }
}

async function terminateGroup(pid: number, graceMs: number, deadlineMs: number): Promise<void> {
  if (!groupPresent(pid)) return;
  const started = performance.now();
  signalGroup(pid, "SIGTERM");
  let killed = false;
  while (groupPresent(pid)) {
    const elapsed = performance.now() - started;
    if (!killed && elapsed >= Math.min(graceMs, deadlineMs)) {
      signalGroup(pid, "SIGKILL");
      killed = true;
      if (!groupPresent(pid)) return;
    }
    if (elapsed >= deadlineMs) throw new ExecError("stop-failed");
    const next = killed ? deadlineMs : Math.min(graceMs, deadlineMs);
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, Math.min(25, Math.max(1, next - elapsed))));
  }
}

function capture(limit: number, emit: (text: string) => void) {
  const decoder = new StringDecoder("utf8");
  const parts: string[] = [];
  let bytes = 0;
  let truncated = false;
  let ended = false;
  const keep = (text: string): void => {
    if (!text || truncated) return;
    const encoded = Buffer.from(text, "utf8");
    const remaining = limit - bytes;
    if (encoded.length > remaining) {
      truncated = true;
      let end = remaining;
      // Cut before a partial code point, including when the cap is smaller than one character.
      while (end > 0 && ((encoded[end] as number) & 0xc0) === 0x80) end--;
      text = encoded.subarray(0, end).toString("utf8");
    }
    if (!text) return;
    bytes += Buffer.byteLength(text);
    parts.push(text);
    emit(text);
  };
  return {
    write(chunk: Buffer) { if (!truncated) keep(decoder.write(chunk)); },
    end() { if (!ended) { ended = true; if (!truncated) keep(decoder.end()); } },
    message: keep,
    text: () => parts.join(""),
    truncated: () => truncated,
  };
}

/**
 * Owns one Linux session/process group. Children that deliberately escape with setsid/setpgid
 * need containment by the sandbox; process groups alone cannot contain them or survive Host death.
 */
export function startProcess(options: RunOptions): RunHandle {
  if (process.platform !== "linux") throw new ExecError("unsupported-platform");
  const config = validate(options);
  const started = performance.now();
  let child;
  try {
    child = spawn(config.command, config.args, {
      cwd: config.cwd, env: config.env, shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"],
    });
  } catch { throw new ExecError("spawn-failed"); }
  const pid = child.pid ?? 0;
  let exitCode: number | null = null;
  let signal: string | null = null;
  let leaderEnded = false;
  let stdoutClosed = false;
  let stderrClosed = false;
  let cleanupDone = false;
  let groupGone = false;
  let timedOut = false;
  let stopped = false;
  let settled = false;
  let spawned = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cleanup: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  let complete!: (value: RunResult) => void;
  const result = new Promise<RunResult>((resolveResult) => { complete = resolveResult; });
  const emit = (stream: "stdout" | "stderr", text: string): void => {
    try { config.onOutput?.(stream, text); } catch { /* Observers cannot break execution or draining. */ }
  };
  const stdout = capture(config.maxOutputBytes, (text) => emit("stdout", text));
  const stderr = capture(config.maxOutputBytes, (text) => emit("stderr", text));
  const clearDeadline = (): void => { if (timeout !== undefined) { clearTimeout(timeout); timeout = undefined; } };
  const finish = (): void => {
    if (settled || !leaderEnded || !stdoutClosed || !stderrClosed || !cleanupDone) return;
    settled = true;
    clearDeadline();
    complete({ exitCode, signal, timedOut, stopped, stdout: stdout.text(), stderr: stderr.text(),
      truncated: stdout.truncated() || stderr.truncated(), durationMs: performance.now() - started, groupGone });
  };
  const cleanGroup = (): Promise<void> => {
    if (!cleanup) {
      clearDeadline();
      cleanup = terminateGroup(pid, config.killGraceMs, config.killDeadlineMs);
      void cleanup.then(() => { groupGone = true; cleanupDone = true; finish(); }, () => {
        cleanupDone = true;
        // A surviving descendant may still own these pipes. After the deadline,
        // release our descriptors so a reaped leader can report groupGone: false.
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        finish();
      });
    }
    return cleanup;
  };
  child.once("spawn", () => { spawned = true; });
  child.once("error", () => {
    if (!spawned) {
      leaderEnded = true;
      stderr.message("failed to start");
    }
    void cleanGroup();
  });
  child.once("exit", (code, exitSignal) => {
    exitCode = code;
    signal = exitSignal;
    leaderEnded = true;
    // Do this on exit, not close: background children may still own the output pipes.
    void cleanGroup();
  });
  child.stdout.on("data", (chunk: Buffer) => stdout.write(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.write(chunk));
  child.stdout.on("error", () => { /* Closing the pipe below still gates completion. */ });
  child.stderr.on("error", () => { /* Closing the pipe below still gates completion. */ });
  child.stdout.once("close", () => { stdout.end(); stdoutClosed = true; finish(); });
  child.stderr.once("close", () => { stderr.end(); stderrClosed = true; finish(); });
  child.stdin.on("error", () => { /* EPIPE when a child exits without consuming stdin is harmless. */ });
  child.stdin.end(config.stdin);
  timeout = setTimeout(() => { timedOut = true; void cleanGroup(); }, config.timeoutMs);
  return {
    pid, result,
    stop(_reason) {
      if (!stopPromise) {
        if (!leaderEnded && child.exitCode === null && child.signalCode === null) stopped = true;
        stopPromise = cleanGroup().then(async () => { await result; });
        // Callers may attach their rejection handler later; the promise still rejects for them.
        void stopPromise.catch(() => undefined);
      }
      return stopPromise;
    },
  };
}

export function runToCompletion(options: RunOptions): Promise<RunResult> {
  return startProcess(options).result;
}
