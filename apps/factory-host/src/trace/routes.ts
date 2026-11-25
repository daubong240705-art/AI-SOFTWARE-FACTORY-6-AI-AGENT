import { API_VERSION, artifactTraceResponseSchema, idSchema, monitorResponseSchema, tracesResponseSchema, traceResponseSchema } from "@factory/contracts";
import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { failure } from "../api/http.js";
import type { ApiGuards } from "../api/server.js";
import { createIdGenerator, type Clock } from "../ids.js";
import { listTraces, readArtifactTrace, readMonitor, readTrace } from "./read.js";

export function registerTraceRoutes(app: FastifyInstance, guards: ApiGuards, deps: { raw: Database; clock: Clock; utcOffsetMinutes: number }): void {
  const { raw, clock } = deps;
  const newId = createIdGenerator(clock);
  const session = { preHandler: guards.session };
  const envelope = { ok: true, apiVersion: API_VERSION } as const;
  const exists = (id: string) => idSchema.safeParse(id).success && raw.prepare("SELECT 1 FROM projects WHERE id=?").get(id);
  app.get<{ Params: { projectId: string } }>("/projects/:projectId/monitor", session, async ({ params }, reply) => {
    if (!exists(params.projectId)) return failure(reply, 404, "not-found", "Project not found.", "refresh", newId);
    return monitorResponseSchema.parse({ ...envelope, ...readMonitor(raw, params.projectId, clock(), deps.utcOffsetMinutes) });
  });
  app.get<{ Params: { projectId: string }; Querystring: { limit?: string } }>("/projects/:projectId/traces", session, async ({ params, query }, reply) => {
    if (!exists(params.projectId)) return failure(reply, 404, "not-found", "Project not found.", "refresh", newId);
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      return failure(reply, 400, "validation", "Limit must be an integer from 1 to 200.", "correct-input", newId);
    return tracesResponseSchema.parse({ ...envelope, traces: listTraces(raw, params.projectId, limit) });
  });
  app.get<{ Params: { projectId: string; traceId: string } }>("/projects/:projectId/traces/:traceId", session, async ({ params }, reply) => {
    const trace = readTrace(raw, params.projectId, params.traceId);
    if (!trace) return failure(reply, 404, "not-found", "Trace not found.", "refresh", newId);
    return traceResponseSchema.parse({ ...envelope, ...trace });
  });
  app.get<{ Params: { projectId: string; artifactId: string }; Querystring: { version?: string } }>(
    "/projects/:projectId/artifacts/:artifactId/trace", session, async ({ params, query }, reply) => {
    const version = query.version === undefined ? undefined : Number(query.version);
    if (version !== undefined && (!Number.isSafeInteger(version) || version < 1))
      return failure(reply, 400, "validation", "Version must be a positive integer.", "correct-input", newId);
    const trace = readArtifactTrace(raw, params.projectId, params.artifactId, version);
    if (!trace) return failure(reply, 404, "not-found", "Artifact trace not found.", "refresh", newId);
    return artifactTraceResponseSchema.parse({ ...envelope, ...trace });
  });
}
