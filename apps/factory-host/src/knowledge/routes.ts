import { API_VERSION, artifactKindSchema, artifactStatusSchema } from "@factory/contracts";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import { z } from "zod";
import type { ApiGuards } from "../api/server.js";
import { failure } from "../api/http.js";
import { createIdGenerator } from "../ids.js";
import { sanitizeAgentText } from "../mcp/security.js";
import { getKnowledgeArtifact, listKnowledgeArtifacts, type KnowledgeIndex } from "./index.js";
import { listStale } from "./lifecycle.js";

function parseQuery(query: Record<string, unknown>, search: boolean) {
  const list = (value: unknown): unknown => value === undefined ? undefined
    : (Array.isArray(value) ? value : [value]).flatMap((part: unknown) => typeof part === "string" ? part.split(",") : [part]);
  const integer = (value: unknown, fallback: number): unknown => value === undefined ? fallback
    : typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : NaN;
  return z.strictObject({
    query: search ? z.string().min(1).max(200) : z.undefined(),
    kinds: z.array(artifactKindSchema).max(13).optional(), statuses: z.array(artifactStatusSchema).max(7).optional(),
    limit: z.number().int().min(1).max(50), offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }).safeParse({ query: search ? query.q : undefined, kinds: list(query.kind), statuses: list(query.status),
    limit: integer(query.limit, 10), offset: integer(query.offset, 0) });
}

/** Public metadata never includes store identities, filesystem locations, or control characters. */
function publicMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicMetadata);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key,
    ["title", "abstractL0", "abstractL1", "snippet"].includes(key) && typeof field === "string"
      ? sanitizeAgentText(field) : publicMetadata(field)]));
}

export function registerKnowledgeRoutes(app: FastifyInstance, guards: ApiGuards, deps: { raw: Database; knowledge: KnowledgeIndex }): void {
  const newId = createIdGenerator();
  const exists = (id: string): boolean => Boolean(deps.raw.prepare("SELECT 1 FROM projects WHERE id = ?").get(id));
  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/knowledge/stale", { preHandler: guards.session }, async (request, reply) => {
      const { projectId } = request.params;
      if (!exists(projectId)) return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
      return { apiVersion: API_VERSION, ok: true, items: publicMetadata(listStale(deps.raw, projectId)) };
    });
  app.get<{ Params: { projectId: string }; Querystring: Record<string, unknown> }>(
    "/projects/:projectId/knowledge/search", { preHandler: guards.session }, async (request, reply) => {
      const { projectId } = request.params;
      if (!exists(projectId)) return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
      const parsed = parseQuery(request.query, true);
      if (!parsed.success || parsed.data.query === undefined)
        return failure(reply, 400, "validation", "Invalid knowledge query.", "correct-input", newId);
      try {
        const { query, kinds, statuses, limit, offset } = parsed.data;
        const results = deps.knowledge.search({ projectId, teamId: null, viewer: "operator" }, { query, kinds, statuses, limit, offset },
          { maxLimit: 50, projectOnly: true });
        return { apiVersion: API_VERSION, ok: true, results: publicMetadata(results) };
      } catch { return failure(reply, 503, "runtime-unavailable", "Search is temporarily unavailable.", "wait", newId); }
    });
  app.get<{ Params: { projectId: string }; Querystring: Record<string, unknown> }>(
    "/projects/:projectId/knowledge/artifacts", { preHandler: guards.session }, async (request, reply) => {
      const { projectId } = request.params;
      if (!exists(projectId)) return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
      const parsed = parseQuery(request.query, false);
      if (!parsed.success) return failure(reply, 400, "validation", "Invalid knowledge query.", "correct-input", newId);
      const { kinds, statuses, limit, offset } = parsed.data;
      return { apiVersion: API_VERSION, ok: true, items: publicMetadata(listKnowledgeArtifacts(deps.raw,
        { projectId, teamId: null, viewer: "operator" }, { kinds, statuses, limit, offset })) };
    });
  app.get<{ Params: { projectId: string; artifactId: string } }>(
    "/projects/:projectId/knowledge/artifacts/:artifactId", { preHandler: guards.session }, async (request, reply) => {
      const { projectId, artifactId } = request.params;
      if (!exists(projectId)) return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
      const artifact = getKnowledgeArtifact(deps.raw, { projectId, teamId: null, viewer: "operator" }, artifactId);
      if (!artifact) return failure(reply, 404, "not-found", "Artifact not found.", "correct-input", newId);
      return { apiVersion: API_VERSION, ok: true, artifact: publicMetadata(artifact) };
    });
}
