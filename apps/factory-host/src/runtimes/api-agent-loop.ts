import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { AttemptContext, RuntimeEvent } from "../dispatch/runtime.js";

export interface ApiAgentInput {
  access?: Pick<NonNullable<AttemptContext["model"]>, "baseUrl" | "token" | "models" | "mcpBaseUrl">;
  model?: string;
  effort: NonNullable<NonNullable<AttemptContext["agent"]>["effort"]>;
  timeoutMinutes: number;
  task: Pick<AttemptContext["task"], "title" | "goal" | "brief" | "acceptance" | "inputs">;
  handoff: AttemptContext["handoff"];
  contextPack: AttemptContext["contextPack"];
  instructions: AttemptContext["instructions"];
  inputs: AttemptContext["inputs"];
  workspacePath: string | undefined;
  language: string;
}

type Fields = Record<string, unknown>;
type Failure = Extract<RuntimeEvent, { type: "failed" }>;
type Post = (url: string, data: unknown, modelRequest?: boolean) => Promise<Fields>;
type Tool = { type: "function"; function: { name: string; description?: string; parameters: Fields } };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type ToolResult = { text: string; written?: string };

const MAX_TURNS = 40;
const MAX_CALLS = 200;
const RESULT_BYTES = 32 * 1024;
const READ_BYTES = 64 * 1024;
const WRITE_BYTES = 256 * 1024;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const record = (value: unknown): Fields => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Fields : {};
const redact = (text: string, token: string): string => (token ? text.replaceAll(token, "[redacted]") : text)
  .replace(/fpx_[A-Za-z0-9_-]+/g, "[redacted]");
const prefix = (text: string, maxBytes: number): string => {
  const bytes = Buffer.from(text);
  if (bytes.length <= maxBytes) return text;
  while ((bytes[maxBytes]! & 0xc0) === 0x80) maxBytes--;
  return bytes.subarray(0, maxBytes).toString("utf8");
};

class LoopFailure extends Error {
  constructor(readonly kind: Failure["kind"], message: string) { super(message); }
}

function pathParts(value: unknown, allowRoot: boolean): string[] {
  if (allowRoot && (value === undefined || value === "." || value === "")) return [];
  if (typeof value !== "string" || isAbsolute(value) || value.length > 4096 || /[\\:\0]/.test(value)) throw new Error();
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git"
    || (process.platform === "win32" && /[. ]$/.test(part)))) throw new Error();
  return parts;
}

export function createWorkspaceTools(workspacePath: string, token = ""):
  (name: string, args: Fields, signal?: AbortSignal) => Promise<ToolResult> {
  async function directory(parts: string[], create: boolean, signal: AbortSignal, handles: FileHandle[]) {
    let current = resolve(workspacePath);
    async function anchor(path: string): Promise<string> {
      if (!(await lstat(path)).isDirectory() || await realpath(path) !== current) throw new Error();
      if (process.platform !== "linux") return current;
      const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | NO_FOLLOW);
      handles.push(handle);
      const descriptor = `/proc/self/fd/${handle.fd}`;
      if (await realpath(descriptor) !== current) throw new Error();
      return descriptor;
    }
    let anchored = await anchor(current);
    for (const part of parts) {
      signal.throwIfAborted();
      if (await realpath(anchored) !== current) throw new Error();
      const next = join(anchored, part);
      current = join(current, part);
      if (create) {
        try { await mkdir(next); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      }
      anchored = await anchor(next);
    }
    if (await realpath(anchored) !== current) throw new Error();
    return { anchored, canonical: current };
  }

  return async (name: string, args: Fields, signal = new AbortController().signal): Promise<ToolResult> => {
    const handles: FileHandle[] = [];
    try {
      signal.throwIfAborted();
      if (name === "workspace__list") {
        const { anchored } = await directory(pathParts(args.dir, true), false, signal, handles);
        const folder = await opendir(anchored);
        const entries: string[] = [];
        let size = 0;
        for await (const entry of folder) {
          signal.throwIfAborted();
          if (entry.name.toLowerCase() === ".git" || entry.isSymbolicLink()) continue;
          const label = JSON.stringify(entry.name + (entry.isDirectory() ? "/" : ""));
          size += Buffer.byteLength(label) + 1;
          if (size > RESULT_BYTES - 40) { entries.push("[Listing truncated]"); break; }
          entries.push(label);
        }
        return { text: entries.join("\n") || "(empty directory)" };
      }
      const parts = pathParts(args.path, false);
      const writing = name === "workspace__write";
      const content = args.content;
      const offset = args.offset ?? 0, limit = args.limit ?? RESULT_BYTES;
      if (writing) {
        if (typeof content !== "string" || Buffer.byteLength(content) > WRITE_BYTES
          || redact(content, token) !== content || redact(parts.join("/"), token) !== parts.join("/"))
          return { text: "Error: workspace write requires safe text of at most 256 KiB" };
      } else if (name !== "workspace__read" || typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0
        || typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > READ_BYTES) {
        return { text: "Error: workspace read requires a nonnegative byte offset and a limit of 1 to 65536 bytes" };
      }
      const { anchored, canonical } = await directory(parts.slice(0, -1), writing, signal, handles);
      const leaf = parts.at(-1)!;
      const target = join(anchored, leaf), expected = join(canonical, leaf);
      try {
        const stat = await lstat(target);
        if (!stat.isFile() || stat.nlink !== 1 || await realpath(target) !== expected) throw new Error();
      } catch (error) { if (!writing || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      signal.throwIfAborted();
      const file = await open(target, (writing ? constants.O_WRONLY | constants.O_CREAT : constants.O_RDONLY)
        | NO_FOLLOW | (constants.O_NONBLOCK ?? 0), 0o644);
      handles.push(file);
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1
        || await realpath(process.platform === "linux" ? `/proc/self/fd/${file.fd}` : target) !== expected) throw new Error();
      signal.throwIfAborted();
      if (writing) {
        await file.truncate(0);
        await file.writeFile(content as string, { encoding: "utf8", signal });
        return { text: "File written", written: parts.join("/") };
      }
      const buffer = Buffer.alloc(limit as number);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset as number);
      return { text: buffer.subarray(0, bytesRead).toString("utf8") };
    } catch { return { text: "Error: workspace path denied or unavailable" }; }
    finally { await Promise.allSettled(handles.map((handle) => handle.close())); }
  };
}

const string = { type: "string" };
const workspaceTools: Tool[] = [
  { type: "function", function: { name: "workspace__list", description: "List a workspace-relative directory (default: workspace root).",
    parameters: { type: "object", properties: { dir: string } } } },
  { type: "function", function: { name: "workspace__read", description: "Read workspace text by byte offset and limit (default 32768 bytes).",
    parameters: { type: "object", required: ["path"], properties: { path: string,
      offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: READ_BYTES } } } } },
  { type: "function", function: { name: "workspace__write", description: "Write UTF-8 text to a workspace-relative path (max 256 KiB).",
    parameters: { type: "object", required: ["path", "content"], properties: { path: string, content: string } } } },
];

function prompts(input: ApiAgentInput, skillTool: boolean) {
  const skills = input.instructions?.skills ?? [];
  const system = [input.instructions?.profile, skills.length ? ["Assigned skills:",
    ...skills.map(({ name, description }) => `- ${name}: ${description}`),
    ...(skillTool ? ["Use the skill.get tool (skill__get) for the full text."] : []),
  ].join("\n") : null,
  `Language: write everything the operator reads in ${input.language}. Keep code, identifiers, file names, commands and quoted errors as they are.`,
  "Work in turns. Call the available tools when needed, using double underscores for dots in tool names. Finish with a final message summarising the result."].filter(Boolean).join("\n\n");
  const { task } = input;
  const user = [`Task: ${task.title}\nGoal: ${task.goal}\nBrief: ${task.brief}`,
    `Acceptance criteria:\n${task.acceptance.map((criterion) => `- ${criterion}`).join("\n") || "(none)"}`,
    input.handoff ? `Handoff:\n${input.handoff}` : null,
    input.contextPack ? `Context pack:\n${input.contextPack}` : null,
    `Reference inputs:\n${input.inputs?.map(({ path, title, mediaType, note }) => `- ${title} (${mediaType}): ${path}${note ? ` — ${note}` : ""}`).join("\n")
      || task.inputs.map(({ artifactId, version }) => `- ${artifactId} (version ${version})`).join("\n") || "(none)"}`,
  ].filter(Boolean).join("\n\n");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

function toolCalls(value: unknown): ToolCall[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new LoopFailure("runtime", "Invalid model tool calls");
  return value.map((entry: unknown) => {
    const call = record(entry), fn = record(call.function);
    if (typeof call.id !== "string" || call.type !== "function" || typeof fn.name !== "string" || typeof fn.arguments !== "string")
      throw new LoopFailure("runtime", "Invalid model tool call");
    return { id: call.id, type: "function", function: { name: fn.name, arguments: fn.arguments } };
  });
}

function reportedCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export async function runApiAgent(input: ApiAgentInput, emit: (event: RuntimeEvent) => void, fetchImpl: typeof fetch = fetch): Promise<void> {
  const token = input.access?.token ?? "";
  const safe = (text: string): string => redact(text, token);
  const send = (event: RuntimeEvent): void => emit(event.type === "completed" ? { ...event, summary: prefix(safe(event.summary), 8192) }
    : event.type === "failed" ? { ...event, message: safe(event.message) }
      : event.type === "evidence" ? { ...event, detail: safe(event.detail) } : event);
  try {
    const { access, model } = input;
    if (!access?.baseUrl || !token || !model || !access.models.includes(model))
      throw new LoopFailure("config", "API agent requires a proxy token and an approved model");
    const overall = AbortSignal.timeout(input.timeoutMinutes * 60_000);
    const callSignal = (): AbortSignal => AbortSignal.any([overall, AbortSignal.timeout(120_000)]);
    const post: Post = async (url, data, modelRequest = false) => {
      const signal = callSignal();
      try {
        signal.throwIfAborted();
        const response = await fetchImpl(url, { method: "POST", signal, redirect: "error",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(data) });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          const status = response.status;
          const kind = modelRequest && ([401, 403, 429].includes(status) || status >= 500) ? "model" : "runtime";
          throw new LoopFailure(kind, `${modelRequest ? "Model proxy" : "MCP endpoint"} returned HTTP ${status}`);
        }
        return record(await response.json());
      } catch (error) {
        if (signal.aborted) throw new LoopFailure("timeout", "API agent request timed out");
        if (error instanceof LoopFailure) throw error;
        throw new LoopFailure("runtime", modelRequest ? "Model proxy request failed" : "MCP request failed");
      }
    };
    let rpcId = 0;
    const rpc = async (method: string, params: Fields): Promise<Fields> => {
      const id = ++rpcId;
      const url = new URL("/mcp", access.mcpBaseUrl!);
      const response = await post(url.href, { jsonrpc: "2.0", id, method, params });
      if (response.id !== id || response.jsonrpc !== "2.0" || response.error || !response.result)
        throw new LoopFailure("runtime", "MCP returned a JSON-RPC error");
      return record(response.result);
    };
    const workspace = input.workspacePath ? createWorkspaceTools(input.workspacePath, token) : undefined;
    const tools = workspace ? [...workspaceTools] : [];
    const mcpNames = new Map<string, string>();
    if (access.mcpBaseUrl) {
      const listed = (await rpc("tools/list", {})).tools;
      if (!Array.isArray(listed)) throw new LoopFailure("runtime", "Invalid MCP tool list");
      for (const entry of listed) {
        const { name, description, inputSchema } = record(entry);
        if (typeof name !== "string" || !name) throw new LoopFailure("runtime", "Invalid MCP tool name");
        const mapped = name.replaceAll(".", "__");
        if (tools.some((tool) => tool.function.name === mapped)) throw new LoopFailure("runtime", "Conflicting API agent tool names");
        mcpNames.set(mapped, name);
        tools.push({ type: "function", function: { name: mapped, parameters: record(inputSchema),
          ...(typeof description === "string" ? { description: safe(description) } : {}) } });
      }
    }
    const messages: Fields[] = prompts(input, mcpNames.has("skill__get")).map(({ role, content }) => ({ role, content: safe(content) }));
    const url = `${access.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    let totalCalls = 0;
    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      const reply = await post(url, { model, messages, tools, tool_choice: "auto",
        stream: false, reasoning_effort: input.effort }, true);
      const choice = Array.isArray(reply.choices) ? record(reply.choices[0]) : {};
      const message = record(choice.message);
      const calls = toolCalls(message.tool_calls);
      send({ type: "progress", message: `L\u01b0\u1ee3t ${turn}: g\u1ecdi ${calls.length} c\u00f4ng c\u1ee5` });
      const usage = record(reply.usage);
      send({ type: "usage", usage: { inputTokens: reportedCount(usage.prompt_tokens),
        cachedInputTokens: reportedCount(record(usage.prompt_tokens_details).cached_tokens),
        outputTokens: reportedCount(usage.completion_tokens),
        reasoningOutputTokens: reportedCount(record(usage.completion_tokens_details).reasoning_tokens) } });
      const text = typeof message.content === "string" ? safe(message.content) : null;
      if (!calls.length) {
        if (!text?.trim() || choice.finish_reason === "length" || choice.finish_reason === "content_filter")
          throw new LoopFailure("runtime", "Model did not return a final answer");
        send({ type: "completed", summary: text });
        return;
      }
      if (totalCalls + calls.length > MAX_CALLS) throw new LoopFailure("runtime", `API agent hit the ${MAX_CALLS} tool call limit`);
      totalCalls += calls.length;
      messages.push({ role: "assistant", content: text, tool_calls: calls });
      for (const call of calls) {
        if (overall.aborted) throw new LoopFailure("timeout", "API agent overall timeout exceeded");
        let result: ToolResult;
        try {
          const parsed: unknown = JSON.parse(call.function.arguments);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
          const args = record(parsed);
          const name = call.function.name;
          const original = mcpNames.get(name);
          if (original) {
            const output = await rpc("tools/call", { name: original, arguments: args });
            const content = Array.isArray(output.content) ? output.content.map(record)
              .flatMap((part) => part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("\n") : "";
            result = { text: output.isError === true ? `Error: ${content || "MCP tool failed"}` : content || "(no text result)" };
          } else if (workspace && workspaceTools.some((tool) => tool.function.name === name)) {
            const signal = callSignal();
            result = await workspace(name, args, signal);
            if (signal.aborted) result = { text: "Error: workspace tool timed out" };
          } else result = { text: "Error: unknown tool" };
        } catch (error) {
          result = { text: `Error: ${error instanceof LoopFailure ? error.message : "invalid tool arguments"}` };
        }
        if (result.written) send({ type: "evidence", name: "file", detail: result.written });
        messages.push({ role: "tool", tool_call_id: call.id, content: prefix(safe(result.text), RESULT_BYTES) });
      }
    }
    throw new LoopFailure("runtime", `API agent hit the ${MAX_TURNS} model turn limit`);
  } catch (error) {
    send(error instanceof LoopFailure ? { type: "failed", kind: error.kind, message: error.message }
      : { type: "failed", kind: "runtime", message: "API agent execution failed" });
  }
}
