import { lstatSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AttemptContext, RuntimeAdapter, RuntimeEvent, RuntimeSession } from "../dispatch/runtime.js";
import type { RunHandle } from "../exec/process-group.js";
import { scrubForLog } from "../exec/safe-env.js";
import { SANDBOX_RELAY_PORT, startSandboxed, type SandboxSpec } from "../sandbox/index.js";
import { assertInside, canonicalPath } from "../workspace/paths.js";

export interface OpenCodeRuntimeOptions {
  roots: SandboxSpec["roots"];
  opencodeDir: string;
  nodeDir?: string;
  relayFile?: string;
  timeoutMs?: number;
  stallMs?: number;
  maxOutputBytes?: number;
  maxPromptBytes?: number;
  variant?: string;
  launcher?: typeof startSandboxed;
  bwrapPath?: string;
}

const invalid = (): never => { throw new Error("Runtime configuration invalid"); };
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function utf8Prefix(text: string, bytes: number): string {
  const buffer = Buffer.from(text);
  if (buffer.length <= bytes) return text;
  let end = bytes;
  while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString("utf8");
}

export function promptFor(context: AttemptContext, maxBytes: number, token: string): string {
  const redact = (text: string): string => text.replaceAll(token, "[redacted]").replace(/fpx_[A-Za-z0-9_-]+/g, "[redacted]");
  const prompt = redact([
    `Task: ${context.task.code} — ${context.task.title}`,
    `Goal: ${context.task.goal}`,
    "Acceptance criteria:", ...context.task.acceptance.map((criterion) => `- ${criterion}`),
    `Seat role: ${context.seat.role}`,
    "Rules:",
    "Work only inside the current directory.",
    "Do not commit or push or change git config.",
    "Do not touch files outside the task scope.",
    "Run the project's own tests when they exist.",
    "Finish with a short summary of what changed and what was verified.",
    "Factory tools: factory_task_progress (call it at meaningful milestones, short summary) and factory_output_register (after you write a deliverable file in the workspace, register it with its workspace-relative path, a title, a kind and a one-sentence abstract). Never include secrets in them.",
    "If a business decision blocks you and you cannot make it yourself, call factory_decision_request with the question and 2-6 options, then stop immediately without further tool calls. The operator will answer and a new session will continue your work.",
  ].join("\n"));
  if (prompt.includes("\0") || Buffer.byteLength(prompt) > maxBytes) return invalid();
  const suffix = (context.contextPack ? `\nContext:\n${redact(context.contextPack.replaceAll("\0", ""))}` : "")
    + (context.handoff ? `\nHandoff:\n${redact(context.handoff.replaceAll("\0", ""))}` : "");
  if (!context.instructions) return utf8Prefix(prompt + suffix, maxBytes);
  const { profile, skills } = context.instructions;
  const mapping = "Tool names written with dots in profiles and skills (for example knowledge.search) are called here as factory_ plus the name with dots replaced by underscores (for example factory_knowledge_search).";
  const catalog = skills.length ? "\nSkills available (read one in full with factory_skill_get before relying on it):\n"
    + skills.slice(0, 20).map(({ name, description }) => `- ${name}: ${description.replace(/[\r\n\0]/g, " ")}`).join("\n") : "";
  const header = "\nSeat profile:\n";
  const tail = redact(catalog + "\n" + mapping);
  const profileText = utf8Prefix(redact(profile.replaceAll("\0", "")), 6000);
  const available = Math.max(0, maxBytes - Buffer.byteLength(prompt + suffix));
  const overhead = Buffer.byteLength(header + tail);
  const block = available >= overhead ? header + utf8Prefix(profileText, available - overhead) + tail : "";
  return utf8Prefix(prompt + block + suffix, maxBytes);
}

function gitDirectories(workspace: string, roots: SandboxSpec["roots"]): NonNullable<SandboxSpec["gitDirs"]> {
  if (assertInside(roots.worktreesRoot, workspace) !== workspace) return invalid();
  const file = join(workspace, ".git");
  if (assertInside(workspace, file) !== file) return invalid();
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384) return invalid();
  const match = /^gitdir: ([^\0\r\n]+)\r?\n?$/.exec(readFileSync(file, "utf8"));
  const target = match?.[1];
  if (!target || !isAbsolute(target) || resolve(target) !== target || canonicalPath(target) !== target) return invalid();
  const worktree = assertInside(roots.projectsRoot, target);
  const common = dirname(dirname(worktree));
  if (basename(common) !== ".git" || basename(dirname(worktree)) !== "worktrees"
    || !basename(worktree) || assertInside(roots.projectsRoot, common) !== common
    || !lstatSync(worktree).isDirectory() || !lstatSync(common).isDirectory()) return invalid();
  return { common, worktree };
}

export function createOpenCodeRuntime(options: OpenCodeRuntimeOptions): RuntimeAdapter {
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const stallMs = options.stallMs ?? 5 * 60_000;
  const maxOutputBytes = options.maxOutputBytes ?? 4 * 1024 * 1024;
  const maxPromptBytes = options.maxPromptBytes ?? 96 * 1024;
  for (const [value, maximum] of [[timeoutMs, 6 * 60 * 60_000], [stallMs, 2_147_483_647],
    [maxOutputBytes, 16 * 1024 * 1024], [maxPromptBytes, 96 * 1024]]) {
    if (value === undefined || maximum === undefined || !Number.isSafeInteger(value) || value < 1 || value > maximum) invalid();
  }
  if (options.variant !== undefined && (!options.variant || /[\0\r\n]/.test(options.variant))) invalid();
  const launcher = options.launcher ?? startSandboxed;
  return {
    kind: "native-opencode",
    async start(context): Promise<RuntimeSession> {
      let spec: SandboxSpec;
      let scrub: (text: string) => string;
      try {
        const { model, workspace } = context;
        if (!workspace || !model?.socketPath || !model.token || !model.models.length
          || model.models.some((name) => !name || /[\s\p{Cc}]/u.test(name))
          || new Set(model.models).size !== model.models.length) return invalid();
        const selected = context.agent?.model ?? model.models[0];
        if (!selected || !model.models.includes(selected)) return invalid();
        const variant = context.agent?.effort ?? options.variant;
        const secrets = [model.token, ...Object.values(options.roots), options.nodeDir ?? dirname(dirname(process.execPath)),
          options.opencodeDir, options.relayFile ?? fileURLToPath(new URL("../sandbox/relay-main.js", import.meta.url)), model.socketPath];
        scrub = (text) => {
          // Redact before shortening text, so truncation cannot expose a prefix of a secret.
          let clean = scrubForLog(text, [model.token]);
          clean = clean.replaceAll(model.token, "[redacted]");
          for (const path of [workspace.path, workspace.path.replaceAll("\\", "/")]) clean = clean.replaceAll(path, "<workspace>");
          clean = scrubForLog(clean, secrets);
          for (const secret of secrets) if (secret) clean = clean.replaceAll(secret, "[redacted]");
          return clean.replace(/fpx_[A-Za-z0-9_-]+/g, "[redacted]")
            .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted]")
            .replace(/[A-Za-z]:[\\/][^\s<>"'`]+|(?<![\w:])\/(?:[^\s<>"'`]+\/)*[^\s<>"'`]+/g, "[path]")
            .replace(/[\p{Cc}\p{Cf}]+/gu, " ");
        };
        spec = {
          bwrapPath: options.bwrapPath ?? "/usr/bin/bwrap", workspace: workspace.path, roots: { ...options.roots },
          readOnlyBinds: [
            { host: options.nodeDir ?? dirname(dirname(process.execPath)), guest: "/opt/node" },
            { host: options.opencodeDir, guest: "/opt/opencode" },
            { host: options.relayFile ?? fileURLToPath(new URL("../sandbox/relay-main.js", import.meta.url)), guest: "/opt/factory/relay.js" },
          ],
          gitDirs: gitDirectories(workspace.path, options.roots),
          socket: { host: model.socketPath, guest: "/opt/factory/model.sock" },
          env: {
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              $schema: "https://opencode.ai/config.json", autoupdate: false, share: "disabled",
              model: `factory/${selected}`, small_model: `factory/${selected}`,
              provider: { factory: { npm: "@ai-sdk/openai-compatible", name: "Factory",
                options: { baseURL: `http://127.0.0.1:${SANDBOX_RELAY_PORT}/v1`, apiKey: model.token },
                models: Object.fromEntries(model.models.map((name) => [name, { name, tool_call: true,
                  limit: { context: 128000, output: 8192 } }])),
              } },
              enabled_providers: ["factory"],
              mcp: { factory: { type: "remote", url: `http://127.0.0.1:${SANDBOX_RELAY_PORT}/mcp`, enabled: true,
                headers: { Authorization: `Bearer ${model.token}` } } },
              permission: { edit: "allow", bash: "allow", webfetch: "deny", external_directory: "deny" },
            }),
            OPENCODE_DISABLE_AUTOUPDATE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
          },
          command: "/opt/opencode/bin/opencode",
          args: ["run", "--pure", "--format", "json", "-m", `factory/${selected}`, "--dir", workspace.path,
            ...(variant === undefined ? [] : ["--variant", variant]),
            promptFor(context, maxPromptBytes, model.token)],
        };
        if (JSON.stringify({ ...spec, env: { ...spec.env, OPENCODE_CONFIG_CONTENT: "" } }).includes(model.token)) return invalid();
      } catch { return invalid(); }

      const queue: RuntimeEvent[] = [];
      const readers: Array<{ resolve(value: IteratorResult<RuntimeEvent>): void; reject(error: Error): void }> = [];
      let handle: RunHandle | undefined;
      let stopped = false;
      let ended = false;
      let failure: Error | undefined;
      let stopPromise: Promise<void> | undefined;
      let termination: Promise<void> | undefined;
      let terminal: Extract<RuntimeEvent, { type: "failed" }> | undefined;
      let summary = "";
      let line = "";
      let lineBytes = 0;
      let discardLine = false;
      let outputBytes = 0;
      let totalTimer: ReturnType<typeof setTimeout> | undefined;
      let stallTimer: ReturnType<typeof setTimeout> | undefined;
      const clearTimers = (): void => { clearTimeout(totalTimer); clearTimeout(stallTimer); };
      const emit = (event: RuntimeEvent): void => {
        if (stopped || ended) return;
        const reader = readers.shift();
        if (reader) reader.resolve({ done: false, value: event });
        // Bound the pending event queue as well as the input. Preserve the most recent progress.
        else { if (queue.length >= 1024) queue.shift(); queue.push(event); }
      };
      const finish = (error?: Error): void => {
        if (ended) return;
        ended = true; failure = error; clearTimers();
        context.signal.removeEventListener("abort", onAbort);
        for (const reader of readers.splice(0)) {
          if (error) reader.reject(error); else reader.resolve({ done: true, value: undefined });
        }
      };
      const terminate = (): Promise<void> => {
        termination ??= Promise.resolve().then(async () => {
          if (!handle) return;
          try {
            await handle.stop("operator");
            if (!(await handle.result).groupGone) throw new Error();
          } catch { throw new Error("Runtime stop failed"); }
        });
        void termination.catch(() => undefined);
        return termination;
      };
      const timeOut = (): void => {
        if (stopped || ended || terminal) return;
        terminal = { type: "failed", kind: "timeout", message: scrub("agent timed out") };
        clearTimers();
        void terminate().catch(() => finish(new Error("Runtime stop failed")));
      };
      const resetStall = (): void => { clearTimeout(stallTimer); stallTimer = setTimeout(timeOut, stallMs); };
      const parseLine = (input: string): void => {
        if (stopped || ended || terminal) return;
        let event: Record<string, unknown>;
        try { event = object(JSON.parse(input) as unknown); } catch { return; }
        if (typeof event.type !== "string") return;
        resetStall();
        const part = object(event.part);
        if (event.type === "step_start") emit({ type: "progress", message: scrub("Working") });
        else if (event.type === "text" && typeof part.text === "string") {
          const text = scrub(part.text);
          summary = text.trim().slice(0, 2000);
          emit({ type: "progress", message: text.slice(0, 200) });
        } else if (event.type === "tool_use" && typeof part.tool === "string") {
          const state = object(part.state);
          const tool = scrub(part.tool).slice(0, 80);
          if (part.tool.startsWith("factory_")) emit({ type: "progress", message: `tool: ${tool}` });
          else if (state.status === "error") emit({ type: "progress", message: `tool failed: ${tool}` });
          else if (state.status === "completed") {
            const input = object(state.input);
            let detail = "";
            if (typeof input.filePath === "string") {
              const path = relative(spec.workspace, resolve(spec.workspace, input.filePath));
              detail = isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`) ? "<outside workspace>" : path.replaceAll("\\", "/");
            } else if (typeof input.command === "string") detail = scrub(input.command).slice(0, 80);
            emit({ type: "progress", message: scrub(`tool: ${tool}${detail ? ` ${detail}` : ""}`) });
          }
        } else if (event.type === "error") {
          const error = object(event.error);
          const status = object(error.data).statusCode;
          terminal = error.name === "APIError"
            ? { type: "failed", kind: "model", message: scrub(typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
              ? `model request failed (HTTP ${status})` : "model request failed") }
            : { type: "failed", kind: "runtime", message: scrub("agent error") };
          clearTimers();
          void terminate().catch(() => finish(new Error("Runtime stop failed")));
        }
      };
      const onOutput = (stream: "stdout" | "stderr", chunk: string): void => {
        if (stream !== "stdout" || stopped || ended || terminal) return;
        const remaining = maxOutputBytes - outputBytes;
        outputBytes += Buffer.byteLength(chunk);
        const text = utf8Prefix(chunk, Math.max(0, remaining));
        const lines = text.split("\n");
        for (let index = 0; index < lines.length; index++) {
          const segment = lines[index] ?? "";
          if (!discardLine) {
            lineBytes += Buffer.byteLength(segment);
            if (lineBytes > 1024 * 1024) { line = ""; discardLine = true; }
            else line += segment;
          }
          if (index < lines.length - 1) {
            if (!discardLine) parseLine(line);
            line = ""; lineBytes = 0; discardLine = false;
          }
        }
      };
      function stop(): Promise<void> {
        if (!stopPromise) {
          stopped = true; queue.length = 0; clearTimers();
          stopPromise = terminate().then(() => finish(), () => {
            const error = new Error("Runtime stop failed"); finish(error); throw error;
          });
          void stopPromise.catch(() => undefined);
        }
        return stopPromise;
      }
      function onAbort(): void { void stop().catch(() => undefined); }
      const iterator: AsyncIterableIterator<RuntimeEvent> = {
        [Symbol.asyncIterator]() { return this; },
        next() {
          if (failure) return Promise.reject(failure);
          const event = queue.shift();
          if (event) return Promise.resolve({ done: false, value: event });
          if (ended) return Promise.resolve({ done: true, value: undefined });
          return new Promise((resolveNext, reject) => { readers.push({ resolve: resolveNext, reject }); });
        },
        async return() { await stop(); return { done: true, value: undefined }; },
      };
      context.signal.addEventListener("abort", onAbort, { once: true });
      if (context.signal.aborted) { onAbort(); return { events: () => iterator, stop }; }
      try {
        totalTimer = setTimeout(timeOut, timeoutMs); resetStall();
        handle = launcher({ spec, timeoutMs, maxOutputBytes, onOutput });
      } catch {
        clearTimers(); context.signal.removeEventListener("abort", onAbort);
        throw new Error("Runtime launch failed");
      }
      void handle.result.then(async (result) => {
        try {
          if (termination) await termination;
          if (!result.groupGone) { finish(new Error("Runtime stop failed")); return; }
          if (stopped) { finish(); return; }
          if (line && !discardLine) parseLine(line);
          if (termination) await termination;
          emit(terminal ?? (result.timedOut ? { type: "failed", kind: "timeout", message: scrub("agent timed out") }
            : result.exitCode === 0 ? { type: "completed", summary: summary || scrub("Work finished") }
            : { type: "failed", kind: "runtime", message: scrub(`agent exited with code ${result.exitCode ?? 1}`) }));
          finish();
        } catch { finish(new Error("Runtime stop failed")); }
      }, () => finish(new Error("Runtime execution failed")));
      return { events: () => iterator, stop };
    },
  };
}
