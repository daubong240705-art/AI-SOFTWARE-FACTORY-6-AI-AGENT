import type { Database } from "better-sqlite3";
import { z } from "zod";
import { effectRecordSchema, idSchema, type EffectState } from "@factory/contracts";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventHub } from "../events/hub.js";
import type { Clock } from "../ids.js";
import { startProcess, type RunHandle, type RunOptions, type RunResult } from "../exec/process-group.js";
import { buildSafeEnv } from "../exec/safe-env.js";
import { assertInside, checkedDirectory } from "../workspace/paths.js";
import { describeRemote, parsePushRemotes, validatePushSshCommand, type PushRemote } from "./config.js";

export type PushCode = "unknown-remote" | "not-found" | "task-not-done" | "workspace-not-ready"
  | "invalid-branch" | "workspace-unavailable" | "branch-missing" | "not-unknown" | "unreachable"
  | "not-available" | "invalid-record";
export class PushError extends Error {
  constructor(readonly code: PushCode) { super(code); this.name = "PushError"; }
}
export interface EffectView {
  id: string; attemptId: string; kind: "git.push-branch"; remote: string; branch: string;
  state: EffectState; error: string | null; createdAt: string; completedAt: string | null;
}
interface Target { remote: string; branch: string; tipSha: string; remoteDigest: string }
interface Row {
  project_id: string; id: string; attempt_id: string; kind: "git.push-branch"; idempotency_key: string;
  target_json: string; state: EffectState; error: string | null; created_at: string; completed_at: string | null;
}
const digest = (text: string): string => createHash("sha256").update(text).digest("hex");
const sha = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const errors = new Set(["auth", "rejected", "network", "timeout", "other", "not-pushed"]);
const sharedSchema = z.strictObject(effectRecordSchema.shape).omit({ attempt: true });
function validBranch(branch: unknown): branch is string {
  return typeof branch === "string" && branch.length <= 160
    && !/^(main|master)$/i.test(branch.replace(/^refs\/heads\//i, ""))
    && /^factory\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(branch)
    && !branch.includes("..") && branch.split("/").every((part) => !part.startsWith(".")
      && !part.endsWith(".") && !part.toLowerCase().endsWith(".lock"));
}
function targetOf(row: Row): Target {
  try {
    const value = JSON.parse(row.target_json) as Target;
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(value.remote) || !validBranch(value.branch)) throw new Error();
    return value;
  } catch { throw new PushError("invalid-record"); }
}
function view(row: Row): EffectView {
  const target = targetOf(row);
  try {
    // The contract's attempt identity is a legacy lease identity; validate the shared fields
    // directly rather than inventing a lease for a completed M2 attempt.
    const shared = sharedSchema.parse({
      id: row.id, projectId: row.project_id, kind: row.kind, idempotencyKey: row.idempotency_key,
      target: { remote: target.remote, branch: target.branch }, state: row.state,
      error: row.error === null ? null : errors.has(row.error) ? row.error : "other",
      createdAt: row.created_at, completedAt: row.completed_at,
    });
    if ((shared.state === "done" || shared.state === "failed") && !shared.completedAt) throw new Error();
    if (shared.state === "failed" && !shared.error) throw new Error();
    return { id: shared.id, attemptId: idSchema.parse(row.attempt_id), kind: shared.kind, remote: shared.target.remote,
      branch: shared.target.branch, state: shared.state, error: shared.error,
      createdAt: shared.createdAt, completedAt: shared.completedAt };
  } catch { throw new PushError("invalid-record"); }
}

function safeGitDirectory(root: string): string {
  try {
    const git = checkedDirectory(assertInside(root, join(root, ".git")));
    // A clone is Host-owned. Fail closed on config that could redirect an explicit URL,
    // enable includes, replace transports, or weaken transport authentication.
    const config = fs.readFileSync(assertInside(git, join(git, "config")), "utf8");
    let section = "";
    for (const line of config.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || /^[#;]/.test(trimmed)) continue;
      if (trimmed.startsWith("[")) {
        if (!/^\[(core|user|remote "[A-Za-z0-9._-]+"|branch "[A-Za-z0-9._/-]+")\]$/i.test(trimmed))
          throw new PushError("workspace-unavailable");
        section = trimmed.slice(1, -1).split(" ", 1)[0]?.toLowerCase() ?? "";
      } else {
        const key = trimmed.split(/[=\s]/, 1)[0]?.toLowerCase() ?? "";
        const allowed: Record<string, readonly string[]> = {
          core: ["repositoryformatversion", "filemode", "bare", "logallrefupdates", "ignorecase", "precomposeunicode", "autocrlf", "hookspath", "fsmonitor"],
          user: ["name", "email"], remote: ["url", "fetch", "pushurl"], branch: ["remote", "merge"],
        };
        if (!allowed[section]?.includes(key) || trimmed.endsWith("\\")) throw new PushError("workspace-unavailable");
      }
    }
    return git;
  } catch (error) {
    if (error instanceof PushError) throw error;
    throw new PushError("workspace-unavailable");
  }
}

/** Check loose/packed refs without launching a process before the write-ahead commit. */
function localTip(root: string, branch: string): string {
  try {
    const git = safeGitDirectory(root);
    const ref = `refs/heads/${branch}`;
    const loose = assertInside(git, join(git, ref));
    let tip: string | undefined;
    try { tip = fs.readFileSync(loose, "utf8").trim(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (tip === undefined) {
      try {
        tip = fs.readFileSync(assertInside(git, join(git, "packed-refs")), "utf8").split("\n")
          .map((line) => line.split(" ")).find((parts) => parts[1] === ref)?.[0];
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    if (!tip || !sha.test(tip)) throw new PushError("branch-missing");
    return tip;
  } catch (error) {
    if (error instanceof PushError) throw error;
    throw new PushError("workspace-unavailable");
  }
}

function classification(result: RunResult): string {
  const text = `${result.stderr}\n${result.stdout}`;
  if (/non-fast-forward|\[rejected\]|\[remote rejected\]|protected branch|fetch first|pre-receive hook declined/i.test(text)) return "rejected";
  if (/authentication|permission denied|could not read username|access denied|publickey|unauthorized|forbidden|returned error: (401|403)/i.test(text)) return "auth";
  if (/could not resolve|unable to access|connection|network|timed out|does not appear to be a git repository|could not read from remote/i.test(text)) return "network";
  return "other";
}
function succeeded(result: RunResult, branch: string): boolean {
  const refspec = `refs/heads/${branch}:refs/heads/${branch}`;
  return result.stdout.split(/\r?\n/).some((line) => {
    const fields = line.split("\t");
    return [" ", "*", "="].includes(fields[0] ?? "") && fields[1] === refspec;
  });
}

export function createEffectExecutor(deps: {
  raw: Database; hub: EventHub; clock: Clock; newId: () => string; remotes: PushRemote[];
  sshCommand?: string; runGit?: (options: RunOptions) => Promise<RunResult>; timeoutMs?: number;
  projectRootFor(projectId: string): string | null;
}) {
  const { raw, hub } = deps;
  const configured = deps.remotes.length ? parsePushRemotes(deps.remotes.map((remote) => `${remote.name}=${remote.url}`).join(",")) : [];
  validatePushSshCommand(deps.sshCommand);
  const remotes = new Map(configured.map((remote) => [remote.name, remote]));
  const queues = new Map<string, Promise<unknown>>();
  const handles = new Set<RunHandle>();
  let stopped = false;
  let closing: Promise<void> | undefined;
  const rowOf = (projectId: string, id: string): Row | undefined => raw.prepare("SELECT * FROM effects WHERE project_id = ? AND id = ?")
    .get(projectId, id) as Row | undefined;
  const publish = (row: Row, revision: number): void => { hub.append({ projectId: row.project_id, causationId: row.id,
    payload: { type: "entity.changed", entity: { kind: "effect", id: row.id, revision } } }); };
  const update = (row: Row, state: EffectState, error: string | null): EffectView => hub.transaction(() => {
    raw.prepare("UPDATE effects SET state = ?, error = ?, completed_at = ? WHERE project_id = ? AND id = ? AND state = ?")
      .run(state, error, state === "done" || state === "failed" ? deps.clock().toISOString() : null, row.project_id, row.id, row.state);
    const changed = rowOf(row.project_id, row.id)!;
    publish(changed, row.state === "unknown" ? 3 : 2);
    return view(changed);
  });
  const serialize = <T>(projectId: string, operation: () => Promise<T>): Promise<T> => {
    if (stopped) return Promise.reject(new PushError("not-available"));
    if (raw.inTransaction) return Promise.reject(new PushError("not-available"));
    const next = (queues.get(projectId) ?? Promise.resolve()).catch(() => undefined).then(() => {
      if (stopped || raw.inTransaction) throw new PushError("not-available");
      return operation();
    });
    queues.set(projectId, next);
    void next.finally(() => { if (queues.get(projectId) === next) queues.delete(projectId); }).catch(() => undefined);
    return next;
  };
  const rootFor = (projectId: string): string => {
    try {
      const root = deps.projectRootFor(projectId);
      if (!root) throw new Error();
      return checkedDirectory(root);
    } catch { throw new PushError("workspace-unavailable"); }
  };
  const run = async (root: string, remote: PushRemote, args: string[], network: boolean): Promise<RunResult> => {
    const home = fs.mkdtempSync(join(tmpdir(), "factory-effect-"));
    try {
      const hooks = assertInside(home, join(home, "hooks")); fs.mkdirSync(hooks, { mode: 0o700 });
      const scheme = new URL(remote.url).protocol.slice(0, -1);
      const env = buildSafeEnv({ HOME: home, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "",
        GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
        ...(network && scheme === "ssh" && deps.sshCommand !== undefined ? { GIT_SSH_COMMAND: deps.sshCommand } : {}),
      });
      const options: RunOptions = { command: "/usr/bin/git", cwd: checkedDirectory(root), env,
        args: ["-c", "credential.helper=", "-c", `core.hooksPath=${hooks}`, "-c", "core.fsmonitor=false",
          "-c", "protocol.allow=never", "-c", `protocol.${scheme}.allow=always`, ...args],
        timeoutMs: deps.timeoutMs ?? 120_000, maxOutputBytes: 64 * 1024 };
      if (deps.runGit) return await deps.runGit(options);
      const handle = startProcess(options); handles.add(handle);
      try { return await handle.result; } finally { handles.delete(handle); }
    } finally {
      // Only directories created by this call are removed; no caller-controlled recursive cleanup.
      try { fs.rmdirSync(assertInside(home, join(home, "hooks"))); } catch { /* Empty private directory only. */ }
      try { fs.rmdirSync(home); } catch { /* Git may have populated its private HOME. */ }
    }
  };
  const badResult = (result: RunResult): boolean => result.timedOut || result.stopped || !result.groupGone || result.exitCode === null;
  const execute = async (row: Row, root: string, remote: PushRemote, target: Target): Promise<EffectView> => {
    try {
      const verified = await run(root, remote, ["rev-parse", "--verify", `refs/heads/${target.branch}`], false);
      if (badResult(verified) || verified.exitCode !== 0 || verified.stdout.trim() !== target.tipSha)
        return update(row, "failed", "other");
      if (stopped) return update(row, "failed", "other");
      // Check config again after the local verification, immediately before contacting the remote.
      if (localTip(root, target.branch) !== target.tipSha) return update(row, "failed", "other");
    } catch { return update(row, "failed", "other"); }
    let result: RunResult;
    try {
      result = await run(root, remote, ["push", "--porcelain", "--no-verify", "--no-follow-tags", remote.url,
        `refs/heads/${target.branch}:refs/heads/${target.branch}`], true);
    } catch { return update(row, "unknown", "other"); }
    if (badResult(result)) return update(row, "unknown", result.timedOut ? "timeout" : "other");
    if (result.exitCode !== 0) return update(row, "failed", classification(result));
    if (result.truncated || !succeeded(result, target.branch)) return update(row, "unknown", "other");
    return update(row, "done", null);
  };
  const executor = {
    remoteNames(): string[] { return configured.map(describeRemote); },
    getEffect(projectId: string, effectId: string): EffectView | null { const row = rowOf(projectId, effectId); return row ? view(row) : null; },
    listEffects(projectId: string, options: { attemptId?: string } = {}): EffectView[] {
      const rows = raw.prepare("SELECT * FROM effects WHERE project_id = ? ORDER BY created_at, rowid").all(projectId) as Row[];
      return rows.filter((row) => options.attemptId === undefined || row.attempt_id === options.attemptId).map(view);
    },
    requestPush(input: { projectId: string; attemptId: string; remote: string }): Promise<EffectView> {
      // Return an existing pending effect immediately, even while its project queue is occupied.
      try {
        if (stopped || raw.inTransaction) throw new PushError("not-available");
        if (!remotes.has(input.remote)) throw new PushError("unknown-remote");
        const prior = raw.prepare("SELECT * FROM effects WHERE project_id = ? AND attempt_id = ? AND state <> 'failed' ORDER BY rowid DESC")
          .all(input.projectId, input.attemptId) as Row[];
        const existing = prior.find((row) => targetOf(row).remote === input.remote);
        if (existing) return Promise.resolve(view(existing));
      } catch (error) { return Promise.reject(error instanceof PushError ? error : new PushError("invalid-record")); }
      return serialize(input.projectId, async () => {
        const remote = remotes.get(input.remote)!;
        const attempt = raw.prepare(`SELECT t.state FROM attempts a JOIN tasks t ON t.project_id = a.project_id AND t.id = a.task_id
          WHERE a.project_id = ? AND a.id = ?`).get(input.projectId, input.attemptId) as { state: string } | undefined;
        if (!attempt) throw new PushError("not-found");
        if (attempt.state !== "done") throw new PushError("task-not-done");
        const events = raw.prepare("SELECT body_json FROM attempt_events WHERE project_id = ? AND attempt_id = ? AND kind = 'state' ORDER BY seq DESC")
          .all(input.projectId, input.attemptId) as { body_json: string }[];
        let ready: { branch?: unknown } | undefined;
        try { ready = events.map((event) => JSON.parse(event.body_json) as { to?: string; branch?: unknown }).find((event) => event.to === "workspace-ready"); }
        catch { throw new PushError("workspace-not-ready"); }
        if (!ready) throw new PushError("workspace-not-ready");
        if (!validBranch(ready.branch)) throw new PushError("invalid-branch");
        const branch = ready.branch;
        const previous = (raw.prepare("SELECT * FROM effects WHERE project_id = ? AND attempt_id = ? ORDER BY rowid")
          .all(input.projectId, input.attemptId) as Row[]).filter((row) => {
          const target = targetOf(row); return target.remote === remote.name && target.branch === branch;
        });
        const existing = previous.find((row) => row.state !== "failed");
        if (existing) return view(existing);
        const root = rootFor(input.projectId);
        const target: Target = { remote: remote.name, branch, tipSha: localTip(root, branch), remoteDigest: digest(remote.url) };
        const row: Row = { project_id: input.projectId, id: deps.newId(), attempt_id: input.attemptId, kind: "git.push-branch",
          idempotency_key: digest(`git.push-branch|${input.attemptId}|${remote.name}|${branch}|${previous.length + 1}`),
          target_json: JSON.stringify(target), state: "pending", error: null, created_at: deps.clock().toISOString(), completed_at: null };
        view(row);
        hub.transaction(() => {
          raw.prepare(`INSERT INTO effects (project_id, id, attempt_id, kind, idempotency_key, target_json, state, error, created_at, completed_at)
            VALUES (@project_id, @id, @attempt_id, @kind, @idempotency_key, @target_json, @state, @error, @created_at, @completed_at)`).run(row);
          publish(row, 1);
        });
        if (raw.inTransaction) throw new PushError("not-available");
        return execute(row, root, remote, target);
      });
    },
    reconcile(input: { projectId: string; effectId: string }): Promise<EffectView> {
      return serialize(input.projectId, async () => {
        const row = rowOf(input.projectId, input.effectId);
        if (!row) throw new PushError("not-found");
        if (row.state !== "unknown") throw new PushError("not-unknown");
        const target = targetOf(row);
        const remote = remotes.get(target.remote);
        if (!remote || target.remoteDigest !== digest(remote.url) || !sha.test(target.tipSha ?? "")) throw new PushError("unreachable");
        let result: RunResult;
        try {
          const root = rootFor(input.projectId); safeGitDirectory(root);
          result = await run(root, remote, ["ls-remote", remote.url, `refs/heads/${target.branch}`], true);
        } catch { throw new PushError("unreachable"); }
        if (badResult(result) || result.truncated || result.exitCode !== 0) throw new PushError("unreachable");
        const lines = result.stdout.trim() ? result.stdout.trim().split(/\r?\n/) : [];
        if (lines.some((line) => !/^[a-f0-9]{40}(?:[a-f0-9]{24})?\trefs\/heads\//.test(line))) throw new PushError("unreachable");
        const match = lines.find((line) => line.split("\t")[1] === `refs/heads/${target.branch}`)?.split("\t")[0];
        return match === target.tipSha ? update(row, "done", null) : update(row, "failed", "not-pushed");
      });
    },
    recoverAtStart(): void {
      if (raw.inTransaction || queues.size) throw new PushError("not-available");
      for (const row of raw.prepare("SELECT * FROM effects WHERE state = 'pending'").all() as Row[]) update(row, "unknown", "other");
    },
    close(): Promise<void> {
      stopped = true;
      closing ??= (async () => {
        await Promise.allSettled([...handles].map((handle) => handle.stop("shutdown")));
        await Promise.allSettled([...queues.values()]);
      })();
      return closing;
    },
  };
  return executor;
}
export type EffectExecutor = ReturnType<typeof createEffectExecutor>;
