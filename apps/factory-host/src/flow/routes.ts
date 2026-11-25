import type { FastifyInstance } from "fastify";
import { API_VERSION, flowDetailSchema, flowRunDetailSchema, projectFlowsResponseSchema } from "@factory/contracts";
import { failure } from "../api/http.js";
import type { ApiGuards } from "../api/server.js";
import { createIdGenerator } from "../ids.js";
import { getProject } from "../projects/service.js";
import type { Storage } from "../storage/database.js";
import { publishIssues } from "./commands.js";
import { decode, definitionOf, flowSummary, getFlow, getRun, nodeHistory, runSummary, type FlowRow, type RunRow } from "./store.js";

export function registerFlowRoutes(app: FastifyInstance, guards: ApiGuards, { storage, integrations }: { storage: Storage;
  integrations?: import("../integrations/store.js").IntegrationStore }): void {
  const { raw } = storage;
  const newId = createIdGenerator();
  const preHandler = guards.session;
  app.get<{ Params: { projectId: string } }>("/projects/:projectId/flows", { preHandler }, async ({ params: { projectId } }, reply) => {
    if (!getProject(raw, projectId)) return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
    const flows = (raw.prepare("SELECT * FROM flows WHERE project_id=? ORDER BY updated_at DESC,id LIMIT 500").all(projectId) as FlowRow[])
      .map((row) => flowSummary(raw, row));
    const runs = (raw.prepare("SELECT * FROM flow_runs WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 200").all(projectId) as RunRow[]).map(runSummary);
    return { apiVersion: API_VERSION, ok: true, ...projectFlowsResponseSchema.parse({ flows, runs }) };
  });
  app.get<{ Params: { projectId: string; flowId: string } }>("/projects/:projectId/flows/:flowId", { preHandler }, async ({ params: { projectId, flowId } }, reply) => {
    const flow = getFlow(raw, projectId, flowId);
    if (!flow) return failure(reply, 404, "not-found", "Flow not found.", "correct-input", newId);
    const draft = definitionOf(flow.draft_json);
    const versions = raw.prepare(`SELECT version,sha256,published_at AS publishedAt,actor_id AS actorId FROM flow_versions
      WHERE project_id=? AND flow_id=? ORDER BY version DESC LIMIT 500`).all(projectId, flowId);
    return { apiVersion: API_VERSION, ok: true, ...flowDetailSchema.parse({ flow: flowSummary(raw, flow), draft,
      issues: publishIssues(raw, projectId, draft, integrations).slice(0, 500), versions }) };
  });
  app.get<{ Params: { projectId: string; runId: string } }>("/projects/:projectId/flow-runs/:runId", { preHandler }, async ({ params: { projectId, runId } }, reply) => {
    const run = getRun(raw, projectId, runId);
    if (!run) return failure(reply, 404, "not-found", "Flow run not found.", "correct-input", newId);
    return { apiVersion: API_VERSION, ok: true, ...flowRunDetailSchema.parse({ run: runSummary(run), definition: definitionOf(run.definition_json),
      inputs: decode(run.inputs_json), nodeRuns: nodeHistory(raw, projectId, runId) }) };
  });
}
