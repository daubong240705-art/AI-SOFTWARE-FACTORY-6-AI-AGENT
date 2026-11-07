import { API_VERSION, idSchema, projectSchema } from "@factory/contracts";
import type { FastifyInstance } from "fastify";
import type { createCommandPipeline } from "../commands/pipeline.js";
import type { EventHub } from "../events/hub.js";
import { createIdGenerator } from "../ids.js";
import { getActiveEngagement, getTeam, listSeats } from "../org/service.js";
import { getProject, listProjects } from "../projects/service.js";
import type { Storage } from "../storage/database.js";
import { listTasks } from "../work/service.js";
import { failure } from "./http.js";
import type { ApiGuards } from "./server.js";
import { registerEventStream } from "./sse.js";

export function createRoutes(deps: {
  storage: Storage; hub: EventHub; pipeline: ReturnType<typeof createCommandPipeline>;
  keepAliveMs?: number; maxStreams?: number; batchSize?: number;
}): (app: FastifyInstance, guards: ApiGuards) => void {
  const newId = createIdGenerator();
  return (app, guards) => {
    registerEventStream(app, guards, deps);
    app.post("/commands", { preHandler: guards.write }, async (request, reply) => {
      const r = deps.pipeline.execute(request.body);
      return reply.code(r.status).send(r.body);
    });
    app.get("/projects", { preHandler: guards.session }, async () => ({
      apiVersion: API_VERSION, ok: true, projects: listProjects(deps.storage.raw).map((project) => projectSchema.parse(project)),
    }));
    app.get<{ Params: { projectId: string } }>("/projects/:projectId/tasks", { preHandler: guards.session }, async (request, reply) => {
      const parsed = idSchema.safeParse(request.params.projectId);
      if (!parsed.success) return failure(reply, 400, "validation", "Invalid project id.", "correct-input", newId);
      if (!getProject(deps.storage.raw, parsed.data))
        return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
      return { apiVersion: API_VERSION, ok: true, items: listTasks(deps.storage.raw, parsed.data) };
    });
    app.get<{ Params: { projectId: string } }>("/projects/:projectId/team", { preHandler: guards.session }, async (request, reply) => {
      const parsed = idSchema.safeParse(request.params.projectId);
      if (!parsed.success) return failure(reply, 400, "validation", "Invalid project id.", "correct-input", newId);
      if (!getProject(deps.storage.raw, parsed.data))
        return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
      const engagement = getActiveEngagement(deps.storage.raw, parsed.data);
      const team = engagement === undefined ? undefined : getTeam(deps.storage.raw, engagement.teamId);
      if (!engagement || !team) return failure(reply, 404, "not-found", "Project team not found.", "correct-input", newId);
      return { apiVersion: API_VERSION, ok: true, team, seats: listSeats(deps.storage.raw, team.id), engagement };
    });
  };
}
