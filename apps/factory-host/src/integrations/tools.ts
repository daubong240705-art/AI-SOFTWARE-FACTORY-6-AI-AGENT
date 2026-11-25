import type { Database } from "better-sqlite3";
import { integrationToolNameSchema, type Integration } from "@factory/contracts";
import { z } from "zod";
import type { TokenGrant } from "../proxy/tokens.js";
import { assertActiveGrant } from "../mcp/security.js";
import { createToolPolicy } from "../mcp/policy.js";
import type { ToolResult } from "../mcp/tools.js";
import type { ExternalTools } from "../mcp-external/index.js";
import { createMcpClient, truncateText, type ExternalDefinition } from "../mcp-external/client.js";
import { scrub, requestParams } from "./http.js";
import type { HttpEffects } from "./http-effects.js";
import { launchStdio, stdioSession, type StdioLaunch } from "./stdio.js";
import { integrationToolPattern, object, type IntegrationStore } from "./store.js";
import { rpcError, type createMcpHandler } from "../mcp/rpc.js";

const rpcCall = z.strictObject({ jsonrpc: z.literal("2.0"), method: z.literal("tools/call"), id: z.union([z.string().max(512), z.number().int()]).optional(),
  params: z.strictObject({ name: z.string().max(120), arguments: z.record(z.string(), z.unknown()).optional(), _meta: z.record(z.string(), z.unknown()).optional() }) });
export function withHttpToolDispatch(next: ReturnType<typeof createMcpHandler>, tools: ExternalTools): ReturnType<typeof createMcpHandler> {
  return { async handle(grant, input) {
    let rpc: unknown = input;
    if (typeof input === "string" || Buffer.isBuffer(input)) {
      try { rpc = JSON.parse(typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input)); }
      catch { return next.handle(grant, input); }
    }
    if (object(rpc) && rpc.method === "tools/call" && object(rpc.params) && typeof rpc.params.name === "string" && rpc.params.name.startsWith("http.")) {
      const parsed = rpcCall.safeParse(rpc);
      if (!parsed.success) return rpcError(-32602);
      if (parsed.data.id === undefined) return { status: 202 };
      const { id, params } = parsed.data;
      const result = await tools.call(grant, params.name, params.arguments ?? {});
      return { status: 200, body: { jsonrpc: "2.0", id, result } };
    }
    return next.handle(grant, input);
  } };
}

function nameOf(integration: Integration, name: string) { return `${integration.kind === "http-api" ? "http" : "ext"}.${integration.name}.${name}`; }
const result = (text: string, isError = true): ToolResult => ({ isError, content: [{ type: "text", text }] });

export function createIntegrationTools(deps: { raw: Database; store: IntegrationStore; http: HttpEffects; stateDir: string; clock: () => Date;
  approve(grant: TokenGrant, tool: string, args: unknown, revision?: string): string | null; launch?: StdioLaunch; fetch?: typeof fetch }): ExternalTools & {
    check(integration: Integration): Promise<void>;
  } {
  const policy = createToolPolicy(deps.raw);
  const active = (grant: TokenGrant) => assertActiveGrant(deps.raw, grant, deps.clock());
  const clients = new Set<ReturnType<typeof createMcpClient>>();
  const stdioSessions = new Set<AbortController>();
  const counts = new Map<string, number>();
  let closed = false;
  const mcpHttp = async <T>(integration: Extract<Integration, { kind: "mcp-http" }>, work: (client: ReturnType<typeof createMcpClient>) => Promise<T>) => {
    const client = createMcpClient({ name: integration.name, url: integration.config.url, timeoutMs: 20_000, maxResultBytes: 32_768, maxTools: 64 },
      { ...(deps.fetch ? { fetch: deps.fetch } : {}), headers: () => deps.http.proxyHeaders(integration) });
    clients.add(client);
    try { return await work(client); } finally { client.close(); clients.delete(client); }
  };
  const stdio = async <T>(integration: Extract<Integration, { kind: "mcp-stdio" }>,
    work: (request: (method: string, params: unknown) => Promise<unknown>, secrets: string[]) => Promise<T>) => {
    const secrets: string[] = [];
    const env = Object.fromEntries(Object.entries(integration.config.env).map(([key, entry]) => {
      if ("value" in entry) return [key, entry.value];
      const value = deps.store.read(entry.credential, integration.scopeGroupId);
      secrets.push(value);
      return [key, value];
    }));
    const controller = new AbortController();
    stdioSessions.add(controller);
    try {
      return await stdioSession(deps.launch ?? launchStdio, { config: integration.config, env, stateDir: deps.stateDir },
        (request) => work(request, secrets), controller.signal);
    } finally { stdioSessions.delete(controller); }
  };
  const discover = async (integration: Integration): Promise<ExternalDefinition[]> => {
    if (integration.kind === "http-api") { await deps.http.check(integration); return []; }
    if (integration.kind === "mcp-http") return mcpHttp(integration, (client) => client.listTools());
    return stdio(integration, async (request, secrets) => {
      const tools = new Map<string, ExternalDefinition>();
      const visited = new Set<string>();
      let cursor: string | undefined;
      const clean = (value: unknown): unknown => typeof value === "string" ? scrub(value, secrets) : Array.isArray(value) ? value.map(clean)
        : object(value) ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [scrub(key, secrets), clean(entry)])) : value;
      do {
        const response = await request("tools/list", cursor === undefined ? {} : { cursor });
        if (!object(response) || !Array.isArray(response.tools)) throw new Error("Invalid tools/list result");
        for (const tool of response.tools as unknown[]) {
          if (tools.size >= 64) break;
          if (!object(tool) || typeof tool.name !== "string" || !integrationToolNameSchema.safeParse(tool.name).success || scrub(tool.name, secrets) !== tool.name
            || !object(tool.inputSchema) || Buffer.byteLength(JSON.stringify(tool.inputSchema)) > 16_384) continue;
          tools.set(tool.name, { name: tool.name, description: typeof tool.description === "string" ? scrub(tool.description, secrets).slice(0, 1000) : "",
            inputSchema: clean(tool.inputSchema) as Record<string, unknown> });
        }
        cursor = typeof response.nextCursor === "string" && response.nextCursor.length <= 4096 ? response.nextCursor : undefined;
        if (cursor !== undefined) {
          if (visited.has(cursor)) throw new Error("Invalid tools/list cursor");
          visited.add(cursor);
        }
      } while (cursor !== undefined && tools.size < 64 && visited.size < 64);
      return [...tools.values()];
    });
  };
  const privateInput = (value: string, grant: TokenGrant) => [grant.projectId, grant.taskId, grant.attemptId, grant.workspacePath]
    .some((field) => field && value.includes(field)) || /fpx_[A-Za-z0-9_-]+/.test(value);
  return {
    async check(integration) {
      if (closed) return;
      let tools: ExternalDefinition[] = []; let ok = false;
      try { tools = await discover(integration); ok = true; } catch { /* Store a generic error, never upstream text. */ }
      deps.store.finishCheck(integration.id, integration.revision, ok, tools);
    },
    async definitionsFor(grant) {
      try {
        if (closed) return [];
        active(grant);
        const grantPolicy = policy(grant);
        return deps.store.forProject(grant.projectId).flatMap((integration) => integration.tools.flatMap((tool) => {
          const name = nameOf(integration, tool.name);
          return grantPolicy.allows(name) ? [{ name, description: tool.description, inputSchema: tool.inputSchema }] : [];
        }));
      } catch { return []; }
    },
    async call(grant, name, args) {
      try {
        if (closed) return result("tool is not available");
        active(grant);
        const match = integrationToolPattern.exec(name);
        const integration = deps.store.forProject(grant.projectId).find((entry) => entry.name === match?.[2]);
        const tool = integration?.tools.find((entry) => nameOf(integration, entry.name) === name);
        const mode = policy(grant).mode(name);
        if (!integration || !tool || mode === "deny") return result("tool is not available");
        if (!object(args)) return result("invalid tool input");
        const json = JSON.stringify(args);
        if (Buffer.byteLength(json) > 16_384 || privateInput(json, grant)
          || (integration.kind !== "http-api" && /[A-Za-z]:[\\/]|(?:^|["\s])\/[^\s]/.test(json))) return result("invalid tool input");
        const count = counts.get(grant.attemptId) ?? 0;
        if (count >= 100) return result("integration tool call limit reached");
        if (!counts.has(grant.attemptId) && counts.size >= 10_000) counts.delete(counts.keys().next().value!);
        counts.set(grant.attemptId, count + 1);
        const operation = integration.kind === "http-api" ? integration.config.operations.find((entry) => entry.name === tool.name) : undefined;
        if (integration.kind === "http-api" && operation) requestParams(integration, operation, args);
        if (mode === "ask") {
          const waiting = deps.approve(grant, name, args, `${integration.id}:${integration.revision}`);
          if (waiting) return result(waiting);
        }
        if (integration.kind === "http-api" && operation) {
          const effect = await deps.http.submit({ projectId: grant.projectId, attemptId: grant.attemptId, caller: grant.attemptId,
            integration, operation, args, beforeSend: () => active(grant) });
          return effect.state === "done" ? result(truncateText(JSON.stringify(effect.output), 32_768), false) : result(effect.error ?? "HTTP request pending");
        }
        if (integration.kind === "mcp-http") return await mcpHttp(integration, (client) => client.callTool(tool.name, args, () => active(grant)));
        if (integration.kind === "mcp-stdio") return await stdio(integration, async (request, secrets) => {
          active(grant);
          const response = await request("tools/call", { name: tool.name, arguments: args });
          if (!object(response) || !Array.isArray(response.content)) return result("invalid MCP result");
          const text = (response.content as unknown[]).map((entry) => object(entry) && entry.type === "text" && typeof entry.text === "string"
            ? entry.text : "[non-text content omitted]").join("\n");
          return result(truncateText(scrub(text, secrets), 32_768), response.isError === true);
        });
        return result("tool is not available");
      } catch { return result("integration tool call failed"); }
    },
    status() {
      return deps.store.list().map((integration) => ({ name: integration.name,
        origin: integration.kind === "mcp-stdio" ? "stdio" : new URL(integration.kind === "mcp-http" ? integration.config.url : integration.config.baseUrl).origin,
        state: integration.status === "ready" ? "ready" : "unreachable", tools: integration.tools.length, lastCheckedAt: integration.lastCheckAt }));
    },
    close() {
      closed = true;
      for (const client of clients) client.close();
      for (const controller of stdioSessions) controller.abort();
    },
  };
}
