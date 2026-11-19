import type { Database } from "better-sqlite3";
import type { AgentDetail, AgentRelation, AgentSummary, ProjectAgentsResponse, ProjectTeam } from "@factory/contracts";
import { seatLoad } from "../dispatch/node.js";
import { agentRevision, currentAgentConfig, getAgent, groupIdsForAgent, parseAgentConfig, relationsRevision,
  type AgentRevisionRow, type AgentRow, type GroupRow } from "./agents.js";

function summarize(raw: Database, agent: AgentRow, config: AgentDetail["config"]): AgentSummary {
  const { adapter, model } = config.runtime;
  const latest = agent.template_id === null ? undefined : raw.prepare("SELECT latest_revision FROM agent_templates WHERE id = ?")
    .get(agent.template_id) as { latest_revision: number } | undefined;
  return { id: agent.id, projectId: agent.project_id, revision: agent.revision, configRevision: agent.config_revision,
    status: agent.status, isLead: agent.is_lead === 1, name: config.name, role: config.role, adapter, model,
    teamIds: groupIdsForAgent(raw, agent.project_id, agent.id), live: seatLoad(raw, agent.id).used,
    template: latest && agent.template_id !== null && agent.template_revision !== null
      ? { id: agent.template_id, revision: agent.template_revision, latestRevision: latest.latest_revision } : null };
}

function groupView(raw: Database, group: GroupRow): ProjectTeam {
  const members = raw.prepare("SELECT agent_id FROM team_members WHERE team_id = ? ORDER BY agent_id")
    .all(group.id) as { agent_id: string }[];
  return { id: group.id, projectId: group.project_id, revision: group.revision, name: group.name, description: group.description,
    leadAgentId: group.lead_agent_id, memberIds: members.map(({ agent_id }) => agent_id) };
}

export function projectAgentsView(raw: Database, projectId: string): ProjectAgentsResponse | undefined {
  if (!raw.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId)) return undefined;
  const agents = raw.prepare(`SELECT s.*, r.config_json FROM seats s JOIN agent_revisions r
    ON r.agent_id = s.id AND r.revision = s.config_revision WHERE s.project_id = ? ORDER BY s.name, s.id`)
    .all(projectId) as (AgentRow & Pick<AgentRevisionRow, "config_json">)[];
  const groups = raw.prepare("SELECT * FROM teams WHERE project_id = ? AND kind = 'group' ORDER BY name, id").all(projectId) as GroupRow[];
  const relations = raw.prepare(`SELECT from_agent_id AS "from", to_agent_id AS "to", kind FROM agent_relations
    WHERE project_id = ? ORDER BY from_agent_id, to_agent_id, kind`).all(projectId) as AgentRelation[];
  return { agents: agents.map((agent) => summarize(raw, agent, parseAgentConfig(agent))), teams: groups.map((group) => groupView(raw, group)),
    relations, relationsRevision: relationsRevision(raw, projectId) };
}

export function agentDetailView(raw: Database, projectId: string, agentId: string): AgentDetail | undefined {
  const agent = getAgent(raw, projectId, agentId);
  if (!agent) return undefined;
  const { config } = currentAgentConfig(raw, agentId)!;
  const revisions = raw.prepare(`SELECT revision, created_at AS createdAt, actor_id AS actorId, note FROM agent_revisions
    WHERE agent_id = ? ORDER BY revision DESC LIMIT 200`).all(agentId) as AgentDetail["revisions"];
  return { ...summarize(raw, agent, config), config, revisions };
}

export function agentRevisionView(raw: Database, projectId: string, agentId: string, revision: number) {
  if (!getAgent(raw, projectId, agentId)) return undefined;
  const row = agentRevision(raw, agentId, revision);
  return row && { agentId, revision, createdAt: row.created_at, actorId: row.actor_id, note: row.note, config: parseAgentConfig(row) };
}
