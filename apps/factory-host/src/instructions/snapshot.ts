import type { Database } from "better-sqlite3";
import type { AgentConfig } from "@factory/contracts";
import { agentRevision, currentAgentConfig, parseAgentConfig, resolveSkills, type SkillPin } from "../org/agents.js";
import { packManifestSchema, type LoadedPack } from "../org/pack.js";
import { registryPack, type RegistryPack } from "../org/registry.js";

export interface SeatInstructions {
  packDigest: string | null; agentRevision: number | null; skillVersions: SkillPin[]; profilePath: string; profile: string;
  skills: { name: string; description: string }[];
}

export interface AgentInstructionPin { revision: number; skillVersions: SkillPin[] }

export function getAttemptInstructionPin(raw: Database, projectId: string, attemptId: string): AgentInstructionPin | undefined {
  const row = raw.prepare(`SELECT agent_revision, skill_versions_json FROM attempt_instructions
    WHERE project_id = ? AND attempt_id = ? AND agent_revision IS NOT NULL`).get(projectId, attemptId) as
    { agent_revision: number; skill_versions_json: string } | undefined;
  return row && { revision: row.agent_revision, skillVersions: JSON.parse(row.skill_versions_json) as SkillPin[] };
}

function agentProfile(config: AgentConfig): string {
  const bullets = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
  return [`# ${config.name} — ${config.role}`, config.description, config.goals.length && `## Goals\n${bullets(config.goals)}`,
    config.instructions && `## Instructions\n${config.instructions}`,
    config.workRules.length && `## Work rules\n${bullets(config.workRules)}`].filter(Boolean).join("\n\n");
}

export function capturePackSnapshot(raw: Database, pack: LoadedPack, now: Date | string): string {
  return raw.transaction(() => {
    raw.prepare(`INSERT OR IGNORE INTO pack_snapshots (digest, pack_key, pack_version, manifest_json, captured_at)
      VALUES (?, ?, ?, ?, ?)`).run(pack.digest, pack.manifest.key, pack.manifest.version,
      JSON.stringify(pack.manifest), typeof now === "string" ? now : now.toISOString());
    const insert = raw.prepare(`INSERT OR IGNORE INTO pack_files (digest, path, kind, name, description, content)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const profile of pack.files.profiles) insert.run(pack.digest, profile.path, "profile", null, null, profile.content);
    for (const skill of pack.files.skills) insert.run(pack.digest, skill.path, "skill", skill.name, skill.description, skill.content);
    return pack.digest;
  })();
}

function pinnedSeat(raw: Database, input: { seatId: string }) {
  const row = raw.prepare(`SELECT t.pack_digest AS digest, s.name, p.manifest_json AS manifest
    FROM seats s JOIN teams t ON t.id = s.team_id JOIN pack_snapshots p ON p.digest = t.pack_digest
    WHERE s.id = ?`).get(input.seatId) as { digest: string; name: string; manifest: string } | undefined;
  if (!row) return null;
  const manifest = packManifestSchema.parse(JSON.parse(row.manifest) as unknown);
  const seat = manifest.seats.find((entry) => entry.name === row.name);
  if (!seat) return null;
  return { digest: row.digest, seat, index: manifest.seats.indexOf(seat) };
}

/** Position of the seat in its pinned manifest: the pack author's order of preference for default work. */
export function getSeatOrder(raw: Database, input: { seatId: string }): number | null {
  if (raw.prepare("SELECT 1 FROM seats WHERE id = ? AND config_revision IS NOT NULL").get(input.seatId)) return null;
  return pinnedSeat(raw, input)?.index ?? null;
}

export function getSeatCapabilities(raw: Database, input: { seatId: string }): string[] | null {
  const agent = currentAgentConfig(raw, input.seatId);
  if (agent) return agent.config.tags;
  const pinned = pinnedSeat(raw, input);
  return pinned === null ? null : pinned.seat.capabilities ?? null;
}

export function getSeatTools(raw: Database, input: { seatId: string }): string[] | null {
  const agent = currentAgentConfig(raw, input.seatId);
  if (agent) return allowedAgentTools(agent.config.tools);
  return pinnedSeat(raw, input)?.seat.tools ?? null;
}

export function allowedAgentTools(tools: AgentConfig["tools"]): string[] | null {
  if (tools === null) return null;
  const denied = new Set(tools.filter(({ mode }) => mode === "deny").map(({ tool }) => tool));
  return tools.filter(({ mode, tool }) => mode === "allow" && !denied.has(tool)).map(({ tool }) => tool);
}

export function getSeatInstructions(raw: Database, input: { seatId: string; pin?: AgentInstructionPin }): SeatInstructions | null {
  const agent = currentAgentConfig(raw, input.seatId);
  if (agent) {
    const revision = input.pin?.revision ?? agent.revision;
    const config = revision === agent.revision ? agent.config : parseAgentConfig(agentRevision(raw, input.seatId, revision)!);
    const skills = resolveSkills(raw, input.pin?.skillVersions ?? config.skills);
    return { packDigest: null, agentRevision: revision, profilePath: `agent:${revision}`, profile: agentProfile(config),
      skills: skills.map(({ name, description }) => ({ name, description })), skillVersions: skills.map(({ skillId, version }) => ({ skillId, version })) };
  }
  const row = pinnedSeat(raw, input);
  if (!row) return null;
  const { seat } = row;
  const profile = raw.prepare("SELECT content FROM pack_files WHERE digest = ? AND path = ? AND kind = 'profile'")
    .get(row.digest, seat.profile) as { content: string } | undefined;
  if (!profile) return null;
  const skills = raw.prepare(`SELECT name, description FROM pack_files WHERE digest = ? AND kind = 'skill' ORDER BY path`)
    .all(row.digest) as { name: string; description: string }[];
  return { packDigest: row.digest, agentRevision: null, skillVersions: [], profilePath: seat.profile, profile: profile.content, skills };
}

export function getSkill(raw: Database, input: { seatId: string; name: string; pin?: AgentInstructionPin }): string | null {
  const agent = currentAgentConfig(raw, input.seatId);
  if (agent) return resolveSkills(raw, input.pin?.skillVersions ?? agent.config.skills).find(({ name }) => name === input.name)?.content ?? null;
  const row = raw.prepare(`SELECT f.content FROM seats s JOIN teams t ON t.id = s.team_id
    JOIN pack_files f ON f.digest = t.pack_digest AND f.kind = 'skill' WHERE s.id = ? AND f.name = ?`)
    .get(input.seatId, input.name) as { content: string } | undefined;
  return row?.content ?? null;
}

/** Startup recovery is best effort and only captures the exact registered pack version. */
export function backfillPackSnapshots(raw: Database, packs: readonly RegistryPack[], now: Date | string): void {
  let failed = false;
  try {
    const teams = raw.prepare(`SELECT id, pack_key, pack_version FROM teams
      WHERE pack_digest IS NULL AND pack_key IS NOT NULL AND pack_version IS NOT NULL`)
      .all() as { id: string; pack_key: string; pack_version: string }[];
    for (const team of teams) {
      const entry = packs.find((pack) => pack.key === team.pack_key && pack.version === team.pack_version);
      if (!entry) continue;
      try {
        raw.transaction(() => {
          const digest = capturePackSnapshot(raw, registryPack(entry), now);
          raw.prepare("UPDATE teams SET pack_digest = ? WHERE id = ? AND pack_digest IS NULL").run(digest, team.id);
        })();
      } catch { failed = true; }
    }
  } catch { failed = true; }
  if (failed) console.error("Instructions unavailable");
}

/**
 * Moves teams of the listed packs to the registered pack of the same key and version when its
 * content changed (profiles, skills, tools), so existing projects get improved instructions.
 * Seats are matched by name; a team is skipped when a seat of the team is missing from the new
 * manifest. Runs at startup, before any attempt starts, so no running attempt changes underneath.
 */
export function followPackUpdates(raw: Database, packs: readonly RegistryPack[], keys: readonly string[], now: Date | string): string[] {
  const moved: string[] = [];
  if (!keys.length) return moved;
  const teams = raw.prepare(`SELECT id, name, pack_key, pack_version, pack_digest FROM teams
    WHERE pack_key IS NOT NULL AND pack_version IS NOT NULL AND pack_digest IS NOT NULL`)
    .all() as { id: string; name: string; pack_key: string; pack_version: string; pack_digest: string }[];
  for (const team of teams) {
    if (!keys.includes(team.pack_key)) continue;
    const entry = packs.find((pack) => pack.key === team.pack_key && pack.version === team.pack_version);
    if (!entry) continue;
    try {
      const pack = registryPack(entry);
      if (pack.digest === team.pack_digest) continue;
      const seatNames = new Set(pack.manifest.seats.map((seat) => seat.name));
      const seats = raw.prepare("SELECT name FROM seats WHERE team_id = ?").all(team.id) as { name: string }[];
      if (seats.some((seat) => !seatNames.has(seat.name))) continue;
      raw.transaction(() => {
        capturePackSnapshot(raw, pack, now);
        raw.prepare("UPDATE teams SET pack_digest = ? WHERE id = ? AND pack_digest = ?").run(pack.digest, team.id, team.pack_digest);
      })();
      moved.push(`${team.name}: ${team.pack_digest.slice(0, 10)} -> ${pack.digest.slice(0, 10)}`);
    } catch { console.error("Pack update skipped"); }
  }
  return moved;
}
