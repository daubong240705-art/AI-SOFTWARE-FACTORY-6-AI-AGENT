import { reasoningEffortSchema, usageSchema, type Usage } from "@factory/contracts";
import { z } from "zod";

export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export interface ModelRequest {
  model: string; effort: ReasoningEffort | null; system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxOutputTokens: number; timeoutMs?: number; signal?: AbortSignal;
}
export interface ModelResult {
  text: string; usage: Usage | null; provider: string; model: string; finishReason: string | null;
}
export type ModelErrorKind = "auth" | "rate-limit" | "timeout" | "unavailable" | "bad-response" | "cancelled" | "config";

export class ModelError extends Error {
  constructor(readonly kind: ModelErrorKind, status?: number) {
    super(status === undefined ? kind : `${kind} ${status}`);
    this.name = "ModelError";
  }
}

export interface ModelGateway {
  readonly providerId: string;
  complete(request: ModelRequest): Promise<ModelResult>;
}

const timeoutSchema = z.number().int().min(1).max(2_147_483_647);
const requestSchema = z.object({
  model: z.string().refine((model) => model.trim().length > 0),
  effort: reasoningEffortSchema.nullable(), system: z.string(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })),
  maxOutputTokens: z.number().int().min(1).max(32_768), timeoutMs: timeoutSchema.optional(),
});
const tokens = usageSchema.shape.inputTokens;
const responseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() }), finish_reason: z.string().nullable().optional(),
  })).min(1),
  usage: z.object({
    prompt_tokens: tokens.optional(), completion_tokens: tokens.optional(),
    prompt_tokens_details: z.object({ cached_tokens: tokens.optional() }).optional(),
    completion_tokens_details: z.object({ reasoning_tokens: tokens.optional() }).optional(),
  }).nullable().optional(),
});

async function readBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) throw new ModelError("bad-response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new ModelError("bad-response");
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)); }
  catch { throw new ModelError("bad-response"); }
}

export function createChatCompletionsGateway(options: {
  baseUrl: string; apiKey: string; providerId?: string; fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number; maxResponseBytes?: number;
}): ModelGateway {
  // Credentials remain in the closure, never on the inspectable gateway or an error.
  const { apiKey, providerId = "9router", fetchImpl = fetch,
    defaultTimeoutMs = 120_000, maxResponseBytes = 1_048_576 } = options;
  if (typeof apiKey !== "string" || apiKey.length === 0 || /[\s\p{Cc}]/u.test(apiKey)
    || typeof providerId !== "string" || providerId.includes(apiKey)
    || !timeoutSchema.safeParse(defaultTimeoutMs).success
    || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1)
    throw new ModelError("config");
  let base: URL;
  try { base = new URL(options.baseUrl); }
  catch { throw new ModelError("config"); }
  if ((base.protocol !== "https:" && !(base.protocol === "http:"
    && ["127.0.0.1", "[::1]", "localhost"].includes(base.hostname)))
    || base.username || base.password || base.search || base.hash)
    throw new ModelError("config");
  const endpoint = `${base.href.replace(/\/+$/, "")}/chat/completions`;

  return {
    providerId,
    async complete(request) {
      const parsed = requestSchema.safeParse(request);
      if (!parsed.success) throw new ModelError("config");
      const input = parsed.data;
      if (input.model.includes(apiKey)
        || input.system.length + input.messages.reduce((sum, message) => sum + message.content.length, 0) > 2_000_000)
        throw new ModelError("config");
      if (request.signal?.aborted) throw new ModelError("cancelled");
      const controller = new AbortController();
      let abortKind: "cancelled" | "timeout" | undefined;
      const abort = (kind: "cancelled" | "timeout"): void => {
        if (controller.signal.aborted) return;
        abortKind = kind;
        controller.abort();
      };
      const onAbort = (): void => abort("cancelled");
      request.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => abort("timeout"), input.timeoutMs ?? defaultTimeoutMs);
      try {
        let response: Response;
        try {
          response = await fetchImpl(endpoint, {
            method: "POST", redirect: "manual", signal: controller.signal,
            headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model: input.model,
              messages: [{ role: "system", content: input.system }, ...input.messages],
              max_tokens: input.maxOutputTokens, stream: false,
              ...(input.effort ? { reasoning_effort: input.effort } : {}),
            }),
          });
        } catch { throw new ModelError(abortKind ?? "unavailable"); }
        if (abortKind) throw new ModelError(abortKind);
        if (!response.ok) throw new ModelError(response.status === 401 || response.status === 403 ? "auth"
          : response.status === 429 ? "rate-limit" : "unavailable", response.status);
        let body: string;
        try { body = await readBody(response, maxResponseBytes); }
        catch (error) {
          throw new ModelError(abortKind ?? (error instanceof ModelError ? "bad-response" : "unavailable"));
        }
        if (abortKind) throw new ModelError(abortKind);
        // Neither parser errors nor upstream data are allowed onto the error object.
        try {
          const data = responseSchema.parse(JSON.parse(body));
          const choice = data.choices[0];
          if (!choice) throw new ModelError("bad-response");
          const reported = data.usage;
          let usage: Usage | null = null;
          if (reported && (reported.prompt_tokens !== undefined || reported.completion_tokens !== undefined
            || reported.prompt_tokens_details?.cached_tokens !== undefined
            || reported.completion_tokens_details?.reasoning_tokens !== undefined)) {
            usage = usageSchema.parse({ inputTokens: reported.prompt_tokens,
              cachedInputTokens: reported.prompt_tokens_details?.cached_tokens ?? 0,
              outputTokens: reported.completion_tokens,
              reasoningOutputTokens: reported.completion_tokens_details?.reasoning_tokens ?? 0,
            });
          }
          const finishReason = choice.finish_reason ?? null;
          if (choice.message.content.includes(apiKey) || finishReason?.includes(apiKey))
            throw new ModelError("bad-response");
          return { text: choice.message.content, usage, provider: providerId, model: input.model, finishReason };
        } catch { throw new ModelError("bad-response"); }
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
        controller.abort();
      }
    },
  };
}
