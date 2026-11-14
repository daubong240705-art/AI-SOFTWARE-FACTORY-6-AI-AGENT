#!/usr/bin/env node
// Hand ONE task to Codex CLI inside any git repository, then print what changed.
// No routing policy: Codex runs with the operator's own ~/.codex defaults (model, provider, effort).
// Safety that stays: the sandbox is workspace-write on --repo only (read-only with --read-only),
// no network unless --network, an env allow-list, no shell, prompt on stdin, a timeout.
//
//   node delegate.mjs --repo <dir> --task <task.md> [--name id] [--read-only] [--network]
//                     [--model m] [--effort low|medium|high|xhigh] [--timeout-min 30] [--dry-run]
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const die = (m, c = 1) => { console.error(`ERROR: ${m}`); process.exit(c); };

const repoArg = value("--repo");
const taskFile = value("--task");
if (!repoArg || !taskFile) die("usage: delegate.mjs --repo <dir> --task <task.md> [--name id] [--read-only] [--network] [--model m] [--effort e] [--timeout-min 30] [--dry-run]");
const repo = path.resolve(repoArg);
if (!existsSync(repo) || !statSync(repo).isDirectory()) die(`--repo does not exist: ${repo}`);
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 16 << 20 });
let top;
try { top = path.resolve(git("rev-parse", "--show-toplevel").trim()); } catch { die("--repo must be inside a git repository (run git init first)"); }

const name = (value("--name") ?? path.basename(taskFile, path.extname(taskFile))).toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60);
const readOnly = flag("--read-only");
const timeoutMs = Math.max(1, Number(value("--timeout-min", "30"))) * 60_000;
const logDir = path.join(top, ".git", "codex-delegate", `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const lastFile = path.join(logDir, "answer.md");

const preamble = `You are a contractor working in ${repo}. Do exactly the task below.
- Work only inside this directory. Never commit, push, or change git configuration.
- The network is ${flag("--network") && !readOnly ? "available" : "NOT available: dependencies are already installed, do not try to install anything"}.
- Never print or write secrets. Never edit files outside the paths the task says you own.
- Run the checks the task lists and fix what fails. Do not claim a check passed unless you ran it.
- Finish with a SHORT report: files created or changed, each command you ran with its exit code, and anything you could not verify.

--- TASK ---
`;
const prompt = preamble + readFileSync(path.resolve(taskFile), "utf8");

function findCodex() {
  const names = [process.env.CODEX_BIN, ...String(process.env.PATH ?? "").split(path.delimiter).map((d) => d && path.join(d, "codex")),
    path.join(os.homedir(), ".local", "npm", "bin", "codex")];
  return names.find((p) => p && existsSync(p));
}
const codex = findCodex();
if (!codex) die("codex not found: set CODEX_BIN or put codex on PATH");

const args = ["exec", "--json", "--ephemeral", "--color", "never", "-C", repo,
  "-s", readOnly ? "read-only" : "workspace-write", "-o", lastFile,
  ...(value("--model") ? ["-m", value("--model")] : []),
  ...(value("--effort") ? ["-c", `model_reasoning_effort=${JSON.stringify(value("--effort"))}`] : []),
  ...(flag("--network") && !readOnly ? ["-c", "sandbox_workspace_write.network_access=true"] : []),
  "-"];

const keep = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TERM", "TMPDIR", "CODEX_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME",
  "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "NINE_ROUTER_API_KEY"];
const env = Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
// The provider key lives in the operator's login session. When this shell lacks it, read it from the systemd user
// environment (the operator allowed this). It goes only into the Codex process env: never printed, logged or written.
if (env.NINE_ROUTER_API_KEY === undefined) {
  try {
    const line = execFileSync("systemctl", ["--user", "show-environment"], { encoding: "utf8" })
      .split("\n").find((l) => l.startsWith("NINE_ROUTER_API_KEY="));
    if (line) env.NINE_ROUTER_API_KEY = line.slice("NINE_ROUTER_API_KEY=".length);
  } catch { /* no user systemd session */ }
}
if (env.NINE_ROUTER_API_KEY === undefined) console.error("warning: NINE_ROUTER_API_KEY not found (shell env or systemd user env); Codex fails with an auth error if the provider needs it.");

// Changes relative to the baseline (the index or HEAD): modified tracked files and new untracked files.
const lines = (text) => text.split("\n").filter(Boolean);
const changes = () => ({ modified: lines(git("diff", "--name-only")), untracked: lines(git("ls-files", "--others", "--exclude-standard")) });
const before = changes();
const dirtyBefore = before.modified.length + before.untracked.length;
console.log(JSON.stringify({ task: name, repo, codex, sandbox: readOnly ? "read-only" : "workspace-write", network: flag("--network") && !readOnly,
  args: args.slice(0, -1), repoDirtyBefore: dirtyBefore, logDir }, null, 2));
if (flag("--dry-run")) process.exit(0);

mkdirSync(logDir, { recursive: true });
writeFileSync(path.join(logDir, "task.md"), prompt);
const events = createWriteStream(path.join(logDir, "events.jsonl"));
const started = Date.now();
const child = spawn(codex, args, { cwd: repo, env, stdio: ["pipe", "pipe", "pipe"], detached: true });
let timedOut = false, stderr = "", tail = "";
const usage = { value: null }, errors = [];
const onLine = (line) => {
  try {
    const ev = JSON.parse(line);
    if (ev.type === "turn.completed" && ev.usage) usage.value = ev.usage;
    if (ev.type === "error" || ev.type === "turn.failed") errors.push(String(ev.message ?? ev.error?.message ?? "").slice(0, 300));
  } catch { /* not JSON */ }
};
child.stdout.on("data", (d) => {
  events.write(d);
  tail += d.toString("utf8");
  const lines = tail.split("\n"); tail = lines.pop() ?? "";
  lines.forEach(onLine);
});
child.stderr.on("data", (d) => { if (stderr.length < 20_000) stderr += d.toString("utf8"); });
const timer = setTimeout(() => {
  timedOut = true;
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
  setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } }, 5000).unref();
}, timeoutMs);
child.stdin.end(prompt);

child.on("error", (e) => die(`could not start codex: ${e.message}`));
child.on("close", (code) => {
  clearTimeout(timer);
  events.end();
  writeFileSync(path.join(logDir, "stderr.txt"), stderr);
  const after = changes();
  const kind = timedOut ? "timeout"
    : /\b(401|403)\b|unauthori[sz]ed|forbidden|api key|NINE_ROUTER/i.test(stderr + errors.join(" ")) ? "auth"
    : /\b429\b|rate.?limit|quota/i.test(stderr + errors.join(" ")) ? "rate_limit"
    : code !== 0 ? "failed" : null;
  console.log(JSON.stringify({ ok: kind === null, exitCode: code, failure: kind, seconds: Math.round((Date.now() - started) / 1000),
    tokens: usage.value, errors: errors.slice(0, 3), answer: existsSync(lastFile) ? lastFile : null, logDir,
    modified: after.modified.length, untracked: after.untracked.length, repoDirtyBefore: dirtyBefore }, null, 2));
  if (kind === "auth" || kind === "failed") console.error(`stderr tail:\n${stderr.slice(-800)}`);
  console.log("\nmodified (git diff --name-only):\n" + after.modified.slice(0, 60).join("\n"));
  console.log("\nnew files (untracked):\n" + after.untracked.slice(0, 60).join("\n") + (after.untracked.length > 60 ? `\n... ${after.untracked.length - 60} more` : ""));
  process.exit(kind === null ? 0 : 2);
});
