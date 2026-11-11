import { readFileSync } from "node:fs";
import { z } from "zod";

export const serverNamePattern = /^[a-z0-9][a-z0-9-]{1,29}$/;
export const remoteToolPattern = /^[A-Za-z0-9_-]{1,64}$/;
export const externalToolPattern = /^ext\.([a-z0-9][a-z0-9-]{1,29})\.([A-Za-z0-9_-]{1,64}|\*)$/;
const reserved = new Set(["host", "content-length", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "cookie", "set-cookie", "content-type", "accept",
  "mcp-session-id", "mcp-protocol-version", "expect", "origin", "referer", "forwarded"]);
export const validHeaderValue = (value: string): boolean => !/[\r\n\0]/.test(value);
const headerName = z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/).refine((name) =>
  !reserved.has(name.toLowerCase()) && !/^(?:proxy-|sec-|x-forwarded-)/i.test(name));
const headerValue = z.string().max(8192).refine(validHeaderValue).refine((value) =>
  !value.startsWith("env:") || /^env:[A-Za-z_][A-Za-z0-9_]*$/.test(value));
export const mcpServerSchema = z.strictObject({
  name: z.string().regex(serverNamePattern),
  url: z.string().max(8192).refine((value) => {
    try {
      const url = new URL(value);
      return validHeaderValue(value) && !url.username && !url.password && !url.hash
        && (url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)));
    } catch { return false; }
  }),
  headers: z.record(headerName, headerValue).refine((headers) => new Set(Object.keys(headers).map((key) => key.toLowerCase())).size === Object.keys(headers).length).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).default(15000),
  maxResultBytes: z.number().int().min(1024).max(65536).default(32768),
  maxTools: z.number().int().min(1).max(64).default(32),
});
export const mcpServersSchema = z.strictObject({ servers: z.array(mcpServerSchema).max(16)
  .refine((servers) => new Set(servers.map((server) => server.name)).size === servers.length) });
export type McpServerConfig = z.infer<typeof mcpServerSchema>;
export type McpServersConfig = z.infer<typeof mcpServersSchema>;
export function parseMcpServers(value: unknown): McpServersConfig {
  const parsed = mcpServersSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid external MCP configuration");
  return parsed.data;
}
export function loadMcpServers(path: string): McpServersConfig {
  try {
    const bytes = readFileSync(path);
    if (bytes.length > 1024 * 1024) throw new Error();
    return parseMcpServers(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown);
  } catch { throw new Error("Invalid external MCP configuration"); }
}
