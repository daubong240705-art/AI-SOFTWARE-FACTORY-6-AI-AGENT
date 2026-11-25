import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { bundleDirSchema, bundleScriptsSchema, idSchema, isBundleOperation, type HttpOperation } from "@factory/contracts";
import type { DependencyCache } from "../deps/cache.js";
import type { EventHub } from "../events/hub.js";
import { buildSafeEnv, startProcess } from "../exec/index.js";
import { runGit } from "../workspace/git.js";
import { INTEGRATION_BRANCH } from "../workspace/integration.js";
import { assertInside } from "../workspace/paths.js";
import { authHeaders, requestParams, scrub, type HttpIntegration } from "./http.js";
import { object, type IntegrationStore } from "./store.js";

const maxBundle = 50 * 1024 * 1024;
const maxResponse = 64 * 1024;
const unknownError = "bundle-outcome-unknown: Hãy đối soát trước khi xuất bản lại.";
type State = "pending" | "done" | "failed" | "unknown";
type Output = { commit: string | null; bytes: number | null; response: unknown; log: string };
type Row = { project_id: string; id: string; state: State; error: string | null; output_json: string | null; target_json: string };
type Input = { projectId: string; caller: string; nodeAttempt: number; integration: HttpIntegration; operation: HttpOperation;
  args: unknown; dir?: string; ref?: "integration" | "main"; scripts?: readonly string[];
  query?: (commit: string) => Record<string, string>; beforeSend?: () => void };

async function jsonResponse(response: Response, secrets: readonly string[]): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponse) return null;
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"), (_key, value: unknown): unknown => {
      if (typeof value === "string") return scrub(value, secrets);
      if (typeof value === "number" && scrub(String(value), secrets) !== String(value)) return "[redacted]";
      if (!object(value)) return value;
      return Object.fromEntries(Object.entries(value).map(([name, entry]) => [scrub(name, secrets), entry]));
    });
    return Buffer.byteLength(JSON.stringify(parsed)) <= maxResponse ? parsed : null;
  } catch { return null; }
}

export function createBundleEffects(deps: { raw: Database; hub: EventHub; clock: () => Date; newId: () => string;
  store: IntegrationStore; stateDir: string; cache: DependencyCache; projectRootFor: (id: string) => string | null; fetch?: typeof fetch;
  processes?: { git: typeof runGit; start: typeof startProcess } }) {
  const { raw, hub } = deps;
  const fetcher = deps.fetch ?? fetch;
  const { git: gitProcess, start } = deps.processes ?? { git: runGit, start: startProcess };
  const handles = new Set<ReturnType<typeof startProcess>>();
  const controllers = new Set<AbortController>();
  const queues = new Map<string, Promise<unknown>>();
  const running = new Map<string, Promise<ReturnType<typeof view>>>();
  let closed = false;
  const get = (projectId: string, id: string) => raw.prepare<[string, string], Row>("SELECT * FROM effects WHERE project_id=? AND id=? AND kind='bundle.publish'").get(projectId, id);
  const latest = (projectId: string, caller: string) => raw.prepare<[string, string], Row>(`SELECT * FROM effects WHERE project_id=?
    AND kind='bundle.publish' AND json_extract(target_json,'$.caller')=? ORDER BY rowid DESC LIMIT 1`).get(projectId, caller);
  const outputOf = (row: Row): Output => row.output_json ? JSON.parse(row.output_json) : { commit: null, bytes: null, response: null, log: "" };
  const view = (row: Row) => ({ id: row.id, state: row.state, error: row.error, ...outputOf(row) });
  const emit = (projectId: string, id: string, revision: number) => {
    if (hub.currentCursor(projectId) !== null) hub.append({ projectId, causationId: id, payload: { type: "entity.changed", entity: { kind: "effect", id, revision } } });
  };
  const update = (row: Row, state: State, error: string | null, output: Output) => hub.transaction(() => {
    const changed = raw.prepare(`UPDATE effects SET state=?,error=?,output_json=?,completed_at=?
      WHERE project_id=? AND id=? AND state=? AND kind='bundle.publish'`)
      .run(state, error, JSON.stringify(output), state === "unknown" ? null : deps.clock().toISOString(), row.project_id, row.id, row.state);
    if (changed.changes) emit(row.project_id, row.id, row.state === "unknown" ? 3 : 2);
    return view(get(row.project_id, row.id)!);
  });

  async function execute(row: Row, input: Input) {
    const output = outputOf(row);
    let temporary: string | undefined, step = "prepare", sent = false;
    try {
      if (closed) throw new Error();
      const { headers, secrets: credentials } = authHeaders(deps.store, input.integration);
      const secrets = credentials.flatMap((secret) => [secret, secret.trim()]).filter(Boolean);
      const append = (text: string) => { output.log = (output.log + scrub(text, secrets)).slice(-12_000); };
      const source = deps.projectRootFor(input.projectId);
      if (!source) throw new Error();
      const git = (root: string, args: string[], timeoutMs = 60_000) => gitProcess(root, args, { timeoutMs });
      if (fs.realpathSync((await git(source, ["rev-parse", "--show-toplevel"])).stdout.trim()) !== source) throw new Error();
      const gitRef = input.ref === "main" ? "refs/heads/main" : `refs/heads/${INTEGRATION_BRANCH}`;
      const commit = (await git(source, ["rev-parse", "--verify", `${gitRef}^{commit}`], 30_000)).stdout.trim();
      if (!/^[0-9a-f]{40,64}$/.test(commit)) throw new Error();
      output.commit = commit;
      step = "request";
      const request = requestParams(input.integration, input.operation, input.args);
      if (request.body !== undefined) throw new Error();
      for (const [key, value] of Object.entries(input.query?.(commit) ?? {})) request.url.searchParams.set(key, value);
      step = "prepare";
      const buildRoot = join(fs.realpathSync(deps.stateDir), "builds");
      if (assertInside(deps.stateDir, join(deps.stateDir, "builds")) !== buildRoot) throw new Error();
      fs.mkdirSync(buildRoot, { mode: 0o700, recursive: true });
      const cwd = join(buildRoot, idSchema.parse(input.projectId));
      if (assertInside(buildRoot, cwd) !== cwd) throw new Error();
      temporary = fs.mkdtempSync(join(buildRoot, "bundle-"));
      if (fs.existsSync(cwd)) {
        if (!fs.lstatSync(join(cwd, ".git")).isFile()) throw new Error();
        const common = async (root: string) => fs.realpathSync(resolve(root, (await git(root, ["rev-parse", "--git-common-dir"])).stdout.trim()));
        if (await common(cwd) !== await common(source)) throw new Error();
        await git(cwd, ["checkout", "--detach", "--force", commit]);
      } else await git(source, ["worktree", "add", "--detach", "--", cwd, commit]);
      await git(cwd, ["reset", "--hard", commit]);
      await git(cwd, ["clean", "-fdx", "-f"]);
      const home = join(temporary, "home"), tmp = join(temporary, "tmp");
      fs.mkdirSync(home, { mode: 0o700 }); fs.mkdirSync(tmp, { mode: 0o700 });
      const env = buildSafeEnv({ HOME: home, TMPDIR: tmp, PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
        npm_config_userconfig: join(home, ".npmrc"), npm_config_globalconfig: "/dev/null" });
      const run = async (command: string, args: string[], timeoutMs: number) => {
        if (closed) throw new Error();
        const capture = 48_004 + Math.max(0, ...secrets.map((secret) => Buffer.byteLength(secret) * 6));
        const handle = start({ command: "/bin/bash", args: ["-o", "pipefail", "-c", '"${@:2}" 2>&1 | /usr/bin/tail -c "$1"',
          "bundle-log", String(capture), command, ...args], timeoutMs, cwd, env, maxOutputBytes: capture + 4 });
        handles.add(handle);
        try {
          const result = await handle.result;
          if (result.truncated) append("[build output truncated]\n");
          else append(`${result.stdout}${result.stderr}\n`);
          if (result.exitCode !== 0 || result.timedOut || result.stopped || !result.groupGone || closed) throw new Error();
        } finally { handles.delete(handle); }
      };
      for (const script of input.scripts ?? ["ci", "build"]) {
        step = script;
        const deadline = performance.now() + (script === "ci" ? 600_000 : 300_000);
        const locked = ["package-lock.json", "npm-shrinkwrap.json"].some((name) => fs.existsSync(join(cwd, name)));
        if (script === "ci" && locked && !fs.existsSync(join(cwd, "npm-shrinkwrap.json"))) {
          if (closed) throw new Error();
          const cached = await deps.cache.prepare(cwd, "host");
          if (cached.warning) append(`${cached.warning}\n`);
          if (cached.used) continue;
        }
        const args = script === "ci" ? (locked ? ["ci"] : ["install", "--no-audit", "--no-fund"]) : ["run", script];
        append(`$ npm ${args.join(" ")}\n`);
        await run("npm", args, Math.max(1, Math.floor(deadline - performance.now())));
      }
      step = "directory";
      const requested = join(cwd, input.dir ?? "dist");
      const dir = assertInside(cwd, requested);
      if (dir !== requested || !fs.lstatSync(dir).isDirectory() || (input.dir ?? "dist").split("/")[0] === ".git") throw new Error();
      const checkEntries = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const path = join(directory, entry.name);
          if (entry.isSymbolicLink()) {
            if (resolve(directory, fs.readlinkSync(path)) !== assertInside(dir, path) || fs.readlinkSync(path).startsWith("/")) throw new Error();
          } else if (entry.isDirectory()) checkEntries(path);
          else if (!entry.isFile()) throw new Error();
        }
      };
      checkEntries(dir);
      step = "archive";
      const archive = join(temporary, "bundle.tar.gz");
      await run("tar", ["-czf", archive, "-C", dir, "--", "."], 300_000);
      output.bytes = fs.statSync(archive).size;
      step = "too-large";
      if (output.bytes > maxBundle) throw new Error();
      step = "request";
      const body = fs.readFileSync(archive);
      if (closed) throw new Error();
      input.beforeSend?.();
      headers.set("content-type", "application/gzip");
      headers.set("idempotency-key", row.id);
      raw.prepare("UPDATE effects SET output_json=? WHERE project_id=? AND id=? AND state='pending'")
        .run(JSON.stringify(output), row.project_id, row.id);
      const controller = new AbortController();
      controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 60_000);
      try {
        sent = true;
        const response = await fetcher(request.url, { method: request.method, body, headers, signal: controller.signal, redirect: "error", credentials: "omit" });
        if (closed || (!response.ok && (response.status < 400 || response.status >= 500))) {
          await response.body?.cancel();
          return update(row, "unknown", unknownError, output);
        }
        const parsed = await jsonResponse(response, secrets);
        if (closed) return update(row, "unknown", unknownError, output);
        if (response.ok) {
          output.response = parsed;
          return update(row, "done", null, output);
        }
        const details = object(parsed) ? [parsed.error, ...(Array.isArray(parsed.problems) ? parsed.problems.slice(0, 5) : [])] : [];
        const error = details.filter((line): line is string => typeof line === "string").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
        return update(row, "failed", scrub(`HTTP ${response.status}${error ? `: ${error}` : ""}`, secrets).slice(0, 500), output);
      } finally { clearTimeout(timer); controllers.delete(controller); }
    } catch {
      return closed || sent ? update(row, "unknown", unknownError, output)
        : update(row, "failed", `build-failed: ${step}. ${step === "too-large" ? "Gói vượt quá giới hạn 50 MiB." : "Không thể chuẩn bị hoặc gửi gói."}`, output);
    } finally { if (temporary) try { fs.rmSync(temporary, { recursive: true, force: true }); } catch { } }
  }

  return {
    latest(projectId: string, caller: string) { const row = latest(projectId, caller); return row ? view(row) : null; },
    list(projectId: string) { return raw.prepare<[string], Row>("SELECT * FROM effects WHERE project_id=? AND kind='bundle.publish' ORDER BY rowid").all(projectId)
      .map(({ id, state, error }) => ({ id, state, error })); },
    reconcile(projectId: string, id: string, resolution: "done" | "failed") {
      const row = get(projectId, id);
      if (row?.state !== "unknown") return false;
      update(row, resolution, resolution === "failed" ? "Người vận hành xác nhận xuất bản thất bại." : null, outputOf(row));
      return true;
    },
    submit(input: Input) {
      const { projectId, caller, nodeAttempt } = input;
      if (closed) throw new Error("Bundle executor unavailable");
      const row = hub.transaction(() => {
        const key = `bundle:${caller}:${nodeAttempt}`;
        const existing = raw.prepare<[string, string], Row>("SELECT * FROM effects WHERE project_id=? AND idempotency_key=?").get(projectId, key);
        const prior = latest(projectId, caller);
        if (existing || (prior && prior.state !== "failed")) return { row: (existing ?? prior)!, created: false };
        bundleDirSchema.parse(input.dir ?? "dist");
        bundleScriptsSchema.parse(input.scripts ?? ["ci", "build"]);
        if (!isBundleOperation(input.operation) || (input.ref !== undefined && input.ref !== "integration" && input.ref !== "main")) throw new Error("Invalid bundle operation");
        const id = deps.newId();
        const target = JSON.stringify({ caller, nodeAttempt });
        raw.prepare(`INSERT INTO effects (project_id,id,kind,idempotency_key,target_json,state,created_at)
          VALUES (?,?,'bundle.publish',?,?,'pending',?)`).run(projectId, id, key, target, deps.clock().toISOString());
        emit(projectId, id, 1);
        return { row: get(projectId, id)!, created: true };
      });
      if (!row.created) return running.get(row.row.id) ?? Promise.resolve(view(row.row));
      const job = Promise.resolve(queues.get(projectId)).catch(() => {}).then(() => {
        if (!raw.open || !get(projectId, row.row.id)) return view(row.row);
        return execute(row.row, input);
      }).finally(() => { running.delete(row.row.id); if (queues.get(projectId) === job) queues.delete(projectId); });
      running.set(row.row.id, job); queues.set(projectId, job);
      return job;
    },
    recoverAtStart() {
      for (const row of raw.prepare<[], Row>("SELECT * FROM effects WHERE kind='bundle.publish' AND state='pending'").all())
        update(row, "unknown", unknownError, outputOf(row));
    },
    async close() {
      closed = true;
      for (const controller of controllers) controller.abort();
      await Promise.allSettled([...handles].map((handle) => handle.stop("shutdown")));
      await Promise.allSettled(running.values());
    },
  };
}
export type BundleEffects = ReturnType<typeof createBundleEffects>;
