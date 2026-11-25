import { API_VERSION } from "@factory/contracts";
import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { failure } from "../api/http.js";
import type { ApiGuards } from "../api/server.js";
import { createIdGenerator } from "../ids.js";
import { getProposal, readView, type ProposalRow } from "./store.js";

export function registerSetupRoutes(app: FastifyInstance, guards: ApiGuards, raw: Database) {
  const newId = createIdGenerator();
  const preHandler = guards.session;
  app.get<{ Params: { projectId: string } }>("/projects/:projectId/setup-proposals", { preHandler }, async ({ params }, reply) => {
    if (!raw.prepare("SELECT 1 FROM projects WHERE id=?").get(params.projectId))
      return failure(reply, 404, "not-found", "Không tìm thấy project.", "correct-input", newId);
    const proposals = raw.prepare<[string], ProposalRow>(`SELECT * FROM setup_proposals WHERE project_id=?
      ORDER BY created_at DESC,id DESC LIMIT 100`).all(params.projectId).map((row) => readView(raw, row));
    return { apiVersion: API_VERSION, ok: true, proposals };
  });
  app.get<{ Params: { projectId: string; proposalId: string } }>("/projects/:projectId/setup-proposals/:proposalId", { preHandler }, async ({ params }, reply) => {
    const row = getProposal(raw, params.projectId, params.proposalId);
    if (!row) return failure(reply, 404, "not-found", "Không tìm thấy đề xuất.", "correct-input", newId);
    return { apiVersion: API_VERSION, ok: true, proposal: readView(raw, row) };
  });
}
