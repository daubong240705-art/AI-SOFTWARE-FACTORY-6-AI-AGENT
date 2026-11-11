// Thin, testable wrapper around `codex exec`. No shell is used: the command is
// node + codex.js + an argument array; the prompt travels on stdin, never on the command line.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export function resolveCodexEntry(env = process.env) {
  const entry = path.join(env.APPDATA ?? "", "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
  if (!existsSync(entry)) throw new Error("codex.js not found under %APPDATA%\\npm (this PoC targets the Windows npm install)");
  return entry;
}

export function buildArgs({ policy, decision, workdir, lastMessageFile }) {
  const p = policy.provider;
  if (!policy.allowedSandboxes.includes(decision.sandbox)) throw new Error(`sandbox not allowed: ${decision.sandbox}`);
  if ((policy.forbiddenEfforts ?? []).includes(decision.effort)) throw new Error(`effort not allowed: ${decision.effort}`);
  const args = [
    "exec",
    "--ignore-user-config", // no MCP servers, plugins, hooks or notify from the user's config
    "--ephemeral",
    "--json",
    "--color", "never",
    "-m", decision.model,
    "-s", decision.sandbox,
    "-C", workdir,
    "-o", lastMessageFile,
    "-c", `model_provider="${p.id}"`,
    "-c", `model_providers.${p.id}={name="${p.name}", base_url="${p.baseUrl}", wire_api="${p.wireApi}", env_key="${p.envKey}"}`,
    "-c", `model_reasoning_effort="${decision.effort}"`,
    "-c", 'approval_policy="never"',
    "-c", 'windows.sandbox="elevated"',
    "-", // read the prompt from stdin
  ];
  if (args.some((a) => a.startsWith("--dangerously") || a === "danger-full-access")) throw new Error("unsafe flag refused");
  return args;
}

// Environment handed to codex: an allowlist, never the whole process environment.
export function buildEnv(policy, env = process.env) {
  const keep = ["PATH", "PATHEXT", "SystemRoot", "SystemDrive", "ComSpec", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "USERNAME", "COMPUTERNAME", "windir", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"];
  const out = {};
  for (const k of keep) if (env[k] !== undefined) out[k] = env[k];
  out[policy.provider.envKey] = env[policy.provider.envKey]; // value is passed by environment only
  return out;
}

// ---- JSONL events ---------------------------------------------------------------------------------
function findUsage(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 5) return null;
  if (node.usage && typeof node.usage === "object") return node.usage;
  for (const v of Object.values(node)) {
    const found = findUsage(v, depth + 1);
    if (found) return found;
  }
  return null;
}

export function parseEvents(jsonl) {
  const summary = { eventCount: 0, types: {}, turnStarted: false, turnCompleted: false, turnFailed: false, usage: null, lastAgentMessage: "", errors: [], commandCount: 0, fileChangeCount: 0, parseErrors: 0 };
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { summary.parseErrors += 1; continue; }
    summary.eventCount += 1;
    const type = String(ev.type ?? ev.msg?.type ?? "unknown");
    summary.types[type] = (summary.types[type] ?? 0) + 1;
    if (type === "turn.started") summary.turnStarted = true;
    if (type === "turn.completed") summary.turnCompleted = true;
    if (type === "turn.failed") summary.turnFailed = true;
    const usage = findUsage(ev);
    if (usage) summary.usage = usage; // the last one wins (cumulative or per-turn, recorded as given)
    const item = ev.item;
    if (item?.type === "agent_message" && typeof item.text === "string") summary.lastAgentMessage = item.text;
    // Count only completed items: Codex emits item.started and item.completed for the same item.
    if (type === "item.completed" && item?.type === "command_execution") summary.commandCount += 1;
    if (type === "item.completed" && item?.type === "file_change") summary.fileChangeCount += 1;
    if (type === "error" || type === "turn.failed") summary.errors.push(String(ev.message ?? ev.error?.message ?? JSON.stringify(ev.error ?? ev)).slice(0, 400));
  }
  return summary;
}

export function classifyError({ exitCode, timedOut, stderr, summary }) {
  if (timedOut) return "timeout";
  const text = `${stderr}\n${summary.errors.join("\n")}`;
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|invalid api key/i.test(text)) return "auth";
  if (/\b429\b|rate.?limit|quota/i.test(text)) return "rate_limit";
  if (/model.*(not found|does not exist|unsupported|unknown|not available)|\b404\b/i.test(text)) return "model_unavailable";
  if (!summary.turnStarted && exitCode !== 0) return "config";
  if (exitCode !== 0 || summary.turnFailed) return "runtime";
  return null;
}

// ---- run -----------------------------------------------------------------------------------------
export function runCodex({ entry, args, prompt, cwd, env, timeoutMs, maxBytes = 5_000_000 }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [entry, ...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "", timedOut = false, truncated = false;
    const take = (cur, chunk) => {
      if (cur.length + chunk.length > maxBytes) { truncated = true; return cur; }
      return cur + chunk;
    };
    child.stdout.on("data", (d) => { stdout = take(stdout, d.toString("utf8")); });
    child.stderr.on("data", (d) => { stderr = take(stderr, d.toString("utf8")); });
    const timer = setTimeout(() => {
      timedOut = true;
      // Stop the whole process tree that we started (and only that tree).
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    }, timeoutMs);
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut, truncated, durationMs: Date.now() - started });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, stdout, stderr: `${stderr}\nspawn error: ${e.message}`, timedOut, truncated, durationMs: Date.now() - started });
    });
    child.stdin.end(prompt);
  });
}
