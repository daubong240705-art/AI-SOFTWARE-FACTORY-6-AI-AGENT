import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import type { RuntimeAdapter, RuntimeEvent, RuntimeSession } from "../dispatch/runtime.js";
import { scrubForLog } from "../exec/safe-env.js";
import { promptFor } from "./opencode.js";
import { cliProcess, validateCliCommand } from "./local-cli-process.js";

type Cli = "codex" | "claude";
type Failure = Extract<RuntimeEvent, { type: "failed" }>;
export interface LocalCliRuntimeOptions {
  codexCommand?: readonly string[]; claudeCommand?: readonly string[];
  timeoutMs?: number; stallMs?: number; maxOutputBytes?: number; maxPromptBytes?: number; maxLineBytes?: number;
  // CLI releases can change flags. Each group can be replaced, including with an empty array.
  claudeFlags?: Partial<Record<"prompt" | "output" | "model" | "permission" | "mcp" | "directory", readonly string[]>>;
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const failure = (cli: Cli, text: string, missing = false): Failure => {
  if (missing) return { type: "failed", kind: "config", message: `${cli}: not installed on the Host machine.` };
  if (/sign[ -]?in|log[ -]?in|unauthori[sz]ed|\b401\b|authentication/i.test(text)) return { type: "failed", kind: "config",
    message: `${cli}: not logged in. Run ${cli === "codex" ? "codex login" : "claude auth login"} on the Host machine.` };
  if (/usage limit|quota|rate.?limit|\b429\b|resets at/i.test(text)) return { type: "failed", kind: "model",
    message: `${cli}: quota or rate limit reached. Check usage on the Host machine.` };
  return { type: "failed", kind: "runtime", message: `${cli}: execution failed.` };
};
function oneEvent(event: RuntimeEvent): RuntimeSession {
  return { async *events() { yield event; }, async stop() {} };
}

export function createLocalCliRuntime(options: LocalCliRuntimeOptions = {}): RuntimeAdapter {
  const commands = { codex: options.codexCommand ?? ["codex"], claude: options.claudeCommand ?? ["claude"] };
  Object.values(commands).forEach(validateCliCommand);
  const timeoutMs = options.timeoutMs ?? 30 * 60_000, stallMs = options.stallMs ?? 10 * 60_000;
  const maxOutputBytes = options.maxOutputBytes ?? 4 * 1024 * 1024;
  const maxPromptBytes = options.maxPromptBytes ?? 24 * 1024, maxLineBytes = options.maxLineBytes ?? 1024 * 1024;
  for (const [value, max] of [[timeoutMs, 6 * 60 * 60_000], [stallMs, 2_147_483_647],
    [maxOutputBytes, 16 * 1024 * 1024], [maxPromptBytes, 96 * 1024], [maxLineBytes, 4 * 1024 * 1024]])
    if (!Number.isSafeInteger(value) || value! < 1 || value! > max!) throw new Error("Local CLI configuration invalid");
  if (options.claudeFlags) for (const flags of Object.values(options.claudeFlags))
    if (!Array.isArray(flags) || flags.some((flag) => typeof flag !== "string" || flag.includes("\0")))
      throw new Error("Local CLI configuration invalid");
  return { kind: "acp", async start(context) {
    const { agent, workspace, model } = context;
    if (!workspace || !isAbsolute(workspace.path)) return oneEvent({ type: "failed", kind: "config", message: "local CLI: workspace unavailable" });
    if (!agent?.cli || !model?.token) return oneEvent({ type: "failed", kind: "config", message: "local CLI: configuration invalid" });
    const cli = agent.cli;
    const scrub = (text: string): string => scrubForLog(text, [model.token, workspace.path, workspace.path.replaceAll("\\", "/"), homedir()])
      .replaceAll(model.token, "[redacted]").replace(/fpx_[A-Za-z0-9_-]+|\bsk-[A-Za-z0-9_-]+/g, "[redacted]")
      .replace(/[A-Za-z]:[\\/][^\s<>"'`]+|(?<![\w:])\/(?:[^\s<>"'`]+\/)*[^\s<>"'`]+/g, "[path]")
      .replace(/[\p{Cc}\p{Cf}]+/gu, " ");
    let args: string[];
    try {
      const url = new URL("/mcp", model.mcpBaseUrl ?? model.baseUrl);
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) throw new Error();
      if (agent.model && (agent.model.length > 256 || /[\s\p{Cc}]/u.test(agent.model))) throw new Error();
      // Shared task, profile, context, artifact and summary rules; CLI-native MCP names.
      const prompt = promptFor(context, maxPromptBytes, model.token)
        .replace(/factory_([a-z_]+)/g, (_, name: string) => cli === "claude" ? `mcp__factory__${name.replaceAll("_", ".")}` : `factory MCP ${name.replaceAll("_", ".")}`)
        + (cli === "codex" ? "\nFactory tools are on the 'factory' MCP server; use its advertised tool names (task.progress, output.register, decision.request, skill.get)."
          : "\nFactory tools use the mcp__factory__* prefix; use the advertised names from the factory MCP server.");
      const autonomous = agent.permission !== "workspace-write";
      if (cli === "codex") args = ["exec", "--json", "-C", workspace.path, "--skip-git-repo-check", "--ephemeral",
        ...(agent.model ? ["-m", agent.model] : []),
        ...(agent.effort ? ["-c", `model_reasoning_effort=${JSON.stringify(agent.effort)}`] : []),
        ...(autonomous ? ["--dangerously-bypass-approvals-and-sandbox"] : ["-s", "workspace-write"]),
        "-c", `mcp_servers.factory.url=${JSON.stringify(url.href)}`,
        "-c", 'mcp_servers.factory.bearer_token_env_var="FACTORY_MCP_TOKEN"', prompt];
      else {
        const flags = options.claudeFlags ?? {};
        args = [...(flags.prompt ?? ["-p"]), prompt, ...(flags.output ?? ["--output-format", "stream-json", "--verbose"]),
          ...(agent.model ? [...(flags.model ?? ["--model"]), agent.model] : []),
          ...(flags.permission ?? ["--permission-mode"]), autonomous ? "bypassPermissions" : "acceptEdits",
          ...(flags.mcp ?? ["--mcp-config"]), JSON.stringify({ mcpServers: { factory: { type: "http", url: url.href,
            headers: { Authorization: "Bearer ${FACTORY_MCP_TOKEN}" } } } }),
          ...(flags.directory ?? ["--add-dir"]), workspace.path];
      }
      if ([...commands[cli], ...args].some((arg) => arg.includes(model.token))) throw new Error();
    } catch { return oneEvent({ type: "failed", kind: "config", message: "local CLI: configuration invalid" }); }

    const queue: RuntimeEvent[] = [], readers: Array<(value: IteratorResult<RuntimeEvent>) => void> = [];
    let ended = false, stopped = false, success = false, summary = "", line = "", diagnostic = "";
    let discard = false, bytes = 0, terminal: Failure | undefined;
    let processHandle: ReturnType<typeof cliProcess> | undefined;
    let totalTimer: ReturnType<typeof setTimeout> | undefined, stallTimer: ReturnType<typeof setTimeout> | undefined;
    let stopPromise: Promise<void> | undefined;
    let iteratorError: Error | undefined;
    const emit = (event: RuntimeEvent): void => {
      if (ended || stopped) return;
      const reader = readers.shift();
      if (reader) reader({ done: false, value: event });
      else { if (queue.length >= 1024) queue.shift(); queue.push(event); }
    };
    const clear = (): void => { clearTimeout(totalTimer); clearTimeout(stallTimer); };
    const finish = (): void => {
      if (ended) return;
      ended = true; clear(); context.signal.removeEventListener("abort", onAbort);
      for (const reader of readers.splice(0)) reader({ done: true, value: undefined });
    };
    const terminate = (): void => { void processHandle?.stop().catch(() => { iteratorError = new Error("Runtime stop failed"); finish(); }); };
    const timeout = (): void => {
      if (ended || stopped || terminal) return;
      terminal = { type: "failed", kind: "timeout", message: `${cli}: timed out.` }; clear(); terminate();
    };
    const activity = (): void => { clearTimeout(stallTimer); stallTimer = setTimeout(timeout, stallMs); };
    const parse = (input: string): void => {
      if (terminal || stopped) return;
      let event: Record<string, unknown>;
      try { event = record(JSON.parse(input)); } catch { return; }
      const type = event.type;
      if (typeof type !== "string") return;
      activity();
      const item = record(event.item);
      const text = (value: string): void => { const clean = scrub(value); summary = clean.trim().slice(0, 2000); emit({ type: "output", text: clean }); };
      const error = (): void => { terminal = failure(cli, input + "\n" + diagnostic); clear(); terminate(); };
      if (type === "error" || type === "turn.failed") { error(); return; }
      if (cli === "codex") {
        if (type === "item.completed" && item.type === "agent_message" && typeof item.text === "string") text(item.text);
        else if ((type === "item.started" || type === "item.completed") && ["command_execution", "mcp_tool_call", "file_change", "web_search"].includes(String(item.type)))
          emit({ type: "progress", message: scrub(`tool: ${String(item.type)}`).slice(0, 160) });
        else if (type === "turn.completed") success = true;
        else if (type === "thread.started" || type === "turn.started") emit({ type: "progress", message: "Working" });
      } else {
        if (type === "system") emit({ type: "progress", message: "Working" });
        if (type === "assistant") {
          const message = record(event.message);
          if (Array.isArray(message.content)) {
            const texts: string[] = [];
            for (const entry of message.content) {
              const part = record(entry);
              if (part.type === "text" && typeof part.text === "string") texts.push(part.text);
              if (part.type === "tool_use") emit({ type: "progress", message: "tool: Claude tool activity" });
            }
            if (texts.length) text(texts.join("\n"));
          }
          if (event.error) error();
        }
        if (type === "result") {
          if (event.is_error === true || event.subtype !== "success") { error(); return; }
          success = true;
          if (!summary && typeof event.result === "string") text(event.result);
        }
      }
    };
    const output = (stream: "stdout" | "stderr", chunk: string): void => {
      if (ended || stopped || terminal) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxOutputBytes) { terminal = { type: "failed", kind: "runtime", message: `${cli}: output limit exceeded.` }; clear(); terminate(); return; }
      if (stream === "stderr") { diagnostic = (diagnostic + chunk).slice(-16_384); return; }
      const segments = chunk.split("\n");
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]!;
        if (!discard) {
          if (Buffer.byteLength(line) + Buffer.byteLength(segment) > maxLineBytes) { line = ""; discard = true; }
          else line += segment;
        }
        if (i < segments.length - 1) { if (!discard) parse(line); line = ""; discard = false; }
      }
    };
    async function stop(): Promise<void> {
      stopPromise ??= (async () => { stopped = true; queue.length = 0; clear(); await processHandle?.stop(); finish(); })();
      return stopPromise;
    }
    function onAbort(): void { void stop().catch(() => { iteratorError = new Error("Runtime stop failed"); finish(); }); }
    const iterator: AsyncIterableIterator<RuntimeEvent> = {
      [Symbol.asyncIterator]() { return this; },
      next() {
        if (iteratorError) return Promise.reject(iteratorError);
        const event = queue.shift();
        if (event) return Promise.resolve({ done: false, value: event });
        return ended ? Promise.resolve({ done: true, value: undefined }) : new Promise((resolve) => readers.push(resolve));
      },
      async return() { await stop(); return { done: true, value: undefined }; },
    };
    context.signal.addEventListener("abort", onAbort, { once: true });
    if (context.signal.aborted) { await stop(); return { events: () => iterator, stop }; }
    try {
      processHandle = cliProcess(commands[cli], args, { cwd: workspace.path, token: model.token, output });
      totalTimer = setTimeout(timeout, timeoutMs); activity();
      void processHandle.result.then((result) => {
        if (stopped) { finish(); return; }
        if (line && !discard) parse(line);
        emit(terminal ?? (result.errorCode ? failure(cli, "", result.errorCode === "ENOENT")
          : result.code === 0 && success ? { type: "completed", summary: summary || "Work finished" }
          : failure(cli, diagnostic)));
        diagnostic = ""; line = ""; finish();
      });
    } catch { emit(failure(cli, "")); finish(); }
    return { events: () => iterator, stop };
  } };
}
