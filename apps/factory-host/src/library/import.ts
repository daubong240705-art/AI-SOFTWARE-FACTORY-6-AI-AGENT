import { createHash } from "node:crypto";
import type { Database } from "better-sqlite3";
import { agentConfigSchema, idSchema, skillNameSchema, type AgentConfig } from "@factory/contracts";
import type { LoadedPack } from "../org/pack.js";
import { registryPack, type RegistryPack } from "../org/registry.js";

export interface LibraryDeps { newId: () => string; clock: () => Date }

export interface PackImportResult {
  skills: { name: string; skillId: string; version: number; created: boolean }[];
  templates: { seatName: string; templateId: string; revision: number; created: boolean }[];
}

function skillName(name: string): string {
  const lower = name.toLowerCase();
  if (skillNameSchema.safeParse(lower).success) return lower;
  return skillNameSchema.parse(lower.replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 64));
}

const adapters = { "native-opencode": "opencode", acp: "codex", "api-agent": "codex", fake: "fake" } as const;

/** Convert one pack seat into the validated agent configuration used by templates. */
export function seatToAgentConfig(pack: LoadedPack, seatName: string, skills: { skillId: string; version: number }[]): AgentConfig {
  const seat = pack.manifest.seats.find((candidate) => candidate.name === seatName);
  if (!seat) throw new Error("Pack seat not found");
  const profile = pack.files.profiles.find((candidate) => candidate.path === seat.profile);
  if (!profile) throw new Error("Pack seat profile not found");
  return agentConfigSchema.parse({
    name: seat.name.slice(0, 80),
    role: seat.role,
    description: "",
    goals: [],
    instructions: profile.content.slice(0, 65_536),
    tags: seat.capabilities ?? [],
    runtime: { adapter: adapters[seat.runtime], maxConcurrent: seat.slots },
    skills,
    tools: seat.tools?.map((tool) => ({ tool, mode: "allow" as const })) ?? null,
    delegation: { canAssign: seat.isLead ? "project" : "none" },
  });
}

function importPack(raw: Database, pack: LoadedPack, deps: LibraryDeps, warnings?: string[]): PackImportResult {
  return raw.transaction((): PackImportResult => {
    const { manifest, files } = pack;
    const now = deps.clock().toISOString();
    const result: PackImportResult = { skills: [], templates: [] };
    const source = `pack:${manifest.key}`;
    const description = manifest.description.slice(0, 1_024);
    const lookupSkill = raw.prepare<[string, string], { id: string; version: number; sha256: string }>(`
      SELECT s.id, s.latest_version AS version, v.sha256 FROM skills s
      LEFT JOIN skill_versions v ON v.skill_id = s.id AND v.version = s.latest_version
      WHERE s.name = ? AND s.source = ?`);
    const insertSkill = raw.prepare(`INSERT INTO skills
      (id, revision, name, description, latest_version, trust, source, created_at, updated_at)
      VALUES (?, 1, ?, ?, 1, 'instructions', ?, ?, ?)`);
    const insertVersion = raw.prepare(`INSERT INTO skill_versions
      (skill_id, version, name, description, content, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const advanceSkill = raw.prepare("UPDATE skills SET latest_version = ?, revision = revision + 1, updated_at = ? WHERE id = ?");

    for (const file of files.skills) {
      if (file.content.length > 65_536) {
        warnings?.push(`Skill skipped: ${file.name} exceeds 65,536 characters`);
        continue;
      }
      const name = skillName(file.name);
      const existing = lookupSkill.get(name, source);
      const hash = createHash("sha256").update(file.content, "utf8").digest("hex");
      if (existing?.sha256 === hash) {
        result.skills.push({ name, skillId: existing.id, version: existing.version, created: false });
        continue;
      }
      const skillId = existing?.id ?? idSchema.parse(deps.newId());
      const version = (existing?.version ?? 0) + 1;
      if (!existing) insertSkill.run(skillId, name, description, source, now, now);
      insertVersion.run(skillId, version, name, description, file.content, hash, now);
      if (existing) advanceSkill.run(version, now, skillId);
      result.skills.push({ name, skillId, version, created: true });
    }

    const lookupTemplate = raw.prepare<[string, string, string], { id: string; revision: number }>(`
      SELECT id, latest_revision AS revision FROM agent_templates
      WHERE source_pack_key = ? AND source_pack_version = ? AND source_seat_name = ?`);
    const insertTemplate = raw.prepare(`INSERT INTO agent_templates
      (id, revision, name, role, description, latest_revision, source_pack_key, source_pack_version, source_seat_name, created_at, updated_at)
      VALUES (?, 1, ?, ?, ?, 1, ?, ?, ?, ?, ?)`);
    const insertRevision = raw.prepare(`INSERT INTO agent_template_revisions
      (template_id, revision, config_json, created_at) VALUES (?, 1, ?, ?)`);
    const skills = result.skills.map(({ skillId, version }) => ({ skillId, version }));
    for (const seat of manifest.seats) {
      const existing = lookupTemplate.get(manifest.key, manifest.version, seat.name);
      if (existing) {
        result.templates.push({ seatName: seat.name, templateId: existing.id, revision: existing.revision, created: false });
        continue;
      }
      const templateId = idSchema.parse(deps.newId());
      const config = seatToAgentConfig(pack, seat.name, skills);
      insertTemplate.run(templateId, config.name, config.role, manifest.description.slice(0, 2_000),
        manifest.key, manifest.version, seat.name, now, now);
      insertRevision.run(templateId, JSON.stringify(config), now);
      result.templates.push({ seatName: seat.name, templateId, revision: 1, created: true });
    }
    return result;
  }).immediate();
}

/** Idempotently import one loaded pack in a single immediate transaction. */
export function importPackToLibrary(raw: Database, pack: LoadedPack, deps: LibraryDeps): PackImportResult {
  return importPack(raw, pack, deps);
}

/** Import all registry packs, isolating failures to the individual pack. */
export function importPacksToLibrary(raw: Database, packs: readonly RegistryPack[], deps: LibraryDeps,
  onError?: (packKey: string, message: string) => void): PackImportResult[] {
  const results: PackImportResult[] = [];
  for (const entry of packs) {
    const warnings: string[] = [];
    try { results.push(importPack(raw, registryPack(entry), deps, warnings)); }
    catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
    for (const message of warnings) {
      try { onError?.(entry.key, message); } catch {}
    }
  }
  return results;
}
