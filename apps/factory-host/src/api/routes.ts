import { API_VERSION, conversationSchema, idSchema, messageSchema, projectSchema } from "@factory/contracts";
import type { FastifyInstance } from "fastify";
import type { createCommandPipeline, PipelineResult } from "../commands/pipeline.js";
import { getConversation, listConversations, listMessages } from "../chat/index.js";
import type { EventHub } from "../events/hub.js";
import { createIdGenerator, systemClock, type Clock } from "../ids.js";
import { getActiveEngagement, getTeam, listSeats } from "../org/service.js";
import { budgetStatus, DEFAULT_BUDGET_CONFIG, type BudgetConfig } from "../policy/index.js";
import { getProject, listProjects } from "../projects/service.js";
import type { Storage } from "../storage/database.js";
import { listTasks } from "../work/service.js";
import { failure } from "./http.js";
import type { ApiGuards } from "./server.js";
import type { BackupStatus } from "../backup/service.js";
import { registerEventStream } from "./sse.js";

export function createRoutes(deps: {
  storage: Storage; hub: EventHub; pipeline: ReturnType<typeof createCommandPipeline>;
  keepAliveMs?: number; maxStreams?: number; batchSize?: number;
  budgetConfig?: BudgetConfig; clock?: Clock;
  afterCommand?: (type: string, result: PipelineResult) => void;
  backupStatus?: () => BackupStatus | null;
}): (app: FastifyInstance, guards: ApiGuards) => void {
  const newId = createIdGenerator();
  return (app, guards) => {
    registerEventStream(app, guards, deps);
    app.get("/system/backups", { preHandler: guards.session }, async () => ({
      apiVersion: API_VERSION, ok: true, backup: deps.backupStatus?.() ?? null,
    }));
    app.post("/commands", { preHandler: guards.write }, async (request, reply) => {
      const r = deps.pipeline.execute(request.body);
      try {
        const body = request.body;
        if (typeof body === "object" && body !== null && "type" in body && typeof body.type === "string")
          deps.afterCommand?.(body.type, r);
      } catch { /* Scheduling cannot change a committed command response. */ }
      return reply.code(r.status).send(r.body);
    });
    app.get("/projects", { preHandler: guards.session }, async () => ({
      apiVersion: API_VERSION, ok: true, projects: listProjects(deps.storage.raw).map((project) => projectSchema.parse(project)),
    }));
    app.get<{ Params: { projectId: string } }>("/projects/:projectId/conversations", { preHandler: guards.session }, async (request, reply) => {
      const parsed = idSchema.safeParse(request.params.projectId);
      if (!parsed.success) return failure(reply, 400, "validation", "Invalid project id.", "correct-input", newId);
      if (!getProject(deps.storage.raw, parsed.data))
        return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
      return { apiVersion: API_VERSION, ok: true,
        conversations: listConversations(deps.storage.raw, parsed.data).map((conversation) => conversationSchema.parse(conversation)) };
    });
    app.get<{ Params: { projectId: string; conversationId: string }; Querystring: { afterOrdinal?: unknown; limit?: unknown } }>(
      "/projects/:projectId/conversations/:conversationId/messages", { preHandler: guards.session }, async (request, reply) => {
        const project = idSchema.safeParse(request.params.projectId);
        const conversation = idSchema.safeParse(request.params.conversationId);
        if (!project.success || !conversation.success)
          return failure(reply, 400, "validation", "Invalid project or conversation id.", "correct-input", newId);
        const raw = deps.storage.raw;
        if (!getProject(raw, project.data))
          return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
        if (!getConversation(raw, project.data, conversation.data))
          return failure(reply, 404, "not-found", "Conversation not found.", "correct-input", newId);
        const queryInteger = (value: unknown, fallback: number, minimum: number): number | undefined => {
          if (value === undefined) return fallback;
          if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return undefined;
          const number = Number(value);
          return Number.isSafeInteger(number) && number >= minimum ? number : undefined;
        };
        const afterOrdinal = queryInteger(request.query.afterOrdinal, 0, 0);
        const limit = queryInteger(request.query.limit, 100, 1);
        if (afterOrdinal === undefined || limit === undefined)
          return failure(reply, 400, "validation", "Invalid message pagination.", "correct-input", newId);
        const { messages } = listMessages(raw, project.data, conversation.data, { afterOrdinal, limit });
        const turns = raw.prepare(`SELECT t.id, t.state, t.error_kind AS errorKind FROM lead_turns AS t
          WHERE t.project_id = ? AND t.conversation_id = ? AND (t.state != ? OR EXISTS (
            SELECT 1 FROM messages AS m WHERE m.project_id = t.project_id AND m.conversation_id = t.conversation_id
              AND m.id = t.reply_message_id AND m.ordinal > ? AND m.ordinal <= ?)) ORDER BY t.created_at, t.id`)
          .all(project.data, conversation.data, "done", afterOrdinal, messages.at(-1)?.ordinal ?? afterOrdinal);
        return { apiVersion: API_VERSION, ok: true,
          messages: messages.map(({ ordinal, ...message }) => ({ ordinal, message: messageSchema.parse(message) })), turns };
      },
    );
    app.get<{ Params: { projectId: string } }>("/projects/:projectId/budget", { preHandler: guards.session }, async (request, reply) => {
      const parsed = idSchema.safeParse(request.params.projectId);
      if (!parsed.success) return failure(reply, 400, "validation", "Invalid project id.", "correct-input", newId);
      if (!getProject(deps.storage.raw, parsed.data))
        return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
      return { apiVersion: API_VERSION, ok: true,
        budget: budgetStatus(deps.storage.raw, parsed.data, (deps.clock ?? systemClock)(), deps.budgetConfig ?? DEFAULT_BUDGET_CONFIG) };
    });
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
