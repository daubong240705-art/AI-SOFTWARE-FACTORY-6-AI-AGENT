import { API_VERSION } from "@factory/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiGuards } from "../api/server.js";
import { failure } from "../api/http.js";
import { createIdGenerator } from "../ids.js";
import type { ExtractionService } from "./service.js";
import { textWindow } from "./records.js";

const paramsSchema = z.strictObject({ projectId: z.uuid(), artifactId: z.uuid(), version: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER) });
const number = (value: unknown, fallback: number): unknown => value === undefined ? fallback
  : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
const path = "/projects/:projectId/knowledge/artifacts/:artifactId/versions/:version/extraction";
export function registerExtractionRoutes(app: FastifyInstance, guards: ApiGuards, service: ExtractionService): void {
  const newId = createIdGenerator();
  app.get<{ Params: Record<string, string> }>(path, { preHandler: guards.session }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    const row = parsed.success ? service.get(parsed.data.projectId, parsed.data.artifactId, parsed.data.version) : null;
    if (!row) return failure(reply, 404, "not-found", "Extraction not found.", "correct-input", newId);
    return { apiVersion: API_VERSION, ok: true, extraction: row };
  });
  app.get<{ Params: Record<string, string>; Querystring: Record<string, unknown> }>(`${path}/text`, { preHandler: guards.session }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params); const query = request.query;
    const bounds = z.strictObject({ from: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), limit: z.number().int().min(1).max(20000) })
      .safeParse({ from: number(query.from, 0), limit: number(query.limit, 6000), ...Object.fromEntries(Object.entries(query).filter(([key]) => !["from", "limit"].includes(key))) });
    if (!bounds.success) return failure(reply, 400, "validation", "Invalid text bounds.", "correct-input", newId);
    const row = parsed.success ? service.get(parsed.data.projectId, parsed.data.artifactId, parsed.data.version) : null;
    if (!row) return failure(reply, 404, "not-found", "Extraction not found.", "correct-input", newId);
    if (row.status !== "done") return failure(reply, 409, "conflict", "Document text is not ready.", "wait", newId);
    const text = parsed.success ? service.text(parsed.data.projectId, parsed.data.artifactId, parsed.data.version) : null;
    if (text === null) return failure(reply, 404, "not-found", "Document text not found.", "correct-input", newId);
    return { apiVersion: API_VERSION, ok: true, ...textWindow(text, bounds.data.from, bounds.data.limit) };
  });
  app.post<{ Params: Record<string, string> }>(`${path}/retry`, { onRequest: guards.write }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    const row = parsed.success ? service.get(parsed.data.projectId, parsed.data.artifactId, parsed.data.version) : null;
    if (!row) return failure(reply, 404, "not-found", "Extraction not found.", "correct-input", newId);
    if (!parsed.success || !service.retry(parsed.data.projectId, parsed.data.artifactId, parsed.data.version))
      return failure(reply, 409, "conflict", "Extraction cannot be retried.", "correct-input", newId);
    return reply.code(202).send({ apiVersion: API_VERSION, ok: true });
  });
}
