import { ModelError } from "./gateway.js";

export interface Upstream {
  readonly providerId: string;
  chatCompletions(body: string, signal: AbortSignal): Promise<Response>;
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
}): Upstream {
  const { apiKey, providerId = "9router", fetchImpl = fetch, connectTimeoutMs = 30_000 } = options;
  if (typeof apiKey !== "string" || !apiKey || /[\s\p{Cc}]/u.test(apiKey)
    || typeof providerId !== "string" || providerId.includes(apiKey)
    || !Number.isSafeInteger(connectTimeoutMs) || connectTimeoutMs < 1 || connectTimeoutMs > 2_147_483_647)
    throw new ModelError("config");
  let base: URL;
  try { base = new URL(options.baseUrl); } catch { throw new ModelError("config"); }
  if ((base.protocol !== "https:" && !(base.protocol === "http:"
    && ["127.0.0.1", "[::1]", "localhost"].includes(base.hostname)))
    || base.username || base.password || base.search || base.hash) throw new ModelError("config");
  const endpoint = `${base.href.replace(/\/+$/, "")}/chat/completions`;
  const upstream: Upstream = {
    providerId,
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
