import { API_VERSION, revisionSchema } from "@factory/contracts";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import type { ApiGuards } from "../api/server.js";
import { failure } from "../api/http.js";
import { createIdGenerator } from "../ids.js";
import { getSkillVersion, getTemplateDetail, listLibrary } from "./service.js";

function parseRevision(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const parsed = revisionSchema.safeParse(Number(value));
  return parsed.success ? parsed.data : undefined;
}

export function registerLibraryRoutes(app: FastifyInstance, guards: ApiGuards, deps: { raw: Database }): void {
  const newId = createIdGenerator();
  app.get("/library", { preHandler: guards.session }, async () => ({ ok: true, apiVersion: API_VERSION, ...listLibrary(deps.raw) }));
  app.get<{ Params: { skillId: string; version: string } }>("/library/skills/:skillId/versions/:version",
    { preHandler: guards.session }, async (request, reply) => {
      const { skillId, version } = request.params;
      const selection = version === "latest" ? version : parseRevision(version);
      const skill = selection === undefined ? undefined : getSkillVersion(deps.raw, skillId, selection);
      return skill ? { ok: true, apiVersion: API_VERSION, ...skill } : failure(reply, 404, "not-found", "Skill version not found.", "correct-input", newId);
    });
  app.get<{ Params: { templateId: string }; Querystring: { revision?: string } }>("/library/templates/:templateId",
    { preHandler: guards.session }, async (request, reply) => {
      const revision = parseRevision(request.query.revision);
      const template = revision === undefined && request.query.revision !== undefined
        ? undefined : getTemplateDetail(deps.raw, request.params.templateId, revision);
      return template ? { ok: true, apiVersion: API_VERSION, ...template } : failure(reply, 404, "not-found", "Template not found.", "correct-input", newId);
    });
}
