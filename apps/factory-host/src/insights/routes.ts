import { API_VERSION, flowInsightsResponseSchema, improvementProposalResponseSchema, improvementProposalsResponseSchema,
  insightsDaysSchema, projectInsightsResponseSchema } from "@factory/contracts";
import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { failure } from "../api/http.js";
import type { ApiGuards } from "../api/server.js";
import { activeAgents } from "../flow/selector.js";
import { definitionOf, getFlow, listFlows } from "../flow/store.js";
import { createIdGenerator, type Clock } from "../ids.js";
import { getProject } from "../projects/service.js";
import { insightsWindow, readFlowInsights, readProjectAgents } from "./read.js";
import { agentFindings, flowFindings } from "./rules.js";
import { listProposals, readProposal } from "./store.js";

type ProjectParams = { projectId: string };
type Query = { days?: unknown };
const parseDays = ({ days }: Query) => insightsDaysSchema.safeParse(days === undefined ? 30
  : typeof days === "string" && /^\d{1,2}$/.test(days) ? Number(days) : days);

export function registerInsightsRoutes(app: FastifyInstance, guards: ApiGuards, { raw, clock }: { raw: Database; clock: Clock }): void {
  const session = { preHandler: guards.session };
  const newId = createIdGenerator(clock);
  const envelope = { ok: true, apiVersion: API_VERSION } as const;
  app.get<{ Params: ProjectParams & { flowId: string }; Querystring: Query }>("/projects/:projectId/flows/:flowId/insights", session,
    async ({ params: { projectId, flowId }, query }, reply) => {
      const days = parseDays(query);
      if (!days.success) return failure(reply, 400, "validation", "Số ngày phải là số nguyên từ 1 đến 90.", "correct-input", newId);
      const row = getFlow(raw, projectId, flowId);
      if (!row) return failure(reply, 404, "not-found", "Không tìm thấy quy trình.", "refresh", newId);
      const window = insightsWindow(projectId, days.data, clock());
      const flow = readFlowInsights(raw, window, row);
      const findings = flowFindings(flow, { draft: definitionOf(row.draft_json), agents: activeAgents(raw, projectId) });
      return flowInsightsResponseSchema.parse({ ...envelope, ...window, flow, findings });
    });
  app.get<{ Params: ProjectParams; Querystring: Query }>("/projects/:projectId/insights", session,
    async ({ params: { projectId }, query }, reply) => {
      const days = parseDays(query);
      if (!days.success) return failure(reply, 400, "validation", "Số ngày phải là số nguyên từ 1 đến 90.", "correct-input", newId);
      if (!getProject(raw, projectId)) return failure(reply, 404, "not-found", "Không tìm thấy dự án.", "refresh", newId);
      const window = insightsWindow(projectId, days.data, clock());
      const active = activeAgents(raw, projectId);
      const flows = listFlows(raw, projectId).map((row) => {
        const flow = readFlowInsights(raw, window, row);
        return { flow, findings: flowFindings(flow, { draft: definitionOf(row.draft_json), agents: active }) };
      });
      const agents = readProjectAgents(raw, window);
      return projectInsightsResponseSchema.parse({ ...envelope, ...window, flows, agents, findings: agentFindings(agents) });
    });
  app.get<{ Params: ProjectParams }>("/projects/:projectId/improvement-proposals", session, async ({ params: { projectId } }, reply) => {
    if (!getProject(raw, projectId)) return failure(reply, 404, "not-found", "Không tìm thấy dự án.", "refresh", newId);
    return improvementProposalsResponseSchema.parse({ ...envelope, proposals: listProposals(raw, projectId) });
  });
  app.get<{ Params: ProjectParams & { id: string } }>("/projects/:projectId/improvement-proposals/:id", session,
    async ({ params: { projectId, id } }, reply) => {
      const proposal = readProposal(raw, projectId, id);
      if (!proposal) return failure(reply, 404, "not-found", "Không tìm thấy đề xuất cải tiến.", "refresh", newId);
      return improvementProposalResponseSchema.parse({ ...envelope, proposal });
    });
}
