import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { appendMessage, conversationsCreateHandler } from "../src/chat/service.js";
import { createCommandPipeline } from "../src/commands/pipeline.js";
import { createAttempt } from "../src/dispatch/attempts.js";
import { EventHub } from "../src/events/hub.js";
import { followPackUpdates } from "../src/instructions/snapshot.js";
import { importPackToLibrary } from "../src/library/import.js";
import { orgActivity } from "../src/org/activity.js";
import { currentAgentConfig, getAgent } from "../src/org/agents.js";
import { loadPack, packManifestSchema } from "../src/org/pack.js";
import { registryEntry } from "../src/org/registry.js";
import { agentsFromPack } from "../src/org/roster.js";
import { migrateProjectsToRosters } from "../src/org/roster-migration.js";
import { seatsSetRuntimeHandler } from "../src/org/runtime-config.js";
import { ensureEngagement, ensureTeamFromPack, findLeadSeat, getPrimaryEngagement, listSeats } from "../src/org/service.js";
import { teamViews } from "../src/org/views.js";
import { createProjectsCreateHandler } from "../src/projects/service.js";
import { listWorkflowDefinitions } from "../src/workflow/definitions.js";
import { selectWorkflowEngagement } from "../src/workflow/teams.js";
import { fixedClock, idFactory, migratedStorage } from "./helpers.js";

const load = (key: string) => loadPack(fileURLToPath(new URL(`../../../../packs/${key}`, import.meta.url)));

function fixture(context: TestContext) {
  const storage = migratedStorage();
  context.after(() => storage.close());
  const { raw } = storage;
  const clock = fixedClock(), newId = idFactory(), deps = { clock, newId };
  const hub = new EventHub(raw, { clock });
  const pack = load("web-games");
  const pipeline = createCommandPipeline({ storage, hub, ...deps, handlers: {
    "conversations.create": conversationsCreateHandler, "seats.set-runtime": seatsSetRuntimeHandler,
  } });
  const execute = (projectId: string, type: string, payload: unknown, target = pipeline) => {
    const result = target.execute({ apiVersion: 1, projectId, commandId: newId(), type, payload });
    assert.ok(result.body.ok, JSON.stringify(result.body));
    return result.body.receipt.effects;
  };
  const newProject = (target = pipeline) => {
    const projectId = newId();
    const effects = execute(projectId, "projects.create", { name: "Project", workspace: { kind: "git", root: `/projects/${projectId}` } }, target);
    return { projectId, effects };
  };
  const legacy = (teamId: string) => {
    const { projectId } = newProject();
    return { projectId, engagementId: ensureEngagement(raw, { projectId, teamId }, deps).engagementId };
  };
  const task = (projectId: string, engagementId: string, ownerId: string, state: string, code = "TASK-001") => {
    const taskId = newId();
    raw.prepare(`INSERT INTO tasks (project_id, id, revision, code, title, goal, brief, owner_seat_id, engagement_id,
      origin_kind, state, required_capabilities_json, acceptance_json, inputs_json)
      VALUES (?, ?, 1, ?, 'Task', 'Goal', '', ?, ?, 'operator', ?, '[]', '[]', '[]')`)
      .run(projectId, taskId, code, ownerId, engagementId, state);
    return taskId;
  };
  return { raw, storage, hub, pack, deps, execute, newProject, legacy, task };
}

test("project creation gives the project a pack-pinned roster with agents and receipt effects", (context) => {
  const { raw, storage, hub, newProject, deps } = fixture(context);
  const pack = load("software-team");
  const pipeline = createCommandPipeline({ storage, hub, ...deps, handlers: { "projects.create": createProjectsCreateHandler({ pack }) } });
  const { projectId, effects } = newProject(pipeline);
  const engagement = getPrimaryEngagement(raw, projectId)!;
  const roster = raw.prepare("SELECT kind, pack_key, pack_version, pack_digest FROM teams WHERE id = ?").get(engagement.teamId);
  assert.deepEqual(roster, { kind: "roster", pack_key: pack.manifest.key, pack_version: pack.manifest.version, pack_digest: pack.digest });
  const agents = listSeats(raw, engagement.teamId);
  assert.deepEqual(agents.map(({ name }) => name).sort(), pack.manifest.seats.map(({ name }) => name).sort());
  assert.equal(agents.filter(({ isLead }) => isLead).length, 1);
  assert.ok(agents.every(({ id }) => getAgent(raw, projectId, id)?.config_revision === 1));
  assert.deepEqual(effects.filter(({ kind }) => kind === "seat").map(({ id }) => id).sort(), agents.map(({ id }) => id).sort());
  assert.ok(effects.some(({ kind, id, revision }) => kind === "team" && id === engagement.teamId && revision === 1));
  assert.ok(effects.some(({ kind, id, revision }) => kind === "engagement" && id === engagement.id && revision === 1));
  const shared = ensureTeamFromPack(raw, pack, deps);
  assert.notEqual(shared.teamId, engagement.teamId);
  assert.deepEqual(raw.prepare("SELECT team_id FROM engagements WHERE project_id = ?").all(projectId), [{ team_id: engagement.teamId }]);
});

test("migration clones shared web-games seats and remaps current work, chat and stages only", (context) => {
  const { raw, pack, deps, execute, legacy, task } = fixture(context);
  const shared = ensureTeamFromPack(raw, pack, deps);
  const first = legacy(shared.teamId), second = legacy(shared.teamId);
  const oldLead = findLeadSeat(raw, shared.teamId)!;
  const oldWorker = listSeats(raw, shared.teamId).find(({ isLead }) => !isLead)!;
  execute(first.projectId, "seats.set-runtime", { seatId: oldWorker.id, expectedRevision: null,
    runtime: "acp", cli: "claude", model: "test-model", effort: "high", permission: "workspace-write" });
  const currentTask = task(first.projectId, first.engagementId, oldWorker.id, "ready");
  const doneTask = task(first.projectId, first.engagementId, oldWorker.id, "done", "TASK-002");
  const conversationId = deps.newId();
  execute(first.projectId, "conversations.create", { conversationId, agentId: oldLead.id, title: "Lead", workItemId: null });
  appendMessage(raw, { projectId: first.projectId, conversationId, id: deps.newId(), speaker: "agent", agentId: oldLead.id,
    text: "Existing message", createdAt: deps.clock().toISOString() });
  const messages = raw.prepare("SELECT body_json FROM messages WHERE project_id = ?");
  const history = messages.all(first.projectId);
  const workflow = pack.files.workflows[0]!.definition;
  const instanceId = deps.newId(), stage = workflow.stages[0]!;
  raw.prepare(`INSERT INTO workflow_instances (project_id, id, revision, key, pack_key, pack_version, definition_revision,
    definition_json, params_json, title, state, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, '{}', 'Workflow', 'draft', ?)`)
    .run(first.projectId, instanceId, workflow.key, pack.manifest.key, pack.manifest.version, workflow.revision, JSON.stringify(workflow), deps.clock().toISOString());
  raw.prepare(`INSERT INTO workflow_stages (project_id, instance_id, stage_key, phase, state, optional, engagement_id)
    VALUES (?, ?, ?, ?, 'pending', 0, ?)`).run(first.projectId, instanceId, stage.key, stage.phase, first.engagementId);
  let backups = 0;
  const migrate = () => migrateProjectsToRosters(raw, { ...deps, backup: () => {
    assert.equal(raw.inTransaction, false);
    assert.equal(raw.prepare("SELECT 1 FROM teams WHERE kind = 'roster'").get(), undefined);
    backups++;
  } });
  assert.deepEqual(migrate(), [first, second].map(({ projectId }) => ({ projectId, status: "migrated", agents: pack.manifest.seats.length })));
  const roster = getPrimaryEngagement(raw, first.projectId)!;
  const otherRoster = getPrimaryEngagement(raw, second.projectId)!;
  const lead = findLeadSeat(raw, roster.teamId)!;
  const worker = listSeats(raw, roster.teamId).find(({ name }) => name === oldWorker.name)!;
  assert.notEqual(lead.id, oldLead.id);
  assert.notEqual(lead.id, findLeadSeat(raw, otherRoster.teamId)?.id);
  for (const project of [first, second]) {
    assert.equal(listSeats(raw, getPrimaryEngagement(raw, project.projectId)!.teamId).length, pack.manifest.seats.length);
    assert.deepEqual(raw.prepare("SELECT state, revision FROM engagements WHERE project_id = ? AND id = ?").get(project.projectId, project.engagementId),
      { state: "ended", revision: 2 });
    assert.equal(raw.prepare("SELECT lead_agent_id FROM teams WHERE kind = 'group' AND project_id = ?")
      .pluck().get(project.projectId), findLeadSeat(raw, getPrimaryEngagement(raw, project.projectId)!.teamId)?.id);
  }
  const taskRef = raw.prepare("SELECT owner_seat_id, engagement_id FROM tasks WHERE project_id = ? AND id = ?");
  assert.deepEqual(taskRef.get(first.projectId, currentTask), { owner_seat_id: worker.id, engagement_id: roster.id });
  assert.deepEqual(taskRef.get(first.projectId, doneTask), { owner_seat_id: oldWorker.id, engagement_id: first.engagementId });
  assert.equal(raw.prepare("SELECT seat_id FROM conversations WHERE project_id = ? AND id = ?").pluck().get(first.projectId, conversationId), lead.id);
  assert.deepEqual(messages.all(first.projectId), history);
  assert.equal(raw.prepare("SELECT engagement_id FROM workflow_stages WHERE project_id = ? AND instance_id = ?").pluck().get(first.projectId, instanceId), roster.id);
  const current = currentAgentConfig(raw, worker.id)!;
  assert.equal(current.revision, 2);
  assert.deepEqual(current.config.runtime, { adapter: "claude-code", model: "test-model", effort: "high", permission: "workspace-write",
    maxConcurrent: oldWorker.slots, timeoutMinutes: 60 });
  const packRow = raw.prepare(`SELECT p.manifest_json AS manifest FROM seats s
    JOIN teams t ON t.id = s.team_id JOIN pack_snapshots p ON p.digest = t.pack_digest WHERE s.id = ?`).get(lead.id) as { manifest: string };
  assert.equal(packManifestSchema.parse(JSON.parse(packRow.manifest)).leadWorkflow, pack.manifest.leadWorkflow);
  assert.ok(listWorkflowDefinitions(raw, first.projectId, [registryEntry(pack)]).some(({ key }) => key === pack.manifest.leadWorkflow));
  assert.equal(selectWorkflowEngagement(raw, first.projectId, stage, null), roster.id);
  assert.deepEqual(teamViews(raw).map(({ id }) => id), [shared.teamId]);
  assert.ok(orgActivity(raw, deps.clock()).teams.some(({ id, seats }) => id === roster.teamId && seats.some(({ name }) => name === oldWorker.name)));
  assert.deepEqual(migrate(), [first, second].map(({ projectId }) => ({ projectId, status: "already" })));
  assert.equal(backups, 1);
});

test("a project with a live attempt is busy and unchanged", (context) => {
  const { raw, pack, deps, legacy, task } = fixture(context);
  const shared = ensureTeamFromPack(raw, pack, deps);
  const { projectId, engagementId } = legacy(shared.teamId);
  const seatId = shared.seatIds[0]!;
  const taskId = task(projectId, engagementId, seatId, "active");
  const attempt = createAttempt(raw, { id: deps.newId(), projectId, taskId, seatId, runtime: "fake", provider: "fake", model: "fake",
    effort: "medium", now: deps.clock().toISOString() });
  const changes = raw.prepare("SELECT total_changes()").pluck();
  const before = changes.get();
  assert.deepEqual(migrateProjectsToRosters(raw, { ...deps, backup: () => assert.fail("busy project needs no backup") }), [{ projectId, status: "busy" }]);
  assert.equal(changes.get(), before);
  assert.equal(attempt.state, "queued");
});

test("followed rosters update their manifest without changing agent revisions", (context) => {
  const { raw, pack, deps, newProject } = fixture(context);
  const { projectId } = newProject();
  const { rosterId, agentIds } = agentsFromPack(raw, { projectId, pack, actorId: "operator" }, deps);
  const revised = load("web-games");
  revised.files.profiles[0]!.content += "\nUpdated instructions";
  revised.digest = createHash("sha256").update(revised.files.profiles[0]!.content).digest("hex");
  const leadId = agentIds.get(pack.manifest.seats.find(({ isLead }) => isLead)!.name)!;
  const before = currentAgentConfig(raw, leadId);
  const revisionCount = raw.prepare("SELECT count(*) FROM agent_revisions").pluck();
  const revisions = revisionCount.get();
  assert.equal(followPackUpdates(raw, [registryEntry(revised)], [pack.manifest.key], deps.clock()).length, 1);
  assert.equal(raw.prepare("SELECT pack_digest FROM teams WHERE id = ?").pluck().get(rosterId), revised.digest);
  assert.deepEqual(currentAgentConfig(raw, leadId), before);
  assert.equal(revisionCount.get(), revisions);
});

test("migration uses the pinned profile and skill even if the library has a different snapshot", (context) => {
  const { raw, pack, deps, legacy } = fixture(context);
  const shared = ensureTeamFromPack(raw, pack, deps);
  const { projectId } = legacy(shared.teamId);
  const newer = load("web-games");
  newer.files.profiles[0]!.content += "\nNew profile";
  newer.files.skills[0]!.content += "\nNew skill";
  importPackToLibrary(raw, newer, deps);
  assert.equal(migrateProjectsToRosters(raw, deps)[0]?.status, "migrated");
  const lead = findLeadSeat(raw, getPrimaryEngagement(raw, projectId)!.teamId)!;
  const config = currentAgentConfig(raw, lead.id)!.config;
  assert.equal(config.instructions, pack.files.profiles[0]!.content);
  const skill = config.skills[0]!;
  assert.equal(raw.prepare("SELECT content FROM skill_versions WHERE skill_id = ? AND version = ?").pluck().get(skill.skillId, skill.version), pack.files.skills[0]!.content);
});

test("migration aborts on backup failure and rolls back a project that violates its invariant", (context) => {
  const { raw, pack, deps, legacy, task } = fixture(context);
  const shared = ensureTeamFromPack(raw, pack, deps);
  const foreign = ensureTeamFromPack(raw, load("software-team"), deps);
  const { projectId, engagementId } = legacy(shared.teamId);
  const foreignSeat = foreign.seatIds[0]!;
  task(projectId, engagementId, foreignSeat, "ready");
  assert.deepEqual(migrateProjectsToRosters(raw, { ...deps, backup: () => { throw new Error("backup failed"); } }),
    [{ projectId, status: "failed", detail: "backup failed" }]);
  assert.deepEqual(migrateProjectsToRosters(raw, deps), [{ projectId, status: "failed", detail: "Non-terminal task owner is not a project agent" }]);
  assert.equal(raw.prepare("SELECT 1 FROM teams WHERE project_id = ?").get(projectId), undefined);
  assert.equal(getPrimaryEngagement(raw, projectId)?.id, engagementId);
});

test("migration keeps the primary pack and deduplicates names across active and paused teams", (context) => {
  const { raw, pack, deps, legacy } = fixture(context);
  const software = load("software-team");
  const first = ensureTeamFromPack(raw, software, deps), primary = ensureTeamFromPack(raw, pack, deps);
  const { projectId, engagementId } = legacy(first.teamId);
  raw.prepare("UPDATE engagements SET state = 'paused' WHERE project_id = ? AND id = ?").run(projectId, engagementId);
  ensureEngagement(raw, { projectId, teamId: primary.teamId }, deps);
  assert.deepEqual(migrateProjectsToRosters(raw, deps), [{ projectId, status: "migrated",
    agents: pack.manifest.seats.length + software.manifest.seats.length }]);
  const roster = getPrimaryEngagement(raw, projectId)!;
  assert.equal(raw.prepare("SELECT pack_digest FROM teams WHERE id = ?").pluck().get(roster.teamId), pack.digest);
  const seats = listSeats(raw, roster.teamId);
  assert.deepEqual(seats.filter(({ isLead }) => isLead).map(({ name }) => name), ["Lead"]);
  assert.ok(seats.some(({ name, isLead }) => name === `Lead (${software.manifest.name})` && !isLead));
});

test("a missing snapshot falls back to the legacy seat rows", (context) => {
  const { raw, pack, deps, legacy } = fixture(context);
  const shared = ensureTeamFromPack(raw, pack, deps);
  const { projectId } = legacy(shared.teamId);
  raw.prepare("UPDATE teams SET pack_digest = NULL WHERE id = ?").run(shared.teamId);
  const [report] = migrateProjectsToRosters(raw, deps);
  assert.equal(report?.status, "migrated");
  assert.match(report?.detail ?? "", /no pinned pack snapshot/);
  const lead = findLeadSeat(raw, getPrimaryEngagement(raw, projectId)!.teamId)!;
  assert.equal(currentAgentConfig(raw, lead.id)?.config.instructions, "");
});

test("roster workers retain the configured CLI-only host default at revision one", (context) => {
  const { raw, pack, deps, newProject } = fixture(context);
  const { projectId } = newProject();
  const { agentIds } = agentsFromPack(raw, { projectId, pack, actorId: "operator" }, { ...deps, defaultAgentCli: "claude" });
  const worker = pack.manifest.seats.find(({ runtime }) => runtime === "native-opencode")!;
  const current = currentAgentConfig(raw, agentIds.get(worker.name)!)!;
  assert.equal(current.revision, 1);
  assert.equal(current.config.runtime.adapter, "claude-code");
  assert.equal(current.config.runtime.permission, "autonomous");
});

test("a new project starts with no agents unless a team template is chosen", (context) => {
  const { raw, storage, hub, deps } = fixture(context);
  const pack = load("software-team");
  const research = load("research-team");
  const handler = createProjectsCreateHandler({ pack, packs: [registryEntry(pack), registryEntry(research)], startEmpty: true });
  const pipeline = createCommandPipeline({ storage, hub, ...deps, handlers: { "projects.create": handler } });
  const create = (extra: Record<string, unknown>) => {
    const projectId = deps.newId();
    const result = pipeline.execute({ apiVersion: 1, projectId, commandId: deps.newId(), type: "projects.create",
      payload: { name: "Project", workspace: { kind: "git", root: `/projects/${projectId}` }, ...extra } });
    return { projectId, body: result.body };
  };
  const empty = create({});
  assert.ok(empty.body.ok);
  const engagement = getPrimaryEngagement(raw, empty.projectId)!;
  assert.equal((raw.prepare("SELECT kind FROM teams WHERE id = ?").get(engagement.teamId) as { kind: string }).kind, "roster");
  assert.equal(listSeats(raw, engagement.teamId).length, 0);
  const templated = create({ teamTemplate: "research-team" });
  assert.ok(templated.body.ok);
  assert.deepEqual(listSeats(raw, getPrimaryEngagement(raw, templated.projectId)!.teamId).map(({ name }) => name).sort(),
    research.manifest.seats.map(({ name }) => name).sort());
  const unknown = create({ teamTemplate: "no-such-pack" });
  assert.equal(unknown.body.ok, false);
  assert.equal(raw.prepare("SELECT 1 FROM projects WHERE id = ?").get(unknown.projectId), undefined);
});
