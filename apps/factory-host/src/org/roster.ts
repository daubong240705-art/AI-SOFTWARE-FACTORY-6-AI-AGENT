import type { Database } from "better-sqlite3";
import { MCP_TOOL_NAMES } from "@factory/contracts";
import { capturePackSnapshot } from "../instructions/snapshot.js";
import { importPackToLibrary, seatToAgentConfig } from "../library/import.js";
import { findPackTemplate } from "../library/service.js";
import { ensureRoster, isKnownToolPattern, writeAgentRevision, type AgentDeps } from "./agents.js";
import type { LoadedPack } from "./pack.js";
import { findLeadSeat } from "./service.js";

export type RosterDeps = AgentDeps & { defaultAgentCli?: "claude" | "codex" | undefined };

function uniqueName(names: Set<string>, name: string, suffix: string, limit: number): string {
  let candidate = name.slice(0, limit);
  for (let number = 1; names.has(candidate.toLowerCase()); number++) {
    const ordinal = number === 1 ? "" : ` ${number}`;
    const ending = `${suffix.slice(0, limit - ordinal.length - 1)}${ordinal}`;
    candidate = `${name.slice(0, limit - ending.length)}${ending}`;
  }
  names.add(candidate.toLowerCase());
  return candidate;
}

function snapshotTemplate(raw: Database, pack: LoadedPack, seatName: string,
  skills: ReturnType<typeof importPackToLibrary>["skills"], deps: RosterDeps) {
  const template = findPackTemplate(raw, pack.manifest.key, pack.manifest.version, seatName);
  if (!template) throw new Error("Pack seat template unavailable");
  const config = seatToAgentConfig(pack, seatName, skills.map(({ skillId, version }) => ({ skillId, version })));
  if (config.runtime.adapter === "opencode" && deps.defaultAgentCli) {
    config.runtime.adapter = deps.defaultAgentCli === "claude" ? "claude-code" : "codex";
    config.runtime.permission = "autonomous";
  }
  // Legacy packs allow built-in namespace wildcards; pin their effective tool set for roster agents.
  if (config.tools?.some(({ tool }) => !isKnownToolPattern(tool))) {
    const grants = config.tools.flatMap((grant) => isKnownToolPattern(grant.tool) || !grant.tool.endsWith(".*") ? [grant]
      : MCP_TOOL_NAMES.filter((tool) => tool.startsWith(grant.tool.slice(0, -1))).map((tool) => ({ ...grant, tool })));
    config.tools = [...new Map(grants.map((grant) => [grant.tool, grant])).values()];
  }
  const json = JSON.stringify(config);
  if (json === JSON.stringify(template.config)) return template;

  // A followed snapshot can differ from the library head without changing the pack version.
  const revisions = raw.prepare<[string], { revision: number; config_json: string }>(`SELECT revision, config_json
    FROM agent_template_revisions WHERE template_id = ? ORDER BY revision DESC`).all(template.templateId);
  const matching = revisions.find((row) => row.config_json === json);
  const revision = matching?.revision ?? (revisions[0]!.revision + 1);
  if (!matching) raw.prepare(`INSERT INTO agent_template_revisions (template_id, revision, config_json, created_at)
    VALUES (?, ?, ?, ?)`).run(template.templateId, revision, json, deps.clock().toISOString());
  return { templateId: template.templateId, revision, config };
}

export function agentsFromPack(raw: Database, input: {
  projectId: string; pack: LoadedPack; actorId: string; groupName?: string;
}, deps: RosterDeps): { rosterId: string; agentIds: Map<string, string>; created: number } {
  return raw.transaction(() => {
    const { projectId, pack, actorId, groupName } = input;
    const { skills } = importPackToLibrary(raw, pack, deps);
    const { manifest } = pack;
    const { id: rosterId } = ensureRoster(raw, projectId, deps);
    const digest = capturePackSnapshot(raw, pack, deps.clock());
    raw.prepare(`UPDATE teams SET pack_key = ?, pack_version = ?, pack_digest = ? WHERE id = ? AND pack_key IS NULL`)
      .run(manifest.key, manifest.version, digest, rosterId);
    const names = new Set(raw.prepare<[string, string], { name: string }>("SELECT name FROM seats WHERE project_id = ? OR team_id = ?")
      .all(projectId, rosterId).map(({ name }) => name.toLowerCase()));
    const agentIds = new Map<string, string>();
    let hasLead = Boolean(findLeadSeat(raw, rosterId));
    let groupLeadId: string | null = null;
    for (const seat of manifest.seats) {
      const template = snapshotTemplate(raw, pack, seat.name, skills, deps);
      const config = { ...template.config, name: uniqueName(names, template.config.name, ` (${manifest.name.slice(0, 70)})`, 80) };
      const agentId = deps.newId();
      writeAgentRevision(raw, { agentId, projectId, config, actorId, clock: deps.clock,
        note: `created from pack ${manifest.key}@${manifest.version}`, teamId: rosterId, isLead: seat.isLead && !hasLead,
        template: { id: template.templateId, revision: template.revision, link: false } });
      agentIds.set(seat.name, agentId);
      if (seat.isLead) { hasLead = true; groupLeadId = agentId; }
    }
    if (groupName !== undefined) {
      const groupNames = new Set(raw.prepare<[string], { name: string }>("SELECT name FROM teams WHERE project_id = ? AND kind = 'group'")
        .all(projectId).map(({ name }) => name.toLowerCase()));
      const groupId = deps.newId();
      raw.prepare(`INSERT INTO teams (id, kind, project_id, name, description, charter, lifecycle, revision, lead_agent_id)
        VALUES (?, 'group', ?, ?, ?, '', 'active', 1, ?)`)
        .run(groupId, projectId, uniqueName(groupNames, groupName, "", 80), manifest.description, groupLeadId);
      const member = raw.prepare("INSERT INTO team_members (team_id, agent_id) VALUES (?, ?)");
      for (const agentId of agentIds.values()) member.run(groupId, agentId);
    }
    return { rosterId, agentIds, created: agentIds.size };
  }).immediate();
}
