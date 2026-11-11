import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { buildDocumentCommand, WORKER_STDOUT_BYTES, WORKER_TIMEOUT_MS } from "./bwrap.js";
import type { DocWorkerConfig } from "./config.js";
import { ExtractionError, workerErrorSchema, workerResultSchema, type WorkerResult } from "./result.js";

export type RunnerResult = { status: "done"; result: WorkerResult } | { status: "skipped"; errorCode: string };
const executable = async (path: string): Promise<boolean> => {
  try { await access(path, constants.X_OK); return true; } catch { return false; }
};

/** Hard limits apply to test commands as well as the real isolated worker. */
export function captureWorker(command: string, args: string[], options: {
  timeoutMs?: number; stdoutBytes?: number; signal?: AbortSignal;
} = {}): Promise<WorkerResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { detached: process.platform !== "win32", windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"], env: {} });
    const chunks: Buffer[] = []; let size = 0; let failure: string | undefined;
    const kill = (code: string): void => {
      failure ??= code;
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); }
      catch { /* Already exited. */ }
    };
    const abort = (): void => kill("failed");
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(() => kill("timeout"), options.timeoutMs ?? WORKER_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > (options.stdoutBytes ?? WORKER_STDOUT_BYTES)) kill("stdout-limit");
      else chunks.push(chunk);
    });
    child.on("error", () => { failure = "worker-unavailable"; });
    child.on("close", (code) => {
      clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
      if (failure) { reject(new ExtractionError(failure)); return; }
      try {
        const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
        if (code !== 0) {
          const error = workerErrorSchema.safeParse(parsed);
          throw new ExtractionError(error.success ? error.data.error : "failed");
        }
        const result = workerResultSchema.safeParse(parsed);
        if (!result.success) throw new ExtractionError("invalid-result");
        resolveResult(result.data);
      } catch (error) { reject(error instanceof ExtractionError ? error : new ExtractionError(code === 0 ? "invalid-result" : "failed")); }
    });
  });
}

export async function runDocumentWorker(bytes: Buffer, media: string, config: DocWorkerConfig,
  options: { timeoutMs?: number; stdoutBytes?: number; signal?: AbortSignal } = {}): Promise<RunnerResult> {
  if (!config.enabled) return { status: "skipped", errorCode: "worker-disabled" };
  if (!config.command && (process.platform !== "linux" || !await executable(config.python) || !await executable("/usr/bin/bwrap")))
    return { status: "skipped", errorCode: "worker-unavailable" };
  let temporary: string | undefined;
  try {
    temporary = await mkdtemp(join(tmpdir(), "factory-doc-worker-"));
    const input = join(temporary, "input"); await writeFile(input, bytes, { mode: 0o600 });
    const built = buildDocumentCommand({ python: config.python, script: config.script, input, media,
      prlimit: process.platform === "linux" && await executable("/usr/bin/prlimit") });
    const command = config.command?.[0] ?? built.command;
    const args = config.command ? [...config.command.slice(1), input, media] : built.args;
    return { status: "done", result: await captureWorker(command, args, options) };
  } catch (error) {
    if (error instanceof ExtractionError && error.code === "worker-unavailable")
      return { status: "skipped", errorCode: "worker-unavailable" };
    throw error instanceof ExtractionError ? error : new ExtractionError("failed");
  } finally {
    if (temporary && resolve(temporary).startsWith(resolve(tmpdir()) + sep + "factory-doc-worker-"))
      await rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}
