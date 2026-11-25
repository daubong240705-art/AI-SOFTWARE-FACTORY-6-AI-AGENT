import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { API_VERSION, SYSTEM_SCOPE_ID, groupDetailSchema, groupsResponseSchema, libraryResponseSchema } from "@factory/contracts";
import fastify from "fastify";
import { createCommandPipeline, type PipelineResult } from "../src/commands/pipeline.js";
import { createDispatcher } from "../src/dispatch/dispatcher.js";
import { EventHub } from "../src/events/hub.js";
import { createGroupHandlers, getGroupDetail, registerGroupRoutes, resolveProjectSettings } from "../src/groups/index.js";
import { applyLibraryListScope, createLibraryHandlers, listLibrary, registerLibraryRoutes, withAgentLibraryScope } from "../src/library/index.js";
import { createAgentHandlers } from "../src/org/agent-commands.js";
import { checkAndReserve, DEFAULT_BUDGET_CONFIG, recordUsage } from "../src/policy/budget.js";
import { getProject } from "../src/projects/service.js";
import { RuntimeRegistry } from "../src/dispatch/runtime.js";
import { fixedClock, idFactory, migratedStorage } from "./helpers.js";

function accepted({ status, body }: PipelineResult) {
  if (!body.ok) assert.fail(`${body.error.code}: ${body.error.message}`);
  assert.equal(status, 200);
  return body.receipt.effects;
}

function rejected({ body }: PipelineResult, code: string) {
  if (body.ok) assert.fail("expected command rejection");
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
  const agents = createAgentHandlers();
  const pipeline = createCommandPipeline({ storage, hub, newId, clock, handlers: { ...createGroupHandlers(), ...createLibraryHandlers(),
    ...agents, "agents.create": withAgentLibraryScope(agents["agents.create"]), "agents.update": withAgentLibraryScope(agents["agents.update"]) } });
  const execute = (type: string, payload: unknown, projectId = SYSTEM_SCOPE_ID) =>
    pipeline.execute({ apiVersion: API_VERSION, commandId: newId(), projectId, type, payload });
  const group = (slug: string, parentId: string | null = null) => {
    const groupId = newId();
    accepted(execute("groups.create", { groupId, slug, name: slug, parentId }));
    return groupId;
  };
  const project = (groupId?: string) => {
    const projectId = newId();
    accepted(execute("projects.create", { name: "Project", groupId, workspace: { kind: "directory", root: `${process.cwd()}/${projectId}` } }, projectId));
    return projectId;
  };
  const detail = (groupId: string) => getGroupDetail(raw, groupId, clock())!;
  return { storage, raw, newId, clock, hub, execute, group, project, detail };
}

test("group commands enforce scope, unique paths, depth, cycle checks and subtree rewrites", (context) => {
  const { execute, group, detail, newId } = fixture(context);
  const root = group("root");
  const child = group("child", root);
  const third = group("three", child);
  const fourth = group("four", third);
  const fifth = group("five", fourth);
  const next = { groupId: newId(), slug: "six", name: "Six", parentId: fifth };
  rejected(execute("groups.create", next), "validation");
  rejected(execute("groups.create", { ...next, parentId: null }, newId()), "validation");
  rejected(execute("groups.create", { ...next, slug: "root", parentId: null }), "conflict");
  rejected(execute("groups.move", { groupId: root, expectedRevision: 1, parentId: fifth }), "validation");
  const other = group("other");
  rejected(execute("groups.move", { groupId: root, expectedRevision: 1, parentId: other }), "validation");
  rejected(execute("groups.delete", { groupId: root, expectedRevision: 1 }), "conflict");
  accepted(execute("groups.update", { groupId: root, expectedRevision: 1, slug: "renamed" }));
  assert.equal(detail(fifth).group.path, "renamed/child/three/four/five");
  const before = detail(third).group;
  accepted(execute("groups.move", { groupId: third, expectedRevision: before.revision, parentId: other }));
  assert.equal(detail(fifth).group.path, "other/three/four/five");
  assert.equal(detail(fifth).group.depth, 4);
  const leaf = detail(fifth).group;
  accepted(execute("groups.delete", { groupId: fifth, expectedRevision: leaf.revision }));
  assert.equal(detail(fifth), undefined);
});

test("project placement, settings inheritance and group reads obey the contracts", async (context) => {
  const { raw, clock, execute, group, project, detail, newId } = fixture(context);
  const root = group("root"), child = group("child", root), leaf = group("leaf", child);
  const projectId = project(leaf);
  accepted(execute("groups.set-settings", { groupId: root, expectedRevision: 0,
    settings: { defaultModel: "parent-model", defaultEffort: "high", budgetTokens30d: 2_000 } }));
  accepted(execute("groups.set-settings", { groupId: child, expectedRevision: 0, settings: { defaultModel: "child-model" } }));
  rejected(execute("groups.set-settings", { groupId: child, expectedRevision: 0, settings: {} }), "conflict");
  assert.equal(detail(child).settingsRevision, 1);
  assert.deepEqual(resolveProjectSettings(raw, projectId), {
    defaultModel: { value: "child-model", source: { groupId: child } }, defaultEffort: { value: "high", source: { groupId: root } },
    budgetTokens30d: { value: 2_000, source: { groupId: root } }, defaultAdapter: { value: null, source: "default" },
  });
  rejected(execute("groups.delete", { groupId: leaf, expectedRevision: 1 }), "conflict");
  accepted(execute("groups.archive", { groupId: leaf, expectedRevision: 1, archived: true }));
  assert.equal(getProject(raw, projectId)?.disposition, "active");
  rejected(execute("projects.create", { name: "Archived group", groupId: leaf,
    workspace: { kind: "directory", root: `${process.cwd()}/missing` } }, newId()), "conflict");
  rejected(execute("groups.create", { groupId: newId(), slug: "archived-parent", name: "Archived parent", parentId: leaf }), "conflict");
  accepted(execute("projects.set-group", { groupId: child, expectedRevision: 1 }, projectId));
  assert.equal(getProject(raw, projectId)?.groupId, child);
  assert.equal(getProject(raw, projectId)?.revision, 2);
  const app = fastify();
  context.after(() => app.close());
  registerGroupRoutes(app, { hostAllowed: () => true, session: async () => {}, write: async () => {} }, { raw, clock });
  const list = await app.inject({ method: "GET", url: "/groups" });
  assert.equal(list.statusCode, 200);
  const { ok, apiVersion, ...body } = list.json();
  assert.equal(ok, true);
  assert.equal(apiVersion, API_VERSION);
  const groups = groupsResponseSchema.parse(body);
  assert.deepEqual(groups.membership, { [projectId]: child });
  assert.equal(groups.groups.find(({ id }) => id === child)?.projectCount, 1);
  const response = await app.inject({ method: "GET", url: `/groups/${root}` });
  assert.equal(response.statusCode, 200);
  const { ok: detailOk, apiVersion: detailVersion, ...groupBody } = response.json();
  assert.equal(detailOk, true);
  assert.equal(detailVersion, API_VERSION);
  assert.equal(groupDetailSchema.parse(groupBody).rollup.projects, 1);
  assert.equal((await app.inject(`/groups/${newId()}`)).statusCode, 404);
  assert.equal((await app.inject("/groups/bad-id")).statusCode, 400);
});

test("library list follows the group chain and agent commands reject references outside it", async (context) => {
  const { raw, execute, group, project, newId } = fixture(context);
  const root = group("root"), child = group("child", root), sibling = group("sibling", root);
  const projectId = project(child);
  const makeSkill = (name: string, groupId?: string) => {
    const skillId = newId();
    accepted(execute("skills.create", { skillId, groupId, name, description: "Instructions", content: "Instructions" }));
    return skillId;
  };
  const global = makeSkill("global"), inherited = makeSkill("inherited", root), local = makeSkill("local", child);
  const invisible = makeSkill("invisible", sibling);
  const config = { name: "Agent", role: "Writer", runtime: { adapter: "fake" } };
  const templateId = newId();
  accepted(execute("templates.create", { templateId, config, groupId: sibling }));
  const skills = [{ skillId: inherited, version: "latest" }];
  const agentId = newId();
  accepted(execute("agents.create", { agentId, config: { ...config, skills } }, projectId));
  assert.equal(rejected(execute("agents.update", { agentId, expectedRevision: 1,
    config: { ...config, skills: [{ skillId: invisible, version: "latest" }] } }, projectId), "validation").message,
  "skill is not available in this project's group");
  rejected(execute("agents.create", { agentId: newId(), config: { ...config, name: "Second" },
    template: { id: templateId, revision: 1, link: false } }, projectId), "validation");
  assert.deepEqual(listLibrary(raw, { projectId }).skills.map(({ id }) => id), [global, inherited, local]);
  assert.deepEqual(listLibrary(raw, { groupId: root }).skills.map(({ id }) => id), [global, inherited]);
  assert.deepEqual(listLibrary(raw, { groupId: sibling }).templates.map(({ id, groupId }) => ({ id, groupId })), [{ id: templateId, groupId: sibling }]);
  assert.equal(listLibrary(raw).skills.length, 4);
  const app = fastify();
  context.after(() => app.close());
  applyLibraryListScope(app, raw);
  registerLibraryRoutes(app, { hostAllowed: () => true, session: async () => {}, write: async () => {} }, { raw });
  const response = await app.inject(`/library?projectId=${projectId}`);
  assert.equal(response.statusCode, 200);
  const { ok, apiVersion, ...body } = response.json();
  assert.equal(ok, true);
  assert.equal(apiVersion, API_VERSION);
  assert.deepEqual(libraryResponseSchema.parse(body).skills.map(({ groupId }) => groupId), [null, root, child]);
  assert.equal((await app.inject(`/library?groupId=${sibling}`)).json().templates.length, 1);
});

test("API agents inherit group model and effort; shared budgets refuse new work using reserved estimates", async (context) => {
  const { storage, raw, clock, hub, execute, group, project, detail, newId } = fixture(context);
  const root = group("root"), child = group("child", root), sibling = group("sibling", root);
  const projectId = project(child), siblingProject = project(sibling);
  accepted(execute("groups.set-settings", { groupId: root, expectedRevision: 0,
    settings: { defaultModel: "group-model", defaultEffort: "high", budgetTokens30d: 100 } }));
  accepted(execute("groups.set-settings", { groupId: child, expectedRevision: 0, settings: { budgetTokens30d: 10_000 } }));
  const seatId = newId();
  accepted(execute("agents.create", { agentId: seatId, config: { name: "Agent", role: "Writer",
    runtime: { adapter: "api-agent", model: null, effort: null } } }, projectId));
  const task = () => {
    const taskId = newId();
    const { id: engagementId } = raw.prepare<[string], { id: string }>("SELECT id FROM engagements WHERE project_id = ?").get(projectId)!;
    raw.prepare(`INSERT INTO tasks (project_id, id, revision, code, title, goal, brief, owner_seat_id, engagement_id, origin_kind,
      state, required_capabilities_json, acceptance_json, inputs_json) VALUES (?, ?, 1, ?, 'Task', 'Goal', '', ?, ?, 'operator', 'active', '[]', '[]', '[]')`)
      .run(projectId, taskId, `TASK-${taskId.slice(-4)}`, seatId, engagementId);
    return taskId;
  };
  const dispatcher = createDispatcher({ storage, hub, newId, clock, registry: new RuntimeRegistry(), defaultAgentModel: () => "host-model" });
  try {
    const attempt = dispatcher.enqueue({ projectId, taskId: task(), seatId });
    assert.equal(attempt.model, "group-model");
    assert.equal(attempt.effort, "high");
    const usageSeat = newId();
    accepted(execute("agents.create", { agentId: usageSeat, isLead: true, config: { name: "Lead", role: "Lead", runtime: { adapter: "fake" } } }, siblingProject));
    const conversationId = newId();
    raw.prepare("INSERT INTO conversations (project_id, id, revision, seat_id, title) VALUES (?, ?, 1, ?, 'Usage')")
      .run(siblingProject, conversationId, usageSeat);
    const usage = (estimatedTokens: number, recordedAt: string) => recordUsage(raw, { id: newId(), projectId: siblingProject,
      attemptId: null, taskId: null, conversationId, model: "group-model", effort: null, provider: "api-agent", usage: null, estimatedTokens, recordedAt });
    usage(500, "2026-10-01T10:00:00.000Z");
    assert.equal(detail(root).rollup.tokens30d, 0);
    usage(101, clock().toISOString());
    const reservation = checkAndReserve(raw, { projectId, taskId: null, now: clock(), estimateTokens: 1, config: DEFAULT_BUDGET_CONFIG });
    assert.equal(reservation.ok, false);
    if (!reservation.ok) assert.equal(reservation.scope, "group");
    assert.throws(() => dispatcher.enqueue({ projectId, taskId: task(), seatId }), /Group root.*30 ngày/);
    assert.equal(detail(root).rollup.tokens30d, null);
    assert.equal(detail(root).rollup.liveAttempts, 1);
    assert.deepEqual(detail(root).rollup.tasksByState, { active: 2 });
  } finally { await dispatcher.stop(); }
});
