import { API_VERSION, commandSchema, type AgentAdapter, type AgentRelation, type ApiError, type Command } from "@factory/contracts";
import type { Database } from "better-sqlite3";
import { CommandError } from "../commands/errors.js";
import type { HandlerContext, HandlerMap, createCommandPipeline } from "../commands/pipeline.js";
import type { EventHub } from "../events/hub.js";
import { getFlow } from "../flow/store.js";
import { relationsRevision } from "../org/agents.js";
import { getProposal, issue } from "./store.js";
import { resolveFlowAgents, validateProposal } from "./validation.js";

export const SETUP_COMMANDS = ["setup.propose", "setup.apply", "setup.discard"] as const;
type Pipeline = ReturnType<typeof createCommandPipeline>;
type SetupChild = Extract<Command, { type: "agents.create" | "teams.create" | "relations.set" | "flows.create" | "flows.save-draft" }>;
type ChildInput = { [Type in SetupChild["type"]]: Pick<Extract<SetupChild, { type: Type }>, "type" | "payload"> }[SetupChild["type"]];

function requireProposal(raw: Database, projectId: string, id: string, expectedRevision?: number) {
  const row = getProposal(raw, projectId, id);
  if (!row) throw new CommandError("not-found", "Không tìm thấy đề xuất.", "correct-input");
  if (expectedRevision !== undefined && row.revision !== expectedRevision)
    throw new CommandError("conflict", "Đề xuất đã thay đổi.", "refresh", { currentRevision: row.revision });
  return row;
}

function applyError(code: ApiError["code"], path: string, message: string, fields = [issue(path, message)]) {
  const extra: Pick<ApiError, "fields"> & { currentRevision?: number } = { fields };
  return new CommandError(code, message, "correct-input", extra);
}

export function proposeSetup({ raw, clock }: HandlerContext,
  { projectId, payload }: Pick<Extract<Command, { type: "setup.propose" }>, "projectId" | "payload">, kick: () => void) {
  if (!raw.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId))
    throw new CommandError("not-found", "Không tìm thấy project.", "correct-input");
  if (getProposal(raw, projectId, payload.proposalId))
    throw new CommandError("conflict", "Mã đề xuất đã được sử dụng.", "correct-input");
  const flowId = payload.mode === "flow" ? payload.flowId : undefined;
  const flow = flowId ? getFlow(raw, projectId, flowId) : undefined;
  if (flowId && (!flow || flow.archived))
    throw new CommandError("not-found", "Không tìm thấy workflow có thể chỉnh sửa.", "correct-input");
  raw.prepare(`INSERT INTO setup_proposals (project_id,id,state,request,mode,flow_id,flow_revision,created_at)
    VALUES (?,?,'generating',?,?,?,?,?)`).run(projectId, payload.proposalId, payload.request, payload.mode,
    flowId ?? null, flow?.revision ?? null, clock().toISOString());
  kick();
  return { effects: [] };
}

export function createSetupHandlers(deps: { adapters: ReadonlySet<AgentAdapter>; executeChild: Pipeline["execute"]; kick: () => void }):
  Pick<HandlerMap, typeof SETUP_COMMANDS[number]> {
  return {
    "setup.propose": (ctx, command) => proposeSetup(ctx, command, deps.kick),
    "setup.apply": (ctx, { projectId, payload }) => {
      const { raw, newId } = ctx;
      const row = requireProposal(raw, projectId, payload.proposalId, payload.expectedRevision);
      if (row.state !== "ready") throw new CommandError("conflict", "Đề xuất chưa sẵn sàng để áp dụng.", "refresh");
      const { proposal, issues } = validateProposal(raw, row, payload.edited ?? JSON.parse(row.proposal_json!), deps.adapters);
      if (!proposal || issues.length) throw applyError("validation", "", "Đề xuất không còn hợp lệ.", issues);

      const execute = (input: ChildInput, path: string) => {
        try {
          const result = deps.executeChild({ apiVersion: API_VERSION, commandId: newId(), projectId, ...input },
            ctx.actorId, ctx.actorIsOperator);
          if (!result.body.ok) throw applyError(result.body.error.code, path, result.body.error.message);
        } catch (error) {
          if (error instanceof CommandError) throw error;
          throw applyError("conflict", path, "Không thể áp dụng thay đổi. Không có thay đổi nào được lưu.");
        }
      };
      const agentIds = new Map(proposal.agents.map(({ key }) => [key, newId()]));
      const teamIds = proposal.teams.map(() => newId());
      const flowIds = proposal.flows.map(() => row.flow_id ?? newId());
      proposal.agents.forEach(({ key, config }, index) => execute({ type: "agents.create", payload: {
        agentId: agentIds.get(key)!, config, teamIds: [], isLead: false,
      } }, `agents.${index}`));
      proposal.teams.forEach(({ name, description, memberKeys, leadKey }, index) => execute({ type: "teams.create", payload: {
        teamId: teamIds[index]!, name, description, memberIds: memberKeys.map((key) => agentIds.get(key)!),
        leadAgentId: leadKey === undefined ? null : agentIds.get(leadKey)!,
      } }, `teams.${index}`));
      if (proposal.relations.length) {
        const existing = raw.prepare<[string], AgentRelation>(`SELECT from_agent_id AS "from", to_agent_id AS "to", kind
          FROM agent_relations WHERE project_id=? ORDER BY from_agent_id,to_agent_id,kind`).all(projectId);
        const relations = [...existing, ...proposal.relations.map(({ fromKey, toKey, kind }) =>
          ({ from: agentIds.get(fromKey)!, to: agentIds.get(toKey)!, kind }))];
        execute({ type: "relations.set", payload: { expectedRevision: relationsRevision(raw, projectId), relations } }, "relations");
      }
      proposal.flows.forEach((flow, index) => {
        const draft = { flowId: flowIds[index]!, definition: resolveFlowAgents(flow, agentIds) };
        execute(row.flow_revision === null ? { type: "flows.create", payload: draft }
          : { type: "flows.save-draft", payload: { ...draft, expectedRevision: row.flow_revision } }, `flows.${index}`);
      });
      raw.prepare(`UPDATE setup_proposals SET state='applied', revision=revision+1, proposal_json=?, applied_json=?, issues_json='[]'
        WHERE project_id=? AND id=?`).run(JSON.stringify(proposal), JSON.stringify({ agentIds: [...agentIds.values()], teamIds, flowIds }),
        projectId, row.id);
      return { effects: [] };
    },
    "setup.discard": ({ raw }, { projectId, payload }) => {
      const row = requireProposal(raw, projectId, payload.proposalId, payload.expectedRevision);
      if (row.state === "applied" || row.state === "discarded")
        throw new CommandError("conflict", "Không thể bỏ đề xuất ở trạng thái này.", "refresh");
      raw.prepare("UPDATE setup_proposals SET state='discarded', revision=revision+1 WHERE project_id=? AND id=?").run(projectId, row.id);
      return { effects: [] };
    },
  };
}

export function withSetupApplyIssues(pipeline: Pipeline, raw: Database, hub: EventHub): Pipeline {
  return { execute(body, actorId, actorIsOperator) {
    if (!body || typeof body !== "object" || !("type" in body) || body.type !== "setup.apply")
      return pipeline.execute(body, actorId, actorIsOperator);
    const command = commandSchema.safeParse(body);
    if (!command.success || command.data.type !== "setup.apply") return pipeline.execute(body, actorId, actorIsOperator);
    const { projectId, payload } = command.data;
    return hub.transaction(() => {
      const result = pipeline.execute(body, actorId, actorIsOperator);
      if (!result.replayed && !result.body.ok && result.body.error.fields?.length) {
        raw.prepare(`UPDATE setup_proposals SET issues_json=?, revision=revision+1
          WHERE project_id=? AND id=? AND revision=? AND state='ready'`).run(JSON.stringify(result.body.error.fields),
          projectId, payload.proposalId, payload.expectedRevision);
      }
      return result;
    });
  } };
}
