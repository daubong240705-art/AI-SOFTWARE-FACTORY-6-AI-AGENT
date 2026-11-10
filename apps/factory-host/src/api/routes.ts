import { getMonitor, listMonitors, listMonitorEvents } from "../automation/monitors.js";
import { pendingPatches } from "../workflow/patch.js";
import { getSchedule, listSchedules, listOccurrences } from "../schedule/service.js";
import { API_VERSION, contextPackSchema, conversationSchema, idSchema, messageSchema, projectSchema } from "@factory/contracts";
import type { FastifyInstance } from "fastify";
import type { createCommandPipeline, PipelineResult } from "../commands/pipeline.js";
import { getConversation, listConversations, listMessages } from "../chat/index.js";
import type { EventHub } from "../events/hub.js";
import { createIdGenerator, systemClock, type Clock } from "../ids.js";
import { getPrimaryEngagement, getTeam, listSeats } from "../org/service.js";
import type { RegistryPack } from "../org/registry.js";
import { projectEngagements, teamQueue, teamViews } from "../org/views.js";
import { budgetStatus, DEFAULT_BUDGET_CONFIG, type BudgetConfig } from "../policy/index.js";
import { getProject, listProjects } from "../projects/service.js";
import type { Storage } from "../storage/database.js";
import { getTask, listTasks } from "../work/service.js";
import { getAttempt, listAttempts, listAttemptEvents, type Dispatcher } from "../dispatch/index.js";
import { failure } from "./http.js";
import type { ApiGuards } from "./server.js";
import type { BackupStatus } from "../backup/service.js";
import { registerEventStream } from "./sse.js";
import fs from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { assertInside } from "../workspace/index.js";
import { ATTEMPT_UUID } from "../dispatch/workspace-provider.js";
import { getArtifactVersion, listTaskArtifacts } from "../artifacts/service.js";
import { getApprovalView, listApprovals, publicApprovalText } from "../approvals/service.js";
import type { ContentStore } from "../artifacts/content-store.js";
import { z } from "zod";
import { PushError, type EffectExecutor } from "../effects/executor.js";
import { getRequest, listRequests, RequestError } from "../requests/service.js";
import { registerDossierRoutes } from "../dossier/routes.js";
import type { ExternalTools } from "../mcp-external/index.js";
import { listWorkflowInstances, workflowInstanceView } from "../workflow/service.js";

export function createRoutes(deps: {
  external?: ExternalTools;
  packs?: readonly RegistryPack[];
  storage: Storage; hub: EventHub; pipeline: ReturnType<typeof createCommandPipeline>;
  keepAliveMs?: number; maxStreams?: number; batchSize?: number;
  budgetConfig?: BudgetConfig; clock?: Clock;
  afterCommand?: (type: string, result: PipelineResult) => void;
  backupStatus?: () => BackupStatus | null;
  dispatch?: Dispatcher;
  evidenceDir?: string;
  artifacts?: { store: ContentStore };
  effects?: EffectExecutor;
}): (app: FastifyInstance, guards: ApiGuards) => void {
  const newId = createIdGenerator();
  return (app, guards) => {
    app.get<{ Params: { projectId: string } }>("/projects/:projectId/monitors", { preHandler: guards.session }, async (request, reply) => {
      const { projectId } = request.params;
      if (!getProject(deps.storage.raw, projectId)) return failure(reply,404,"not-found","Project not found.","correct-input",newId);
      return { apiVersion: API_VERSION, ok: true, items: listMonitors(deps.storage.raw,projectId) };
    });
    app.get<{ Params: { projectId: string; monitorId: string } }>("/projects/:projectId/monitors/:monitorId/events", { preHandler: guards.session }, async (request, reply) => {
      const { projectId,monitorId } = request.params;
      if (!getProject(deps.storage.raw,projectId) || !getMonitor(deps.storage.raw,projectId,monitorId))
        return failure(reply,404,"not-found","Monitor not found.","correct-input",newId);
      return { apiVersion: API_VERSION, ok: true, items: listMonitorEvents(deps.storage.raw,projectId,monitorId) };
    });
    app.get<{ Params: { projectId: string } }>("/projects/:projectId/schedules", { preHandler: guards.session }, async (request, reply) => {
      const { projectId } = request.params;
      if (!getProject(deps.storage.raw, projectId)) return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
      return { apiVersion: API_VERSION, ok: true, items: listSchedules(deps.storage.raw, projectId, (deps.clock ?? systemClock)()) };
    });
    app.get<{ Params: { projectId: string; scheduleId: string } }>("/projects/:projectId/schedules/:scheduleId/occurrences", { preHandler: guards.session }, async (request, reply) => {
      const { projectId, scheduleId } = request.params;
      if (!getProject(deps.storage.raw, projectId) || !getSchedule(deps.storage.raw, projectId, scheduleId))
        return failure(reply, 404, "not-found", "Schedule not found.", "correct-input", newId);
      return { apiVersion: API_VERSION, ok: true, items: listOccurrences(deps.storage.raw, projectId, scheduleId) };
    });
    app.get<{ Params: { projectId: string } }>("/projects/:projectId/workflows", { preHandler: guards.session }, async (request, reply) => {
      const { projectId } = request.params;
      if (!getProject(deps.storage.raw, projectId)) return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
      return { instances: listWorkflowInstances(deps.storage.raw, projectId) };
    });
    app.get<{ Params: { projectId: string; instanceId: string } }>("/projects/:projectId/workflows/:instanceId", { preHandler: guards.session }, async (request, reply) => {
      const { projectId, instanceId } = request.params;
      const instance = getProject(deps.storage.raw, projectId) ? workflowInstanceView(deps.storage.raw, projectId, instanceId) : undefined;
      if (!instance) return failure(reply, 404, "not-found", "Workflow not found.", "correct-input", newId);
      return { instance };
    });
    app.get("/mcp-servers", { preHandler: guards.session }, async () => ({
      apiVersion: API_VERSION, ok: true, servers: deps.external?.status() ?? [],
    }));
    registerDossierRoutes(app,guards,{ raw: deps.storage.raw,now: deps.clock ?? systemClock,
      ...(deps.artifacts === undefined ? {} : { store: deps.artifacts.store }) });
    registerEventStream(app, guards, deps);
    app.get<{ Params: { projectId: string; taskId: string } }>("/projects/:projectId/tasks/:taskId/context",
      { preHandler: guards.session }, async (request, reply) => {
        const { projectId, taskId } = request.params;
        if (!getProject(deps.storage.raw, projectId) || !getTask(deps.storage.raw, projectId, taskId))
          return failure(reply, 404, "not-found", "Task not found.", "correct-input", newId);
        const rows = deps.storage.raw.prepare(`SELECT p.attempt_id AS attemptId,a.epoch,p.built_at AS builtAt,
          p.tokens,p.max_tokens AS maxTokens,p.l0_count AS l0,p.l1_count AS l1,p.omitted_count AS omitted,p.pack_json AS json
          FROM context_packs p JOIN attempts a ON a.project_id = p.project_id AND a.id = p.attempt_id
          WHERE a.project_id = ? AND a.task_id = ? ORDER BY a.epoch DESC,p.built_at DESC LIMIT 20`)
          .all(projectId, taskId) as { attemptId: string; epoch: number; builtAt: string; tokens: number;
            maxTokens: number; l0: number; l1: number; omitted: number; json: string }[];
        return { apiVersion: API_VERSION, ok: true, packs: rows.map(({ json, ...row }) => ({
          ...row, pack: contextPackSchema.parse(JSON.parse(json) as unknown),
          instructions: deps.storage.raw.prepare(`SELECT pack_digest AS packDigest, profile_path AS profilePath,
            skills_count AS skillsCount, bytes FROM attempt_instructions
            WHERE project_id = ? AND attempt_id = ? AND pack_digest IS NOT NULL`)
            .get(projectId, row.attemptId) ?? null,
        })) };
      });
    app.get("/packs", { preHandler: guards.session }, async () => ({
      packs: (deps.packs ?? []).map(({ key, version, name, description, seats, produces, workflows }) =>
        ({ key, version, name, description, seatCount: seats.length, seats,
          ...(produces === undefined ? {} : { produces }), ...(workflows === undefined ? {} : { workflows }) })),
    }));
    app.get("/teams", { preHandler: guards.session }, async () => ({ teams: teamViews(deps.storage.raw) }));
    app.get<{ Params: { teamId: string } }>("/teams/:teamId/queue", { preHandler: guards.session }, async (request, reply) => {
      const parsed = idSchema.safeParse(request.params.teamId);
      if (!parsed.success) return failure(reply, 400, "validation", "Invalid team id.", "correct-input", newId);
      if (!getTeam(deps.storage.raw, parsed.data))
        return failure(reply, 404, "not-found", "Team not found.", "correct-input", newId);
      return { items: teamQueue(deps.storage.raw, parsed.data) };
    });
    const effectFailure = (reply: import("fastify").FastifyReply, error: unknown) => {
      const code = error instanceof PushError ? error.code : "invalid-record";
      const status = ["not-found", "not-available"].includes(code) ? 404
        : ["unknown-remote", "invalid-branch"].includes(code) ? 400 : 409;
      return failure(reply, status, status === 404 ? "not-found" : status === 400 ? "validation" : "conflict",
        code, "correct-input", newId);
    };
    app.get("/effects/remotes", { preHandler: guards.session }, async () => ({
      apiVersion: API_VERSION, ok: true, remotes: deps.effects?.remoteNames() ?? [],
    }));
    app.post<{ Params: { projectId: string; attemptId: string } }>("/projects/:projectId/attempts/:attemptId/push",
      { preHandler: guards.write }, async (request, reply) => {
        if (!deps.effects) return effectFailure(reply, new PushError("not-available"));
        const body = z.strictObject({ remote: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/) }).safeParse(request.body);
        if (!body.success) return failure(reply, 400, "validation", "Invalid push request.", "correct-input", newId);
        try { return { apiVersion: API_VERSION, ok: true, effect: await deps.effects.requestPush({ ...request.params, remote: body.data.remote }) }; }
        catch (error) { return effectFailure(reply, error); }
      });
    app.post<{ Params: { projectId: string; effectId: string } }>("/projects/:projectId/effects/:effectId/reconcile",
      { preHandler: guards.write }, async (request, reply) => {
        if (!deps.effects) return effectFailure(reply, new PushError("not-available"));
        if (request.body !== undefined && !z.strictObject({}).safeParse(request.body).success)
          return failure(reply, 400, "validation", "Invalid reconcile request.", "correct-input", newId);
        try { return { apiVersion: API_VERSION, ok: true, effect: await deps.effects.reconcile(request.params) }; }
        catch (error) { return effectFailure(reply, error); }
      });
    app.get<{ Params: { projectId: string } }>("/projects/:projectId/effects", { preHandler: guards.session }, async (request, reply) => {
      if (!deps.storage.raw.prepare("SELECT id FROM projects WHERE id = ?").get(request.params.projectId))
        return effectFailure(reply, new PushError("not-found"));
      try { return { apiVersion: API_VERSION, ok: true, effects: deps.effects?.listEffects(request.params.projectId) ?? [] }; }
      catch (error) { return effectFailure(reply, error); }
    });
    app.get<{ Params: { projectId: string; attemptId: string } }>("/projects/:projectId/attempts/:attemptId/effects",
      { preHandler: guards.session }, async (request, reply) => {
        const { projectId, attemptId } = request.params;
        if (!getAttempt(deps.storage.raw, projectId, attemptId)) return effectFailure(reply, new PushError("not-found"));
        try { return { apiVersion: API_VERSION, ok: true, effects: deps.effects?.listEffects(projectId, { attemptId }) ?? [] }; }
        catch (error) { return effectFailure(reply, error); }
      });
    const inbox = (projectId?: string) => {
      const projects = (deps.storage.raw.prepare("SELECT id, name FROM projects ORDER BY id").all() as { id: string; name: string }[])
        .filter((project) => projectId === undefined || project.id === projectId);
      const approvals = projects.flatMap((project) => listApprovals(deps.storage.raw, project.id, { states: ["pending"] }).reverse()
        .map((approval) => ({ ...approval, ...(projectId === undefined ? { projectName: publicApprovalText(project.name) } : {}) })))
        .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
      const startGates = projects.flatMap((project) => {
        const tasks = deps.storage.raw.prepare("SELECT id, code, title FROM tasks WHERE project_id = ? AND state = 'awaiting-go' ORDER BY code, id")
          .all(project.id) as { id: string; code: string; title: string }[];
        return tasks.map((task) => ({ taskId: task.id, code: task.code, title: publicApprovalText(task.title),
          ...(projectId === undefined ? { projectId: project.id, projectName: publicApprovalText(project.name) } : {}) }));
      });
      const requests = projects.flatMap((project) => listRequests(deps.storage.raw, project.id)
        .filter((item) => ["submitted", "need-info"].includes(item.triageState) && item.taskState === "proposed")
        .map((item) => ({ ...item, ...(projectId === undefined ? { projectId: project.id, projectName: publicApprovalText(project.name) } : {}) })));
      const patches = projects.flatMap((project) => pendingPatches({ raw: deps.storage.raw }, project.id)
        .map((patch) => ({ ...patch, ...(projectId === undefined ? { projectName: publicApprovalText(project.name) } : {}) })));
      const monitors = projects.flatMap((project) => (deps.storage.raw.prepare(`SELECT id AS monitorId,project_id AS projectId,name,kind,last_value AS value,
        (SELECT at FROM monitor_events e WHERE e.project_id=m.project_id AND e.monitor_id=m.id AND to_status='tripped' ORDER BY seq DESC LIMIT 1) AS since
        FROM monitors m WHERE project_id=? AND status='tripped' ORDER BY created_at,id`).all(project.id) as { monitorId: string; projectId: string; name: string; kind: string; value: number | null; since: string | null }[])
        .map((row) => ({ ...row,name: publicApprovalText(row.name) })));
      const stalledWorkflows = projects.flatMap((project) => (deps.storage.raw.prepare(`SELECT id AS instanceId,title,state_reason AS reason FROM workflow_instances
        WHERE project_id=? AND state='stalled' ORDER BY created_at,id`).all(project.id) as { instanceId: string; title: string; reason: string | null }[])
        .map((row) => ({ ...row,title: publicApprovalText(row.title),reason: row.reason === null ? null : publicApprovalText(row.reason) })));
      return { apiVersion: API_VERSION, ok: true, approvals, startGates, requests, patches, monitors, stalledWorkflows,
        counts: { monitors: monitors.length, stalledWorkflows: stalledWorkflows.length, patches: patches.length, approvals: approvals.length, startGates: startGates.length, requests: requests.length,
          total: approvals.length + startGates.length + requests.length + patches.length + monitors.length + stalledWorkflows.length } };
    };
    app.get("/inbox", { preHandler: guards.session }, async () => inbox());
    app.get<{ Params: { projectId: string }; Querystring: { state?: string; team?: string; limit?: string } }>(
      "/projects/:projectId/requests", { preHandler: guards.session }, async (request, reply) => {
        const { projectId } = request.params;
        if (!getProject(deps.storage.raw, projectId)) return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
        const query = z.strictObject({ state: z.enum(["submitted", "need-info", "accepted", "declined", "redirected", "merged",
          "draft", "proposed", "ready", "awaiting-go", "active", "in-review", "done", "failed", "cancelled", "superseded"]).optional(),
          team: idSchema.optional(), limit: z.string().regex(/^[1-9][0-9]*$/).transform(Number).refine(Number.isSafeInteger).optional() }).safeParse(request.query);
        if (!query.success) return failure(reply, 400, "validation", "Invalid request filters.", "correct-input", newId);
        return { apiVersion: API_VERSION, ok: true, items: listRequests(deps.storage.raw, projectId, {
          ...(query.data.state === undefined ? {} : { state: query.data.state }), ...(query.data.team === undefined ? {} : { team: query.data.team }),
          ...(query.data.limit === undefined ? {} : { limit: query.data.limit }),
        }) };
      });
    app.get<{ Params: { projectId: string; taskId: string } }>("/projects/:projectId/requests/:taskId",
      { preHandler: guards.session }, async (request, reply) => {
        try { return { apiVersion: API_VERSION, ok: true, request: getRequest(deps.storage.raw,
          { grantOrOperator: { projectId: request.params.projectId, operator: true }, requestId: request.params.taskId }) }; }
        catch (error) {
          if (!(error instanceof RequestError)) throw error;
          return failure(reply, 404, "not-found", "Request not found.", "correct-input", newId);
        }
      });
    app.get<{ Params: { projectId: string } }>("/projects/:projectId/inbox", { preHandler: guards.session }, async (request, reply) => {
      if (!getProject(deps.storage.raw, request.params.projectId))
        return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
      return inbox(request.params.projectId);
    });
    app.get<{ Params: { projectId: string; approvalId: string } }>("/projects/:projectId/approvals/:approvalId",
      { preHandler: guards.session }, async (request, reply) => {
        const approval = getApprovalView(deps.storage.raw, request.params.projectId, request.params.approvalId);
        if (!approval) return failure(reply, 404, "not-found", "Approval not found.", "correct-input", newId);
        return { apiVersion: API_VERSION, ok: true, approval };
      });
    app.get<{ Params: { projectId: string; taskId: string } }>("/projects/:projectId/tasks/:taskId/approvals",
      { preHandler: guards.session }, async (request, reply) => {
        const { projectId, taskId } = request.params;
        if (!getTask(deps.storage.raw, projectId, taskId))
          return failure(reply, 404, "not-found", "Task not found.", "correct-input", newId);
        return { apiVersion: API_VERSION, ok: true, approvals: listApprovals(deps.storage.raw, projectId, { taskId }) };
      });
    app.get<{ Params: { projectId: string; taskId: string } }>(
      "/projects/:projectId/tasks/:taskId/artifacts", { preHandler: guards.session }, async (request, reply) => {
        const { projectId, taskId } = request.params;
        if (!getTask(deps.storage.raw, projectId, taskId))
          return failure(reply, 404, "not-found", "Task not found.", "correct-input", newId);
        return { apiVersion: API_VERSION, ok: true, items: listTaskArtifacts(deps.storage.raw, projectId, taskId) };
      },
    );
    app.get<{ Params: { projectId: string; artifactId: string; version: string } }>(
      "/projects/:projectId/artifacts/:artifactId/versions/:version/content", { preHandler: guards.session }, async (request, reply) => {
        const missing = () => failure(reply, 404, "not-found", "Artifact content not found.", "correct-input", newId);
        const { projectId, artifactId, version } = request.params;
        if (!/^[1-9][0-9]*$/.test(version) || !Number.isSafeInteger(Number(version))) return missing();
        const artifact = getArtifactVersion(deps.storage.raw, projectId, artifactId, Number(version));
        if (!artifact || !deps.artifacts) return missing();
        let bytes: Buffer | null;
        try { bytes = deps.artifacts.store.get(artifact.contentHash); } catch { return missing(); }
        if (bytes === null || bytes.length !== artifact.sizeBytes) return missing();
        if (!["text/x-diff", "text/markdown"].includes(artifact.mediaType))
          return failure(reply, 415, "unsupported", "Artifact media type is not supported.", "correct-input", newId);
        let text: string;
        try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
        catch { return failure(reply, 422, "validation", "Artifact text is not valid UTF-8.", "correct-input", newId); }
        return { apiVersion: API_VERSION, ok: true, mediaType: artifact.mediaType,
          sizeBytes: artifact.sizeBytes, contentHash: artifact.contentHash, text };
      },
    );
    app.get<{ Params: { projectId: string; attemptId: string } }>(
      "/projects/:projectId/attempts/:attemptId/patch", { preHandler: guards.session }, async (request, reply) => {
        const missing = () => failure(reply, 404, "not-found", "Patch not found.", "correct-input", newId);
        const { projectId, attemptId } = request.params;
        if (!deps.dispatch || !deps.evidenceDir || !ATTEMPT_UUID.test(attemptId) ||
          !getAttempt(deps.storage.raw, projectId, attemptId)) return missing();
        const rows = deps.storage.raw.prepare(`SELECT body_json FROM attempt_events
          WHERE project_id = ? AND attempt_id = ? AND kind = 'evidence' ORDER BY seq DESC`)
          .all(projectId, attemptId) as { body_json: string }[];
        try {
          const name = `${attemptId}.patch`;
          const evidence = rows.map((row) => JSON.parse(row.body_json) as { patchFile?: string; patchSha256?: string })
            .find((body) => body.patchFile === name && typeof body.patchSha256 === "string");
          if (!evidence) return missing();
          const data = fs.readFileSync(assertInside(deps.evidenceDir, join(deps.evidenceDir, name)));
          const sha256 = createHash("sha256").update(data).digest("hex");
          if (sha256 !== evidence.patchSha256) return missing();
          return { apiVersion: API_VERSION, ok: true, patch: data.toString("utf8"), sha256, bytes: data.length };
        } catch { return missing(); }
      },
    );
    app.get("/system/backups", { preHandler: guards.session }, async () => ({
      apiVersion: API_VERSION, ok: true, backup: deps.backupStatus?.() ?? null,
    }));
    app.post("/commands", { preHandler: guards.write }, async (request, reply) => {
      // Session ids are bearer credentials. Derive a stable UUID actor without persisting the credential.
      const isApproval = typeof request.body === "object" && request.body !== null
        && "type" in request.body && request.body.type === "approvals.decide";
      const hash = isApproval && request.session ? createHash("sha256").update(request.session.id).digest("hex") : undefined;
      const actorId = hash === undefined ? undefined
        : `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      const r = deps.pipeline.execute(request.body, actorId);
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
      const engagement = getPrimaryEngagement(deps.storage.raw, parsed.data);
      const team = engagement === undefined ? undefined : getTeam(deps.storage.raw, engagement.teamId);
      if (!engagement || !team) return failure(reply, 404, "not-found", "Project team not found.", "correct-input", newId);
      return { apiVersion: API_VERSION, ok: true, team, seats: listSeats(deps.storage.raw, team.id), engagement,
        engagements: projectEngagements(deps.storage.raw, parsed.data) };
    });
    app.get<{ Params: { projectId: string; taskId: string } }>(
      "/projects/:projectId/tasks/:taskId/attempts", { preHandler: guards.session }, async (request, reply) => {
        if (!deps.dispatch) return failure(reply, 404, "not-found", "Dispatch not found.", "correct-input", newId);
        const project = idSchema.safeParse(request.params.projectId);
        const task = idSchema.safeParse(request.params.taskId);
        if (!project.success || !task.success)
          return failure(reply, 400, "validation", "Invalid project or task id.", "correct-input", newId);
        const raw = deps.storage.raw;
        if (!getProject(raw, project.data) || !getTask(raw, project.data, task.data))
          return failure(reply, 404, "not-found", "Project or task not found.", "correct-input", newId);
        const attempts = listAttempts(raw, project.data, task.data).map((attempt) => {
          const seat = attempt.seatId === null ? undefined
            : raw.prepare("SELECT name FROM seats WHERE id = ?").get(attempt.seatId) as { name: string } | undefined;
          return { id: attempt.id, taskId: attempt.taskId, epoch: attempt.epoch, revision: attempt.revision,
            state: attempt.state, outcome: attempt.outcome, runtime: attempt.runtime, seatId: attempt.seatId,
            seatName: seat?.name ?? null, startedAt: attempt.startedAt, endedAt: attempt.endedAt };
        });
        return { apiVersion: API_VERSION, ok: true, attempts };
      },
    );
    app.get<{ Params: { projectId: string; attemptId: string }; Querystring: { afterSeq?: unknown; limit?: unknown } }>(
      "/projects/:projectId/attempts/:attemptId/events", { preHandler: guards.session }, async (request, reply) => {
        if (!deps.dispatch) return failure(reply, 404, "not-found", "Dispatch not found.", "correct-input", newId);
        const project = idSchema.safeParse(request.params.projectId);
        const attempt = idSchema.safeParse(request.params.attemptId);
        if (!project.success || !attempt.success)
          return failure(reply, 400, "validation", "Invalid project or attempt id.", "correct-input", newId);
        const raw = deps.storage.raw;
        if (!getProject(raw, project.data) || !getAttempt(raw, project.data, attempt.data))
          return failure(reply, 404, "not-found", "Project or attempt not found.", "correct-input", newId);
        const integer = (value: unknown, fallback: number, min: number, max: number): number | undefined => {
          if (value === undefined) return fallback;
          if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return undefined;
          const parsed = Number(value);
          return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
        };
        const afterSeq = integer(request.query.afterSeq, 0, 0, Number.MAX_SAFE_INTEGER);
        const limit = integer(request.query.limit, 100, 1, 500);
        if (afterSeq === undefined || limit === undefined)
          return failure(reply, 400, "validation", "Invalid attempt event pagination.", "correct-input", newId);
        const events = listAttemptEvents(raw, project.data, attempt.data, { afterSeq, limit })
          .map(({ seq, at, kind, body }) => ({ seq, at, kind, body }));
        return { apiVersion: API_VERSION, ok: true, events };
      },
    );
  };
}
