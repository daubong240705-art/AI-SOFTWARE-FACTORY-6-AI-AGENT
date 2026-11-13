import fs from "node:fs";
import { join } from "node:path";
import { ExecError, runToCompletion } from "../exec/process-group.js";
import { buildSafeEnv } from "../exec/safe-env.js";
import { assertInside, checkedDirectory, requireLinux, WorkspaceError } from "./paths.js";

export interface GitOptions {
  stdin?: string; timeoutMs?: number; maxOutputBytes?: number; allowSafeDirectory?: string;
  acceptExitCodes?: readonly number[];
  factoryIdentity?: boolean;
  /** Treat the agents' `.factory/` scratch directory as ignored, without touching the repository's own ignore files. */
  excludeScratch?: boolean;
}
export interface GitResult { stdout: string; stderr: string; exitCode: number }
const defaults = [
  "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.autocrlf=false",
  "-c", "protocol.ext.allow=never", "-c", "credential.helper=",
  "-c", "core.sshCommand=/bin/false", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false",
  "-c", "core.pager=cat", "-c", "core.quotePath=true",
  "-c", "protocol.no-push.allow=never",
];

async function execute(cwd: string, args: string[], options: GitOptions,
  output?: { maxBytes: number }): Promise<GitResult & { patch: string; patchBytes: number; truncated: boolean }> {
  if (!Array.isArray(args) || !/^[a-z][a-z0-9-]*$/.test(args[0] ?? "") ||
    args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) throw new WorkspaceError("invalid-input");
  requireLinux();
  const directory = checkedDirectory(cwd);
  const temporaryRoot = checkedDirectory("/tmp");
  const prefix = assertInside(temporaryRoot, join(temporaryRoot, "factory-git-home-"));
  const home = fs.mkdtempSync(prefix);
  let patchFile: string | undefined;
  let excludesFile: string | undefined;
  const failure = (): WorkspaceError => new WorkspaceError("git-failed", `git ${args[0]} failed`);
  try {
    assertInside(temporaryRoot, home);
    const env = buildSafeEnv({
      HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "/bin/false", GIT_SSH_COMMAND: "/bin/false", GIT_OPTIONAL_LOCKS: "0", GIT_ATTR_NOSYSTEM: "1",
    });
    const leading = [...defaults];
    if (options.factoryIdentity) leading.push("-c", "user.name=Factory", "-c", "user.email=factory@localhost");
    if (options.excludeScratch) {
      // An extra ignore source, not a pathspec: an exclude pathspec fails ("paths are ignored") when the repo already ignores it.
      excludesFile = assertInside(home, join(home, "excludes"));
      fs.writeFileSync(excludesFile, "/.factory/\n", { mode: 0o600, flag: "wx" });
      leading.push("-c", `core.excludesFile=${excludesFile}`);
    }
    if (options.allowSafeDirectory !== undefined) {
      const allowed = checkedDirectory(options.allowSafeDirectory);
      if (allowed !== options.allowSafeDirectory) throw new WorkspaceError("invalid-input");
      leading.push("-c", `safe.directory=${allowed}`);
    }
    const commandArgs = [...args];
    if (output) {
      // A private output file gives an exact byte count even beyond the runner's capture limit.
      patchFile = assertInside(home, join(home, "diff.patch"));
      commandArgs.splice(1, 0, `--output=${patchFile}`);
    }
    const result = await runToCompletion({
      command: "/usr/bin/git", args: [...leading, ...commandArgs], cwd: checkedDirectory(directory), env,
      ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      maxOutputBytes: options.maxOutputBytes ?? 8 * 1024 * 1024,
    });
    if (result.exitCode === null || result.timedOut || result.stopped || !result.groupGone || result.truncated ||
      (result.exitCode !== 0 && !options.acceptExitCodes?.includes(result.exitCode))) throw failure();
    let patch = "";
    let patchBytes = 0;
    let truncated = false;
    if (output && patchFile) {
      patchBytes = fs.statSync(assertInside(home, patchFile)).size;
      truncated = patchBytes > output.maxBytes;
      if (!truncated) patch = fs.readFileSync(assertInside(home, patchFile), "utf8");
    }
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, patch, patchBytes, truncated };
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    if (error instanceof ExecError && error.code === "unsupported-platform") throw new WorkspaceError("unsupported-platform");
    throw failure();
  } finally {
    for (const file of [patchFile, excludesFile]) {
      if (!file) continue;
      try { fs.unlinkSync(assertInside(home, file)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw failure(); }
    }
    // HOME is private and empty; never recursively remove a directory supplied by a caller.
    try { fs.rmdirSync(assertInside(temporaryRoot, home)); } catch { throw failure(); }
  }
}

export async function runGit(cwd: string, args: string[], options: GitOptions = {}): Promise<GitResult> {
  const { stdout, stderr, exitCode } = await execute(cwd, args, options);
  return { stdout, stderr, exitCode };
}

export async function readGitDiff(cwd: string, baseSha: string, maxBytes: number): Promise<{
  patch: string; patchBytes: number; truncated: boolean;
}> {
  return execute(cwd, ["diff", "--cached", "--binary", "--find-renames", "--no-ext-diff", "--no-textconv",
    "--src-prefix=a/", "--dst-prefix=b/", baseSha, "--"], {}, { maxBytes });
}
