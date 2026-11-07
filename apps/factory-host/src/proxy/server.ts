import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { Database } from "better-sqlite3";
import { reasoningEffortSchema, usageSchema, type Usage } from "@factory/contracts";
import { z } from "zod";
import type { Clock } from "../ids.js";
import { ModelError } from "../models/gateway.js";
import { createResponseGuard, type Upstream } from "../models/upstream.js";
import { checkAndReserve, recordUsage, type BudgetConfig } from "../policy/budget.js";
import type { TokenGrant, TokenRegistry } from "./tokens.js";

const toolCall = z.object({ id: z.string(), type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }) });
const tool = z.object({ type: z.literal("function"), function: z.object({ name: z.string(),
  description: z.string().optional(), parameters: z.record(z.string(), z.unknown()).optional(), strict: z.boolean().optional() }) });
const requestSchema = z.object({
  model: z.string(), messages: z.array(z.object({ role: z.enum(["system", "user", "assistant", "tool"]),
    // OpenAI sends null/absent content on assistant messages that only carry tool calls.
    content: z.union([z.string(), z.array(z.object({ type: z.literal("text"), text: z.string() }))]).nullable().optional(),
    tool_calls: z.array(toolCall).optional(), tool_call_id: z.string().optional(), name: z.string().optional() })).min(1),
  max_tokens: z.number().int().positive().safe().optional(), max_completion_tokens: z.number().int().positive().safe().optional(),
  temperature: z.number().min(0).max(2).optional(), top_p: z.number().min(0).max(1).optional(),
  stop: z.union([z.string(), z.array(z.string()).max(4)]).optional(), tools: z.array(tool).optional(),
  tool_choice: z.union([z.enum(["none", "auto", "required"]),
    z.object({ type: z.literal("function"), function: z.object({ name: z.string() }) })]).optional(),
  parallel_tool_calls: z.boolean().optional(), reasoning_effort: reasoningEffortSchema.optional(),
  stream: z.boolean().optional(), stream_options: z.unknown().optional(), n: z.literal(1).optional(),
  seed: z.number().int().safe().optional(), presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
});
const count = usageSchema.shape.inputTokens;
const reportedSchema = z.object({ usage: z.object({ prompt_tokens: count.optional(), completion_tokens: count.optional(),
  prompt_tokens_details: z.object({ cached_tokens: count.optional() }).optional(),
  completion_tokens_details: z.object({ reasoning_tokens: count.optional() }).optional() }).nullable().optional() });

function extractUsage(value: unknown): Usage | null {
  const parsed = reportedSchema.safeParse(value);
  const usage = parsed.success ? parsed.data.usage : null;
  if (!usage || Object.keys(usage).length === 0) return null;
  const mapped = usageSchema.safeParse({ inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens,
    cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    reasoningOutputTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0 });
  return mapped.success ? mapped.data : null;
}
function security(reply: FastifyReply): void {
  reply.header("cache-control", "no-store").header("x-content-type-options", "nosniff");
}
function failure(reply: FastifyReply, status: number, code: string): FastifyReply {
  security(reply);
  return reply.code(status).send({ error: { message: status === 401 ? "Authentication required." : "Request could not be completed.",
    type: status >= 500 ? "server_error" : "invalid_request_error", code } });
}

export function createModelProxy(options: {
  upstream: Upstream; tokens: TokenRegistry; raw: Database; budget: BudgetConfig; clock: Clock; newId: () => string;
  approvedModels?: never; maxBodyBytes?: number; maxOutputTokens?: number; maxConcurrentPerAttempt?: number;
  maxRequestsPerAttempt?: number; requestTimeoutMs?: number; allowedHosts: string[];
  maxResponseBytes?: number; onError?: (error: Error) => void;
}): { app: FastifyInstance; close(): Promise<void>; inflight(): number } {
  const { upstream, tokens, raw, budget, clock, newId, maxBodyBytes = 4_194_304, maxOutputTokens = 32_768,
    maxConcurrentPerAttempt = 4, maxRequestsPerAttempt = 2_000, requestTimeoutMs = 600_000,
    maxResponseBytes = 8 * 1_048_576 } = options;
  for (const value of [maxBodyBytes, maxOutputTokens, maxConcurrentPerAttempt, maxRequestsPerAttempt, requestTimeoutMs, maxResponseBytes]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw new Error("Invalid proxy configuration");
  }
  const hosts = options.allowedHosts;
  const grants = new WeakMap<FastifyRequest, { grant: TokenGrant; token: string }>();
  const active = new Map<AbortController, { projectId: string; attemptId: string; estimate: number }>();
  const totals = new Map<string, number>();
  let closing = false;
  let closePromise: Promise<void> | undefined;
  const authenticate = (request: FastifyRequest, reply: FastifyReply): FastifyReply | undefined => {
    security(reply);
    if (typeof request.headers.host !== "string" || !hosts.includes(request.headers.host)) return failure(reply, 403, "forbidden");
    const header = request.headers.authorization;
    const token = typeof header === "string" && /^Bearer fpx_[A-Za-z0-9_-]{43}$/.test(header) ? header.slice(7) : "";
    const grant = tokens.resolve(token);
    if (!grant) return failure(reply, 401, "invalid_api_key");
    grants.set(request, { grant, token });
    if (closing) return failure(reply, 503, "unavailable");
    return undefined;
  };
  const app = Fastify({ logger: false, trustProxy: false, exposeHeadRoutes: false, bodyLimit: maxBodyBytes,
    frameworkErrors(_error, request, reply) { authenticate(request, reply) ?? failure(reply, 400, "invalid_request"); } });
  app.addHook("onRequest", async (request, reply) => {
    const rejected = authenticate(request, reply);
    if (rejected) return rejected;
    if (request.method === "POST" && !/^application\/json(?:\s*;\s*charset\s*=\s*(?:[A-Za-z0-9._-]+|"[A-Za-z0-9._-]+"))?$/i
      .test(request.headers["content-type"] ?? "")) return failure(reply, 415, "invalid_request");
    return undefined;
  });
  app.addHook("onSend", async (_request, reply, payload) => { security(reply); return payload; });
  app.setErrorHandler((error, _request, reply) => {
    const code = error !== null && typeof error === "object" && "code" in error ? error.code : "";
    return failure(reply, code === "FST_ERR_CTP_BODY_TOO_LARGE" ? 413 : 400, "invalid_request");
  });
  app.setNotFoundHandler((_request, reply) => failure(reply, 404, "not_found"));
  app.get("/v1/models", async (request, reply) => {
    const access = grants.get(request);
    if (!access || tokens.resolve(access.token) !== access.grant) return failure(reply, 401, "invalid_api_key");
    const list = { object: "list", data: access.grant.allowedModels.map((id) => ({ id, object: "model", created: 0, owned_by: "host" })) };
    if (createResponseGuard(upstream, access.token).push(Buffer.from(JSON.stringify(list))) === null)
      return failure(reply, 502, "upstream_invalid");
    return list;
  });
  app.post("/v1/chat/completions", async (request, reply) => {
    const access = grants.get(request);
    // Authentication may precede a slow upload; stop/expiry must win before spending.
    if (!access || tokens.resolve(access.token) !== access.grant) return failure(reply, 401, "invalid_api_key");
    const { grant, token } = access;
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, "invalid_request");
    const { stream_options: _ignored, ...body } = parsed.data;
    if (!grant.allowedModels.includes(body.model)) return failure(reply, 403, "model_not_allowed");
    const pending = [...active.values()];
    if (pending.filter((item) => item.attemptId === grant.attemptId).length >= maxConcurrentPerAttempt
      || (totals.get(grant.attemptId) ?? 0) >= maxRequestsPerAttempt) return failure(reply, 429, "too_many_requests");
    if (body.max_completion_tokens !== undefined) body.max_completion_tokens = Math.min(body.max_completion_tokens, maxOutputTokens);
    if (body.max_tokens !== undefined) body.max_tokens = Math.min(body.max_tokens, maxOutputTokens);
    if (body.max_tokens === undefined && body.max_completion_tokens === undefined) body.max_tokens = maxOutputTokens;
    const output = Math.max(body.max_tokens ?? 0, body.max_completion_tokens ?? 0);
    const forwarded = { ...body, ...(body.stream ? { stream_options: { include_usage: true } } : {}) };
    const estimate = Math.ceil((JSON.stringify(body.messages).length + (body.tools ? JSON.stringify(body.tools).length : 0)) / 3) + output;
    const reserved = pending.reduce((sum, item) => sum + (item.projectId === grant.projectId ? item.estimate : 0), 0);
    if (!checkAndReserve(raw, { projectId: grant.projectId, taskId: grant.taskId, now: clock(),
      estimateTokens: estimate + reserved, config: budget }).ok) return failure(reply, 429, "budget_exceeded");
    const controller = new AbortController();
    active.set(controller, { projectId: grant.projectId, attemptId: grant.attemptId, estimate });
    totals.set(grant.attemptId, (totals.get(grant.attemptId) ?? 0) + 1);
    let timedOut = false;
    let usage: Usage | null = null;
    let streaming = false;
    let rejectedUpstream = false;
    const abort = (): void => { controller.abort(); };
    const timer = setTimeout(() => { timedOut = true; abort(); }, requestTimeoutMs);
    const unsubscribe = tokens.onRevoke(grant.attemptId, abort);
    request.raw.once("aborted", abort);
    const disconnected = (): void => { if (!reply.raw.writableFinished) abort(); };
    reply.raw.once("close", disconnected);
    const ended = new Promise<void>((resolve) => {
      reply.raw.once("finish", resolve); reply.raw.once("close", resolve);
    });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const guard = createResponseGuard(upstream, token);
    try {
      const response = await upstream.chatCompletions(JSON.stringify(forwarded), controller.signal);
      if (controller.signal.aborted) throw new ModelError("cancelled");
      if (!response.ok) {
        // A definitive HTTP rejection generated nothing: charging the estimate would let a retry loop drain the budget.
        rejectedUpstream = true;
        void response.body?.cancel().catch(() => {});
        return failure(reply, response.status === 429 ? 429 : 502, response.status === 401 || response.status === 403
          ? "upstream_auth" : response.status === 429 ? "upstream_rate_limited" : "upstream_unavailable");
      }
      if (!response.body) throw new ModelError("bad-response");
      reader = response.body.getReader();
      if (body.stream) {
        if (!/^text\/event-stream(?:;|$)/i.test(response.headers.get("content-type") ?? "")) throw new ModelError("bad-response");
        reply.hijack(); streaming = true;
        reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", "x-content-type-options": "nosniff" });
        reply.raw.flushHeaders();
        let line = Buffer.alloc(0);
        const scan = (bytes: Buffer): void => {
          let offset = 0;
          while (offset < bytes.length) {
            const newline = bytes.indexOf(10, offset);
            const end = newline < 0 ? bytes.length : newline;
            if (line.length + end - offset > 1_048_576) throw new ModelError("bad-response");
            line = Buffer.concat([line, bytes.subarray(offset, end)]);
            if (newline < 0) break;
            const text = line.toString("utf8").replace(/\r$/, "");
            if (text.startsWith("data:")) {
              try { usage = extractUsage(JSON.parse(text.slice(5).trim())) ?? usage; } catch { /* Includes [DONE]. */ }
            }
            line = Buffer.alloc(0); offset = newline + 1;
          }
        };
        const write = async (bytes: Buffer): Promise<void> => {
          if (!bytes.length || controller.signal.aborted) return;
          if (!reply.raw.write(bytes)) await new Promise<void>((resolve) => {
            const done = (): void => { reply.raw.off("drain", done); controller.signal.removeEventListener("abort", done); resolve(); };
            reply.raw.once("drain", done); controller.signal.addEventListener("abort", done, { once: true });
            if (controller.signal.aborted) done();
          });
        };
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) { const tail = guard.finish(); scan(tail); scan(Buffer.from("\n")); await write(tail); break; }
          const safe = guard.push(chunk.value);
          if (safe === null) { abort(); break; }
          scan(safe); await write(safe);
        }
        reply.raw.end();
      } else {
        const chunks: Buffer[] = [];
        let size = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maxResponseBytes) throw new ModelError("bad-response");
          const safe = guard.push(chunk.value);
          if (safe === null) throw new ModelError("bad-response");
          chunks.push(safe);
        }
        chunks.push(guard.finish());
        let text: string;
        let json: unknown;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); json = JSON.parse(text) as unknown;
        } catch { throw new ModelError("bad-response"); }
        if (json === null || typeof json !== "object" || Array.isArray(json)) throw new ModelError("bad-response");
        usage = extractUsage(json);
        reply.type("application/json").send(text);
      }
    } catch (error) {
      if (streaming) reply.raw.end();
      else if (!reply.raw.destroyed) failure(reply, timedOut || (error instanceof ModelError && error.kind === "timeout") ? 504 : 502,
        timedOut || (error instanceof ModelError && error.kind === "timeout") ? "upstream_timeout"
          : error instanceof ModelError && error.kind === "bad-response" ? "upstream_invalid" : "upstream_unavailable");
    } finally {
      controller.abort();
      void reader?.cancel().catch(() => {});
      if (!reply.raw.writableFinished && !reply.raw.destroyed) await ended;
      try {
        if (!rejectedUpstream) recordUsage(raw, { id: newId(), projectId: grant.projectId, taskId: grant.taskId, attemptId: grant.attemptId,
          conversationId: null, provider: upstream.providerId, model: body.model, effort: body.reasoning_effort ?? null,
          usage, estimatedTokens: usage === null ? estimate : null, recordedAt: clock().toISOString() });
      } catch { try { options.onError?.(new Error("Model usage recording failed")); } catch { /* Observer only. */ } }
      clearTimeout(timer); unsubscribe();
      request.raw.off("aborted", abort); reply.raw.off("close", disconnected);
      active.delete(controller);
    }
    return reply;
  });
  return { app, inflight: () => active.size, close() {
    closePromise ??= (async () => {
      closing = true;
      for (const controller of active.keys()) controller.abort();
      await app.close();
      totals.clear();
    })();
    return closePromise;
  } };
}
