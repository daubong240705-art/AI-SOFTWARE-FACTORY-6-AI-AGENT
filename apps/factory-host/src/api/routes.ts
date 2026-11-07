import { API_VERSION, projectSchema } from "@factory/contracts";
import type { FastifyInstance } from "fastify";
import type { createCommandPipeline } from "../commands/pipeline.js";
import type { EventHub } from "../events/hub.js";
import { listProjects } from "../projects/service.js";
import type { Storage } from "../storage/database.js";
import type { ApiGuards } from "./server.js";
import { registerEventStream } from "./sse.js";

export function createRoutes(deps: {
  storage: Storage; hub: EventHub; pipeline: ReturnType<typeof createCommandPipeline>;
  keepAliveMs?: number; maxStreams?: number; batchSize?: number;
}): (app: FastifyInstance, guards: ApiGuards) => void {
  return (app, guards) => {
    registerEventStream(app, guards, deps);
    app.post("/commands", { preHandler: guards.write }, async (request, reply) => {
      const r = deps.pipeline.execute(request.body);
      return reply.code(r.status).send(r.body);
    });
    app.get("/projects", { preHandler: guards.session }, async () => ({
      apiVersion: API_VERSION, ok: true, projects: listProjects(deps.storage.raw).map((project) => projectSchema.parse(project)),
    }));
  };
}
