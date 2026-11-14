import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { homedir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";
import { z } from "zod";
import { prepareLeadView } from "../lead/view.js";
import { localCliEnv } from "../runtimes/local-cli-process.js";
import { createPreviewProxy, type PreviewProxy } from "./proxy.js";

/**
 * Preview: the Host starts the project from its latest integrated code so the operator can play it. The project says how
 * in `factory.preview.json`. The server is a Host-supervised process: it lives until the operator stops it or the Host
 * closes (agent attempts cannot do this; their processes end with the attempt). It listens on loopback only and gets a
 * minimal environment: no Host secrets, no gateway key.
 */
const DENIED_ENV = /^(?:PATH|HOME|USER|SHELL|LD_.*|NODE_OPTIONS|NODE_V8_COVERAGE|FACTORY_.*|NINE_ROUTER_.*|.*API_KEY.*|.*TOKEN.*|.*SECRET.*)$/i;
const manifestSchema = z.strictObject({
  command: z.array(z.string().min(1).max(200).regex(/^[^\0\r\n]+$/)).min(1).max(16),
  install: z.array(z.string().min(1).max(200).regex(/^[^\0\r\n]+$/)).min(1).max(16).optional(),
  portEnv: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).default("PORT"),
  readyPath: z.string().regex(/^\/[A-Za-z0-9._~\-/%?=&]{0,200}$/).default("/"),
  readyTimeoutS: z.number().int().min(5).max(300).default(60),
  env: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), z.string().max(500).regex(/^[^\0]*$/)).default({}),
}).superRefine((value, ctx) => {
  for (const name of [value.portEnv, ...Object.keys(value.env)]) if (DENIED_ENV.test(name))
    ctx.addIssue({ code: "custom", message: `environment variable ${name} is not allowed`, path: ["env"] });
});
export type PreviewManifest = z.infer<typeof manifestSchema>;

export type PreviewState = "stopped" | "preparing" | "installing" | "starting" | "running" | "failed";
export interface PreviewStatus {
  state: PreviewState; url: string | null; viewUrl: string | null; port: number | null; sha: string | null;
  startedAt: string | null; message: string | null; log: string;
}

const LOG_LIMIT = 48 * 1024;
const API_LOG = 12 * 1024;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const MANIFEST = "factory.preview.json";

interface Entry {
  generation: number; state: PreviewState; port: number | null; sha: string | null; startedAt: string | null;
  message: string | null; log: string; child: ChildProcess | null; stopping: boolean;
  proxy: PreviewProxy | null;
}

const clean = (text: string): string => text.replace(/\r\n?/g, "\n").replace(/[^\P{Cc}\n\t]|\p{Cf}/gu, "").replaceAll(homedir(), "~");

async function freePort(avoid: ReadonlySet<number>): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = await new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        probe.close(() => typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port")));
      });
    });
    if (!avoid.has(port) && port !== 8787) return port;
  }
  throw new Error("no free port");
}

function readManifest(cwd: string): { manifest: PreviewManifest } | { error: string } {
  const path = join(cwd, MANIFEST);
  let stat: fs.Stats;
  try { stat = fs.lstatSync(path); } catch { return { error: `The project has no ${MANIFEST}. Ask the DevOps Engineer to add it (skill local-preview).` }; }
  if (!stat.isFile() || stat.size > 16 * 1024) return { error: `${MANIFEST} must be a regular file under 16 KiB.` };
  let value: unknown;
  try { value = JSON.parse(fs.readFileSync(path, "utf8")); } catch { return { error: `${MANIFEST} is not valid JSON.` }; }
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) return { error: `${MANIFEST}: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}` };
  return { manifest: parsed.data };
}

export function createPreviewService(options: {
  viewRoot: string; hostPort: number; projectRootFor(projectId: string): string | null; now?: () => Date;
}) {
  const now = options.now ?? (() => new Date());
  const proxy = createPreviewProxy();
  const entries = new Map<string, Entry>();
  const entry = (projectId: string): Entry => {
    let current = entries.get(projectId);
    if (!current) { current = { generation: 0, state: "stopped", port: null, sha: null, startedAt: null, message: null, log: "", child: null, stopping: false, proxy: null }; entries.set(projectId, current); }
    return current;
  };
  const append = (current: Entry, text: string): void => { current.log = (current.log + clean(text)).slice(-LOG_LIMIT); };
  const status = (projectId: string): PreviewStatus => {
    const current = entries.get(projectId);
    if (!current) return { state: "stopped", url: null, viewUrl: null, port: null, sha: null, startedAt: null, message: null, log: "" };
    return { state: current.state, port: current.port, sha: current.sha, startedAt: current.startedAt, message: current.message,
      url: current.state === "running" && current.port !== null ? `http://127.0.0.1:${current.port}/` : null,
      viewUrl: current.state === "running" && current.proxy ? current.proxy.viewUrl : null, log: current.log.slice(-API_LOG) };
  };

  const kill = async (child: ChildProcess | null): Promise<void> => {
    if (!child || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
    const timer = setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already gone */ } }, 5_000);
    try { await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 8_000))]); } finally { clearTimeout(timer); }
  };

  /** Runs one command to completion in cwd; resolves with its exit code, or null on timeout. */
  const runToEnd = (current: Entry, generation: number, command: readonly string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number) =>
    new Promise<number | null>((resolve) => {
      const child = spawn(command[0]!, command.slice(1), { cwd, env, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      current.child = child;
      const timer = setTimeout(() => { void kill(child); resolve(null); }, timeoutMs);
      const take = (chunk: Buffer): void => { if (current.generation === generation) append(current, chunk.toString("utf8")); };
      child.stdout?.on("data", take); child.stderr?.on("data", take);
      child.once("error", (error) => { clearTimeout(timer); append(current, `${error.message}\n`); resolve(-1); });
      child.once("exit", (code) => { clearTimeout(timer); resolve(code ?? -1); });
    });

  async function run(projectId: string, current: Entry, generation: number): Promise<void> {
    const alive = (): boolean => current.generation === generation;
    const fail = (message: string): void => { if (alive()) {
      current.proxy?.close(); current.proxy = null;
      current.state = "failed"; current.message = message; current.child = null;
    } };
    try {
      const projectRoot = options.projectRootFor(projectId);
      if (!projectRoot) return fail("This project has no Git workspace to start.");
      current.state = "preparing";
      const view = await prepareLeadView(options.viewRoot, projectId, projectRoot);
      if (!alive()) return;
      if (!view) return fail("The project repository has no commit yet.");
      current.sha = view.sha;
      const read = readManifest(view.cwd);
      if ("error" in read) return fail(read.error);
      const { manifest } = read;
      const base = localCliEnv();
      for (const [name, value] of Object.entries(manifest.env)) base[name] = value;

      if (fs.existsSync(join(view.cwd, "package.json")) || manifest.install) {
        current.state = "installing";
        append(current, `$ ${(manifest.install ?? ["npm", "install", "--no-audit", "--no-fund"]).join(" ")}\n`);
        const code = await runToEnd(current, generation, manifest.install ?? ["npm", "install", "--no-audit", "--no-fund"], view.cwd, base, INSTALL_TIMEOUT_MS);
        if (!alive()) return;
        current.child = null;
        if (code !== 0) return fail(code === null ? "Installing dependencies took too long." : `Installing dependencies failed (exit code ${code}).`);
      }

      current.state = "starting";
      const port = await freePort(new Set([options.hostPort]));
      if (!alive()) return;
      current.port = port;
      const env = { ...base, [manifest.portEnv]: String(port) };
      append(current, `$ ${manifest.command.join(" ")}   (${manifest.portEnv}=${port})\n`);
      const child = spawn(manifest.command[0]!, manifest.command.slice(1), { cwd: view.cwd, env, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      current.child = child;
      let exited: number | null | undefined;
      const take = (chunk: Buffer): void => { if (alive()) append(current, chunk.toString("utf8")); };
      child.stdout?.on("data", take); child.stderr?.on("data", take);
      child.once("error", (error) => { exited = -1; append(current, `${error.message}\n`); });
      child.once("exit", (code, signal) => {
        exited = code ?? -1;
        if (!alive()) return;
        current.proxy?.close(); current.proxy = null;
        current.child = null;
        if (current.state === "running" || current.state === "starting") {
          if (current.stopping) { current.state = "stopped"; current.message = null; }
          else { current.state = "failed"; current.message = signal ? `The server stopped (${signal}).` : `The server exited with code ${String(code)}.`; }
        }
      });

      const deadline = Date.now() + manifest.readyTimeoutS * 1000;
      const url = `http://127.0.0.1:${port}${manifest.readyPath}`;
      while (alive() && exited === undefined && Date.now() < deadline) {
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(2_000), redirect: "manual" });
          if (response.status < 500) {
            if (!alive() || exited !== undefined) return;
            current.proxy?.activate(port);
            current.state = "running"; current.startedAt = now().toISOString(); current.message = null;
            return;
          }
        } catch { /* not listening yet */ }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!alive()) return;
      if (exited !== undefined) return fail(`The server exited with code ${String(exited)} before it was ready.`);
      await kill(child);
      fail(`The server did not answer ${manifest.readyPath} within ${manifest.readyTimeoutS} seconds.`);
    } catch (error) {
      fail(error instanceof Error ? clean(error.message).slice(0, 300) : "Preview failed.");
    }
  }

  /** Stops any running preview of the project, then starts it again from the latest integrated code. */
  async function start(projectId: string): Promise<PreviewStatus> {
    const current = entry(projectId);
    const previous = current.child;
    current.generation++; current.stopping = true;
    const generation = current.generation;
    current.proxy?.close(); current.proxy = proxy.create();
    current.state = "preparing";
    await kill(previous);
    if (current.generation !== generation) return status(projectId);
    current.stopping = false;
    Object.assign(current, { state: "preparing", port: null, sha: null, startedAt: null, message: null, log: "", child: null });
    void run(projectId, current, current.generation);
    return status(projectId);
  }

  async function stop(projectId: string): Promise<PreviewStatus> {
    const current = entries.get(projectId);
    if (!current) return status(projectId);
    current.generation++; current.stopping = true;
    const generation = current.generation;
    current.proxy?.close(); current.proxy = null;
    current.state = "stopped";
    await kill(current.child);
    if (current.generation !== generation) return status(projectId);
    Object.assign(current, { state: "stopped", port: null, startedAt: null, message: null, child: null, stopping: false });
    return status(projectId);
  }

  async function close(): Promise<void> {
    await Promise.all([...entries.keys()].map((projectId) => stop(projectId).catch(() => undefined)));
  }
  return { status, start, stop, close, proxy };
}
export type PreviewService = ReturnType<typeof createPreviewService>;
