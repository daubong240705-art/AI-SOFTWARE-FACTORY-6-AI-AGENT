import { ModelError } from "./gateway.js";

/** What the operator's model picker may show about a gateway model. Only plain, bounded, secret-free values are kept. */
export interface ModelInfo { id: string; name?: string; provider?: string; vision?: boolean; reasoning?: boolean }
const plain = (value: unknown, apiKey: string): string | undefined =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 120 && !/\p{Cc}/u.test(value) && !value.includes(apiKey) ? value.trim() : undefined;
const flag = (...values: unknown[]): boolean | undefined => values.find((value): value is boolean => typeof value === "boolean");
const hasImage = (value: unknown): boolean | undefined => Array.isArray(value) ? value.some((entry) => entry === "image" || entry === "vision") : undefined;
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? value as Record<string, unknown> : {});
function modelInfo(item: Record<string, unknown>, apiKey: string): ModelInfo {
  const capabilities = record(item.capabilities);
  const name = plain(item.name ?? item.display_name ?? item.displayName, apiKey);
  const provider = plain(item.owned_by ?? item.provider, apiKey);
  const vision = flag(item.vision, item.supports_vision, capabilities.vision, hasImage(item.input_modalities), hasImage(item.modalities));
  const reasoning = flag(item.reasoning, item.thinking, item.supports_reasoning, capabilities.reasoning, capabilities.thinking);
  return { id: item.id as string, ...(name === undefined ? {} : { name }), ...(provider === undefined ? {} : { provider }),
    ...(vision === undefined ? {} : { vision }), ...(reasoning === undefined ? {} : { reasoning }) };
}

export interface Upstream {
  readonly providerId: string;
  chatCompletions(body: string, signal: AbortSignal): Promise<Response>;
  listModels(): Promise<ModelInfo[] | null>;
}

export interface ResponseGuard {
  /** null means a secret was found; a suffix is retained across chunk boundaries. */
  push(chunk: Uint8Array): Buffer | null;
  finish(): Buffer;
}
const guards = new WeakMap<Upstream, (token: string) => ResponseGuard>();

function guardFor(secrets: string[]): ResponseGuard {
  const needles = secrets.map((secret) => Buffer.from(secret));
  let pending = Buffer.alloc(0);
  return {
    push(chunk) {
      const bytes = Buffer.concat([pending, chunk]);
      if (needles.some((needle) => bytes.includes(needle))) { pending = Buffer.alloc(0); return null; }
      let retain = 0;
      for (const needle of needles) {
        for (let size = Math.min(needle.length - 1, bytes.length); size > retain; size--) {
          if (bytes.subarray(bytes.length - size).equals(needle.subarray(0, size))) { retain = size; break; }
        }
      }
      pending = Buffer.from(bytes.subarray(bytes.length - retain));
      return bytes.subarray(0, bytes.length - retain);
    },
    finish() { const remaining = pending; pending = Buffer.alloc(0); return remaining; },
  };
}

/** The proxy can detect leaks without retrieving the upstream credential. */
export function createResponseGuard(upstream: Upstream, token: string): ResponseGuard {
  return guards.get(upstream)?.(token) ?? guardFor([token]);
}

export function createUpstream(options: {
  baseUrl: string; apiKey: string; providerId?: string; fetchImpl?: typeof fetch; connectTimeoutMs?: number;
  modelListTimeoutMs?: number;
}): Upstream {
  const { apiKey, providerId = "9router", fetchImpl = fetch, connectTimeoutMs = 30_000, modelListTimeoutMs = 10_000 } = options;
  if (typeof apiKey !== "string" || !apiKey || /[\s\p{Cc}]/u.test(apiKey)
    || typeof providerId !== "string" || providerId.includes(apiKey)
    || !Number.isSafeInteger(connectTimeoutMs) || connectTimeoutMs < 1 || connectTimeoutMs > 2_147_483_647
    || !Number.isSafeInteger(modelListTimeoutMs) || modelListTimeoutMs < 1 || modelListTimeoutMs > 10_000)
    throw new ModelError("config");
  let base: URL;
  try { base = new URL(options.baseUrl); } catch { throw new ModelError("config"); }
  if ((base.protocol !== "https:" && !(base.protocol === "http:"
    && ["127.0.0.1", "[::1]", "localhost"].includes(base.hostname)))
    || base.username || base.password || base.search || base.hash) throw new ModelError("config");
  const endpoint = `${base.href.replace(/\/+$/, "")}/chat/completions`;
  const upstream: Upstream = {
    providerId,
    async listModels() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), modelListTimeoutMs);
      try {
        const response = await fetchImpl(`${base.href.replace(/\/+$/, "")}/models`, {
          method: "GET", redirect: "manual", signal: controller.signal,
          headers: { authorization: `Bearer ${apiKey}` },
        });
        if (!response.ok || !response.body) { void response.body?.cancel().catch(() => {}); return null; }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 1_048_576) { void reader.cancel().catch(() => {}); return null; }
            chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
        const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)));
        if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray(body.data)) return null;
        const models: ModelInfo[] = [];
        for (const item of body.data) {
          if (!item || typeof item !== "object" || typeof item.id !== "string" || item.id.length === 0 || item.id.length > 256
            || /[\s\p{Cc}]/u.test(item.id) || item.id.includes(apiKey) || models.some((model) => model.id === item.id)) continue;
          models.push(modelInfo(item as Record<string, unknown>, apiKey));
          if (models.length === 500) break;
        }
        return controller.signal.aborted ? null : models;
      } catch { return null; }
      finally { clearTimeout(timer); controller.abort(); }
    },
    async chatCompletions(body, signal) {
      if (signal.aborted) throw new ModelError("cancelled");
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), connectTimeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST", redirect: "manual", signal: AbortSignal.any([signal, timeout.signal]),
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body,
        });
        if (response.status >= 300 && response.status < 400) {
          void response.body?.cancel().catch(() => {});
          throw new ModelError("unavailable");
        }
        return response;
      } catch {
        throw new ModelError(signal.aborted ? "cancelled" : timeout.signal.aborted ? "timeout" : "unavailable");
      } finally { clearTimeout(timer); }
    },
  };
  guards.set(upstream, (token) => guardFor([apiKey, token]));
  return upstream;
}
