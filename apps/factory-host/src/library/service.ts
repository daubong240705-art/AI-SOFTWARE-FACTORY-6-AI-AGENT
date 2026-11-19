import type { Database } from "better-sqlite3";
import { agentConfigSchema, agentTemplateDetailSchema, libraryResponseSchema, skillVersionSchema,
  type AgentConfig, type AgentTemplateDetail, type AgentTemplateSummary, type LibraryResponse, type SkillVersion } from "@factory/contracts";

type TemplateRow = Omit<AgentTemplateSummary, "source"> & { packKey: string | null; packVersion: string | null };
const templateColumns = `t.id, t.name, t.role, t.description, t.latest_revision AS latestRevision,
  t.source_pack_key AS packKey, t.source_pack_version AS packVersion, t.updated_at AS updatedAt`;

function templateSummary({ packKey, packVersion, ...summary }: TemplateRow) {
  return { ...summary, source: packKey === null ? null : { packKey, packVersion } };
}

export function listLibrary(raw: Database): LibraryResponse {
  const skills = raw.prepare(`SELECT id, name, description, latest_version AS latestVersion, trust, source, updated_at AS updatedAt
    FROM skills ORDER BY name, id`).all();
  const templates = raw.prepare<[], TemplateRow>(`SELECT ${templateColumns} FROM agent_templates t ORDER BY t.name, t.id`)
    .all().map(templateSummary);
  return libraryResponseSchema.parse({ skills, templates });
}

export function getSkillVersion(raw: Database, skillId: string, version: number | "latest"): SkillVersion | undefined {
  const row = raw.prepare(`SELECT v.skill_id AS skillId, v.version, v.name, v.description, v.content, v.sha256, v.created_at AS createdAt
    FROM skills s JOIN skill_versions v ON v.skill_id = s.id AND v.version = coalesce(?, s.latest_version)
    WHERE s.id = ?`).get(version === "latest" ? null : version, skillId);
  return row === undefined ? undefined : skillVersionSchema.parse(row);
}

export function getTemplateDetail(raw: Database, templateId: string, revision?: number): AgentTemplateDetail | undefined {
  const row = raw.prepare<[number | null, string], TemplateRow & { revision: number; config_json: string }>(`
    SELECT ${templateColumns}, r.revision, r.config_json FROM agent_templates t
    JOIN agent_template_revisions r ON r.template_id = t.id AND r.revision = coalesce(?, t.latest_revision)
    WHERE t.id = ?`).get(revision ?? null, templateId);
  if (!row) return undefined;
  const { revision: selected, config_json, ...summary } = row;
  return agentTemplateDetailSchema.parse({
    template: templateSummary(summary), revision: selected, config: JSON.parse(config_json) as unknown,
  });
}

export function findPackTemplate(raw: Database, packKey: string, packVersion: string, seatName: string):
  { templateId: string; revision: number; config: AgentConfig } | undefined {
  const row = raw.prepare<[string, string, string], { templateId: string; revision: number; config_json: string }>(`
    SELECT t.id AS templateId, r.revision, r.config_json FROM agent_templates t
    JOIN agent_template_revisions r ON r.template_id = t.id AND r.revision = t.latest_revision
    WHERE t.source_pack_key = ? AND t.source_pack_version = ? AND t.source_seat_name = ?`).get(packKey, packVersion, seatName);
  if (!row) return undefined;
  return { templateId: row.templateId, revision: row.revision, config: agentConfigSchema.parse(JSON.parse(row.config_json) as unknown) };
}
