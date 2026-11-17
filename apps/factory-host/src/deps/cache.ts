import fs from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";
import { startProcess, type RunHandle } from "../exec/process-group.js";
import { buildSafeEnv } from "../exec/safe-env.js";

export interface DependencyCacheResult { used: boolean; warning?: string }
export interface DependencyCache {
  prepare(worktree: string, network?: "host" | "isolated"): Promise<DependencyCacheResult>;
  close(): Promise<void>;
}
const MAX_ENTRIES = 8, TIMEOUT_MS = 5 * 60_000;
const caches = new Map<string, DependencyCache>();
const enabled = (): boolean => process.env.FACTORY_DEP_CACHE !== "0";
const exists = (path: string): boolean => { try { fs.lstatSync(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; } };
const mkdir = (path: string): void => { fs.mkdirSync(path, { recursive: true, mode: 0o700 }); if (!fs.lstatSync(path).isDirectory()) throw new Error("invalid cache directory"); };
const digestOf = (lock: Buffer): string => createHash("sha256").update(lock).update(`\0node-${process.versions.node.split(".")[0]}`).digest("hex");
const cleanLog = (text: string): string => text.replace(/(?:https?|git\+https?|ssh):\/\/[^\s<>"']+/gi, "[url]").replace(/\b(?:npm_|gh[pousr]_|sk-)[A-Za-z0-9_-]+/g, "[redacted]");
function trim(root: string, pinned: ReadonlyMap<string, number>): void {
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && /^[a-f0-9]{64}$/.test(e.name))
    .map((e) => ({ name: e.name, mtime: fs.statSync(join(root, e.name)).mtimeMs })).sort((a, b) => a.mtime - b.mtime);
  let count = entries.length;
  for (const entry of entries) {
    if (count <= MAX_ENTRIES) break;
    if (pinned.has(entry.name)) continue;
    fs.rmSync(join(root, entry.name), { recursive: true, force: true });
    fs.rmSync(join(root, "logs", `${entry.name}.log`), { force: true });
    count--;
  }
}
function linksInside(root: string, current = root): void {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      // Absolute links into the install directory would break (or expose cache files) after copying.
      if (isAbsolute(fs.readlinkSync(path)) || !fs.realpathSync(path).startsWith(`${root}/`)) throw new Error("external link");
    }
    else if (entry.isDirectory()) linksInside(root, path);
    else if (!entry.isFile()) throw new Error("invalid dependency file");
  }
}

export function createDependencyCache(stateDir: string): DependencyCache {
  const root = join(stateDir, "dep-cache"), old = caches.get(root); if (old) return old;
  const inflight = new Map<string, Promise<boolean>>();
  const pinned = new Map<string, number>();
  const handles = new Set<RunHandle>(), operations = new Set<Promise<DependencyCacheResult>>();
  let stopped = false;
  let initialized = false;
  function initialize(): void {
    if (initialized) return; mkdir(root);
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) if (entry.name.startsWith(".partial-")) fs.rmSync(join(root, entry.name), { recursive: true, force: true });
    trim(root, pinned); mkdir(join(root, "logs")); mkdir(join(root, ".npm")); initialized = true;
  }
  async function install(digest: string, manifest: Buffer, lock: Buffer, network: "host" | "isolated"): Promise<boolean> {
    const entry = join(root, digest), cached = join(entry, "node_modules"); if (exists(cached)) return true;
    const temporary = fs.mkdtempSync(join(root, ".partial-"));
    try {
      const project = join(temporary, "project"), home = join(temporary, "home"); mkdir(project); mkdir(home);
      fs.writeFileSync(join(project, "package.json"), manifest, { mode: 0o600 }); fs.writeFileSync(join(project, "package-lock.json"), lock, { mode: 0o600 });
      const env = buildSafeEnv({ HOME: home, TMPDIR: home, PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`, npm_config_userconfig: join(home, ".npmrc"), npm_config_globalconfig: "/dev/null", npm_config_cache: join(root, ".npm"),
        npm_config_install_links: "true", npm_config_include: "dev" });
      let command = "npm", args = ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"];
      if (network === "isolated") {
        // Match OpenCode's network namespace; fail closed if bwrap cannot start.
        const binds: string[] = [];
        for (const name of ["bin", "sbin", "lib", "lib64"]) if (exists(`/${name}`) && fs.lstatSync(`/${name}`).isSymbolicLink()) binds.push("--symlink", fs.readlinkSync(`/${name}`), `/${name}`);
        const nodeRoot = dirname(dirname(process.execPath));
        if (nodeRoot !== "/usr" && !nodeRoot.startsWith("/usr/")) binds.push("--ro-bind", nodeRoot, nodeRoot);
        command = "/usr/bin/bwrap"; args = ["--unshare-all", "--die-with-parent", "--new-session", "--ro-bind", "/usr", "/usr", ...binds, "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--bind", temporary, temporary, "--bind", join(root, ".npm"), join(root, ".npm"), "--chdir", project, "--", "npm", ...args];
      }
      const logPath = join(root, "logs", `${digest}.log`), log = fs.openSync(logPath, "w", 0o600);
      try {
        const handle = startProcess({ command, args, cwd: project, env, timeoutMs: TIMEOUT_MS, maxOutputBytes: 1024 * 1024 });
        handles.add(handle);
        try {
          const result = await handle.result;
          // Redact after capture so credentials split across output chunks cannot escape sanitization.
          fs.writeSync(log, cleanLog(`${result.stdout}\n${result.stderr}`));
          if (stopped || result.exitCode !== 0 || result.timedOut || result.stopped || !result.groupGone) return false;
        } finally { handles.delete(handle); }
      } finally { fs.closeSync(log); }
      const modules = join(project, "node_modules"); if (!exists(modules)) mkdir(modules); if (!fs.lstatSync(modules).isDirectory()) return false; linksInside(modules);
      const ready = join(temporary, "ready"); mkdir(ready);
      fs.renameSync(modules, join(ready, "node_modules"));
      fs.renameSync(ready, entry); return true;
    } catch { return false; } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }
  async function prepare(worktree: string, network: "host" | "isolated"): Promise<DependencyCacheResult> {
    if (stopped || !enabled()) return { used: false }; const lockPath = join(worktree, "package-lock.json");
    let selected: string | undefined;
    try {
      if (!exists(lockPath)) return { used: false };
      if (!fs.lstatSync(lockPath).isFile() || !fs.lstatSync(join(worktree, "package.json")).isFile()) throw new Error("invalid package file");
      const lock = fs.readFileSync(lockPath), manifest = fs.readFileSync(join(worktree, "package.json")); initialize();
      const digest = digestOf(lock), pending = inflight.get(digest); let operation = pending;
      selected = digest; pinned.set(digest, (pinned.get(digest) ?? 0) + 1);
      if (!operation) { operation = install(digest, manifest, lock, network); inflight.set(digest, operation); void operation.finally(() => inflight.delete(digest)).catch(() => undefined); }
      if (!await operation) return { used: false, warning: "Dependency cache install failed; dependencies may need installing." };
      if (stopped) return { used: false };
      const destination = join(worktree, "node_modules"), scratch = join(worktree, ".factory");
      mkdir(scratch);
      const temporary = fs.mkdtempSync(join(scratch, "deps-"));
      // Reflinks fall back to independent copies. No hardlinks: agent edits and chmod cannot affect cache inodes.
      try {
        const handle = startProcess({ command: "/bin/cp", args: ["--reflink=auto", "-a", join(root, digest, "node_modules"), join(temporary, "node_modules")],
          cwd: worktree, env: buildSafeEnv({ HOME: temporary }), timeoutMs: TIMEOUT_MS, maxOutputBytes: 0 });
        handles.add(handle);
        try {
          const result = await handle.result;
          if (stopped || result.exitCode !== 0 || result.timedOut || result.stopped || !result.groupGone) return { used: false, warning: "Dependency cache copy failed; dependencies may need installing." };
        } finally { handles.delete(handle); }
        // Copy beside the destination so rename works even when state and worktrees use different filesystems.
        fs.rmSync(destination, { recursive: true, force: true }); fs.renameSync(join(temporary, "node_modules"), destination);
      }
      finally { fs.rmSync(temporary, { recursive: true, force: true }); }
      fs.utimesSync(join(root, digest), new Date(), new Date()); return { used: true };
    } catch { return { used: false, warning: "Dependency cache unavailable; dependencies may need installing." };
    } finally {
      if (selected) { const count = (pinned.get(selected) ?? 1) - 1; if (count) pinned.set(selected, count); else pinned.delete(selected); }
      try { if (initialized) trim(root, pinned); } catch { /* Maintenance cannot fail an attempt. */ }
    }
  }
  const cache: DependencyCache = {
    prepare(worktree, network = "host") {
      const operation = prepare(worktree, network);
      operations.add(operation);
      void operation.finally(() => operations.delete(operation)).catch(() => undefined);
      return operation;
    },
    async close() {
      stopped = true;
      await Promise.allSettled([...handles].map((handle) => handle.stop("shutdown")));
      await Promise.allSettled([...operations]);
      caches.delete(root);
    },
  };
  caches.set(root, cache); if (enabled()) try { initialize(); } catch { /* prepare reports a warning */ } return cache;
}
