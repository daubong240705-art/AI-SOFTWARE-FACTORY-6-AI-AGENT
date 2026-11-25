import { API_VERSION, idSchema } from "@factory/contracts";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ApiGuards } from "../api/server.js";
import { failure } from "../api/http.js";
import { createIdGenerator } from "../ids.js";
import type { IntegrationStore } from "./store.js";
import type { HttpEffects } from "./http-effects.js";

export function registerIntegrationRoutes(app: FastifyInstance, guards: ApiGuards, store: IntegrationStore, http: HttpEffects,
  advance: (projectId: string) => void) {
  const newId = createIdGenerator();
  const envelope = { apiVersion: API_VERSION, ok: true };
  app.get("/integrations", { preHandler: guards.session }, async (request, reply) => {
    const query = z.strictObject({ groupId: idSchema.optional() }).safeParse(request.query);
    if (!query.success) return failure(reply, 400, "validation", "Invalid integration scope", "correct-input", newId);
    if (query.data.groupId) try { store.validateGroup(query.data.groupId); }
    catch { return failure(reply, 404, "not-found", "Group not found", "correct-input", newId); }
    return { ...envelope, integrations: store.list(query.data.groupId) };
  });
  app.get<{ Params: { id: string } }>("/integrations/:id", { preHandler: guards.session }, async (request, reply) => {
    const integration = idSchema.safeParse(request.params.id).success && store.get(request.params.id);
    return integration ? { ...envelope, integration } : failure(reply, 404, "not-found", "Integration not found", "correct-input", newId);
  });
  app.get("/credentials", { preHandler: guards.session }, async () => ({ ...envelope, credentials: store.credentials() }));
  app.get<{ Params: { projectId: string } }>("/projects/:projectId/http-effects", { preHandler: guards.session }, async (request) =>
    ({ ...envelope, effects: http.list(request.params.projectId) }));
  app.post<{ Params: { projectId: string; id: string } }>("/projects/:projectId/http-effects/:id/reconcile", { preHandler: guards.write }, async (request, reply) => {
    const input = z.strictObject({ resolution: z.enum(["done", "failed"]) }).safeParse(request.body);
    if (!input.success) return failure(reply, 400, "validation", "Invalid resolution", "correct-input", newId);
    if (!http.reconcile(request.params.projectId, request.params.id, input.data.resolution))
      return failure(reply, 409, "conflict", "HTTP effect is not unknown", "refresh", newId);
    advance(request.params.projectId);
    return envelope;
  });
}
