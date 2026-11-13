import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import type { RuntimeAdapter, RuntimeEvent, RuntimeSession } from "../dispatch/runtime.js";
import { scrubForLog } from "../exec/safe-env.js";
import { promptFor } from "./opencode.js";
import { cliProcess, validateCliCommand, validatePassEnv } from "./local-cli-process.js";

type Cli = "codex" | "claude";
type Failure = Extract<RuntimeEvent, { type: "failed" }>;
export interface LocalCliRuntimeOptions {
  codexCommand?: readonly string[]; claudeCommand?: readonly string[];
  /** Extra Host variables the operator lets through to the CLIs (FACTORY_CLI_PASS_ENV). */
  passEnv?: readonly string[];
  timeoutMs?: number; stallMs?: number; maxOutputBytes?: number; maxPromptBytes?: number; maxLineBytes?: number;
  // CLI releases can change flags. Each group can be replaced, including with an empty array.
  claudeFlags?: Partial<Record<"prompt" | "output" | "model" | "permission" | "mcp" | "directory" | "strictMcp" | "allowedTools", readonly string[]>>;
  /** Names of the operator's own Codex MCP servers (test hook; default: `codex mcp list --json`). */
  codexUserServers?: () => Promise<string[] | null>;
}
const configKey = /^[A-Za-z0-9_-]{1,64}$/;
/** Lists the operator's Codex MCP servers once per five minutes, so isolated seats can switch them off. */
function codexServerLister(command: readonly string[], passEnv: readonly string[]): () => Promise<string[] | null> {
  let cache: { at: number; names: string[] } | undefined;
  let pending: Promise<string[] | null> | undefined;
  return () => {
    if (cache && Date.now() - cache.at < 300_000) return Promise.resolve(cache.names);
    pending ??= (async () => {
      let out = "";
      const child = cliProcess(command, ["mcp", "list", "--json"], { passEnv,
        output(stream, chunk) { if (stream === "stdout") out = (out + chunk).slice(0, 262_144); } });
      const timer = setTimeout(() => { void child.stop().catch(() => {}); }, 10_000);
      try {
        const result = await child.result;
        if (result.code !== 0 || result.errorCode) return null;
        const parsed: unknown = JSON.parse(out);
        if (!Array.isArray(parsed)) return null;
        const names = parsed.map((entry) => record(entry).name).filter((name): name is string => typeof name === "string" && configKey.test(name));
        cache = { at: Date.now(), names };
        return names;
      } catch { return null; } finally { clearTimeout(timer); }
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const failure = (cli: Cli, text: string, missing = false): Failure => {
  if (missing) return { type: "failed", kind: "config", message: `${cli}: not installed on the Host machine.` };
  if (/missing environment variable/i.test(text)) return { type: "failed", kind: "config",
    message: `${cli}: a provider key it needs is not set for the Host. Set it in the Host's environment (FACTORY_CLI_PASS_ENV) and restart.` };
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
  const passEnv = [...(options.passEnv ?? [])];
  validatePassEnv(passEnv);
  const timeoutMs = options.timeoutMs ?? 30 * 60_000, stallMs = options.stallMs ?? 10 * 60_000;
  const maxOutputBytes = options.maxOutputBytes ?? 4 * 1024 * 1024;
  const maxPromptBytes = options.maxPromptBytes ?? 24 * 1024, maxLineBytes = options.maxLineBytes ?? 1024 * 1024;
  for (const [value, max] of [[timeoutMs, 6 * 60 * 60_000], [stallMs, 2_147_483_647],
    [maxOutputBytes, 16 * 1024 * 1024], [maxPromptBytes, 96 * 1024], [maxLineBytes, 4 * 1024 * 1024]])
    if (!Number.isSafeInteger(value) || value! < 1 || value! > max!) throw new Error("Local CLI configuration invalid");
  if (options.claudeFlags) for (const flags of Object.values(options.claudeFlags))
    if (!Array.isArray(flags) || flags.some((flag) => typeof flag !== "string" || flag.includes("\0")))
      throw new Error("Local CLI configuration invalid");
  const codexUserServers = options.codexUserServers ?? codexServerLister(commands.codex, passEnv);
  return { kind: "acp", async start(context) {
    const { agent, workspace, model } = context;
    if (!workspace || !isAbsolute(workspace.path)) return oneEvent({ type: "failed", kind: "config", message: "local CLI: workspace unavailable" });
    if (!agent?.cli || !model?.token) return oneEvent({ type: "failed", kind: "config", message: "local CLI: configuration invalid" });
    const cli = agent.cli;
    // Values the operator passed through (such as a provider key) are secrets too.
    const passed = passEnv.map((name) => process.env[name]).filter((value): value is string => value !== undefined && value.length >= 8);
    const scrub = (text: string): string => passed.reduce((out, value) => out.replaceAll(value, "[redacted]"),
      scrubForLog(text, [model.token, ...passed, workspace.path, workspace.path.replaceAll("\\", "/"), homedir()]))
      .replaceAll(model.token, "[redacted]").replace(/fpx_[A-Za-z0-9_-]+|\bsk-[A-Za-z0-9_-]+/g, "[redacted]")
      .replace(/[A-Za-z]:[\\/][^\s<>"'`]+|(?<![\w:])\/(?:[^\s<>"'`]+\/)*[^\s<>"'`]+/g, "[path]")
      .replace(/[\p{Cc}\p{Cf}]+/gu, " ");
    // CLI-native MCP servers assigned to this seat; "{workspace}" in their arguments is the attempt worktree.
    const servers = (context.mcp?.servers ?? []).filter((server) => server.clis.includes(cli));
    const isolated = context.mcp?.isolated === true;
    const expand = (value: string): string => value.replaceAll("{workspace}", workspace.path);
    // An isolated Codex seat switches off the operator's own servers; Claude has --strict-mcp-config for that.
    let disabled: string[] = [];
    let isolationNote: string | undefined;
    if (cli === "codex" && isolated) {
      const names = await codexUserServers().catch(() => null);
      if (names === null) isolationNote = "codex: could not list the operator's MCP servers; they stay enabled for this attempt.";
      else disabled = names.filter((name) => name !== "factory" && !servers.some((server) => server.name === name));
    }
    let args: string[];
    try {
      const url = new URL("/mcp", model.mcpBaseUrl ?? model.baseUrl);
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) throw new Error();
      if (agent.model && (agent.model.length > 256 || /[\s\p{Cc}]/u.test(agent.model))) throw new Error();
      for (const server of servers)
        if (!configKey.test(server.name) || server.name === "factory" || [server.command, ...server.args.map(expand)].some((value) => /[\0\r\n]/.test(value))) throw new Error();
      const names = servers.map((server) => server.name).join(", ");
      // Shared task, profile, context, artifact and summary rules; CLI-native MCP names.
      const prompt = promptFor(context, maxPromptBytes, model.token)
        .replace(/factory_([a-z_]+)/g, (_, name: string) => cli === "claude" ? `mcp__factory__${name.replaceAll("_", ".")}` : `factory MCP ${name.replaceAll("_", ".")}`)
        + "\nDocument policy: create and register a document only when the operator explicitly requested it (for example, an SRD). Keep source changes, diffs, test output, task summaries and routine handoffs in the task/workspace; do not publish them as documents."
        + (cli === "codex" ? "\nFactory tools are on the 'factory' MCP server; use its advertised tool names (task.progress, output.register, decision.request, skill.get)."
          : "\nFactory tools use the mcp__factory__* prefix; use the advertised names from the factory MCP server.")
        + (servers.length === 0 ? "" : cli === "codex"
          ? `\nThis seat also has these MCP servers: ${names}. Use their advertised tools when the task needs them.`
          : `\nThis seat also has these MCP servers: ${names}. Their tools are named mcp__<server>__<tool>; use them when the task needs them.`);
      const autonomous = agent.permission !== "workspace-write";
      if (cli === "codex") args = ["exec", "--json", "-C", workspace.path, "--skip-git-repo-check", "--ephemeral",
        ...(agent.model ? ["-m", agent.model] : []),
        ...(agent.effort ? ["-c", `model_reasoning_effort=${JSON.stringify(agent.effort)}`] : []),
        ...(autonomous ? ["--dangerously-bypass-approvals-and-sandbox"] : ["-s", "workspace-write"]),
        "-c", `mcp_servers.factory.url=${JSON.stringify(url.href)}`,
        "-c", 'mcp_servers.factory.bearer_token_env_var="FACTORY_MCP_TOKEN"',
        // Without this, sandboxed (workspace-write) runs refuse every MCP call: "requires approval, but approval policy is never".
        "-c", 'mcp_servers.factory.default_tools_approval_mode="approve"',
        ...servers.flatMap((server) => ["-c", `mcp_servers.${server.name}.command=${JSON.stringify(server.command)}`,
          "-c", `mcp_servers.${server.name}.args=${JSON.stringify(server.args.map(expand))}`,
          ...(server.envNames.length ? ["-c", `mcp_servers.${server.name}.env_vars=${JSON.stringify(server.envNames)}`] : []),
          "-c", `mcp_servers.${server.name}.default_tools_approval_mode="approve"`]),
        ...disabled.flatMap((name) => ["-c", `mcp_servers.${name}.enabled=false`]),
        prompt];
      else {
        const flags = options.claudeFlags ?? {};
        const mcpServers: Record<string, unknown> = { factory: { type: "http", url: url.href, headers: { Authorization: "Bearer ${FACTORY_MCP_TOKEN}" } } };
        // Claude merges this env into its own, so blank the attempt token and every passed variable the server did not ask
        // for; Codex already starts MCP servers with a minimal environment plus env_vars.
        for (const server of servers) mcpServers[server.name] = { type: "stdio", command: server.command, args: server.args.map(expand),
          env: Object.fromEntries([["FACTORY_MCP_TOKEN", ""], ...passEnv.filter((name) => !server.envNames.includes(name)).map((name) => [name, ""]),
            ...server.envNames.map((name) => [name, `\${${name}}`])]) };
        args = [...(flags.prompt ?? ["-p"]), prompt, ...(flags.output ?? ["--output-format", "stream-json", "--verbose"]),
          ...(agent.model ? [...(flags.model ?? ["--model"]), agent.model] : []),
          ...(flags.permission ?? ["--permission-mode"]), autonomous ? "bypassPermissions" : "acceptEdits",
          ...(flags.mcp ?? ["--mcp-config"]), JSON.stringify({ mcpServers }),
          ...(isolated ? flags.strictMcp ?? ["--strict-mcp-config"] : []),
          // acceptEdits refuses MCP tools that were not approved in advance, including the Factory's own tools.
          ...(autonomous ? [] : [...(flags.allowedTools ?? ["--allowedTools"]), ["factory", ...servers.map((server) => server.name)].map((name) => `mcp__${name}`).join(",")]),
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
      // Any CLI activity resets the stall timer; only agent text and task.progress are work reports.
      activity();
      const item = record(event.item);
      const text = (value: string): void => { const clean = scrub(value); summary = clean.trim().slice(0, 2000); emit({ type: "output", text: clean }); };
      const error = (): void => { terminal = failure(cli, input + "\n" + diagnostic); clear(); terminate(); };
      if (type === "error" || type === "turn.failed") { error(); return; }
      if (cli === "codex") {
        if (type === "item.completed" && item.type === "agent_message" && typeof item.text === "string") text(item.text);
        else if (type === "turn.completed") success = true;
      } else {
        if (type === "assistant") {
          const message = record(event.message);
          if (Array.isArray(message.content)) {
            const texts: string[] = [];
            for (const entry of message.content) {
              const part = record(entry);
              if (part.type === "text" && typeof part.text === "string") texts.push(part.text);
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
      processHandle = cliProcess(commands[cli], args, { cwd: workspace.path, token: model.token, passEnv, output });
      totalTimer = setTimeout(timeout, timeoutMs); activity();
      if (isolationNote) emit({ type: "progress", message: isolationNote });
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
