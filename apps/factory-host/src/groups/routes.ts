import { API_VERSION, idSchema } from "@factory/contracts";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import type { ApiGuards } from "../api/server.js";
import { failure } from "../api/http.js";
import { createIdGenerator } from "../ids.js";
import { getGroupDetail, listGroups } from "./service.js";

export function registerGroupRoutes(app: FastifyInstance, guards: ApiGuards, deps: { raw: Database; clock?: () => Date }): void {
  const newId = createIdGenerator();
  app.get("/groups", { preHandler: guards.session }, async () => ({ ok: true, apiVersion: API_VERSION, ...listGroups(deps.raw) }));
  app.get<{ Params: { groupId: string } }>("/groups/:groupId", { preHandler: guards.session }, async (request, reply) => {
    const parsed = idSchema.safeParse(request.params.groupId);
    if (!parsed.success) return failure(reply, 400, "validation", "Invalid group id.", "correct-input", newId);
    const detail = getGroupDetail(deps.raw, parsed.data, deps.clock?.());
    return detail ? { ok: true, apiVersion: API_VERSION, ...detail }
      : failure(reply, 404, "not-found", "Group not found.", "correct-input", newId);
  });
}
