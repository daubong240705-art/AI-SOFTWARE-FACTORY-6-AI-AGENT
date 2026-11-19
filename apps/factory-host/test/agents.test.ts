import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { agentConfigSchema, agentDetailSchema, agentRevisionViewSchema, projectAgentsResponseSchema,
  type AgentConfigInput } from "@factory/contracts";
import { createCommandPipeline, type PipelineResult } from "../src/commands/pipeline.js";
import { createRoutes } from "../src/api/routes.js";
import { createDispatcher } from "../src/dispatch/dispatcher.js";
import { RuntimeRegistry } from "../src/dispatch/runtime.js";
import { EventHub } from "../src/events/hub.js";
import { allowedAgentTools, getAttemptInstructionPin, getSeatCapabilities, getSeatInstructions, getSeatOrder, getSeatTools,
  getSkill } from "../src/instructions/snapshot.js";
import { createAgentHandlers } from "../src/org/agent-commands.js";
import { agentDetailView, agentRevisionView, projectAgentsView } from "../src/org/agent-views.js";
import { loadPack } from "../src/org/pack.js";
import { getSeatRuntimeConfig, seatsSetRuntimeHandler } from "../src/org/runtime-config.js";
import { ensureTeamFromPack, findLeadSeat, listAllSeats, listSeats } from "../src/org/service.js";
import { fixedClock, idFactory, migratedStorage } from "./helpers.js";

const baseConfig: AgentConfigInput = { name: "Writer", role: "Editor", runtime: { adapter: "fake" } };

function accepted({ body }: PipelineResult) {
  if (!body.ok) assert.fail(`${body.error.code}: ${body.error.message}`);
  return body.receipt.effects;
}

function rejected({ body }: PipelineResult, code: string) {
  assert.equal(body.ok, false);
  if (body.ok) assert.fail("expected a command rejection");
  assert.equal(body.error.code, code);
  assert.ok(body.error.nextAction === "correct-input" || body.error.nextAction === "refresh");
  return body.error;
}

function fixture(t: TestContext) {
  const storage = migratedStorage();
  t.after(() => storage.close());
  const { raw } = storage;
  const newId = idFactory();
  const clock = fixedClock();
  const hub = new EventHub(raw, { newId, clock });
  const pipeline = createCommandPipeline({ storage, hub, newId, clock,
    handlers: { ...createAgentHandlers(), "seats.set-runtime": seatsSetRuntimeHandler } });
  const projectId = newId();
  const execute = (type: string, payload: unknown, scope = projectId) =>
    pipeline.execute({ apiVersion: 1, commandId: newId(), projectId: scope, type, payload });
  const createProject = (id: string) => accepted(execute("projects.create", {
    name: "Project", workspace: { kind: "directory", root: `/tmp/agent-tests/${id}` },
  }, id));
  createProject(projectId);
  const create = (config = baseConfig, options: { teamIds?: string[]; isLead?: boolean; template?: { id: string; revision: number; link: boolean } } = {}) => {
    const agentId = newId();
    accepted(execute("agents.create", { agentId, config, ...options }));
    return agentId;
  };
  const roster = () => raw.prepare("SELECT id, revision FROM teams WHERE project_id = ? AND kind = 'roster'").get(projectId) as
    { id: string; revision: number };
  return { storage, raw, hub, pipeline, projectId, newId, clock, create, createProject, execute, roster };
}

test("create stores parsed config and projects the seat and its Codex runtime", (t) => {
  const { raw, create, roster, projectId, clock } = fixture(t);
  const config: AgentConfigInput = { ...baseConfig, runtime: { adapter: "codex", maxConcurrent: 3, model: "test-model", effort: "high" } };
  const id = create(config);
  assert.deepEqual(raw.prepare(`SELECT team_id, project_id, revision, name, role, profile_id, profile_revision, config_revision,
    runtime, slots, node_policy, dedicated_node_id, created_at FROM seats WHERE id = ?`).get(id),
  { team_id: roster().id, project_id: projectId, revision: 1, name: "Writer", role: "Editor", profile_id: id, profile_revision: 1,
    config_revision: 1, runtime: "acp", slots: 3, node_policy: "elastic", dedicated_node_id: null, created_at: clock().toISOString() });
  assert.deepEqual(getSeatRuntimeConfig(raw, id), { seat_id: id, revision: 1, runtime: "acp", cli: "codex", model: "test-model",
    effort: "high", permission: "workspace-write", updated_at: clock().toISOString() });
  assert.deepEqual(raw.prepare("SELECT revision, config_json, actor_id, note, created_at FROM agent_revisions WHERE agent_id = ?").get(id),
    { revision: 1, config_json: JSON.stringify(agentConfigSchema.parse(config)), actor_id: "operator", note: null, created_at: clock().toISOString() });
  assert.deepEqual(raw.prepare("SELECT state, priority, max_concurrent FROM engagements WHERE team_id = ?").get(roster().id),
    { state: "active", priority: 60, max_concurrent: 4 });
});

test("update projects the next revision and rejects a stale seat revision", (t) => {
  const { raw, create, execute } = fixture(t);
  const agentId = create({ ...baseConfig, runtime: { adapter: "claude-code" } });
  const config: AgentConfigInput = { ...baseConfig, name: "Updated", runtime: { adapter: "opencode", maxConcurrent: 2 } };
  assert.deepEqual(accepted(execute("agents.update", { agentId, expectedRevision: 1, config, note: "new runtime" })),
    [{ kind: "seat", id: agentId, revision: 2 }]);
  assert.equal(rejected(execute("agents.update", { agentId, expectedRevision: 1, config }), "conflict").currentRevision, 2);
  assert.deepEqual(raw.prepare("SELECT revision, profile_revision, config_revision, runtime FROM seats WHERE id = ?").get(agentId),
    { revision: 2, profile_revision: 2, config_revision: 2, runtime: "native-opencode" });
  assert.equal(getSeatRuntimeConfig(raw, agentId)?.revision, 2);
  assert.deepEqual(raw.prepare("SELECT revision, note FROM agent_revisions WHERE agent_id = ? ORDER BY revision").all(agentId),
    [{ revision: 1, note: null }, { revision: 2, note: "new runtime" }]);
});

test("update with an unchanged configuration creates no revision", (t) => {
  const { raw, create, execute } = fixture(t);
  const agentId = create({ ...baseConfig, runtime: { adapter: "codex" } });
  assert.deepEqual(accepted(execute("agents.update", { agentId, expectedRevision: 1, config: { ...baseConfig, runtime: { adapter: "codex" } } })),
    [{ kind: "seat", id: agentId, revision: 1 }]);
  assert.equal((raw.prepare("SELECT count(*) AS n FROM agent_revisions WHERE agent_id = ?").get(agentId) as { n: number }).n, 1);
});

test("create rejects unavailable adapter, unknown tools and missing skills without a roster side effect", (t) => {
  const { raw, execute, newId, roster } = fixture(t);
  const agentId = newId();
  const request = (config: AgentConfigInput) => execute("agents.create", { agentId, config });
  assert.equal(rejected(request({ ...baseConfig, runtime: { adapter: "api-agent" } }), "unsupported").message,
    "runtime adapter api-agent is not available yet");
  assert.match(rejected(request({ ...baseConfig, tools: [{ mode: "allow", tool: "unknown.tool" }] }), "validation").message, /unknown\.tool/);
  assert.match(rejected(request({ ...baseConfig, skills: [{ skillId: newId(), version: "latest" }] }), "not-found").message, /skill not found/);
  assert.equal(roster(), undefined);
  assert.deepEqual(raw.prepare("SELECT * FROM seats").all(), []);
});

test("instructions compose the agent profile and resolve the latest skill; pack seats keep their profile", (t) => {
  const { raw, create, clock, newId } = fixture(t);
  const at = clock().toISOString();
  const skillId = newId();
  raw.prepare(`INSERT INTO skills (id, revision, name, description, latest_version, trust, created_at, updated_at)
    VALUES (?, 1, 'editing', 'Editing tips', 1, 'instructions', ?, ?)`).run(skillId, at, at);
  const insert = raw.prepare(`INSERT INTO skill_versions (skill_id, version, name, description, content, sha256, created_at)
    VALUES (?, ?, 'editing', ?, ?, ?, ?)`);
  insert.run(skillId, 1, "Original tips", "First content", "0".repeat(64), at);
  const seatId = create({ ...baseConfig, description: "Write carefully.", goals: ["Clarity"], instructions: "Check the facts.",
    workRules: ["Review the draft"], skills: [{ skillId, version: "latest" }] });
  insert.run(skillId, 2, "Editing tips", "Latest content", "1".repeat(64), at);
  raw.prepare("UPDATE skills SET latest_version = 2 WHERE id = ?").run(skillId);
  const instructions = getSeatInstructions(raw, { seatId })!;
  assert.deepEqual(instructions, { packDigest: null, agentRevision: 1, profilePath: "agent:1",
    profile: "# Writer \u2014 Editor\n\nWrite carefully.\n\n## Goals\n- Clarity\n\n## Instructions\nCheck the facts.\n\n## Work rules\n- Review the draft",
    skills: [{ name: "editing", description: "Editing tips" }], skillVersions: [{ skillId, version: 2 }] });
  assert.equal(getSkill(raw, { seatId, name: "editing" }), "Latest content");
  assert.equal(getSkill(raw, { seatId, name: "editing", pin: { revision: 1, skillVersions: [{ skillId, version: 1 }] } }), "First content");
  assert.deepEqual(getSeatCapabilities(raw, { seatId }), []);
  assert.equal(getSeatOrder(raw, { seatId }), null);
  const pack = loadPack(fileURLToPath(new URL("../../../../packs/software-team", import.meta.url)));
  const legacy = ensureTeamFromPack(raw, pack, { clock, newId });
  const lead = findLeadSeat(raw, legacy.teamId)!;
  const legacyInstructions = getSeatInstructions(raw, { seatId: lead.id })!;
  const profilePath = pack.manifest.seats.find(({ name }) => name === lead.name)?.profile;
  assert.equal(legacyInstructions.profile, pack.files.profiles.find(({ path }) => path === profilePath)?.content);
  assert.equal(legacyInstructions.packDigest, pack.digest);
  assert.equal(legacyInstructions.agentRevision, null);
});

test("tool policy preserves null and filters denied grants", (t) => {
  const { raw, create, execute } = fixture(t);
  const seatId = create();
  assert.equal(getSeatTools(raw, { seatId }), null);
  const allow = { tool: "knowledge.search", mode: "allow" } as const;
  const deny = { tool: "knowledge.search", mode: "deny" } as const;
  const other = { tool: "skill.get", mode: "allow" } as const;
  assert.deepEqual(allowedAgentTools([allow, deny, other]), ["skill.get"]);
  accepted(execute("agents.update", { agentId: seatId, expectedRevision: 1, config: { ...baseConfig, tools: [deny, other] } }));
  assert.deepEqual(getSeatTools(raw, { seatId }), ["skill.get"]);
});

test("moving and archiving the lead clears relations and memberships and hides it from dispatch", (t) => {
  const { raw, create, execute, newId, roster, projectId } = fixture(t);
  const first = create(baseConfig, { isLead: true });
  const second = create({ ...baseConfig, name: "Second" });
  const teamId = newId();
  accepted(execute("teams.create", { teamId, name: "Editors", memberIds: [first, second], leadAgentId: second }));
  accepted(execute("relations.set", { expectedRevision: 0, relations: [{ from: first, to: second, kind: "reviews" }] }));
  accepted(execute("agents.set-lead", { agentId: second, expectedRevision: 1 }));
  assert.equal(findLeadSeat(raw, roster().id)?.id, second);
  assert.equal(listSeats(raw, roster().id).find(({ id }) => id === first)?.isLead, false);
  accepted(execute("agents.set-status", { agentId: second, expectedRevision: 2, status: "archived" }));
  assert.equal(findLeadSeat(raw, roster().id), undefined);
  assert.deepEqual(listSeats(raw, roster().id).map(({ id }) => id), [first]);
  assert.equal(listAllSeats(raw, roster().id).length, 2);
  const view = projectAgentsResponseSchema.parse(projectAgentsView(raw, projectId));
  assert.equal(view.agents.find(({ id }) => id === second)?.status, "archived");
  assert.deepEqual(view.relations, []);
  assert.deepEqual(view.teams[0]?.memberIds, [first]);
  assert.equal(view.teams[0]?.leadAgentId, null);
  assert.equal(rejected(execute("agents.create", { agentId: newId(), config: { ...baseConfig, name: "SECOND" } }), "conflict").message,
    "name already used in this project");
});

test("delete refuses an agent with an owned task and removes a fresh agent", (t) => {
  const { raw, create, projectId, newId, execute } = fixture(t);
  const owned = create();
  raw.prepare(`INSERT INTO tasks (project_id, id, revision, code, title, goal, brief, owner_seat_id, origin_kind, state,
    required_capabilities_json, acceptance_json, inputs_json) VALUES (?, ?, 1, 'TASK-001', 'Task', 'Goal', '', ?, 'operator', 'draft', '[]', '[]', '[]')`)
    .run(projectId, newId(), owned);
  assert.equal(rejected(execute("agents.delete", { agentId: owned, expectedRevision: 1 }), "conflict").message,
    "agent has history; archive it instead");
  const fresh = create({ ...baseConfig, name: "Fresh", runtime: { adapter: "codex" } });
  accepted(execute("agents.delete", { agentId: fresh, expectedRevision: 1 }));
  assert.equal(getSeatRuntimeConfig(raw, fresh), undefined);
  assert.equal(raw.prepare("SELECT id FROM seats WHERE id = ?").get(fresh), undefined);
  assert.equal(raw.prepare("SELECT 1 FROM agent_revisions WHERE agent_id = ?").get(fresh), undefined);
});

test("relations reject cycles and stale revisions, but allow non-manages cycles", (t) => {
  const { raw, projectId, roster, create, execute } = fixture(t);
  const first = create();
  const second = create({ ...baseConfig, name: "Second" });
  const forward = { from: first, to: second, kind: "manages" };
  const reverse = { from: second, to: first, kind: "manages" };
  assert.equal(rejected(execute("relations.set", { expectedRevision: 0, relations: [forward, reverse] }), "validation").message,
    "manages relations form a cycle");
  const team = roster();
  assert.deepEqual(accepted(execute("relations.set", { expectedRevision: 0, relations: [forward, { ...reverse, kind: "reviews" }] })),
    [{ kind: "team", id: team.id, revision: team.revision + 1 }]);
  assert.equal(rejected(execute("relations.set", { expectedRevision: 0, relations: [] }), "conflict").currentRevision, 1);
  assert.equal(projectAgentsView(raw, projectId)?.relationsRevision, 1);
  accepted(execute("relations.set", { expectedRevision: 1, relations: [] }));
  assert.equal(projectAgentsView(raw, projectId)?.relationsRevision, 2);
});

test("rollback creates a new revision equal to the target config", (t) => {
  const { raw, projectId, create, execute } = fixture(t);
  const agentId = create();
  accepted(execute("agents.update", { agentId, expectedRevision: 1, config: { ...baseConfig, name: "Different", runtime: { adapter: "codex" } } }));
  accepted(execute("agents.rollback", { agentId, expectedRevision: 2, toRevision: 1 }));
  const view = agentDetailSchema.parse(agentDetailView(raw, projectId, agentId));
  assert.deepEqual(view.revisions.map(({ revision }) => revision), [3, 2, 1]);
  assert.equal(view.revisions[0]?.note, "rollback to r1");
  assert.equal(view.configRevision, 3);
  assert.deepEqual(view.config, agentRevisionViewSchema.parse(agentRevisionView(raw, projectId, agentId, 1)).config);
  assert.equal(getSeatRuntimeConfig(raw, agentId), undefined);
});

test("seats.set-runtime rejects agents configured through agents.update", (t) => {
  const { create, execute } = fixture(t);
  const seatId = create();
  assert.equal(rejected(execute("seats.set-runtime", { seatId, expectedRevision: null, runtime: "acp", cli: "codex" }), "conflict").message,
    "configure this agent with agents.update");
});

test("clone retains group memberships but not template or lead; agent and team lookups stay project scoped", (t) => {
  const { raw, projectId, create, createProject, clock, newId, execute } = fixture(t);
  const otherProject = newId();
  createProject(otherProject);
  const templateId = newId();
  raw.prepare(`INSERT INTO agent_templates (id, revision, name, role, description, latest_revision, created_at, updated_at)
    VALUES (?, 1, 'Template', 'Editor', '', 2, ?, ?)`).run(templateId, clock().toISOString(), clock().toISOString());
  raw.prepare(`INSERT INTO agent_template_revisions (template_id, revision, config_json, created_at) VALUES (?, 1, ?, ?)`)
    .run(templateId, JSON.stringify(agentConfigSchema.parse(baseConfig)), clock().toISOString());
  const teamId = newId();
  accepted(execute("teams.create", { teamId, name: "Editors" }));
  const sourceAgentId = create(baseConfig, { isLead: true, teamIds: [teamId], template: { id: templateId, revision: 1, link: true } });
  const agentId = newId();
  rejected(execute("agents.clone", { sourceAgentId, agentId, name: "Clone" }, otherProject), "not-found");
  accepted(execute("agents.clone", { sourceAgentId, agentId, name: "Clone" }));
  const clone = agentDetailSchema.parse(agentDetailView(raw, projectId, agentId));
  assert.equal(clone.isLead, false);
  assert.equal(clone.template, null);
  assert.deepEqual(clone.teamIds, [teamId]);
  assert.deepEqual(agentDetailView(raw, projectId, sourceAgentId)?.template, { id: templateId, revision: 1, latestRevision: 2 });
  assert.equal(agentRevisionView(raw, otherProject, agentId, 1), undefined);
  rejected(execute("teams.update", { teamId, expectedRevision: 3, memberIds: [] }, otherProject), "not-found");
  accepted(execute("teams.update", { teamId, expectedRevision: 3, leadAgentId: agentId, memberIds: [agentId] }));
  assert.deepEqual(projectAgentsView(raw, projectId)?.teams[0]?.memberIds, [agentId]);
  accepted(execute("teams.delete", { teamId, expectedRevision: 4 }));
  assert.deepEqual(agentDetailView(raw, projectId, agentId)?.teamIds, []);
});

test("dispatch pins agent instructions at enqueue and refuses new attempts for inactive agents", async (t) => {
  const { storage, raw, hub, projectId, roster, create, execute, newId, clock } = fixture(t);
  const seatId = create({ ...baseConfig, instructions: "First revision" });
  const dispatcher = createDispatcher({ storage, hub, newId, clock, registry: new RuntimeRegistry() });
  const { id: engagementId } = raw.prepare("SELECT id FROM engagements WHERE project_id = ? AND team_id = ?")
    .get(projectId, roster().id) as { id: string };
  const insertTask = raw.prepare(`INSERT INTO tasks (project_id, id, revision, code, title, goal, brief, owner_seat_id,
    engagement_id, origin_kind, state, required_capabilities_json, acceptance_json, inputs_json)
    VALUES (?, ?, 1, ?, 'Task', 'Goal', '', ?, ?, 'operator', 'active', '[]', '[]', '[]')`);
  const taskId = newId();
  insertTask.run(projectId, taskId, "TASK-001", seatId, engagementId);
  const attempt = dispatcher.enqueue({ projectId, taskId, seatId });
  assert.deepEqual(raw.prepare(`SELECT pack_digest, profile_path, agent_revision, skill_versions_json FROM attempt_instructions
    WHERE project_id = ? AND attempt_id = ?`).get(projectId, attempt.id),
    { pack_digest: null, profile_path: "agent:1", agent_revision: 1, skill_versions_json: "[]" });
  accepted(execute("agents.update", { agentId: seatId, expectedRevision: 1, config: { ...baseConfig, instructions: "Updated" } }));
  const pin = getAttemptInstructionPin(raw, projectId, attempt.id)!;
  assert.match(getSeatInstructions(raw, { seatId, pin })!.profile, /First revision/);
  assert.match(getSeatInstructions(raw, { seatId })!.profile, /Updated/);
  accepted(execute("agents.set-status", { agentId: seatId, expectedRevision: 2, status: "paused" }));
  const secondTask = newId();
  insertTask.run(projectId, secondTask, "TASK-002", seatId, engagementId);
  assert.throws(() => dispatcher.enqueue({ projectId, taskId: secondTask, seatId }), /agent is not active/);
  await dispatcher.stop();
});

test("agent GET routes apply the session guard, return contract-shaped data and hide foreign IDs", async (t) => {
  const { storage, hub, pipeline, projectId, create, createProject, execute, newId } = fixture(t);
  const agentId = create();
  accepted(execute("agents.set-status", { agentId, expectedRevision: 1, status: "archived" }));
  const otherProject = newId();
  createProject(otherProject);
  const app = Fastify();
  let sessionAllowed = false;
  createRoutes({ storage, hub, pipeline })(app, { hostAllowed: () => true, write: async () => undefined,
    session: async (_request, reply) => { if (!sessionAllowed) await reply.code(401).send(); } });
  try {
    const url = `/projects/${projectId}/agents`;
    assert.equal((await app.inject(url)).statusCode, 401);
    sessionAllowed = true;
    const list = await app.inject(url);
    assert.equal(list.statusCode, 200);
    assert.equal(projectAgentsResponseSchema.parse(unwrap(list.json())).agents[0]?.status, "archived");
    assert.equal(agentDetailSchema.parse(unwrap((await app.inject(`${url}/${agentId}`)).json())).id, agentId);
    assert.equal(agentRevisionViewSchema.parse(unwrap((await app.inject(`${url}/${agentId}/revisions/1`)).json())).revision, 1);
    for (const path of [`/projects/${newId()}/agents`, `/projects/${otherProject}/agents/${agentId}`,
      `${url}/${agentId}/revisions/2`, `${url}/${agentId}/revisions/0`]) {
      const response = await app.inject(path);
      assert.equal(response.statusCode, 404);
      assert.equal((response.json() as { error: { code: string } }).error.code, "not-found");
    }
  } finally { await app.close(); }
});

function unwrap(body: unknown): unknown {
  const { ok, apiVersion, ...rest } = body as Record<string, unknown>;
  assert.equal(ok, true); assert.equal(apiVersion, 1);
  return rest;
}
