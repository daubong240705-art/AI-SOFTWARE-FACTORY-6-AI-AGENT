import type { Database } from "better-sqlite3";
import { agentConfigSchema, MCP_TOOL_NAMES, type AgentConfig, type AgentStatus } from "@factory/contracts";
import type { Clock } from "../ids.js";
import { externalToolPattern } from "../mcp-external/config.js";
import { CommandError } from "../commands/errors.js";

export interface AgentDeps { newId: () => string; clock: Clock }
export interface AgentRow {
  id: string; project_id: string; team_id: string; revision: number; name: string; role: string;
  is_lead: number; status: AgentStatus; config_revision: number;
  template_id: string | null; template_revision: number | null;
}
export interface GroupRow { id: string; project_id: string; revision: number; name: string; description: string; lead_agent_id: string | null }
export interface AgentRevisionRow { revision: number; config_json: string; actor_id: string; note: string | null; created_at: string }
export interface ResolvedSkill { skillId: string; version: number; name: string; description: string; content: string }
export type SkillPin = Pick<ResolvedSkill, "skillId" | "version">;

export function getAgent(raw: Database, projectId: string, agentId: string): AgentRow | undefined {
  return raw.prepare("SELECT * FROM seats WHERE project_id = ? AND id = ? AND config_revision IS NOT NULL")
    .get(projectId, agentId) as AgentRow | undefined;
}

export function getGroup(raw: Database, projectId: string, teamId: string): GroupRow | undefined {
  return raw.prepare("SELECT * FROM teams WHERE project_id = ? AND id = ? AND kind = 'group'").get(projectId, teamId) as GroupRow | undefined;
}

export function agentRevision(raw: Database, agentId: string, revision: number): AgentRevisionRow | undefined {
  return raw.prepare("SELECT * FROM agent_revisions WHERE agent_id = ? AND revision = ?").get(agentId, revision) as AgentRevisionRow | undefined;
}

export function parseAgentConfig(row: Pick<AgentRevisionRow, "config_json">): AgentConfig {
  return agentConfigSchema.parse(JSON.parse(row.config_json));
}

export function resolveSkills(raw: Database, refs: readonly AgentConfig["skills"][number][]): ResolvedSkill[] {
  const resolve = raw.prepare(`SELECT v.skill_id AS skillId, v.version, v.name, v.description, v.content FROM skills s
    JOIN skill_versions v ON v.skill_id = s.id AND v.version = CASE WHEN ? = 'latest' THEN s.latest_version ELSE ? END
    WHERE s.id = ?`);
  return refs.map(({ skillId, version }) => {
    const skill = resolve.get(version, version, skillId) as ResolvedSkill | undefined;
    if (skill) return skill;
    if (!raw.prepare("SELECT 1 FROM skills WHERE id = ?").get(skillId))
      throw new CommandError("not-found", `skill not found: ${skillId}`, "correct-input");
    throw new CommandError("not-found", `skill version not found: ${skillId}@${version}`, "correct-input");
  });
}

export function isKnownToolPattern(name: string): boolean {
  return externalToolPattern.test(name) || MCP_TOOL_NAMES.some((tool) => tool === name
    || (/^[a-z0-9]+(?:\\.[a-z0-9]+)*\\.\\*$/.test(name) && tool.startsWith(name.slice(0, -1))));
}

export function validateAgentConfig(raw: Database, config: AgentConfig) {
  const runtime = seatRuntime(config.runtime.adapter);
  for (const grant of config.tools ?? []) if (!isKnownToolPattern(grant.tool))
    throw new CommandError("validation", `unknown tool pattern: ${grant.tool}`, "correct-input");
  const names = new Set<string>();
  for (const skill of resolveSkills(raw, config.skills)) {
    if (names.has(skill.name)) throw new CommandError("validation", `duplicate skill name: ${skill.name}`, "correct-input");
    names.add(skill.name);
  }
  const configJson = JSON.stringify(config);
  if ([...configJson].length > 262144) throw new CommandError("validation", "agent configuration is too large", "correct-input");
  return { runtime, configJson };
}

export function ensureRoster(raw: Database, projectId: string, deps: AgentDeps): { id: string; revision: number } {
  const existing = raw.prepare("SELECT id, revision FROM teams WHERE project_id = ? AND kind = 'roster'").get(projectId) as { id: string; revision: number } | undefined;
  if (existing) {
    ensureRosterEngagement(raw, projectId, existing.id, deps);
    return existing;
  }
  const id = deps.newId();
  raw.prepare(`INSERT INTO teams (id, revision, name, charter, pack_key, pack_version, lifecycle, pack_digest, kind, project_id, description, lead_agent_id)
    VALUES (?, 1, 'Roster', '', NULL, NULL, 'active', NULL, 'roster', ?, '', NULL)`).run(id, projectId);
  ensureRosterEngagement(raw, projectId, id, deps);
  return { id, revision: 1 };
}

function ensureRosterEngagement(raw: Database, projectId: string, teamId: string, deps: AgentDeps): void {
  if (!raw.prepare("SELECT id FROM engagements WHERE project_id = ? AND team_id = ? AND state = 'active'").get(projectId, teamId))
    raw.prepare(`INSERT INTO engagements (project_id, id, team_id, revision, priority, max_concurrent, state, created_at)
      VALUES (?, ?, ?, 1, 60, 4, 'active', ?)`).run(projectId, deps.newId(), teamId, deps.clock().toISOString());
}

function seatRuntime(adapter: AgentConfig["runtime"]["adapter"]): { runtime: "acp" | "native-opencode" | "fake"; cli: "claude" | "codex" | null } {
  if (adapter === "claude-code") return { runtime: "acp", cli: "claude" };
  if (adapter === "codex") return { runtime: "acp", cli: "codex" };
  if (adapter === "opencode") return { runtime: "native-opencode", cli: null };
  if (adapter === "fake") return { runtime: "fake", cli: null };
  throw new CommandError("unsupported", "runtime adapter api-agent is not available yet", "correct-input");
}

export function writeAgentRevision(raw: Database, input: {
  agentId: string; projectId: string; config: AgentConfig; actorId: string; note?: string; clock: Clock;
} & ({ existing: AgentRow } | { teamId: string; isLead: boolean; template?: { id: string; revision: number; link: boolean } })): number {
  const config = agentConfigSchema.parse(input.config);
  const { runtime, configJson } = validateAgentConfig(raw, config);
  const existing = "existing" in input ? input.existing : undefined;
  const teamId = "teamId" in input ? input.teamId : input.existing.team_id;
  const names = raw.prepare("SELECT name FROM seats WHERE (project_id = ? OR team_id = ?) AND id <> ?")
    .all(input.projectId, teamId, input.agentId) as { name: string }[];
  if (names.some(({ name }) => name.toLowerCase() === config.name.toLowerCase()))
    throw new CommandError("conflict", "name already used in this project", "correct-input");
  const now = input.clock().toISOString();
  const revision = (existing?.config_revision ?? 0) + 1;
  if ("teamId" in input) {
    raw.prepare(`INSERT INTO seats (id, team_id, project_id, revision, name, role, slots, runtime, profile_id, profile_revision,
      config_revision, node_policy, is_lead, template_id, template_revision, template_link, created_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'elastic', ?, ?, ?, ?, ?)`).run(input.agentId, teamId, input.projectId,
      config.name, config.role, config.runtime.maxConcurrent, runtime.runtime, input.agentId, revision, revision, Number(input.isLead),
      input.template?.id ?? null, input.template?.revision ?? null, Number(input.template?.link ?? false), now);
  } else {
    raw.prepare(`UPDATE seats SET name = ?, role = ?, slots = ?, runtime = ?, profile_id = ?, profile_revision = ?,
      config_revision = ?, revision = revision + 1, node_policy = 'elastic', dedicated_node_id = NULL WHERE id = ?`)
      .run(config.name, config.role, config.runtime.maxConcurrent, runtime.runtime, input.agentId, revision, revision, input.agentId);
  }
  raw.prepare(`INSERT INTO agent_revisions (agent_id, revision, config_json, actor_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(input.agentId, revision, configJson, input.actorId, input.note ?? null, now);
  if (runtime.runtime === "fake") raw.prepare("DELETE FROM seat_runtime_config WHERE seat_id = ?").run(input.agentId);
  else raw.prepare(`INSERT INTO seat_runtime_config (seat_id, revision, runtime, cli, model, effort, permission, updated_at)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?) ON CONFLICT(seat_id) DO UPDATE SET revision=seat_runtime_config.revision + 1, runtime=excluded.runtime,
    cli=excluded.cli, model=excluded.model, effort=excluded.effort, permission=excluded.permission, updated_at=excluded.updated_at`)
    .run(input.agentId, runtime.runtime, runtime.cli, config.runtime.model, config.runtime.effort, config.runtime.permission, now);
  return (existing?.revision ?? 0) + 1;
}

export function currentAgentConfig(raw: Database, agentId: string): { config: AgentConfig; revision: number } | null {
  const row = raw.prepare(`SELECT s.config_revision AS revision, r.config_json FROM seats s LEFT JOIN agent_revisions r
    ON r.agent_id = s.id AND r.revision = s.config_revision WHERE s.id = ? AND s.config_revision IS NOT NULL`)
    .get(agentId) as { revision: number; config_json: string | null } | undefined;
  if (!row) return null;
  if (row.config_json === null) throw new Error("Current agent revision is missing");
  return { revision: row.revision, config: parseAgentConfig({ config_json: row.config_json }) };
}

export function relationsRevision(raw: Database, projectId: string): number {
  return (raw.prepare("SELECT revision FROM agent_relation_sets WHERE project_id = ?").get(projectId) as { revision: number } | undefined)?.revision ?? 0;
}

export function groupIdsForAgent(raw: Database, projectId: string, agentId: string): string[] {
  return (raw.prepare(`SELECT t.id FROM team_members m JOIN teams t ON t.id = m.team_id
    WHERE m.agent_id = ? AND t.project_id = ? AND t.kind = 'group' ORDER BY t.id`).all(agentId, projectId) as { id: string }[])
    .map(({ id }) => id);
}
