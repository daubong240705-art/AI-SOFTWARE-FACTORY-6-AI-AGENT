import { API_VERSION, artifactKindSchema, artifactStatusSchema } from "@factory/contracts";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import { z } from "zod";
import type { ApiGuards } from "../api/server.js";
import { failure } from "../api/http.js";
import { createIdGenerator } from "../ids.js";
import { sanitizeAgentText } from "../mcp/security.js";
import { getKnowledgeArtifact, listKnowledgeArtifacts, listKnowledgeGroupRows, type KnowledgeIndex, type KnowledgeQuery } from "./index.js";
import { listStale } from "./lifecycle.js";
import type { ContentStore } from "../artifacts/content-store.js";
import { registerRawRoute } from "./raw.js";
import type { ArtifactTaskRef, ArtifactTaskRefs } from "../work/artifact-tasks.js";

function parseQuery(query: Record<string, unknown>, search: boolean) {
  const list = (value: unknown): unknown => value === undefined ? undefined
    : (Array.isArray(value) ? value : [value]).flatMap((part: unknown) => typeof part === "string" ? part.split(",") : [part]);
  const integer = (value: unknown, fallback: number): unknown => value === undefined ? fallback
    : typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : NaN;
  return z.strictObject({
    query: search ? z.string().min(1).max(200) : z.undefined(),
    kinds: z.array(artifactKindSchema).max(13).optional(), statuses: z.array(artifactStatusSchema).max(7).optional(),
    origin: z.array(z.enum(["agent", "upload"])).max(2).optional(),
    group: z.string().regex(/^(?:task:[A-Za-z0-9_-]{1,64}|uploads|plans|other)$/).optional(),
    media: z.enum(["image", "document"]).optional(),
    limit: z.number().int().min(1).max(50), offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }).safeParse({ query: search ? query.q : undefined, kinds: list(query.kind), statuses: list(query.status), origin: list(query.origin),
    group: query.group, media: query.media, limit: integer(query.limit, 10), offset: integer(query.offset, 0) });
}

/** Public metadata never includes store identities, filesystem locations, or control characters. */
export function publicMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicMetadata);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key,
    ["title", "abstractL0", "abstractL1", "snippet", "fileName"].includes(key) && typeof field === "string"
      ? sanitizeAgentText(field) : publicMetadata(field)]));
}

type GroupKey = `task:${string}` | "uploads" | "plans" | "other";
interface KnowledgeGroup { key: GroupKey; task: ArtifactTaskRef | null; documents: number; images: number; lastAt: string }

export function registerKnowledgeRoutes(app: FastifyInstance, guards: ApiGuards, deps: {
  raw: Database; knowledge: KnowledgeIndex; store?: ContentStore; tasks?: ArtifactTaskRefs;
}): void {
  const newId = createIdGenerator();
  registerRawRoute(app, guards, deps);
  const exists = (id: string): boolean => Boolean(deps.raw.prepare("SELECT 1 FROM projects WHERE id = ?").get(id));
  const producer = deps.raw.prepare("SELECT produced_by_attempt_id AS attemptId FROM artifact_versions WHERE project_id = ? AND artifact_id = ? AND version = ?");
  /** Adds the producing task to each listed document, or null for uploads and plan files. */
  const withTasks = <T extends { artifactId: string; version: number }>(projectId: string, rows: T[]): Array<T & { task: ArtifactTaskRef | null }> => {
    const attempts = rows.map((row) => (producer.get(projectId, row.artifactId, row.version) as { attemptId: string | null } | undefined)?.attemptId ?? null);
    const refs = deps.tasks?.forAttempts(projectId, attempts.filter((id): id is string => id !== null)) ?? new Map<string, ArtifactTaskRef>();
    return rows.map((row, index) => { const attempt = attempts[index]; return { ...row, task: attempt ? refs.get(attempt) ?? null : null }; });
  };
  /** Turns the route's group into list filters. An unknown task matches no documents. */
  const groupFilter = (projectId: string, group: string | undefined): Pick<KnowledgeQuery, "attemptIds" | "bucket"> => {
    if (group === undefined) return {};
    if (group === "uploads" || group === "plans" || group === "other") return { bucket: group };
    return { attemptIds: deps.tasks?.attemptsOf(projectId, group.slice("task:".length)) ?? [] };
  };
  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/knowledge/groups", { preHandler: guards.session }, async (request, reply) => {
      const { projectId } = request.params;
      if (!exists(projectId)) return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
      const rows = listKnowledgeGroupRows(deps.raw, { projectId, teamId: null, viewer: "operator" });
      const refs = deps.tasks?.forAttempts(projectId, rows.flatMap((row) => row.attemptId ? [row.attemptId] : [])) ?? new Map<string, ArtifactTaskRef>();
      const groups = new Map<GroupKey, KnowledgeGroup>();
      const totals = { all: 0, images: 0, documents: 0 };
      for (const row of rows) {
        const task = row.attemptId ? refs.get(row.attemptId) ?? null : null;
        const key: GroupKey = task ? `task:${task.id}` : row.kind === "plan" ? "plans" : row.origin === "upload" ? "uploads" : "other";
        const image = row.mediaType.startsWith("image/");
        const group = groups.get(key) ?? { key, task, documents: 0, images: 0, lastAt: row.createdAt };
        if (image) group.images++; else group.documents++;
        if (row.createdAt > group.lastAt) group.lastAt = row.createdAt;
        groups.set(key, group);
        totals.all++; if (image) totals.images++; else totals.documents++;
      }
      const items = [...groups.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 1000);
      return { apiVersion: API_VERSION, ok: true, groups: publicMetadata(items), totals };
    });
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
        const { query, kinds, statuses, origin, group, media, limit, offset } = parsed.data;
        const grouped = groupFilter(projectId, group);
        const results = deps.knowledge.search({ projectId, teamId: null, viewer: "operator" },
          { query, kinds, statuses, origins: origin, ...grouped, media, limit, offset }, { maxLimit: 50, projectOnly: true });
        return { apiVersion: API_VERSION, ok: true, results: publicMetadata(withTasks(projectId, results)) };
      } catch { return failure(reply, 503, "runtime-unavailable", "Search is temporarily unavailable.", "wait", newId); }
    });
  app.get<{ Params: { projectId: string }; Querystring: Record<string, unknown> }>(
    "/projects/:projectId/knowledge/artifacts", { preHandler: guards.session }, async (request, reply) => {
      const { projectId } = request.params;
      if (!exists(projectId)) return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
      const parsed = parseQuery(request.query, false);
      if (!parsed.success) return failure(reply, 400, "validation", "Invalid knowledge query.", "correct-input", newId);
      const { kinds, statuses, origin, group, media, limit, offset } = parsed.data;
      const grouped = groupFilter(projectId, group);
      return { apiVersion: API_VERSION, ok: true, items: publicMetadata(withTasks(projectId, listKnowledgeArtifacts(deps.raw,
        { projectId, teamId: null, viewer: "operator" }, { kinds, statuses, origins: origin, ...grouped, media, limit, offset }))) };
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
