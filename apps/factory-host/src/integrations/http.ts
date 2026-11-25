import { type Integration, type HttpOperation } from "@factory/contracts";
import { matchesSchema } from "../flow/expressions.js";
import { object, type IntegrationStore } from "./store.js";

export type HttpIntegration = Extract<Integration, { kind: "http-api" }>;
export function scrub(text: string, secrets: readonly string[]): string {
  const values = new Set(secrets.flatMap((value) => [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value), Buffer.from(value).toString("base64")]));
  const candidates = [...values].filter(Boolean).sort((first, second) => second.length - first.length);
  if (candidates.length) text = text.replace(new RegExp(candidates.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g"), "[redacted]");
  return text.replace(/fpx_[A-Za-z0-9_-]+|\bsk-[A-Za-z0-9_-]+/g, "[redacted]");
}
export function requestParams(integration: HttpIntegration, op: HttpOperation, args: unknown) {
  if (!object(args) || !matchesSchema(args, op.inputSchema) || Buffer.byteLength(JSON.stringify(args)) > 64 * 1024) throw new Error("Invalid HTTP operation arguments");
  const used = new Set<string>();
  const path = op.path.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_whole, key: string) => {
    const value = Object.hasOwn(args, key) ? args[key] : undefined;
    if (!["string", "number", "boolean"].includes(typeof value) || value === "." || value === "..") throw new Error("Invalid HTTP path parameter");
    used.add(key);
    return encodeURIComponent(String(value));
  });
  const base = new URL(integration.config.baseUrl);
  const url = new URL(`${base.origin}${base.pathname.replace(/\/$/, "")}${path}`);
  if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname.replace(/\/$/, "")}/`)) throw new Error("Invalid HTTP operation path");
  const rest = Object.entries(args).filter(([key]) => !used.has(key));
  const safe = op.method === "GET" || op.method === "HEAD";
  if (safe) for (const [key, value] of rest) url.searchParams.append(key, typeof value === "string" ? value : JSON.stringify(value));
  return { url, method: op.method, body: safe || !rest.length ? undefined : JSON.stringify(Object.fromEntries(rest)) };
}
export function authHeaders(store: IntegrationStore, integration: HttpIntegration) {
  const headers = new Headers();
  const { auth } = integration.config;
  const secrets: string[] = [];
  if (auth !== "none") {
    const value = store.read("bearer" in auth ? auth.bearer : auth.credential, integration.scopeGroupId);
    secrets.push(value);
    headers.set("bearer" in auth ? "authorization" : auth.header, "bearer" in auth ? `Bearer ${value}` : value);
  }
  return { headers, secrets };
}
export async function responseBody(response: Response, secrets: string[]): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const limit = 64 * 1024;
  const chunks: Buffer[] = [];
  let size = 0; let complete = true;
  const guard = Math.max(0, ...secrets.map((secret) => Buffer.byteLength(secret) * 6));
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const part = Buffer.from(next.value.subarray(0, Math.max(0, limit + guard - size)));
      size += part.length; chunks.push(part);
      if (part.length < next.value.length || size > limit + guard - 1) { complete = false; break; }
    }
  } finally { await reader.cancel().catch(() => {}); }
  const clean = scrub(Buffer.concat(chunks).toString("utf8"), secrets);
  const bounded = Buffer.from(clean).subarray(0, complete ? limit : Math.min(limit, Math.max(0, size - guard))).toString("utf8").replace(/\uFFFD$/, "");
  if (complete && Buffer.byteLength(clean) <= limit) try {
    const redact = (value: unknown): unknown => typeof value === "string" ? scrub(value, secrets) : Array.isArray(value) ? value.map(redact)
      : object(value) ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [scrub(key, secrets), redact(entry)])) : value;
    const parsed = redact(JSON.parse(bounded));
    if (Buffer.byteLength(JSON.stringify(parsed)) <= limit) return parsed;
  } catch { /* Not JSON. */ }
  let bytes = 2; let end = 0;
  for (const char of bounded) {
    bytes += Buffer.byteLength(JSON.stringify(char)) - 2;
    if (bytes > limit) break;
    end += char.length;
  }
  return bounded.slice(0, end);
}
