import { portalActionRequestSchema, portalResponseSchema, portalJoinedGamesResponseSchema, portalStatsQuerySchema, portalStatsResponseSchema, portalActionsResponseSchema, portalActionResponseSchema, portalAuditQuerySchema, portalAuditResponseSchema, idSchema } from "@factory/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ApiGuards } from "../api/server.js";
import { failure } from "../api/http.js";
import { CommandError } from "../commands/errors.js";
import { createIdGenerator } from "../ids.js";
import type { PublishService } from "../publish/service.js";
import type { PortalOpsService } from "./service.js";

export function registerPortalOpsRoutes(app: FastifyInstance, guards: ApiGuards, ops: PortalOpsService, publish: PublishService) {
  const newId = createIdGenerator();
  const unavailable = (reply: FastifyReply) => failure(reply, 409, "conflict", "Không thực hiện được yêu cầu Portal. Kiểm tra cấu hình, game, phiên bản, đề xuất đang mở và điều kiện publish.", "correct-input", newId);
  app.get("/portal", { preHandler: guards.session }, async () => portalResponseSchema.parse(ops.status()));
  app.get("/portal/games", { preHandler: guards.session }, async (_req, reply) => {
    try { return portalJoinedGamesResponseSchema.parse(await ops.games()); } catch { return unavailable(reply); }
  });
  app.get("/portal/stats", { preHandler: guards.session }, async (req, reply) => {
    const query = portalStatsQuerySchema.safeParse(req.query);
    if (!query.success) return failure(reply, 400, "validation", "Invalid Portal date range.", "correct-input", newId);
    try { return portalStatsResponseSchema.parse(await publish.stats(query.data)); } catch { return unavailable(reply); }
  });
  app.get("/portal/audit", { preHandler: guards.session }, async (req, reply) => {
    const query = portalAuditQuerySchema.safeParse(req.query);
    if (!query.success) return failure(reply, 400, "validation", "Invalid Portal audit query.", "correct-input", newId);
    try { return portalAuditResponseSchema.parse(await publish.audit(query.data)); } catch { return unavailable(reply); }
  });
  app.get("/portal/actions", { preHandler: guards.session }, async () => portalActionsResponseSchema.parse(ops.actions()));
  app.post("/portal/actions", { preHandler: guards.write }, async (req, reply) => {
    const body = portalActionRequestSchema.safeParse(req.body);
    if (!body.success) return failure(reply, 400, "validation", "Invalid Portal proposal.", "correct-input", newId);
    try { return portalActionResponseSchema.parse({ action: await ops.propose(body.data) }); } catch (error) { return error instanceof CommandError ? failure(reply, 409, "conflict", error.message, "correct-input", newId) : unavailable(reply); }
  });
  app.post<{ Params: { id: string } }>("/portal/actions/:id/reconcile", { preHandler: guards.write }, async (req, reply) => {
    if (!idSchema.safeParse(req.params.id).success) return failure(reply, 400, "validation", "Invalid Portal action id.", "correct-input", newId);
    try { return portalActionResponseSchema.parse({ action: await ops.reconcile(req.params.id) }); } catch { return unavailable(reply); }
  });
}
