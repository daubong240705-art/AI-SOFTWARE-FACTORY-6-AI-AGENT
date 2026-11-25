import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { Writable } from "node:stream";
import { buildSandboxCommand } from "../sandbox/bwrap.js";
import type { Integration } from "@factory/contracts";
import { object } from "./store.js";

type Config = Extract<Integration, { kind: "mcp-stdio" }>["config"];
export type StdioLaunch = (input: { config: Config; env: Record<string, string>; stateDir: string }) => ChildProcess;
const unavailable = () => new Error("MCP stdio server unavailable");
export function launchStdio({ config, env, stateDir }: { config: Config; env: Record<string, string>; stateDir: string }) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "factory-mcp-"));
  try {
    const workspace = join(root, "work", "server");
    mkdirSync(workspace, { recursive: true, mode: 0o700 });
    mkdirSync(join(root, "projects"), { mode: 0o700 });
    const binds: { host: string; guest: string }[] = [];
    const mount = (value: string) => {
      if (!isAbsolute(value)) return value;
      const host = realpathSync(value);
      if (!statSync(host).isFile()) throw unavailable();
      if (host.startsWith("/usr/")) return host;
      const guest = `/mcp-input/${binds.length}/${value.split("/").at(-1)}`;
      binds.push({ host, guest });
      return guest;
    };
    const command = mount(config.command);
    const args = config.args.map((arg) => isAbsolute(arg) ? mount(arg) : arg);
    const sandbox = buildSandboxCommand({ bwrapPath: "/usr/bin/bwrap", workspace, roots: {
      worktreesRoot: join(root, "work"), projectsRoot: join(root, "projects"), stateDir: realpathSync(stateDir),
    }, env: {}, readOnlyBinds: binds, command, args });
    const fixed = /^(HOME|PATH|TMPDIR|LANG|XDG_.*|FACTORY_.*|LD_.*|NODE_OPTIONS|NODE_V8_COVERAGE)$/;
    if (Object.entries(env).some(([name, value]) => fixed.test(name) || /[\0\r\n]/.test(value))) throw unavailable();
    const setup = Object.entries(env).flatMap(([name, value]) => ["--setenv", name, value]);
    const input = setup.length ? Buffer.from(`${setup.join("\0")}\0`) : Buffer.alloc(0);
    if (input.length > 64 * 1024) throw unavailable();
    const end = sandbox.args.length - args.length - 4;
    const child = spawn(sandbox.command, input.length ? [...sandbox.args.slice(0, end), "--args", "3", ...sandbox.args.slice(end)] : sandbox.args, {
      cwd: workspace, env: { PATH: "/usr/bin:/bin", NODE_V8_COVERAGE: undefined }, detached: true,
      stdio: ["pipe", "pipe", "ignore", "pipe"],
    });
    const setupPipe = child.stdio[3];
    if (setupPipe instanceof Writable) {
      setupPipe.on("error", () => {});
      setupPipe.end(input);
    }
    const cleaned = () => rmSync(root, { recursive: true, force: true });
    child.once("close", cleaned);
    return child;
  } catch { rmSync(root, { recursive: true, force: true }); throw unavailable(); }
}

export async function stdioSession<T>(launch: StdioLaunch, input: Parameters<StdioLaunch>[0],
  work: (request: (method: string, params: unknown) => Promise<unknown>) => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw unavailable();
  const child = launch(input);
  const { stdin, stdout } = child;
  if (!stdin || !stdout) { child.kill("SIGKILL"); throw unavailable(); }
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let id = 0; let bytes = 0; let buffer = ""; let failed = false;
  const decoder = new StringDecoder("utf8");
  const stop = () => {
    if (failed) return;
    failed = true;
    for (const waiter of pending.values()) waiter.reject(unavailable());
    pending.clear();
    if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  };
  child.on("error", stop);
  child.on("exit", stop);
  signal?.addEventListener("abort", stop, { once: true });
  stdin.on("error", stop);
  stdout.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) { stop(); return; }
    buffer += decoder.write(chunk);
    let end: number;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try {
        const message: unknown = JSON.parse(line);
        if (!object(message) || message.jsonrpc !== "2.0" || typeof message.id !== "number" || "method" in message) continue;
        const waiter = pending.get(message.id);
        if (!waiter) continue;
        pending.delete(message.id);
        if ("result" in message && !("error" in message)) waiter.resolve(message.result);
        else waiter.reject(unavailable());
      } catch { stop(); return; }
    }
  });
  const request = (method: string, params: unknown): Promise<unknown> => new Promise((resolve, reject) => {
    if (failed) { reject(unavailable()); return; }
    const next = ++id;
    pending.set(next, { resolve, reject });
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: next, method, params })}\n`);
  });
  const timeout = setTimeout(stop, 20_000);
  try {
    const initialized = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "factory-host", version: "0.1.0" } });
    if (!object(initialized) || typeof initialized.protocolVersion !== "string") throw unavailable();
    stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    return await work(request);
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", stop); stop(); }
}
