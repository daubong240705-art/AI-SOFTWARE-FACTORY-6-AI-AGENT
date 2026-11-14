/**
 * Publishing runs agent-written npm install/check/test/build code on the Host machine WITHOUT a sandbox.
 * A private HOME and a minimal environment prevent credential inheritance; they do not contain that code.
 * Only an operator request creates a job. Every external write has a durable record first; unknown writes
 * are never replayed, including after shutdown or a crash. Reconciliation only reads Portal state.
 */
import fs from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { z } from "zod";
import { idSchema, releaseViewSchema, rollbackRequestSchema, type ReleaseKind, type ReleaseState,
  type ReleaseView, type ReleasesResponse } from "@factory/contracts";
import { createIdGenerator, systemClock, type Clock } from "../ids.js";
import { startProcess, type RunHandle, type RunResult } from "../exec/process-group.js";
import { buildSafeEnv, scrubForLog } from "../exec/safe-env.js";
import { assertInside, checkedDirectory } from "../workspace/paths.js";
import { INTEGRATION_BRANCH } from "../workspace/integration.js";

export interface PortalConfig { url: string; token: string; publicUrl: string }

/** Input comes from main.ts, never from an ambient environment in this module. Errors contain no input. */
export function portalConfig(input: { url?: string; token?: string; publicUrl?: string; allowPrivateHttp?: boolean }): PortalConfig | null {
  // Opt-in: plain http to an RFC 1918 address (a Portal on the same local network). Host names are never trusted for this.
  const privateLan = (host: string): boolean => {
    const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
    if (!m) return false;
    const a = Number(m[1]), b = Number(m[2]);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  };
  const base = (value: string, loopbackOnly: boolean): string => {
    try {
      const url = new URL(value);
      const loopback = url.hostname === "localhost" || url.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
      if (!(["http:", "https:"].includes(url.protocol)) || (loopbackOnly && url.protocol === "http:" && !loopback
        && !(input.allowPrivateHttp === true && privateLan(url.hostname)))
        || url.username || url.password || url.search || url.hash) throw new Error();
      return url.href.replace(/\/$/, "");
    } catch { throw new Error("Invalid Portal URL configuration."); }
  };
  const url = input.url ? base(input.url, true) : null;
  const publicUrl = input.publicUrl ? base(input.publicUrl, false) : url;
  if (input.token !== undefined && (input.token.length < 24 || /[^\x21-\x7e]/.test(input.token)))
    throw new Error("Invalid Portal token configuration (expected at least 24 characters without whitespace).");
  return url && input.token && publicUrl ? { url, token: input.token, publicUrl } : null;
}

type ReleaseCode = "not-found" | "disabled" | "not-git" | "workflow-not-completed" | "release-in-progress"
  | "integration-missing" | "workspace-unavailable" | "invalid-game-id" | "not-unknown" | "unreachable" | "closed";
const messages: Record<ReleaseCode, string> = {
  "not-found": "Project or release not found.", disabled: "The Game Portal is not configured.",
  "not-git": "Publishing requires a Git project.", "workflow-not-completed": "The latest game-build workflow must be completed.",
  "release-in-progress": "A pending or unresolved release prevents publishing.",
  "integration-missing": "The factory/integration branch must exist.", "workspace-unavailable": "The Git workspace is unavailable.",
  "invalid-game-id": "The workspace folder name must be a valid Portal game id.", "not-unknown": "Only unknown releases can be reconciled.",
  unreachable: "The Portal outcome could not be verified.", closed: "Publishing is shutting down.",
};
export class ReleaseError extends Error {
  constructor(readonly code: ReleaseCode) { super(messages[code]); this.name = "ReleaseError"; }
}
interface Row {
  project_id: string; id: string; kind: ReleaseKind; game_id: string; commit_sha: string | null;
  state: ReleaseState; version: number | null; play_path: string | null; error: string | null;
  log_tail: string | null; created_at: string; completed_at: string | null;
}
const positiveVersion = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const versionsSchema = z.object({ currentVersion: positiveVersion.nullable(), versions: z.array(z.object({
  version: positiveVersion, commitSha: z.string().nullable(), createdAt: z.string(),
})) });
const successSchema = z.object({ gameId: z.string(), version: positiveVersion, playPath: z.string() });
const shaPattern = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const MAX_BUNDLE = 20 * 1024 * 1024;

export function createPublishService(deps: {
  raw: Database; stateDir: string; portal?: PortalConfig | null; clock?: Clock; newId?: () => string;
  fetchImpl?: typeof fetch; projectRootFor?(projectId: string): string | null;
}) {
  const { raw } = deps;
  const clock = deps.clock ?? systemClock, newId = deps.newId ?? createIdGenerator(clock);
  // Already validated by portalConfig() (which knows the allowPrivateHttp opt-in); validating again here would drop that context.
  const portal = deps.portal ?? null;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const queues = new Map<string, Promise<unknown>>(), handles = new Set<RunHandle>(), requests = new Set<AbortController>();
  let stopped = false, closing: Promise<void> | undefined;
  const clean = (value: string): string => scrubForLog(value, portal ? [portal.token, portal.url, portal.publicUrl] : [])
    .replace(/https?:\/\/[^\s<>"']+/gi, "[portal-url]").replace(/\r\n?/g, "\n").replace(/[^\P{Cc}\n\t]|\p{Cf}/gu, "");
  const rowOf = (projectId: string, id: string): Row | undefined => raw.prepare("SELECT * FROM game_releases WHERE project_id = ? AND id = ?")
    .get(projectId, id) as Row | undefined;
  const view = (row: Row, log = false): ReleaseView => releaseViewSchema.parse({
    id: row.id, kind: row.kind, gameId: row.game_id, commitSha: row.commit_sha, state: row.state,
    version: row.version, playUrl: row.play_path && portal ? `${portal.publicUrl}${row.play_path}` : null,
    error: row.error, createdAt: row.created_at, completedAt: row.completed_at,
    ...(log ? { logTail: row.log_tail ?? "" } : {}),
  });
  const update = (row: Row, state: ReleaseState, error: string | null, extra: { version?: number; playPath?: string; log?: string } = {}): ReleaseView => {
    raw.prepare(`UPDATE game_releases SET state = ?, error = ?, version = ?, play_path = ?, log_tail = ?, completed_at = ?
      WHERE project_id = ? AND id = ? AND state = ?`).run(state, error === null ? null : clean(error).slice(0, 500),
      extra.version ?? row.version, extra.playPath ?? row.play_path, extra.log === undefined ? row.log_tail : clean(extra.log).slice(-12000),
      state === "done" || state === "failed" ? clock().toISOString() : null, row.project_id, row.id, row.state);
    return view(rowOf(row.project_id, row.id)!);
  };
  const available = (): void => { if (stopped || raw.inTransaction) throw new ReleaseError("closed"); };
  const configured = (): PortalConfig => { available(); if (!portal) throw new ReleaseError("disabled"); return portal; };
  const project = (id: string) => {
    if (!idSchema.safeParse(id).success) throw new ReleaseError("not-found");
    const row = raw.prepare("SELECT workspace_kind, workspace_root FROM projects WHERE id = ?").get(id) as
      { workspace_kind: string; workspace_root: string } | undefined;
    if (!row) throw new ReleaseError("not-found");
    return row;
  };
  const gameIdFor = (projectId: string): string => {
    const gameId = basename(project(projectId).workspace_root);
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(gameId)) throw new ReleaseError("invalid-game-id");
    return gameId;
  };
  const busy = (id: string, unknown: boolean): void => {
    if (raw.prepare(`SELECT 1 FROM game_releases WHERE project_id = ? AND (state = 'pending' ${unknown ? "OR state = 'unknown'" : ""}) LIMIT 1`).get(id))
      throw new ReleaseError("release-in-progress");
  };
  const rootFor = (id: string): string => {
    const row = project(id);
    if (row.workspace_kind !== "git") throw new ReleaseError("not-git");
    try {
      const root = deps.projectRootFor ? deps.projectRootFor(id) : row.workspace_root;
      if (!root) throw new Error();
      return checkedDirectory(root);
    } catch { throw new ReleaseError("workspace-unavailable"); }
  };
  const serialize = <T>(id: string, operation: () => Promise<T>): Promise<T> => {
    available();
    const next = (queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(() => { available(); return operation(); });
    queues.set(id, next);
    void next.finally(() => { if (queues.get(id) === next) queues.delete(id); }).catch(() => undefined);
    return next;
  };
  const run = async (cwd: string, command: string, args: string[], home: string, timeoutMs: number,
    output?: (chunk: string) => void): Promise<RunResult> => {
    available();
    const handle = startProcess({ command, args, cwd, env: buildSafeEnv({ HOME: home, TMPDIR: home }), timeoutMs,
      maxOutputBytes: 256 * 1024, ...(output ? { onOutput: (_stream, chunk) => output(chunk) } : {}) });
    handles.add(handle);
    try { return await handle.result; } finally { handles.delete(handle); }
  };
  const succeeded = (result: RunResult): boolean => result.exitCode === 0 && !result.timedOut && !result.stopped && result.groupGone;
  const publishRoot = (): string => {
    const state = checkedDirectory(deps.stateDir), dir = assertInside(state, join(state, "publish"));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return checkedDirectory(dir);
  };
  const git = async (cwd: string, args: string[], home: string): Promise<string> => {
    const result = await run(cwd, "/usr/bin/git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
      "-c", "credential.helper=", "-c", "protocol.allow=never", ...args], home, 60_000);
    if (!succeeded(result) || result.truncated) throw new Error("git-failed");
    return result.stdout.trim();
  };
  const preconditions = async (id: string): Promise<{ root: string; sha: string; gameId: string }> => {
    configured(); project(id);
    const root = rootFor(id), gameId = gameIdFor(id);
    const workflow = raw.prepare("SELECT state FROM workflow_instances WHERE project_id = ? AND key = 'game-build' ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(id) as { state: string } | undefined;
    if (workflow?.state !== "completed") throw new ReleaseError("workflow-not-completed");
    busy(id, true);
    const home = fs.mkdtempSync(join(publishRoot(), "probe-"));
    try {
      const sha = await git(root, ["rev-parse", "--verify", `refs/heads/${INTEGRATION_BRANCH}^{commit}`], home);
      if (!shaPattern.test(sha)) throw new Error();
      return { root, sha, gameId };
    } catch { throw new ReleaseError(stopped ? "closed" : "integration-missing"); }
    finally { fs.rmSync(home, { recursive: true, force: true }); }
  };
  const insert = (projectId: string, kind: ReleaseKind, gameId: string, sha: string | null, version: number | null): Row => {
    available();
    const row: Row = { project_id: projectId, id: newId(), kind, game_id: gameId, commit_sha: sha, state: "pending",
      version, play_path: null, error: null, log_tail: null, created_at: clock().toISOString(), completed_at: null };
    raw.prepare(`INSERT INTO game_releases (project_id,id,kind,game_id,commit_sha,state,version,play_path,error,log_tail,created_at,completed_at)
      VALUES (@project_id,@id,@kind,@game_id,@commit_sha,@state,@version,@play_path,@error,@log_tail,@created_at,@completed_at)`).run(row);
    return row;
  };
  // Bound remote bodies too: a bad Portal cannot allocate unlimited memory or return raw error objects.
  const json = async (response: Response): Promise<unknown> => {
    if (!response.body) throw new Error();
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const item = await reader.read(); if (item.done) break;
        size += item.value.byteLength;
        if (size > 256 * 1024) throw new Error();
        chunks.push(item.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } finally { await reader.cancel().catch(() => undefined); }
  };
  const request = async <T>(path: string, init: RequestInit, consume: (response: Response) => Promise<T>): Promise<T> => {
    const config = configured(), controller = new AbortController(); requests.add(controller);
    try {
      const response = await fetchImpl(`${config.url}${path}`, { ...init, redirect: "manual",
        headers: { ...init.headers, Authorization: `Bearer ${config.token}` },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]) });
      return await consume(response);
    } finally { requests.delete(controller); }
  };
  const portalFailure = async (response: Response): Promise<string> => {
    try {
      const body = await json(response) as { error?: unknown; problems?: unknown };
      const lines = [typeof body.error === "string" ? body.error : `portal-http-${response.status}`,
        ...(Array.isArray(body.problems) ? body.problems.filter((line): line is string => typeof line === "string").slice(0, 5) : [])];
      return clean(lines.join("\n")).slice(0, 500) || `portal-http-${response.status}`;
    } catch { return `portal-http-${response.status}`; }
  };
  // Asked right before the upload and stored: reconciliation can then tell this upload from older versions of the same
  // commit. A Portal that cannot be reached here has received nothing, so that is a plain failure, not an unknown outcome.
  const baseVersion = async (row: Row): Promise<number | null> => {
    try {
      return await request(`/api/publish/games/${row.game_id}/versions`, { method: "GET" }, async (response) => {
        if (response.status === 404) { await response.body?.cancel(); return 0; }
        if (response.status >= 400 && response.status < 500) { update(row, "failed", await portalFailure(response)); return null; }
        if (response.status !== 200) { await response.body?.cancel(); update(row, "failed", "portal-unreachable"); return null; }
        return versionsSchema.parse(await json(response)).versions.reduce((max, item) => Math.max(max, item.version), 0);
      });
    } catch { update(row, "failed", stopped ? "host-shutdown" : "portal-unreachable"); return null; }
  };
  const send = async (row: Row, body?: Buffer): Promise<void> => {
    try {
      await request(row.kind === "publish" ? `/api/publish?commitSha=${row.commit_sha}` : `/api/publish/games/${row.game_id}/rollback`,
        { method: "POST", headers: { "Content-Type": body ? "application/gzip" : "application/json" },
          body: body ?? JSON.stringify({ version: row.version }) }, async (response) => {
          if (response.status >= 400 && response.status < 500) { update(row, "failed", await portalFailure(response)); return; }
          if (response.status !== 200) { update(row, "unknown", "portal-outcome-unknown"); await response.body?.cancel(); return; }
          const result = await json(response);
          if (row.kind === "rollback") {
            if (!z.object({ ok: z.literal(true) }).safeParse(result).success) throw new Error();
            update(row, "done", null, { playPath: `/play/${row.game_id}` });
          } else {
            const parsed = successSchema.parse(result);
            if (parsed.gameId !== row.game_id || parsed.playPath !== `/play/${row.game_id}`) throw new Error();
            update(row, "done", null, { version: parsed.version, playPath: parsed.playPath });
          }
        });
    } catch { update(row, "unknown", stopped ? "host-shutdown" : "portal-outcome-unknown"); }
  };
  const build = async (row: Row, root: string): Promise<void> => {
    let temporary: string | undefined, log = "", step = "prepare";
    const append = (text: string): void => { log = clean(log + text).slice(-12000); };
    try {
      const dir = publishRoot(), cwd = assertInside(dir, join(dir, row.project_id));
      temporary = fs.mkdtempSync(join(dir, "bundle-"));
      const home = join(temporary, "home"); fs.mkdirSync(home, { mode: 0o700 });
      if (!fs.existsSync(join(cwd, ".git"))) {
        if (fs.existsSync(cwd)) {
          if (fs.lstatSync(cwd).isSymbolicLink()) throw new Error();
          fs.rmSync(cwd, { recursive: true, force: true });
        }
        await git(root, ["worktree", "prune"], home);
        await git(root, ["worktree", "add", "--detach", "--force", "--", cwd, row.commit_sha!], home);
      } else {
        checkedDirectory(cwd);
        if (!fs.lstatSync(join(cwd, ".git")).isFile()) throw new Error();
        const common = await git(cwd, ["rev-parse", "--git-common-dir"], home);
        const expected = await git(root, ["rev-parse", "--git-common-dir"], home);
        if (fs.realpathSync(resolve(cwd, common)) !== fs.realpathSync(resolve(root, expected))) throw new Error();
        await git(cwd, ["checkout", "--detach", "--force", row.commit_sha!], home);
      }
      await git(cwd, ["reset", "--hard", "--quiet", row.commit_sha!], home);
      // A second force also removes untracked nested repositories left by a previous build.
      await git(cwd, ["clean", "-fdx", "-f"], home);
      for (const [name, args, timeout] of [
        ["install", fs.existsSync(join(cwd, "package-lock.json")) ? ["ci"] : ["install", "--no-audit", "--no-fund"], 600_000],
        ["check", ["run", "check"], 300_000], ["test", ["test"], 300_000], ["build", ["run", "build"], 300_000],
      ] as const) {
        step = name; append(`$ npm ${args.join(" ")}\n`);
        if (!succeeded(await run(cwd, "npm", [...args], home, timeout, append))) throw new Error();
      }
      step = "manifest";
      const dist = checkedDirectory(assertInside(cwd, join(cwd, "dist"))), manifest = assertInside(dist, join(dist, "game.json"));
      const stat = fs.lstatSync(manifest);
      if (!stat.isFile() || stat.size > 1024 * 1024 || (JSON.parse(fs.readFileSync(manifest, "utf8")) as { id?: unknown })?.id !== row.game_id)
        throw new Error();
      step = "archive";
      const tarball = join(temporary, "dist.tar.gz");
      if (!succeeded(await run(cwd, "tar", ["-czf", tarball, "-C", "dist", "."], home, 300_000, append))) throw new Error();
      if (fs.lstatSync(tarball).size > MAX_BUNDLE) { update(row, "failed", "bundle-too-large", { log }); return; }
      raw.prepare("UPDATE game_releases SET log_tail = ? WHERE project_id = ? AND id = ? AND state = 'pending'")
        .run(clean(log).slice(-12000), row.project_id, row.id);
      row.log_tail = log;
      available();
      const base = await baseVersion(row);
      if (base === null) return;
      raw.prepare("UPDATE game_releases SET base_version = ? WHERE project_id = ? AND id = ? AND state = 'pending'").run(base, row.project_id, row.id);
      await send(row, fs.readFileSync(tarball));
    } catch {
      update(row, stopped ? "unknown" : "failed", stopped ? "host-shutdown" : step === "manifest" ? "manifest-mismatch" : `build-failed: ${step}`, { log });
    } finally {
      // Shutdown can already have changed pending to unknown; retain output without changing that outcome.
      try {
        raw.prepare("UPDATE game_releases SET log_tail = ? WHERE project_id = ? AND id = ?")
          .run(clean(log).slice(-12000), row.project_id, row.id);
      } finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
    }
  };
  const background = (row: Row, operation: () => Promise<void>): void => {
    void serialize(row.project_id, operation).catch(() => { update(row, "unknown", stopped ? "host-shutdown" : "job-outcome-unknown"); });
  };
  const service = {
    async list(projectId: string, log = false): Promise<ReleasesResponse> {
      project(projectId);
      let reason: string | null = null;
      try { await preconditions(projectId); } catch (error) { reason = error instanceof ReleaseError ? error.message : messages["workspace-unavailable"]; }
      const rows = raw.prepare("SELECT * FROM game_releases WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50").all(projectId) as Row[];
      return { enabled: portal !== null, canPublish: { allowed: reason === null, reason }, releases: rows.map((row) => view(row, log)) };
    },
    async publish(projectId: string): Promise<ReleaseView> {
      configured(); project(projectId); busy(projectId, true);
      return serialize(projectId, async () => {
        const target = await preconditions(projectId);
        busy(projectId, true); // No await between the final guard and the durable insert.
        const row = insert(projectId, "publish", target.gameId, target.sha, null), result = view(row);
        background(row, () => build(row, target.root));
        return result;
      });
    },
    async rollback(projectId: string, version: number): Promise<ReleaseView> {
      configured(); project(projectId); busy(projectId, false);
      rollbackRequestSchema.parse({ version });
      return serialize(projectId, async () => {
        busy(projectId, false);
        const row = insert(projectId, "rollback", gameIdFor(projectId), null, version), result = view(row);
        background(row, () => send(row));
        return result;
      });
    },
    async reconcile(projectId: string, releaseId: string): Promise<ReleaseView> {
      configured(); project(projectId);
      return serialize(projectId, async () => {
        const row = rowOf(projectId, releaseId);
        if (!row) throw new ReleaseError("not-found");
        if (row.state !== "unknown") throw new ReleaseError("not-unknown");
        const base = (raw.prepare("SELECT base_version FROM game_releases WHERE project_id = ? AND id = ?").get(projectId, releaseId) as { base_version: number | null }).base_version;
        // The base version is stored before the upload starts: without it nothing was ever sent.
        if (row.kind === "publish" && base === null) return update(row, "failed", "not-sent");
        try {
          return await request(`/api/publish/games/${row.game_id}/versions`, { method: "GET" }, async (response) => {
            if (response.status === 404) { await response.body?.cancel(); return update(row, "failed", "not-on-portal"); }
            if (response.status !== 200) { await response.body?.cancel(); throw new Error(); }
            const result = versionsSchema.parse(await json(response));
            // Rollbacks have no commit SHA: only the current live version proves their outcome.
            const found = row.kind === "rollback" ? result.versions.find((item) => item.version === row.version && result.currentVersion === row.version)
              : result.versions.find((item) => row.commit_sha !== null && item.commitSha === row.commit_sha && item.version > (base ?? 0));
            if (stopped) throw new Error();
            return found ? update(row, "done", null, { version: found.version, playPath: `/play/${row.game_id}` })
              : update(row, "failed", "not-on-portal");
          });
        } catch { throw new ReleaseError("unreachable"); }
      });
    },
    recoverAtStart(): void {
      if (queues.size || raw.inTransaction) throw new ReleaseError("closed");
      raw.prepare("UPDATE game_releases SET state = 'unknown', error = 'host-restarted', completed_at = NULL WHERE state = 'pending'").run();
    },
    close(): Promise<void> {
      if (closing) return closing;
      stopped = true;
      raw.prepare("UPDATE game_releases SET state = 'unknown', error = 'host-shutdown', completed_at = NULL WHERE state = 'pending'").run();
      for (const controller of requests) controller.abort();
      closing = (async () => {
        await Promise.allSettled([...handles].map((handle) => handle.stop("shutdown")));
        await Promise.allSettled([...queues.values()]);
      })();
      return closing;
    },
  };
  return service;
}
export type PublishService = ReturnType<typeof createPublishService>;
