import { API_VERSION } from "@factory/contracts";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import type { ApiGuards } from "../api/server.js";
import { failure } from "../api/http.js";
import { createIdGenerator } from "../ids.js";
import type { PreviewService } from "./service.js";
import { isPreviewPath } from "./proxy.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Start and stop are operator actions on a Host-supervised process, not domain state, so they live beside the effect routes. */
export function registerPreviewRoutes(app: FastifyInstance, guards: ApiGuards, deps: { raw: Database; preview: PreviewService }): void {
  const newId = createIdGenerator();
  const known = (id: string): boolean => uuid.test(id) && Boolean(deps.raw.prepare("SELECT 1 FROM projects WHERE id = ?").get(id));
  const reply404 = (reply: Parameters<typeof failure>[0]) => failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
  app.addHook("onRequest", async (request, reply) => {
    if (!isPreviewPath(request.raw.url)) return;
    reply.hijack();
    deps.preview.proxy.handleHttp(request.raw, reply.raw);
    return reply;
  });
  app.server.on("upgrade", (request, socket, head) => {
    if (isPreviewPath(request.url)) deps.preview.proxy.handleUpgrade(request, socket, head, guards.hostAllowed(request.headers.host));
    // Without an upgrade listener Node closes these connections; retain that default.
    else if (app.server.listenerCount("upgrade") === 1) socket.destroy();
  });
  app.addHook("preClose", async () => deps.preview.close());
  app.get<{ Params: { projectId: string } }>("/projects/:projectId/preview", { preHandler: guards.session }, async (request, reply) => {
    if (!known(request.params.projectId)) return reply404(reply);
    return { apiVersion: API_VERSION, ok: true, preview: deps.preview.status(request.params.projectId) };
  });
  app.post<{ Params: { projectId: string } }>("/projects/:projectId/preview/start", { preHandler: guards.write }, async (request, reply) => {
    if (!known(request.params.projectId)) return reply404(reply);
    return { apiVersion: API_VERSION, ok: true, preview: await deps.preview.start(request.params.projectId) };
  });
  app.post<{ Params: { projectId: string } }>("/projects/:projectId/preview/stop", { preHandler: guards.write }, async (request, reply) => {
    if (!known(request.params.projectId)) return reply404(reply);
    return { apiVersion: API_VERSION, ok: true, preview: await deps.preview.stop(request.params.projectId) };
  });
}
