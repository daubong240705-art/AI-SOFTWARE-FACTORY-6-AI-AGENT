import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import type { ApiGuards } from "../api/server.js";
import { failure } from "../api/http.js";
import { createIdGenerator } from "../ids.js";
import type { ContentStore } from "../artifacts/content-store.js";
import { buildDossier, dossierDigest, newestDossier } from "./build.js";
import { storedDossierDigest } from "./commands.js";
import { buildBriefing, validSince } from "./briefing.js";

export function registerDossierRoutes(app: FastifyInstance, guards: ApiGuards, deps: {
  raw: Database; store?: ContentStore; now: () => Date;
}): void {
  const newId = createIdGenerator();
  const exists = (projectId: string): boolean => Boolean(deps.raw.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId));
  app.get<{ Params: { projectId: string } }>("/projects/:projectId/dossier",{ preHandler: guards.session },async (request,reply) => {
    const { projectId } = request.params;
    if (!exists(projectId)) return failure(reply,404,"not-found","Project not found.","correct-input",newId);
    const row = newestDossier(deps.raw,projectId);
    if (!row) return { apiVersion: 1, ok: true, dossier: null };
    let markdown: string | undefined;
    try { markdown = deps.store?.get(row.contentHash)?.toString("utf8"); } catch { /* Fixed public error below. */ }
    if (markdown === undefined) return failure(reply,503,"runtime-unavailable","Dossier unavailable.","wait",newId);
    return { apiVersion: 1, ok: true, dossier: { ref: { artifactId: row.artifactId, version: row.version },status: row.status,
      createdAt: row.createdAt,markdown,state: storedDossierDigest(markdown) === dossierDigest(buildDossier(deps.raw,{ projectId,now: deps.now() })) ? "current" : "outdated" } };
  });
  app.get<{ Params: { projectId: string }; Querystring: Record<string,unknown> }>("/projects/:projectId/briefing",{ preHandler: guards.session },async (request,reply) => {
    const { projectId } = request.params;
    if (!exists(projectId)) return failure(reply,404,"not-found","Project not found.","correct-input",newId);
    const since = request.query.since;
    if (since !== undefined && !validSince(since)) return failure(reply,400,"validation","Invalid since timestamp.","correct-input",newId);
    return { apiVersion: 1,ok: true,...buildBriefing(deps.raw,{ projectId,now: deps.now(),...(since === undefined ? {} : { since }),
      ...(deps.store === undefined ? {} : { store: deps.store }) }) };
  });
}
