import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { usageSchema, type Usage } from "@factory/contracts";
import { cliProcess, validateCliCommand, validatePassEnv } from "../runtimes/local-cli-process.js";
import { ModelError, type ModelGateway, type ModelRequest, type ModelResult } from "./gateway.js";
import type { ModelInfo } from "./upstream.js";

/** The aliases the Claude Code CLI accepts with --model; the System page offers these for the Lead. */
export const CLAUDE_CLI_MODELS: readonly ModelInfo[] = [
  { id: "opus", name: "Claude Opus (CLI)", provider: "claude-cli", reasoning: true },
  { id: "sonnet", name: "Claude Sonnet (CLI)", provider: "claude-cli", reasoning: true },
  { id: "haiku", name: "Claude Haiku (CLI)", provider: "claude-cli", reasoning: true },
];

/**
 * Maps a stored Lead model to a CLI --model value. Gateway ids such as "ag/claude-opus-5-5-high" become the
 * family alias; anything else that is not a plain CLI name uses the CLI's own default (null).
 */
export function claudeCliModel(model: string): string | null {
  if (/^[a-z][a-z0-9.-]{0,79}$/i.test(model) && /^(opus|sonnet|haiku|claude-)/i.test(model)) return model;
  return /opus/i.test(model) ? "opus" : /sonnet/i.test(model) ? "sonnet" : /haiku/i.test(model) ? "haiku" : null;
}

function transcript(messages: ModelRequest["messages"]): string {
  if (messages.length === 1 && messages[0]?.role === "user") return messages[0].content;
  const turns = messages.map((message) => `### ${message.role === "user" ? "Operator" : "You (Lead)"}\n\n${message.content}`);
  return `The conversation so far, oldest first. Reply to the operator's last message.\n\n${turns.join("\n\n")}`;
}

function classify(text: string): ModelError {
  if (/not.?logged.?in|log ?in|sign[ -]?in|unauthori[sz]ed|\b401\b|authentication|invalid api key/i.test(text)) return new ModelError("auth");
  if (/usage limit|quota|rate.?limit|\b429\b|overloaded|resets at/i.test(text)) return new ModelError("rate-limit");
  return new ModelError("unavailable");
}

/**
 * A ModelGateway for the Lead that runs the operator's Claude Code CLI (`claude -p`) instead of an HTTP gateway.
 * Every call runs in an empty temporary directory with no tools, no MCP servers, no settings and no session file,
 * so the CLI acts as a plain completion endpoint under the operator's own login.
 */
/** What the Lead may do while inspecting: read files under its working directory (Read rules also bound Grep and Glob)
 * and run Git commands that only read the repository. git diff and git grep are left out: given paths outside the
 * repository they read any file. */
export const INSPECT_ALLOWED = ["Read(./**)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git status:*)",
  "Bash(git ls-files:*)", "Bash(git ls-tree:*)", "Bash(git for-each-ref:*)", "Bash(git rev-parse:*)", "Bash(git merge-base:*)"] as const;

export function createClaudeCliGateway(options: {
  command?: readonly string[]; passEnv?: readonly string[]; defaultTimeoutMs?: number; maxResponseBytes?: number;
} = {}): ModelGateway {
  const command = options.command ?? ["claude"];
  validateCliCommand(command);
  const passEnv = [...(options.passEnv ?? [])];
  validatePassEnv(passEnv);
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 300_000, maxResponseBytes = options.maxResponseBytes ?? 4 * 1024 * 1024;
  if (!Number.isSafeInteger(defaultTimeoutMs) || defaultTimeoutMs < 1 || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1)
    throw new ModelError("config");
  const providerId = "claude-cli";

  return {
    providerId,
    listModels: () => Promise.resolve(CLAUDE_CLI_MODELS.map((model) => ({ ...model }))),
    async complete(request): Promise<ModelResult> {
      if (request.signal?.aborted) throw new ModelError("cancelled");
      if (!request.messages.length || request.system.includes("\0")) throw new ModelError("config");
      const model = claudeCliModel(request.model);
      // Inspection: reading inside the view and read-only Git only. Print mode cannot ask for permission, so any other
      // tool use (edits, other commands, files outside the view) is denied by the CLI itself.
      const tools = request.inspect ? ["--tools", "Read,Grep,Glob,Bash", "--permission-mode", "default", "--max-turns", "40",
        "--allowedTools", INSPECT_ALLOWED.join(" "), "--disallowedTools", "Edit Write NotebookEdit WebFetch WebSearch"] : ["--tools", ""];
      const args = ["-p", "--output-format", "json", ...tools, "--system-prompt", request.system,
        "--setting-sources", "", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands",
        ...(model === null ? [] : ["--model", model]), ...(request.effort ? ["--effort", request.effort] : [])];
      const cwd = request.inspect?.cwd ?? await mkdtemp(join(tmpdir(), "factory-lead-"));
      let stdout = "", stderr = "", overflow = false, abortKind: "cancelled" | "timeout" | undefined;
      const child = cliProcess(command, args, { cwd, passEnv, input: transcript(request.messages), output(stream, chunk) {
        if (stream === "stderr") { stderr = (stderr + chunk).slice(-4096); return; }
        if (stdout.length + chunk.length > maxResponseBytes) { overflow = true; void child.stop().catch(() => {}); return; }
        stdout += chunk;
      } });
      const abort = (kind: "cancelled" | "timeout"): void => { abortKind ??= kind; void child.stop().catch(() => {}); };
      const onAbort = (): void => abort("cancelled");
      request.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => abort("timeout"), request.timeoutMs ?? defaultTimeoutMs);
      try {
        const { code, errorCode } = await child.result;
        if (abortKind) throw new ModelError(abortKind);
        if (errorCode) throw new ModelError(errorCode === "ENOENT" ? "config" : "unavailable");
        if (overflow) throw new ModelError("bad-response");
        let data: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(stdout);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
          data = parsed as Record<string, unknown>;
        } catch { throw code === 0 ? new ModelError("bad-response") : classify(`${stdout}\n${stderr}`); }
        const text = typeof data.result === "string" ? data.result : "";
        if (data.is_error === true || code !== 0 || (typeof data.subtype === "string" && data.subtype !== "success")) throw classify(`${text}\n${stderr}`);
        const reported = data.usage !== null && typeof data.usage === "object" ? data.usage as Record<string, unknown> : null;
        const count = (value: unknown): number => (Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0);
        let usage: Usage | null = null;
        if (reported) {
          const cached = count(reported.cache_read_input_tokens);
          const details = reported.output_tokens_details !== null && typeof reported.output_tokens_details === "object"
            ? reported.output_tokens_details as Record<string, unknown> : {};
          usage = usageSchema.parse({ inputTokens: count(reported.input_tokens) + count(reported.cache_creation_input_tokens) + cached,
            cachedInputTokens: cached, outputTokens: count(reported.output_tokens), reasoningOutputTokens: count(details.thinking_tokens) });
        }
        const used = data.modelUsage !== null && typeof data.modelUsage === "object" ? Object.keys(data.modelUsage as object)[0] : undefined;
        const stop = typeof data.stop_reason === "string" ? data.stop_reason : null;
        return { text, usage, provider: providerId, model: used && used.length <= 120 ? used : model ?? request.model,
          finishReason: stop === "max_tokens" ? "length" : stop };
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
        if (!abortKind && !overflow) void child.stop().catch(() => {});
        // Only the temporary directory is removed; an inspection view belongs to the caller.
        if (!request.inspect) await rm(cwd, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}
