import { sanitizeAgentText } from "../mcp/security.js";
import type { ToolResult } from "../mcp/tools.js";
import { remoteToolPattern, validHeaderValue, type McpServerConfig } from "./config.js";

export interface ExternalDefinition { name: string; description: string; inputSchema: Record<string, unknown> }
export interface ExternalStatus { name: string; origin: string; state: "ready" | "unreachable" | "disabled" | "circuit-open"; tools: number; lastCheckedAt: string | null }
export interface ClientDeps { fetch?: typeof fetch; now?: () => number; env?: Readonly<Record<string, string | undefined>> }
class ExternalError extends Error {
  constructor(message: "external tool unavailable" | "external tool timed out" | "external tool refused" = "external tool unavailable") { super(message); }
}
class SessionLost extends Error {}
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export function truncateText(text: string, limit: number): string {
  if (Buffer.byteLength(text) <= limit) return text;
  const suffix = "\n[truncated]";
  let bytes = 0; let end = 0;
  for (const char of text) { const size = Buffer.byteLength(char); if (bytes + size > limit - Buffer.byteLength(suffix)) break; bytes += size; end += char.length; }
  return text.slice(0, end) + suffix;
}
export function createMcpClient(config: McpServerConfig, deps: ClientDeps = {}) {
  const send = deps.fetch ?? fetch; const now = deps.now ?? Date.now; const env = deps.env ?? process.env;
  let session: string | undefined; let version = "2025-06-18"; let initialized = false; let nextId = 0;
  let failures = 0; let openUntil = 0; let probing = false; let closed = false;
  let checked: string | null = null; let ready = false; let cacheAt = -Infinity;
  let cached: ExternalDefinition[] = []; let listing: Promise<ExternalDefinition[]> | undefined;
  let initializing: Promise<void> | undefined;
  const active = new Set<AbortController>(); const secrets = new Set<string>();
  const headersFor = (): Record<string, string> => {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(config.headers ?? {})) {
      const resolved = value.startsWith("env:") ? env[value.slice(4)] : value;
      if (resolved === undefined || !validHeaderValue(resolved)) throw new ExternalError();
      if (resolved) {
        secrets.add(resolved);
        const credential = /^(?:Bearer|Basic)\s+(\S+)$/i.exec(resolved)?.[1];
        if (credential) secrets.add(credential);
      }
      headers[name] = resolved;
    }
    return headers;
  };
  const clean = (text: string): string => {
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) text = text.split(secret).join("[redacted]");
    return text.split(/\r?\n/).map(sanitizeAgentText).join("\n");
  };
  const redactSchema = (value: unknown): unknown => {
    if (typeof value === "string") {
      for (const secret of [...secrets].sort((a, b) => b.length - a.length)) value = (value as string).split(secret).join("[redacted]");
      return value;
    }
    if (Array.isArray(value)) return value.map(redactSchema);
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [redactSchema(key) as string, redactSchema(child)]));
    return value;
  };
  const disabled = (): boolean => { try { headersFor(); return false; } catch { return true; } };
  async function request(method: string, params: unknown, controller: AbortController, notification = false): Promise<unknown> {
    const id = ++nextId;
    const headers = { ...headersFor(), "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": version, ...(session === undefined ? {} : { "Mcp-Session-Id": session }) };
    const response = await send(config.url, { method: "POST", headers, redirect: "error", credentials: "omit", signal: controller.signal,
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params }) });
    if (response.status === 404 && session !== undefined) { await response.body?.cancel(); throw new SessionLost(); }
    if (!response.ok) { await response.body?.cancel(); throw new ExternalError("external tool refused"); }
    const received = response.headers.get("mcp-session-id");
    if (received !== null) {
      if (!received || received.length > 1024 || !validHeaderValue(received)) { await response.body?.cancel(); throw new ExternalError(); }
      session = received;
    }
    if (notification && (response.status === 202 || response.status === 204)) { await response.body?.cancel(); return {}; }
    const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json" && type !== "text/event-stream") { await response.body?.cancel(); throw new ExternalError("external tool refused"); }
    if (!response.body) throw new ExternalError();
    const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0; let body = "";
    const answer = (message: unknown): unknown => {
      if (!object(message) || message.jsonrpc !== "2.0" || message.id !== id || Object.hasOwn(message, "method")) throw new ExternalError();
      if (Object.hasOwn(message, "error")) throw new ExternalError("external tool refused");
      if (!Object.hasOwn(message, "result")) throw new ExternalError();
      return message.result;
    };
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) { body += decoder.decode(); break; }
        bytes += chunk.value.byteLength;
        if (bytes > 1048576) { controller.abort(); throw new ExternalError("external tool refused"); }
        body += decoder.decode(chunk.value, { stream: true });
        if (type === "text/event-stream") {
          body = body.replace(/\r\n/g, "\n");
          let end: number;
          while ((end = body.indexOf("\n\n")) >= 0) {
            const event = body.slice(0, end); body = body.slice(end + 2);
            const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
            if (!data) continue;
            let message: unknown; try { message = JSON.parse(data) as unknown; } catch { continue; }
            if (object(message) && message.id === id && !Object.hasOwn(message, "method")) return answer(message);
          }
        }
      }
      if (notification && !body.trim()) return {};
      if (type === "text/event-stream") throw new ExternalError();
      return answer(JSON.parse(body) as unknown);
    } finally { await reader.cancel().catch(() => {}); }
  }
  async function initialize(controller: AbortController): Promise<void> {
    if (initialized) return;
    initializing ??= (async () => {
      const result = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "factory-host", version: "0.1.0" } }, controller);
      if (!object(result) || typeof result.protocolVersion !== "string" || !result.protocolVersion || result.protocolVersion.length > 100 || !validHeaderValue(result.protocolVersion)) throw new ExternalError();
      version = result.protocolVersion;
      await request("notifications/initialized", {}, controller, true); initialized = true;
    })().finally(() => { initializing = undefined; });
    await initializing;
  }
  function failed(): void { ready = false; failures++; if (failures >= 3) openUntil = now() + 60000; }
  async function operation<T>(work: (controller: AbortController) => Promise<T>): Promise<T> {
    if (closed || disabled() || now() < openUntil || probing) throw new ExternalError();
    const probe = failures >= 3; if (probe) probing = true;
    const controller = new AbortController(); active.add(controller); let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs); timer.unref();
    try {
      for (let retry = 0; ; retry++) {
        try {
          await initialize(controller); const result = await work(controller);
          if (object(result) && result.isError === true) failed();
          else { failures = 0; openUntil = 0; ready = true; }
          return result;
        } catch (error) {
          if (error instanceof SessionLost && retry === 0) { initialized = false; session = undefined; continue; }
          throw error;
        }
      }
    } catch (error) {
      failed();
      throw new ExternalError(timedOut ? "external tool timed out" : error instanceof ExternalError ? error.message as "external tool refused" | "external tool unavailable" : "external tool unavailable");
    } finally { checked = new Date(now()).toISOString(); clearTimeout(timer); active.delete(controller); if (probe) probing = false; }
  }
  return {
    async listTools(): Promise<ExternalDefinition[]> {
      if (closed || disabled() || now() < openUntil) throw new ExternalError();
      if (now() - cacheAt < 300000) return structuredClone(cached);
      listing ??= operation(async (controller) => {
        const tools: ExternalDefinition[] = []; const names = new Set<string>(); const cursors = new Set<string>();
        let cursor: string | undefined;
        for (let page = 0; page < 64 && tools.length < config.maxTools; page++) {
          const result = await request("tools/list", cursor === undefined ? {} : { cursor }, controller);
          if (!object(result) || !Array.isArray(result.tools)) throw new ExternalError();
          for (const tool of result.tools) {
            if (!object(tool) || typeof tool.name !== "string" || !remoteToolPattern.test(tool.name) || clean(tool.name) !== tool.name || names.has(tool.name)
              || !object(tool.inputSchema) || Buffer.byteLength(JSON.stringify(tool.inputSchema)) > 16384) continue;
            if (tool.description !== undefined && typeof tool.description !== "string") continue;
            const description = clean(typeof tool.description === "string" ? tool.description : "").slice(0, 1000);
            tools.push({ name: tool.name, description, inputSchema: redactSchema(tool.inputSchema) as Record<string, unknown> });
            names.add(tool.name); if (tools.length === config.maxTools) break;
          }
          if (result.nextCursor === undefined) break;
          if (typeof result.nextCursor !== "string" || result.nextCursor.length > 4096 || cursors.has(result.nextCursor)) throw new ExternalError();
          cursor = result.nextCursor; cursors.add(cursor);
        }
        cached = tools; cacheAt = now(); return structuredClone(tools);
      }).finally(() => { listing = undefined; });
      return listing;
    },
    async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
      try {
        if (!remoteToolPattern.test(name) || Buffer.byteLength(JSON.stringify(args)) > 16384) throw new ExternalError("external tool refused");
        const result = await operation(async (controller) => {
          const value = await request("tools/call", { name, arguments: args }, controller);
          if (!object(value) || !Array.isArray(value.content) || (value.isError !== undefined && typeof value.isError !== "boolean")) throw new ExternalError();
          const text = value.content.map((item: unknown) => object(item) && item.type === "text" && typeof item.text === "string" ? item.text : "[non-text content omitted]").join("\n");
          return { content: [{ type: "text" as const, text: truncateText(clean(text), config.maxResultBytes) }], isError: value.isError === true };
        });
        return result;
      } catch (error) { return { content: [{ type: "text", text: error instanceof ExternalError ? error.message : "external tool unavailable" }], isError: true }; }
    },
    status(): ExternalStatus { return { name: config.name, origin: new URL(config.url).origin, state: disabled() ? "disabled" : now() < openUntil ? "circuit-open" : ready ? "ready" : "unreachable", tools: cached.length, lastCheckedAt: checked }; },
    close(): void { closed = true; for (const controller of active) controller.abort(); cached = []; },
  };
}
