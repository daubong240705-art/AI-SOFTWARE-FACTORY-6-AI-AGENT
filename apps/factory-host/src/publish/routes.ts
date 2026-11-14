import { API_VERSION, idSchema, rollbackRequestSchema } from "@factory/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ApiGuards } from "../api/server.js";
import { failure } from "../api/http.js";
import { createIdGenerator } from "../ids.js";
import { ReleaseError, type PublishService } from "./service.js";

export function registerPublishRoutes(app: FastifyInstance, guards: ApiGuards, service: PublishService): void {
  const newId = createIdGenerator();
  const failed = (reply: FastifyReply, error: unknown) => {
    if (!(error instanceof ReleaseError)) return failure(reply, 500, "internal", "Release request failed.", "contact-host", newId);
    const status = error.code === "not-found" ? 404 : error.code === "unreachable" ? 502 : 409;
    return failure(reply, status, status === 404 ? "not-found" : status === 502 ? "outcome-unknown" : "conflict",
      error.message, status === 502 ? "reconcile" : "correct-input", newId);
  };
  app.get<{ Params: { projectId: string }; Querystring: { log?: string } }>("/projects/:projectId/releases",
    { preHandler: guards.session }, async (request, reply) => {
      try { return await service.list(request.params.projectId, request.query.log === "1"); }
      catch (error) { return failed(reply, error); }
    });
  app.post<{ Params: { projectId: string } }>("/projects/:projectId/publish", { preHandler: guards.write }, async (request, reply) => {
    try { return reply.code(202).send({ apiVersion: API_VERSION, ok: true, release: await service.publish(request.params.projectId) }); }
    catch (error) { return failed(reply, error); }
  });
  app.post<{ Params: { projectId: string; releaseId: string } }>("/projects/:projectId/releases/:releaseId/reconcile",
    { preHandler: guards.write }, async (request, reply) => {
      if (!idSchema.safeParse(request.params.releaseId).success) return failed(reply, new ReleaseError("not-found"));
      try { return { apiVersion: API_VERSION, ok: true, release: await service.reconcile(request.params.projectId, request.params.releaseId) }; }
      catch (error) { return failed(reply, error); }
    });
  app.post<{ Params: { projectId: string } }>("/projects/:projectId/releases/rollback", { preHandler: guards.write }, async (request, reply) => {
    const parsed = rollbackRequestSchema.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, "validation", "Expected a positive integer version.", "correct-input", newId);
    try { return reply.code(202).send({ apiVersion: API_VERSION, ok: true, release: await service.rollback(request.params.projectId, parsed.data.version) }); }
    catch (error) { return failed(reply, error); }
  });
}
