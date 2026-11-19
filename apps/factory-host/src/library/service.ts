import type { Database } from "better-sqlite3";
import { API_VERSION, idSchema, agentConfigSchema, agentTemplateDetailSchema, libraryResponseSchema, skillDetailSchema, skillVersionSchema,
  type AgentConfig, type AgentTemplateDetail, type AgentTemplateSummary, type LibraryResponse, type SkillDetail, type SkillVersion } from "@factory/contracts";
import type { FastifyInstance } from "fastify";
import { failure } from "../api/http.js";
import { CommandError } from "../commands/errors.js";
import { groupChain, projectGroupId } from "../groups/settings.js";
import { createIdGenerator } from "../ids.js";

type TemplateRow = Omit<AgentTemplateSummary, "source"> & { packKey: string | null; packVersion: string | null };
const templateColumns = `t.id, t.name, t.role, t.description, t.latest_revision AS latestRevision,
  t.source_pack_key AS packKey, t.source_pack_version AS packVersion, t.updated_at AS updatedAt, t.group_id AS groupId`;

function templateSummary({ packKey, packVersion, ...summary }: TemplateRow) {
  return { ...summary, source: packKey === null ? null : { packKey, packVersion } };
}

export function listLibrary(raw: Database, { projectId, groupId }: { projectId?: string; groupId?: string } = {}): LibraryResponse {
  const scoped = projectId !== undefined || groupId !== undefined;
  const groups = scoped ? groupChain(raw, projectId === undefined ? groupId ?? null : projectGroupId(raw, projectId)).map(({ id }) => id) : [];
  const condition = scoped ? "WHERE group_id IS NULL OR group_id IN (SELECT value FROM json_each(?))" : "";
  const args = scoped ? [JSON.stringify(groups)] : [];
  const skills = raw.prepare(`SELECT id, name, description, latest_version AS latestVersion, trust, source, updated_at AS updatedAt, group_id AS groupId
    FROM skills ${condition} ORDER BY name, id`).all(...args);
  const templates = raw.prepare<string[], TemplateRow>(`SELECT ${templateColumns} FROM agent_templates t ${condition} ORDER BY t.name, t.id`)
    .all(...args).map(templateSummary);
  return libraryResponseSchema.parse({ skills, templates });
}

export function applyLibraryListScope(app: FastifyInstance, raw: Database): void {
  const newId = createIdGenerator();
  app.addHook("onRoute", (route) => {
    if (route.method !== "GET" || route.url !== "/library") return;
    route.handler = async (request, reply) => {
      const { projectId, groupId } = request.query as { projectId?: string; groupId?: string };
      if ((projectId !== undefined && !idSchema.safeParse(projectId).success)
        || (groupId !== undefined && !idSchema.safeParse(groupId).success)
        || (projectId !== undefined && groupId !== undefined))
        return failure(reply, 400, "validation", "Specify one valid project or group id.", "correct-input", newId);
      if (projectId !== undefined && !raw.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId))
        return failure(reply, 404, "not-found", "Project not found.", "correct-input", newId);
      if (groupId !== undefined && !raw.prepare("SELECT 1 FROM groups WHERE id = ?").get(groupId))
        return failure(reply, 404, "not-found", "Group not found.", "correct-input", newId);
      return { ok: true, apiVersion: API_VERSION, ...listLibrary(raw, projectId ? { projectId } : groupId ? { groupId } : {}) };
    };
  });
}

export function validateAgentLibraryScope(raw: Database, projectId: string, config: AgentConfig, templateId: string | null): void {
  const groups = new Set(groupChain(raw, projectGroupId(raw, projectId)).map(({ id }) => id));
  const skill = raw.prepare<[string], { group_id: string | null }>("SELECT group_id FROM skills WHERE id = ?");
  for (const { skillId } of config.skills) {
    const groupId = skill.get(skillId)?.group_id ?? null;
    if (groupId !== null && !groups.has(groupId))
      throw new CommandError("validation", "skill is not available in this project's group", "correct-input");
  }
  if (templateId !== null) {
    const groupId = raw.prepare<[string], { group_id: string | null }>("SELECT group_id FROM agent_templates WHERE id = ?")
      .get(templateId)?.group_id ?? null;
    if (groupId !== null && !groups.has(groupId))
      throw new CommandError("validation", "template is not available in this project's group", "correct-input");
  }
}

export function getSkillVersion(raw: Database, skillId: string, version: number | "latest"): SkillVersion | undefined {
  const row = raw.prepare(`SELECT v.skill_id AS skillId, v.version, v.name, v.description, v.content, v.sha256, v.created_at AS createdAt
    FROM skills s JOIN skill_versions v ON v.skill_id = s.id AND v.version = coalesce(?, s.latest_version)
    WHERE s.id = ?`).get(version === "latest" ? null : version, skillId);
  return row === undefined ? undefined : skillVersionSchema.parse(row);
}

function configUsesSkill(configJson: string, skillId: string): boolean {
  const config = JSON.parse(configJson) as { skills?: Array<{ skillId?: string }> };
  return config.skills?.some((skill) => skill.skillId === skillId) ?? false;
}

export function skillUsage(raw: Database, skillId: string): { agents: number; templates: number } {
  const agents = raw.prepare(`SELECT r.config_json FROM seats s JOIN agent_revisions r
    ON r.agent_id = s.id AND r.revision = s.config_revision
    WHERE s.config_revision IS NOT NULL AND s.status <> 'archived'`).all() as { config_json: string }[];
  const templates = raw.prepare(`SELECT r.config_json FROM agent_templates t JOIN agent_template_revisions r
    ON r.template_id = t.id AND r.revision = t.latest_revision`).all() as { config_json: string }[];
  return {
    agents: agents.filter(({ config_json }) => configUsesSkill(config_json, skillId)).length,
    templates: templates.filter(({ config_json }) => configUsesSkill(config_json, skillId)).length,
  };
}

export function getSkillDetail(raw: Database, skillId: string): SkillDetail | undefined {
  const row = raw.prepare(`SELECT id, name, description, revision, latest_version AS latestVersion, trust, source, updated_at AS updatedAt, group_id AS groupId
    FROM skills WHERE id = ?`).get(skillId);
  if (!row) return undefined;
  const versions = raw.prepare(`SELECT version, sha256, created_at AS createdAt FROM skill_versions
    WHERE skill_id = ? ORDER BY version DESC LIMIT 500`).all(skillId);
  return skillDetailSchema.parse({ skill: row, versions, usedBy: skillUsage(raw, skillId) });
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
