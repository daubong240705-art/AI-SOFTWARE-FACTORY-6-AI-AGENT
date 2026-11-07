import { z } from "zod";
import type { TokenGrant } from "../proxy/tokens.js";
import { createMcpTools, toolDefinitions, type McpDeps } from "./tools.js";

export interface RpcResponse { status: number; body?: unknown }
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const meta = z.record(z.string(), z.unknown()).optional();
const initialize = z.strictObject({ protocolVersion: z.string(), capabilities: z.record(z.string(), z.unknown()),
  clientInfo: z.object({ name: z.string(), version: z.string() }), _meta: meta });
const empty = z.strictObject({ _meta: meta });
const call = z.strictObject({ name: z.string(), arguments: z.record(z.string(), z.unknown()).optional(), _meta: meta });
const versions = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const messages: Record<number, string> = { [-32700]: "Parse error", [-32600]: "Invalid Request",
  [-32601]: "Method not found", [-32602]: "Invalid params", [-32603]: "Internal error" };
export function rpcError(code: number, id: string | number | null = null): RpcResponse {
  if (typeof id === "string" && Buffer.byteLength(JSON.stringify(id)) > 65000) id = null;
  return { status: 200, body: { jsonrpc: "2.0", id, error: { code, message: messages[code] ?? "Internal error" } } };
}

export function createMcpHandler(deps: McpDeps, version = "0.1.0", options: { maxProgressPerAttempt?: number } = {}): {
  handle(grant: TokenGrant, body: unknown): RpcResponse;
} {
  const tools = createMcpTools(deps, options);
  return { handle(grant, input) {
    let body: unknown = input;
    if (typeof input === "string" || Buffer.isBuffer(input)) {
      try { body = JSON.parse(typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input)) as unknown; }
      catch { return rpcError(-32700); }
    }
    if (!object(body)) return rpcError(-32600);
    const hasId = Object.hasOwn(body, "id");
    const validId = typeof body.id === "string" || (typeof body.id === "number" && Number.isSafeInteger(body.id));
    const id = validId ? body.id as string | number : null;
    if (body.jsonrpc !== "2.0" || typeof body.method !== "string" || (hasId && !validId)
      || Object.keys(body).some((key) => !["jsonrpc", "id", "method", "params"].includes(key))) return rpcError(-32600, id);
    const error = (code: number): RpcResponse => hasId ? rpcError(code, id) : { status: 202 };
    try {
      let result: unknown;
      const params = body.params === undefined ? {} : body.params;
      switch (body.method) {
        case "initialize": {
          const parsed = initialize.safeParse(params);
          if (!parsed.success) return error(-32602);
          result = { protocolVersion: versions.includes(parsed.data.protocolVersion) ? parsed.data.protocolVersion : "2025-06-18",
            capabilities: { tools: {} }, serverInfo: { name: "factory-host", version } };
          break;
        }
        case "ping":
        case "tools/list":
          if (!empty.safeParse(params).success) return error(-32602);
          result = body.method === "ping" ? {} : { tools: toolDefinitions };
          break;
        case "tools/call": {
          const parsed = call.safeParse(params);
          if (!parsed.success) return error(-32602);
          result = tools.call(grant, parsed.data.name, parsed.data.arguments ?? {});
          break;
        }
        default: return error(-32601);
      }
      if (!hasId) return { status: 202 };
      const response = { jsonrpc: "2.0", id, result };
      if (Buffer.byteLength(JSON.stringify(response)) > 65536) return rpcError(-32603);
      return { status: 200, body: response };
    } catch { return error(-32603); }
  } };
}
