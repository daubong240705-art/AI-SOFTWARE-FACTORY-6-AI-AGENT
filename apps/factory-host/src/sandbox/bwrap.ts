import { lstatSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, posix, resolve, relative, sep } from "node:path";
import { assertInside, canonicalPath, refuseMount } from "../workspace/paths.js";

export interface SandboxSpec {
  bwrapPath: string;
  workspace: string;
  roots: { worktreesRoot: string; projectsRoot: string; stateDir: string };
  readOnlyBinds: { host: string; guest: string }[];
  gitDirs?: { common: string; worktree: string };
  socket?: { host: string; guest: string };
  env: Record<string, string>;
  command: string;
  args: string[];
  workdir?: string;
}

export class SandboxError extends Error {
  constructor(readonly code: "invalid-spec" | "unavailable") {
    super(code);
    this.name = "SandboxError";
  }
}

const invalid = (): never => { throw new SandboxError("invalid-spec"); };
const secretName = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE/i;
const reserved = ["/proc", "/dev", "/tmp", "/home/agent", "/usr", "/etc"];
const forbiddenHosts = ["/", "/etc", "/root", "/mnt", "/proc", "/sys", "/dev", "/run"];

function contains(parent: string, child: string): boolean {
  const difference = relative(parent, child);
  return difference === "" || (!isAbsolute(difference) && difference !== ".." && !difference.startsWith(`..${sep}`));
}

function hostPath(path: string): string {
  if (typeof path !== "string" || !isAbsolute(path) || /[\0\r\n]/.test(path)
    || path.split(/[\\/]/).some((part) => part === "." || part === "..") || resolve(path) !== path) invalid();
  const canonical = canonicalPath(path);
  // Requiring canonical spelling also refuses symlink components, including dangling links.
  if (canonical !== path) invalid();
  return canonical;
}

function guestPath(path: string): string {
  if (typeof path !== "string" || !posix.isAbsolute(path) || posix.normalize(path) !== path
    || /[\0\r\n\\]/.test(path) || path.endsWith("/")
    || reserved.some((root) => path === root || path.startsWith(`${root}/`) || root.startsWith(`${path}/`))) invalid();
  return path;
}

// Metadata probes select only existing system links/files; no file contents are read.
function exists(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

/** Builds arguments only. It never creates directories, reads config, or inherits environment. */
export function buildSandboxCommand(spec: SandboxSpec): { command: string; args: string[] } {
  try {
    if (!spec || typeof spec !== "object" || !spec.roots || !Array.isArray(spec.readOnlyBinds)
      || spec.readOnlyBinds.length > 16 || !spec.env || typeof spec.env !== "object" || Array.isArray(spec.env)) invalid();
    const command = hostPath(spec.bwrapPath);
    const workspace = hostPath(spec.workspace);
    const worktrees = hostPath(spec.roots.worktreesRoot);
    const projects = hostPath(spec.roots.projectsRoot);
    const state = hostPath(spec.roots.stateDir);
    for (const path of [workspace, worktrees, projects, state]) refuseMount(path);
    for (const [a, b] of [[worktrees, projects], [worktrees, state], [projects, state]] as const)
      if (contains(a, b) || contains(b, a)) invalid();
    assertInside(worktrees, workspace);
    const protectedRoots = [state, worktrees, projects];
    // The mandatory system mount must never reveal any Host-owned private root.
    if (protectedRoots.some((root) => contains(resolve("/usr"), root) || contains(root, resolve("/usr")))) invalid();
    const home = canonicalPath(homedir());
    const safeHost = (path: string, socket = false): string => {
      const result = hostPath(path);
      refuseMount(result);
      if (protectedRoots.some((root) => contains(result, root) || (!socket && contains(root, result))) || contains(result, home)) invalid();
      for (const root of forbiddenHosts) {
        // A socket is a single capability; its containing directory is never mounted.
        if (result === resolve(root) || (root !== "/" && contains(resolve(root), result) && !socket)) invalid();
      }
      if (socket) {
        if ([...forbiddenHosts.map((root) => resolve(root)), ...protectedRoots, home].includes(dirname(result))) invalid();
        if (exists(result) && !lstatSync(result).isSocket()) invalid();
      }
      return result;
    };
    const destinations = new Set([workspace]);
    const destination = (path: string): string => {
      const result = guestPath(path);
      if (destinations.has(result)) invalid();
      destinations.add(result);
      return result;
    };
    const binds = spec.readOnlyBinds.map((bind) => ({ host: safeHost(bind.host), guest: destination(bind.guest) }));
    let git: { common: string; worktree: string } | undefined;
    if (spec.gitDirs) {
      const common = hostPath(spec.gitDirs.common);
      const worktree = hostPath(spec.gitDirs.worktree);
      assertInside(projects, common);
      assertInside(projects, worktree);
      assertInside(join(common, "worktrees"), worktree);
      if (destinations.has(common) || destinations.has(worktree)) invalid();
      destinations.add(common); destinations.add(worktree);
      git = { common, worktree };
    }
    const socket = spec.socket ? { host: safeHost(spec.socket.host, true), guest: destination(spec.socket.guest) } : undefined;
    // Overlaying a tool destination could turn its descendants into host writes when
    // the workspace or writable Git mount is applied later in the mount sequence.
    for (const bind of binds) {
      for (const writable of [workspace, ...(git ? [git.worktree] : [])]) {
        if (contains(writable, bind.guest)) invalid();
      }
    }
    const workdir = spec.workdir === undefined ? workspace : hostPath(spec.workdir);
    if (workdir !== workspace) assertInside(workspace, workdir);
    if (typeof spec.command !== "string" || !spec.command.trim() || /[\0\r\n\\]/.test(spec.command)
      || spec.command.split("/").some((part) => part === "." || part === "..")
      || (spec.command.includes("/") && (!posix.isAbsolute(spec.command) || posix.normalize(spec.command) !== spec.command))
      || spec.command.startsWith("-") || !Array.isArray(spec.args)
      || spec.args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) invalid();
    const supplied = Object.entries(spec.env);
    let envBytes = 0;
    for (const [name, value] of supplied) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== "string" || /[\0\r\n]/.test(value)
        || (secretName.test(name) && name !== "FACTORY_MODEL_TOKEN" && name !== "OPENCODE_CONFIG_CONTENT")) invalid();
      envBytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 2;
      if (envBytes > 64 * 1024) invalid();
    }
    const fixed: Record<string, string> = {
      HOME: "/home/agent", XDG_CONFIG_HOME: "/home/agent/config", XDG_DATA_HOME: "/home/agent/data",
      XDG_STATE_HOME: "/home/agent/state", XDG_CACHE_HOME: "/home/agent/cache", TMPDIR: "/tmp", LANG: "C.UTF-8",
      PATH: [...["/opt/node", "/opt/opencode"].filter((root) => binds.some((bind) => bind.guest === root))
        .map((root) => `${root}/bin`), "/usr/bin", "/bin"].join(":"),
    };
    const args = ["--unshare-all", "--die-with-parent", "--new-session", "--clearenv", "--ro-bind", "/usr", "/usr"];
    for (const name of ["bin", "sbin", "lib", "lib64"]) {
      if (exists(`/${name}`) && lstatSync(`/${name}`).isSymbolicLink()) args.push("--symlink", `usr/${name}`, `/${name}`);
    }
    for (const file of ["passwd", "group", "nsswitch.conf", "ld.so.cache", "localtime"]) {
      if (exists(`/etc/${file}`)) args.push("--ro-bind", `/etc/${file}`, `/etc/${file}`);
    }
    // Private scratch space is capped so a runaway agent cannot exhaust the Host's memory through tmpfs.
    args.push("--proc", "/proc", "--dev", "/dev", "--size", String(256 * 1024 * 1024), "--tmpfs", "/tmp",
      "--size", String(512 * 1024 * 1024), "--tmpfs", "/home/agent");
    for (const bind of binds) args.push("--ro-bind", bind.host, bind.guest);
    args.push("--bind", workspace, workspace);
    if (git) args.push("--ro-bind", git.common, git.common, "--bind", git.worktree, git.worktree);
    if (socket) args.push("--bind", socket.host, socket.guest);
    // The sandbox root is a private tmpfs: make it read-only so only the mounts above are writable.
    args.push("--remount-ro", "/");
    for (const [name, value] of supplied) if (!Object.hasOwn(fixed, name)) args.push("--setenv", name, value);
    for (const [name, value] of Object.entries(fixed)) args.push("--setenv", name, value);
    args.push("--chdir", workdir, "--", spec.command, ...spec.args);
    return { command, args };
  } catch { throw new SandboxError("invalid-spec"); }
}
