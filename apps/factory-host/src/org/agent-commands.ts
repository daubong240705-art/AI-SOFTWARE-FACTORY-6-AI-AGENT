import type { Database } from "better-sqlite3";
import { agentConfigSchema, type AgentRelation, type EntityRef } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerContext, HandlerMap } from "../commands/pipeline.js";
import { agentRevision, currentAgentConfig, ensureRoster, getAgent, getGroup, groupIdsForAgent, parseAgentConfig,
  relationsRevision, writeAgentRevision, type AgentRow, type GroupRow } from "./agents.js";

export const AGENT_COMMANDS = ["agents.create", "agents.update", "agents.clone", "agents.set-status", "agents.set-lead",
  "agents.rollback", "agents.delete", "teams.create", "teams.update", "teams.delete", "relations.set"] as const;

function requireProject(raw: Database, projectId: string): void {
  if (!raw.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId))
    throw new CommandError("not-found", "project not found", "correct-input");
}

function requireAgent(raw: Database, projectId: string, agentId: string, allowArchived = true): AgentRow {
  const agent = getAgent(raw, projectId, agentId);
  if (!agent || (!allowArchived && agent.status === "archived"))
    throw new CommandError("not-found", "agent not found in project", "correct-input");
  return agent;
}

function requireGroup(raw: Database, projectId: string, teamId: string): GroupRow {
  const group = getGroup(raw, projectId, teamId);
  if (!group) throw new CommandError("not-found", "group team not found in project", "correct-input");
  return group;
}

function checkRevision(actual: number, expected: number): void {
  if (actual !== expected) throw new CommandError("conflict", "revision changed", "refresh",
    actual === 0 ? undefined : { currentRevision: actual });
}

const seatEffect = (id: string, revision: number): EntityRef => ({ kind: "seat", id, revision });
const teamEffect = (id: string, revision: number): EntityRef => ({ kind: "team", id, revision });

function clearOtherLeads(raw: Database, teamId: string, agentId: string): EntityRef[] {
  const cleared = raw.prepare(`UPDATE seats SET is_lead = 0, revision = revision + 1
    WHERE team_id = ? AND id <> ? AND is_lead = 1 RETURNING id, revision`).all(teamId, agentId) as { id: string; revision: number }[];
  return cleared.map(({ id, revision }) => seatEffect(id, revision));
}

function bumpTeam(raw: Database, teamId: string): EntityRef {
  const { revision } = raw.prepare("UPDATE teams SET revision = revision + 1 WHERE id = ? RETURNING revision").get(teamId) as { revision: number };
  return teamEffect(teamId, revision);
}

function createAgent(ctx: HandlerContext, projectId: string, input: Parameters<HandlerMap["agents.create"]>[1]["payload"]): { effects: EntityRef[] } {
  const { raw } = ctx;
  if (raw.prepare("SELECT 1 FROM seats WHERE id = ?").get(input.agentId))
    throw new CommandError("conflict", "agent id already exists", "correct-input");
  const { count } = raw.prepare("SELECT count(*) AS count FROM seats WHERE project_id = ? AND config_revision IS NOT NULL")
    .get(projectId) as { count: number };
  if (count >= 500) throw new CommandError("resource-exhausted", "project agent limit reached", "correct-input");
  const groups = [...new Set(input.teamIds)].map((id) => requireGroup(raw, projectId, id));
  for (const group of groups) {
    const { count } = raw.prepare("SELECT count(*) AS count FROM team_members WHERE team_id = ?").get(group.id) as { count: number };
    if (count >= 200) throw new CommandError("resource-exhausted", "team member limit reached", "correct-input");
  }
  if (input.template && !raw.prepare(`SELECT 1 FROM agent_template_revisions WHERE template_id = ? AND revision = ?`)
    .get(input.template.id, input.template.revision))
    throw new CommandError("not-found", "agent template revision not found", "correct-input");
  const roster = ensureRoster(raw, projectId, ctx);
  const cleared = input.isLead ? clearOtherLeads(raw, roster.id, input.agentId) : [];
  const revision = writeAgentRevision(raw, { agentId: input.agentId, projectId, config: input.config,
    actorId: ctx.actorId, clock: ctx.clock, teamId: roster.id, isLead: input.isLead,
    ...(input.template === undefined ? {} : { template: input.template }) });
  const insert = raw.prepare("INSERT INTO team_members (team_id, agent_id) VALUES (?, ?)");
  const teamEffects = groups.map(({ id }) => {
    insert.run(id, input.agentId);
    return bumpTeam(raw, id);
  });
  return { effects: [seatEffect(input.agentId, revision), ...cleared, ...teamEffects] };
}

function removeAgentLinks(raw: Database, projectId: string, agentId: string): EntityRef[] {
  const teams = raw.prepare(`UPDATE teams SET lead_agent_id = CASE WHEN lead_agent_id = ? THEN NULL ELSE lead_agent_id END,
    revision = revision + 1 WHERE project_id = ? AND kind = 'group' AND (lead_agent_id = ? OR id IN
    (SELECT team_id FROM team_members WHERE agent_id = ?)) RETURNING id, revision`)
    .all(agentId, projectId, agentId, agentId) as { id: string; revision: number }[];
  raw.prepare("DELETE FROM team_members WHERE agent_id = ?").run(agentId);
  const removed = raw.prepare("DELETE FROM agent_relations WHERE project_id = ? AND (from_agent_id = ? OR to_agent_id = ?)")
    .run(projectId, agentId, agentId);
  if (removed.changes) bumpRelations(raw, projectId);
  return teams.map(({ id, revision }) => teamEffect(id, revision));
}

function checkGroupName(raw: Database, projectId: string, teamId: string, name: string): void {
  const groups = raw.prepare("SELECT name FROM teams WHERE project_id = ? AND kind = 'group' AND id <> ?")
    .all(projectId, teamId) as { name: string }[];
  if (groups.some((group) => group.name.toLowerCase() === name.toLowerCase()))
    throw new CommandError("conflict", "team name already used in this project", "correct-input");
}

function replaceMembers(raw: Database, projectId: string, teamId: string, memberIds: string[]): void {
  raw.prepare("DELETE FROM team_members WHERE team_id = ?").run(teamId);
  const insert = raw.prepare("INSERT INTO team_members (team_id, agent_id) VALUES (?, ?)");
  for (const id of new Set(memberIds)) {
    requireAgent(raw, projectId, id, false);
    insert.run(teamId, id);
  }
}

function checkRelations(raw: Database, projectId: string, relations: AgentRelation[]): void {
  const agents = new Set<string>();
  const keys = new Set<string>();
  const manages = new Map<string, string[]>();
  for (const { from, to, kind } of relations) {
    agents.add(from); agents.add(to);
    const key = `${from}:${to}:${kind}`;
    if (keys.has(key)) throw new CommandError("validation", "duplicate agent relation", "correct-input");
    keys.add(key);
    if (kind === "manages") {
      const targets = manages.get(from);
      if (targets) targets.push(to);
      else manages.set(from, [to]);
    }
  }
  for (const id of agents) requireAgent(raw, projectId, id, false);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new CommandError("validation", "manages relations form a cycle", "correct-input");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const to of manages.get(id) ?? []) visit(to);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of manages.keys()) visit(id);
}

function bumpRelations(raw: Database, projectId: string): void {
  raw.prepare(`INSERT INTO agent_relation_sets (project_id, revision) VALUES (?, 1)
    ON CONFLICT(project_id) DO UPDATE SET revision = revision + 1`).run(projectId);
}

export function createAgentHandlers(): Pick<HandlerMap, typeof AGENT_COMMANDS[number]> {
  return {
    "agents.create": (ctx, { projectId, payload }) => {
      requireProject(ctx.raw, projectId);
      return createAgent(ctx, projectId, payload);
    },
    "agents.update": (ctx, { projectId, payload }) => {
      requireProject(ctx.raw, projectId);
      const agent = requireAgent(ctx.raw, projectId, payload.agentId);
      checkRevision(agent.revision, payload.expectedRevision);
      if (agent.status === "archived") throw new CommandError("conflict", "archived agent cannot be updated", "correct-input");
      // Saving an unchanged configuration is a no-op: no new revision, nothing to re-pin.
      const current = currentAgentConfig(ctx.raw, agent.id);
      if (current && JSON.stringify(agentConfigSchema.parse(payload.config)) === JSON.stringify(current.config))
        return { effects: [seatEffect(agent.id, agent.revision)] };
      const revision = writeAgentRevision(ctx.raw, { agentId: agent.id, projectId, config: payload.config,
        actorId: ctx.actorId, clock: ctx.clock, existing: agent, ...(payload.note === undefined ? {} : { note: payload.note }) });
      return { effects: [seatEffect(agent.id, revision)] };
    },
    "agents.clone": (ctx, { projectId, payload }) => {
      requireProject(ctx.raw, projectId);
      const source = requireAgent(ctx.raw, projectId, payload.sourceAgentId);
      const { config } = currentAgentConfig(ctx.raw, source.id)!;
      return createAgent(ctx, projectId, { agentId: payload.agentId, config: { ...config, name: payload.name },
        teamIds: groupIdsForAgent(ctx.raw, projectId, source.id), isLead: false });
    },
    "agents.set-status": ({ raw }, { projectId, payload }) => {
      requireProject(raw, projectId);
      const agent = requireAgent(raw, projectId, payload.agentId);
      checkRevision(agent.revision, payload.expectedRevision);
      if (agent.status === "pending-approval" && payload.status === "paused")
        throw new CommandError("conflict", "pending agent must be activated or archived", "correct-input");
      const archived = payload.status === "archived";
      raw.prepare("UPDATE seats SET status = ?, is_lead = ?, revision = revision + 1 WHERE id = ?")
        .run(payload.status, archived ? 0 : agent.is_lead, agent.id);
      return { effects: [seatEffect(agent.id, agent.revision + 1), ...(archived ? removeAgentLinks(raw, projectId, agent.id) : [])] };
    },
    "agents.set-lead": ({ raw }, { projectId, payload }) => {
      requireProject(raw, projectId);
      const agent = requireAgent(raw, projectId, payload.agentId);
      checkRevision(agent.revision, payload.expectedRevision);
      if (agent.status !== "active") throw new CommandError("conflict", "Lead agent must be active", "correct-input");
      const cleared = clearOtherLeads(raw, agent.team_id, agent.id);
      raw.prepare("UPDATE seats SET is_lead = 1, revision = revision + 1 WHERE id = ?").run(agent.id);
      return { effects: [seatEffect(agent.id, agent.revision + 1), ...cleared] };
    },
    "agents.rollback": (ctx, { projectId, payload }) => {
      requireProject(ctx.raw, projectId);
      const agent = requireAgent(ctx.raw, projectId, payload.agentId);
      checkRevision(agent.revision, payload.expectedRevision);
      if (payload.toRevision === agent.config_revision)
        throw new CommandError("conflict", "agent already uses that revision", "correct-input");
      const target = agentRevision(ctx.raw, agent.id, payload.toRevision);
      if (!target) throw new CommandError("not-found", "agent revision not found", "correct-input");
      const revision = writeAgentRevision(ctx.raw, { actorId: ctx.actorId, clock: ctx.clock, projectId, agentId: agent.id, existing: agent,
        config: parseAgentConfig(target), note: `rollback to r${payload.toRevision}` });
      return { effects: [seatEffect(agent.id, revision)] };
    },
    "agents.delete": ({ raw }, { projectId, payload }) => {
      requireProject(raw, projectId);
      const agent = requireAgent(raw, projectId, payload.agentId);
      checkRevision(agent.revision, payload.expectedRevision);
      if (raw.prepare(`SELECT 1 FROM attempt_seats WHERE seat_id = ? UNION ALL SELECT 1 FROM tasks WHERE owner_seat_id = ?
        UNION ALL SELECT 1 FROM conversations WHERE seat_id = ? LIMIT 1`).get(agent.id, agent.id, agent.id))
        throw new CommandError("conflict", "agent has history; archive it instead", "correct-input");
      const teamEffects = removeAgentLinks(raw, projectId, agent.id);
      raw.prepare("DELETE FROM seat_runtime_config WHERE seat_id = ?").run(agent.id);
      raw.prepare("DELETE FROM agent_revisions WHERE agent_id = ?").run(agent.id);
      raw.prepare("DELETE FROM seats WHERE id = ?").run(agent.id);
      return { effects: [seatEffect(agent.id, agent.revision + 1), ...teamEffects] };
    },
    "teams.create": ({ raw }, { projectId, payload }) => {
      requireProject(raw, projectId);
      if (raw.prepare("SELECT 1 FROM teams WHERE id = ?").get(payload.teamId))
        throw new CommandError("conflict", "team id already exists", "correct-input");
      const { count } = raw.prepare("SELECT count(*) AS count FROM teams WHERE project_id = ? AND kind = 'group'")
        .get(projectId) as { count: number };
      if (count >= 100) throw new CommandError("resource-exhausted", "project team limit reached", "correct-input");
      checkGroupName(raw, projectId, payload.teamId, payload.name);
      if (payload.leadAgentId !== null) requireAgent(raw, projectId, payload.leadAgentId, false);
      raw.prepare(`INSERT INTO teams (id, kind, project_id, name, description, charter, lifecycle, revision, lead_agent_id)
        VALUES (?, 'group', ?, ?, ?, '', 'active', 1, ?)`)
        .run(payload.teamId, projectId, payload.name, payload.description, payload.leadAgentId);
      replaceMembers(raw, projectId, payload.teamId, payload.memberIds);
      return { effects: [teamEffect(payload.teamId, 1)] };
    },
    "teams.update": ({ raw }, { projectId, payload }) => {
      requireProject(raw, projectId);
      const group = requireGroup(raw, projectId, payload.teamId);
      checkRevision(group.revision, payload.expectedRevision);
      if (payload.name !== undefined) checkGroupName(raw, projectId, group.id, payload.name);
      const lead = payload.leadAgentId === undefined ? group.lead_agent_id : payload.leadAgentId;
      if (lead !== null) requireAgent(raw, projectId, lead, false);
      if (payload.memberIds !== undefined) replaceMembers(raw, projectId, group.id, payload.memberIds);
      raw.prepare("UPDATE teams SET name = ?, description = ?, lead_agent_id = ?, revision = revision + 1 WHERE id = ?")
        .run(payload.name ?? group.name, payload.description ?? group.description, lead, group.id);
      return { effects: [teamEffect(group.id, group.revision + 1)] };
    },
    "teams.delete": ({ raw }, { projectId, payload }) => {
      requireProject(raw, projectId);
      const group = requireGroup(raw, projectId, payload.teamId);
      checkRevision(group.revision, payload.expectedRevision);
      raw.prepare("DELETE FROM teams WHERE id = ?").run(group.id);
      return { effects: [teamEffect(group.id, group.revision + 1)] };
    },
    "relations.set": (ctx, { projectId, payload }) => {
      const { raw } = ctx;
      requireProject(raw, projectId);
      checkRevision(relationsRevision(raw, projectId), payload.expectedRevision);
      checkRelations(raw, projectId, payload.relations);
      const roster = ensureRoster(raw, projectId, ctx);
      raw.prepare("DELETE FROM agent_relations WHERE project_id = ?").run(projectId);
      const insert = raw.prepare("INSERT INTO agent_relations (project_id, from_agent_id, to_agent_id, kind) VALUES (?, ?, ?, ?)");
      for (const edge of payload.relations) insert.run(projectId, edge.from, edge.to, edge.kind);
      bumpRelations(raw, projectId);
      return { effects: [bumpTeam(raw, roster.id)] };
    },
  };
}
