import { createHash } from "node:crypto";
import type { Database } from "better-sqlite3";
import { LIBRARY_SCOPE_ID, type AgentConfig, type EntityRef } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerMap } from "../commands/pipeline.js";
import { currentAgentConfig, getAgent, validateAgentConfig, writeAgentRevision } from "../org/agents.js";
import { getTemplateDetail, skillUsage } from "./service.js";

export const LIBRARY_COMMANDS = ["skills.create", "skills.update", "skills.delete", "templates.create", "templates.update",
  "templates.delete", "agents.upgrade-from-template", "agents.save-as-template"] as const;

type SkillRow = { revision: number; name: string; description: string; source: string | null; latest_version: number; sha256: string };
type TemplateRow = { revision: number; latest_revision: number; description: string };

function requireLibraryScope(projectId: string): void {
  if (projectId !== LIBRARY_SCOPE_ID) throw new CommandError("validation", "library commands use the library scope", "correct-input");
}

function checkRevision(actual: number, expected: number): void {
  if (actual !== expected) throw new CommandError("conflict", "revision changed", "refresh", { currentRevision: actual });
}

function effect(kind: "skill" | "agent-template" | "seat", id: string, revision: number): { effects: EntityRef[] } {
  return { effects: [{ kind, id, revision }] };
}

function requireSkill(raw: Database, skillId: string): SkillRow {
  const skill = raw.prepare<[string], SkillRow>(`SELECT s.revision, s.name, s.description, s.source, s.latest_version, v.sha256
    FROM skills s JOIN skill_versions v ON v.skill_id = s.id AND v.version = s.latest_version WHERE s.id = ?`).get(skillId);
  if (!skill) throw new CommandError("not-found", "skill not found", "correct-input");
  return skill;
}

function requireOperatorSkillName(raw: Database, name: string, skillId: string): void {
  if (raw.prepare("SELECT 1 FROM skills WHERE name = ? AND source IS NULL AND id <> ?").get(name, skillId))
    throw new CommandError("conflict", "operator skill name already exists", "correct-input");
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function insertSkillVersion(raw: Database, skillId: string, version: number,
  skill: { name: string; description: string; content: string; sha256: string }, now: string): void {
  raw.prepare(`INSERT INTO skill_versions (skill_id, version, name, description, content, sha256, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(skillId, version, skill.name, skill.description, skill.content, skill.sha256, now);
}

function requireTemplate(raw: Database, templateId: string): TemplateRow {
  const template = raw.prepare<[string], TemplateRow>("SELECT revision, latest_revision, description FROM agent_templates WHERE id = ?")
    .get(templateId);
  if (!template) throw new CommandError("not-found", "agent template not found", "correct-input");
  return template;
}

function insertTemplateRevision(raw: Database, templateId: string, revision: number, configJson: string, now: string): void {
  raw.prepare("INSERT INTO agent_template_revisions (template_id, revision, config_json, created_at) VALUES (?, ?, ?, ?)")
    .run(templateId, revision, configJson, now);
}

function createTemplate(raw: Database, { templateId, config, description }: { templateId: string; config: AgentConfig; description: string }, now: string) {
  if (raw.prepare("SELECT 1 FROM agent_templates WHERE id = ?").get(templateId))
    throw new CommandError("conflict", "agent template id already exists", "correct-input");
  const { configJson } = validateAgentConfig(raw, config);
  raw.prepare(`INSERT INTO agent_templates (id, revision, name, role, description, latest_revision, created_at, updated_at)
    VALUES (?, 1, ?, ?, ?, 1, ?, ?)`).run(templateId, config.name, config.role, description, now, now);
  insertTemplateRevision(raw, templateId, 1, configJson, now);
  return effect("agent-template", templateId, 1);
}

function requireAgent(raw: Database, projectId: string, agentId: string) {
  const agent = getAgent(raw, projectId, agentId);
  if (!agent) throw new CommandError("not-found", "agent not found in project", "correct-input");
  return agent;
}

export function createLibraryHandlers(): Pick<HandlerMap, (typeof LIBRARY_COMMANDS)[number]> {
  return {
    "skills.create": ({ raw, clock }, { projectId, payload }) => {
      requireLibraryScope(projectId);
      const { skillId, name, description, content, trust } = payload;
      if (raw.prepare("SELECT 1 FROM skills WHERE id = ?").get(skillId))
        throw new CommandError("conflict", "skill id already exists", "correct-input");
      requireOperatorSkillName(raw, name, skillId);
      const now = clock().toISOString();
      raw.prepare(`INSERT INTO skills (id, revision, name, description, latest_version, trust, created_at, updated_at)
        VALUES (?, 1, ?, ?, 1, ?, ?, ?)`).run(skillId, name, description, trust, now, now);
      insertSkillVersion(raw, skillId, 1, { name, description, content, sha256: hashContent(content) }, now);
      return effect("skill", skillId, 1);
    },
    "skills.update": ({ raw, clock }, { projectId, payload }) => {
      requireLibraryScope(projectId);
      const { skillId, content } = payload;
      const skill = requireSkill(raw, skillId);
      checkRevision(skill.revision, payload.expectedRevision);
      const name = payload.name ?? skill.name;
      const description = payload.description ?? skill.description;
      const sha256 = content === undefined ? skill.sha256 : hashContent(content);
      if (name === skill.name && description === skill.description && sha256 === skill.sha256) return effect("skill", skillId, skill.revision);
      if (skill.source === null && name !== skill.name) requireOperatorSkillName(raw, name, skillId);
      const now = clock().toISOString();
      let version = skill.latest_version;
      if (content !== undefined && sha256 !== skill.sha256) {
        version += 1;
        insertSkillVersion(raw, skillId, version, { name, description, content, sha256 }, now);
      }
      raw.prepare("UPDATE skills SET revision = revision + 1, name = ?, description = ?, latest_version = ?, updated_at = ? WHERE id = ?")
        .run(name, description, version, now, skillId);
      return effect("skill", skillId, skill.revision + 1);
    },
    "skills.delete": ({ raw }, { projectId, payload: { skillId, expectedRevision } }) => {
      requireLibraryScope(projectId);
      const skill = requireSkill(raw, skillId);
      checkRevision(skill.revision, expectedRevision);
      const { agents, templates } = skillUsage(raw, skillId);
      if (agents || templates) throw new CommandError("conflict", `skill is used by ${agents} agents and ${templates} templates`, "correct-input");
      raw.prepare("DELETE FROM skill_versions WHERE skill_id = ?").run(skillId);
      raw.prepare("DELETE FROM skills WHERE id = ?").run(skillId);
      return effect("skill", skillId, skill.revision + 1);
    },
    "templates.create": ({ raw, clock }, { projectId, payload }) => {
      requireLibraryScope(projectId);
      return createTemplate(raw, payload, clock().toISOString());
    },
    "templates.update": ({ raw, clock }, { projectId, payload: { templateId, expectedRevision, config, description } }) => {
      requireLibraryScope(projectId);
      const template = requireTemplate(raw, templateId);
      checkRevision(template.latest_revision, expectedRevision);
      const { configJson } = validateAgentConfig(raw, config);
      const now = clock().toISOString();
      const revision = template.latest_revision + 1;
      insertTemplateRevision(raw, templateId, revision, configJson, now);
      raw.prepare(`UPDATE agent_templates SET revision = revision + 1, latest_revision = ?, name = ?, role = ?, description = ?, updated_at = ?
        WHERE id = ?`).run(revision, config.name, config.role, description ?? template.description, now, templateId);
      return effect("agent-template", templateId, template.revision + 1);
    },
    "templates.delete": ({ raw }, { projectId, payload: { templateId, expectedRevision } }) => {
      requireLibraryScope(projectId);
      const template = requireTemplate(raw, templateId);
      checkRevision(template.latest_revision, expectedRevision);
      const { count } = raw.prepare<[string], { count: number }>(`SELECT count(*) AS count FROM seats
        WHERE template_id = ? AND template_link = 1 AND status <> 'archived'`).get(templateId)!;
      if (count) throw new CommandError("conflict", `template is linked to ${count} non-archived agents`, "correct-input");
      raw.prepare("UPDATE seats SET template_id = NULL, template_revision = NULL, template_link = 0 WHERE template_id = ?").run(templateId);
      raw.prepare("DELETE FROM agent_template_revisions WHERE template_id = ?").run(templateId);
      raw.prepare("DELETE FROM agent_templates WHERE id = ?").run(templateId);
      return effect("agent-template", templateId, template.revision + 1);
    },
    "agents.upgrade-from-template": ({ raw, clock, actorId }, { projectId, payload: { agentId, expectedRevision, toRevision } }) => {
      const agent = requireAgent(raw, projectId, agentId);
      checkRevision(agent.revision, expectedRevision);
      if (agent.template_id === null || agent.template_revision === null
        || !raw.prepare("SELECT 1 FROM seats WHERE id = ? AND template_link = 1").get(agentId))
        throw new CommandError("conflict", "agent is not linked to a template", "correct-input");
      if (toRevision <= agent.template_revision)
        throw new CommandError("conflict", "template revision must be newer than the linked revision", "correct-input");
      const template = getTemplateDetail(raw, agent.template_id, toRevision);
      if (!template) throw new CommandError("not-found", "agent template revision not found", "correct-input");
      const config = { ...template.config, name: agent.name };
      const revision = writeAgentRevision(raw, { agentId, projectId, existing: agent, config, actorId, clock,
        note: `upgraded from template r${toRevision}` });
      raw.prepare("UPDATE seats SET template_revision = ? WHERE id = ?").run(toRevision, agentId);
      return effect("seat", agentId, revision);
    },
    "agents.save-as-template": ({ raw, clock }, { projectId, payload: { agentId, templateId, description } }) => {
      requireAgent(raw, projectId, agentId);
      const { config } = currentAgentConfig(raw, agentId)!;
      return createTemplate(raw, { templateId, config, description }, clock().toISOString());
    },
  };
}
