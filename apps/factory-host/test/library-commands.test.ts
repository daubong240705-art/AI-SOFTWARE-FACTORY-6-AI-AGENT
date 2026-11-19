import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test, type TestContext } from "node:test";
import { API_VERSION, agentConfigSchema, failureResponseSchema, LIBRARY_SCOPE_ID, skillDetailSchema, type AgentConfigInput } from "@factory/contracts";
import fastify from "fastify";
import { createCommandPipeline, type PipelineResult } from "../src/commands/pipeline.js";
import { EventHub } from "../src/events/hub.js";
import { createLibraryHandlers, getSkillVersion, getTemplateDetail, registerLibraryRoutes } from "../src/library/index.js";
import { createAgentHandlers } from "../src/org/agent-commands.js";
import { agentRevision, currentAgentConfig } from "../src/org/agents.js";
import { fixedClock, idFactory, migratedStorage } from "./helpers.js";

const config: AgentConfigInput = { name: "Writer", role: "Editor", runtime: { adapter: "fake" } };
const skill = { name: "editing", description: "Editing tips", content: "Read carefully." };

function accepted({ body, status }: PipelineResult) {
  if (!body.ok) assert.fail(`${body.error.code}: ${body.error.message}`);
  assert.equal(status, 200);
  return body.receipt.effects;
}

function rejected({ body }: PipelineResult, code: string) {
  if (body.ok) assert.fail("expected a command rejection");
  assert.equal(body.error.code, code);
  return body.error;
}

function fixture(context: TestContext) {
  const storage = migratedStorage();
  context.after(() => storage.close());
  const { raw } = storage;
  const newId = idFactory();
  const clock = fixedClock();
  const hub = new EventHub(raw, { newId, clock });
  const pipeline = createCommandPipeline({ storage, hub, newId, clock,
    handlers: { ...createLibraryHandlers(), ...createAgentHandlers() } });
  const projectId = newId();
  const execute = (type: string, payload: unknown, scope = LIBRARY_SCOPE_ID) =>
    pipeline.execute({ apiVersion: API_VERSION, commandId: newId(), projectId: scope, type, payload });
  accepted(execute("projects.create", { name: "Project", workspace: { kind: "directory", root: `/tmp/library-tests/${projectId}` } }, projectId));
  return { raw, newId, clock, hub, projectId, execute };
}

test("skill commands enforce library scope and create immutable versions only on content changes", (context) => {
  const { raw, newId, hub, projectId, execute } = fixture(context);
  const skillId = newId();
  const payload = { skillId, ...skill, trust: "assets" };
  const error = rejected(execute("skills.create", payload, projectId), "validation");
  assert.equal(error.message, "library commands use the library scope");
  assert.equal(error.nextAction, "correct-input");
  assert.deepEqual(accepted(execute("skills.create", payload)), [{ kind: "skill", id: skillId, revision: 1 }]);
  assert.equal(hub.currentCursor(LIBRARY_SCOPE_ID), null);
  rejected(execute("skills.create", { ...payload, name: "another-name" }), "conflict");
  rejected(execute("skills.create", { ...payload, skillId: newId() }), "conflict");
  const update = { skillId, expectedRevision: 1, name: "editing-guide", content: "Read twice." };
  assert.deepEqual(accepted(execute("skills.update", update)), [{ kind: "skill", id: skillId, revision: 2 }]);
  assert.equal(rejected(execute("skills.update", update), "conflict").currentRevision, 2);
  assert.deepEqual(accepted(execute("skills.update", { ...update, expectedRevision: 2 })), [{ kind: "skill", id: skillId, revision: 2 }]);
  assert.deepEqual(accepted(execute("skills.update", { skillId, expectedRevision: 2, description: "Updated description" })),
    [{ kind: "skill", id: skillId, revision: 3 }]);
  assert.equal(getSkillVersion(raw, skillId, 1)?.content, skill.content);
  assert.equal(getSkillVersion(raw, skillId, 1)?.name, skill.name);
  assert.equal(getSkillVersion(raw, skillId, "latest")?.version, 2);
  assert.equal(getSkillVersion(raw, skillId, 2)?.name, update.name);
  assert.equal(getSkillVersion(raw, skillId, 2)?.description, skill.description);
  assert.equal(getSkillVersion(raw, skillId, 2)?.sha256, createHash("sha256").update(update.content).digest("hex"));
});

test("skill deletion checks current agents and latest templates, not their revision history", (context) => {
  const { raw, newId, projectId, execute } = fixture(context);
  const skillId = newId();
  const agentId = newId();
  const archivedId = newId();
  const templateId = newId();
  const withSkill = { ...config, skills: [{ skillId, version: 1 }] };
  accepted(execute("skills.create", { skillId, ...skill }));
  accepted(execute("agents.create", { agentId, config: withSkill }, projectId));
  accepted(execute("agents.create", { agentId: archivedId, config: { ...withSkill, name: "Archived" } }, projectId));
  accepted(execute("agents.set-status", { agentId: archivedId, expectedRevision: 1, status: "archived" }, projectId));
  accepted(execute("templates.create", { templateId, config: withSkill }));
  const remove = () => execute("skills.delete", { skillId, expectedRevision: 1 });
  assert.match(rejected(remove(), "conflict").message, /1 agents and 1 templates/);
  accepted(execute("templates.update", { templateId, expectedRevision: 1, config }));
  assert.match(rejected(remove(), "conflict").message, /1 agents and 0 templates/);
  accepted(execute("agents.update", { agentId, expectedRevision: 1, config }, projectId));
  assert.deepEqual(accepted(remove()), [{ kind: "skill", id: skillId, revision: 2 }]);
  assert.equal(raw.prepare("SELECT 1 FROM skill_versions WHERE skill_id = ?").get(skillId), undefined);
  assert.equal(raw.prepare("SELECT 1 FROM skills WHERE id = ?").get(skillId), undefined);
});

test("templates validate configs and use latest_revision for optimistic concurrency", (context) => {
  const { raw, newId, execute } = fixture(context);
  const templateId = newId();
  const invalidConfig = { ...config, tools: [{ tool: "unknown.tool", mode: "allow" }] };
  assert.match(rejected(execute("templates.create", { templateId, config: invalidConfig }), "validation").message, /unknown tool pattern/);
  assert.deepEqual(accepted(execute("templates.create", { templateId, config, description: "Original" })),
    [{ kind: "agent-template", id: templateId, revision: 1 }]);
  rejected(execute("templates.create", { templateId, config }), "conflict");
  raw.prepare("UPDATE agent_templates SET revision = 10 WHERE id = ?").run(templateId);
  const updated = { ...config, name: "Reviewer", role: "Review lead" };
  assert.equal(rejected(execute("templates.update", { templateId, expectedRevision: 10, config: updated }), "conflict").currentRevision, 1);
  rejected(execute("templates.update", { templateId, expectedRevision: 1, config: invalidConfig }), "validation");
  accepted(execute("templates.update", { templateId, expectedRevision: 1, config: updated }));
  assert.deepEqual(getTemplateDetail(raw, templateId, 1)?.config, agentConfigSchema.parse(config));
  const latest = getTemplateDetail(raw, templateId);
  assert.equal(latest?.revision, 2);
  assert.deepEqual(latest?.config, agentConfigSchema.parse(updated));
  assert.deepEqual(raw.prepare("SELECT revision, latest_revision, name, role, description FROM agent_templates WHERE id = ?").get(templateId),
    { revision: 11, latest_revision: 2, name: updated.name, role: updated.role, description: "Original" });
  assert.equal(rejected(execute("templates.delete", { templateId, expectedRevision: 11 }), "conflict").currentRevision, 2);
  accepted(execute("templates.delete", { templateId, expectedRevision: 2 }));
  assert.equal(getTemplateDetail(raw, templateId, 1), undefined);
});

test("linked agents upgrade to a newer revision without losing their names; linked agents block deletion", (context) => {
  const { raw, newId, projectId, execute } = fixture(context);
  const templateId = newId();
  const agentId = newId();
  const copyId = newId();
  accepted(execute("templates.create", { templateId, config }));
  const link = { id: templateId, revision: 1, link: true };
  accepted(execute("agents.create", { agentId, config: { ...config, name: "Project Writer" }, template: link }, projectId));
  accepted(execute("agents.create", { agentId: copyId, config, template: { ...link, link: false } }, projectId));
  const updated = { ...config, role: "Reviewer", instructions: "Review the draft." };
  accepted(execute("templates.update", { templateId, expectedRevision: 1, config: updated }));
  const upgrade = { agentId, expectedRevision: 1, toRevision: 2 };
  rejected(execute("agents.upgrade-from-template", upgrade), "not-found");
  rejected(execute("agents.upgrade-from-template", { ...upgrade, toRevision: 3 }, projectId), "not-found");
  rejected(execute("agents.upgrade-from-template", { ...upgrade, agentId: copyId }, projectId), "conflict");
  assert.deepEqual(accepted(execute("agents.upgrade-from-template", upgrade, projectId)), [{ kind: "seat", id: agentId, revision: 2 }]);
  assert.deepEqual(currentAgentConfig(raw, agentId), { config: agentConfigSchema.parse({ ...updated, name: "Project Writer" }), revision: 2 });
  assert.equal(agentRevision(raw, agentId, 2)?.note, "upgraded from template r2");
  assert.deepEqual(raw.prepare("SELECT template_revision FROM seats WHERE id = ?").get(agentId), { template_revision: 2 });
  assert.equal(rejected(execute("agents.upgrade-from-template", upgrade, projectId), "conflict").currentRevision, 2);
  for (const toRevision of [1, 2])
    rejected(execute("agents.upgrade-from-template", { ...upgrade, expectedRevision: 2, toRevision }, projectId), "conflict");
  const remove = () => execute("templates.delete", { templateId, expectedRevision: 2 });
  rejected(remove(), "conflict");
  accepted(execute("agents.set-status", { agentId, expectedRevision: 2, status: "archived" }, projectId));
  accepted(remove());
  const seatLink = raw.prepare("SELECT template_id, template_revision, template_link FROM seats WHERE id = ?");
  for (const id of [agentId, copyId])
    assert.deepEqual(seatLink.get(id), { template_id: null, template_revision: null, template_link: 0 });
});

test("saving an agent as a template copies its current config from the agent's project", (context) => {
  const { raw, newId, projectId, execute } = fixture(context);
  const agentId = newId();
  const templateId = newId();
  accepted(execute("agents.create", { agentId, config }, projectId));
  accepted(execute("agents.update", { agentId, expectedRevision: 1, config: { ...config, goals: ["Review drafts"] } }, projectId));
  const payload = { agentId, templateId, description: "Reusable reviewer" };
  rejected(execute("agents.save-as-template", payload), "not-found");
  assert.deepEqual(accepted(execute("agents.save-as-template", payload, projectId)), [{ kind: "agent-template", id: templateId, revision: 1 }]);
  const template = getTemplateDetail(raw, templateId);
  assert.equal(template?.template.source, null);
  assert.equal(template?.template.description, payload.description);
  assert.deepEqual(template?.config, currentAgentConfig(raw, agentId)?.config);
});

test("skill detail route is guarded and returns newest versions and usage counts", async (context) => {
  const { raw, newId, clock, projectId, execute } = fixture(context);
  const app = fastify();
  context.after(() => app.close());
  const skillId = newId();
  const withSkill = { ...config, skills: [{ skillId, version: "latest" }] };
  accepted(execute("skills.create", { skillId, ...skill }));
  raw.prepare("UPDATE skills SET source = 'pack:test' WHERE id = ?").run(skillId);
  const newContent = "Read twice.";
  accepted(execute("skills.update", { skillId, expectedRevision: 1, content: newContent }));
  accepted(execute("agents.create", { agentId: newId(), config: withSkill }, projectId));
  accepted(execute("templates.create", { templateId: newId(), config: withSkill }));
  let sessions = 0;
  registerLibraryRoutes(app, { session: async () => { sessions += 1; }, write: async () => {}, hostAllowed: () => true }, { raw });
  const response = await app.inject({ method: "GET", url: `/library/skills/${skillId}` });
  assert.equal(response.statusCode, 200);
  const { ok, apiVersion, ...detail } = response.json();
  assert.equal(ok, true);
  assert.equal(apiVersion, API_VERSION);
  assert.deepEqual(skillDetailSchema.parse(detail), {
    skill: { id: skillId, name: skill.name, description: skill.description, revision: 2, latestVersion: 2, trust: "instructions",
      source: "pack:test", updatedAt: clock().toISOString(), groupId: null },
    versions: [newContent, skill.content].map((content, index) => ({ version: 2 - index,
      sha256: createHash("sha256").update(content).digest("hex"), createdAt: clock().toISOString() })),
    usedBy: { agents: 1, templates: 1 },
  });
  const missing = await app.inject({ method: "GET", url: `/library/skills/${newId()}` });
  assert.equal(missing.statusCode, 404);
  assert.equal(failureResponseSchema.parse(missing.json()).error.code, "not-found");
  assert.equal(sessions, 2);
});
