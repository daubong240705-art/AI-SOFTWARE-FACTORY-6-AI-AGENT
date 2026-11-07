import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { API_VERSION, eventSchema, failureResponseSchema, successResponseSchema, taskSchema, teamSchema, seatSchema, engagementSchema } from "@factory/contracts";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { createCommandPipeline } from "../dist/commands/index.js";
import { EventHub } from "../dist/events/hub.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
import { loadPack, ensureTeamFromPack, ensureEngagement, listSeats } from "../dist/org/index.js";
import { createProjectsCreateHandler, projectsCreateHandler } from "../dist/projects/service.js";
import { openStorage } from "../dist/storage/database.js";
import { tasksCreateHandler, tasksTransitionHandler, getTask, listTasks } from "../dist/work/service.js";

const host = "127.0.0.1:8787";
const origin = `http://${host}`;
const clock = () => new Date("2026-11-07T10:00:00.000Z");
const pack = loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)));
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const command = (type, projectId, payload) => ({ apiVersion: API_VERSION, commandId: randomUUID(), projectId, type, payload });
const projectCommand = (projectId = randomUUID()) => command("projects.create", projectId, {
  name: "Work project", workspace: { kind: "directory", root: `/workspace/${randomUUID()}` },
});
const taskCommand = (projectId, overrides = {}) => command("tasks.create", projectId, {
  taskId: randomUUID(), code: "WK-001", title: "Implement task", goal: "Deliver a result", brief: "Task brief",
  parentTaskId: null, engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [], ...overrides,
});
const transition = (projectId, taskId, expectedRevision, to) => command("tasks.transition", projectId, { taskId, expectedRevision, to });
const events = (raw, projectId) => raw.prepare("SELECT body_json FROM event_log WHERE project_id = ? ORDER BY sequence").all(projectId)
  .map((row) => eventSchema.parse(JSON.parse(row.body_json)));
function success(response) {
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.deepEqual(successResponseSchema.parse(body), body);
  return body;
}
function failure(response, status, code) {
  assert.equal(response.statusCode, status, response.body);
  const body = response.json();
  assert.deepEqual(failureResponseSchema.parse(body), body);
  assert.equal(body.error.code, code);
  return body.error;
}
async function fixture(t, { projectHandler = createProjectsCreateHandler({ pack }) } = {}) {
  const storage = openStorage(":memory:");
  storage.migrate({ migrationsDir, backupDir: null });
  const raw = storage.raw;
  const hub = new EventHub(raw, { clock });
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
    "projects.create": projectHandler, "tasks.create": tasksCreateHandler, "tasks.transition": tasksTransitionHandler,
  } });
  const app = createApiServer({ origins: [origin], clock,
    gate: createBootstrapGate({ token: "work-test-fixed-bootstrap-token", clock }), sessions: createSessionStore({ clock }),
    register: createRoutes({ storage, hub, pipeline }),
  });
  t.after(async () => { await app.close(); storage.close(); });
  const response = await app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host, origin, "content-type": "application/json" },
    payload: { token: "work-test-fixed-bootstrap-token" } });
  assert.equal(response.statusCode, 200);
  const cookie = response.headers["set-cookie"].split(";")[0];
  const headers = { host, origin, cookie, "x-csrf-token": response.json().csrfToken, "content-type": "application/json" };
  return { app, raw, hub, pipeline,
    post: (payload) => app.inject({ method: "POST", url: "/commands", headers, payload }),
    get: (url, authenticated = true) => app.inject({ method: "GET", url, headers: authenticated ? { host, cookie } : { host } }),
    async project() { const c = projectCommand(); success(await this.post(c)); return c.projectId; },
    async task(projectId, overrides) { const c = taskCommand(projectId, overrides); success(await this.post(c)); return c.payload.taskId; },
  };
}

test("pack-aware project creation emits project/team/engagement and receipt in order; the team is shared", async (t) => {
  const f = await fixture(t);
  const c = projectCommand();
  const body = success(await f.post(c));
  assert.deepEqual(body.receipt.effects.map((effect) => effect.kind), ["project", "team", "engagement"]);
  assert.ok(body.receipt.effects.every((effect) => effect.revision === 1));
  const all = events(f.raw, c.projectId);
  assert.deepEqual(all.map((event) => event.payload.type), ["entity.changed", "entity.changed", "entity.changed", "command.receipted"]);
  assert.deepEqual(all.slice(0, 3).map((event) => event.payload.entity), body.receipt.effects);
  assert.deepEqual(all.map((event) => event.cursor.sequence), ["1", "2", "3", "4"]);
  assert.deepEqual(all[3].payload.receipt, body.receipt);
  assert.ok(all.every((event) => event.causationId === c.commandId));
  const next = projectCommand();
  const second = success(await f.post(next));
  assert.deepEqual(second.receipt.effects.map((effect) => effect.kind), ["project", "engagement"]);
  assert.deepEqual(events(f.raw, next.projectId).map((event) => event.payload.type), ["entity.changed", "entity.changed", "command.receipted"]);
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM teams").get().n, 1);
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM seats").get().n, 7);
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM engagements").get().n, 2);
  const response = await f.get(`/projects/${c.projectId}/team`);
  assert.equal(response.statusCode, 200);
  const { team, seats, engagement } = response.json();
  assert.deepEqual(teamSchema.parse(team), team);
  assert.deepEqual(engagementSchema.parse(engagement), engagement);
  for (const seat of seats) assert.deepEqual(seatSchema.parse(seat), seat);
  assert.equal(seats.length, 7);
  assert.equal(seats[0].isLead, true);
  assert.ok(seats.slice(1).every((seat) => !seat.isLead));
  assert.equal(team.id, body.receipt.effects[1].id);
  assert.equal(engagement.teamId, team.id);
  assert.equal(engagement.id, body.receipt.effects[2].id);
  const nextTeam = (await f.get(`/projects/${next.projectId}/team`)).json();
  assert.deepEqual(nextTeam.team, team);
  assert.notEqual(nextTeam.engagement.id, engagement.id);
});

test("task creation starts in draft with restrictive defaults and defaults to the active engagement", async (t) => {
  const f = await fixture(t);
  const projectId = await f.project();
  const team = (await f.get(`/projects/${projectId}/team`)).json();
  const c = taskCommand(projectId, { ownerSeatId: team.seats[0].id });
  assert.deepEqual(success(await f.post(c)).receipt.effects, [{ kind: "task", id: c.payload.taskId, revision: 1 }]);
  const task = getTask(f.raw, projectId, c.payload.taskId);
  assert.deepEqual(taskSchema.parse(task), task);
  assert.equal(task.state, "draft");
  assert.equal(task.revision, 1);
  assert.equal(task.placement, "node-bound");
  assert.equal(task.sideEffect, "external-irreversible");
  assert.equal(task.reviewPolicy, "human-final");
  assert.deepEqual(task.gate, { requiresGo: true });
  assert.deepEqual(task.origin, { kind: "operator" });
  assert.equal(task.disposition, "active");
  assert.deepEqual(task.holds, []);
  assert.equal(task.engagementId, team.engagement.id);
  assert.equal(task.ownerSeatId, team.seats[0].id);
});

test("task creation respects explicit classifications and round-trips JSON, parent and dependencies", async (t) => {
  const f = await fixture(t);
  const projectId = await f.project();
  const parent = await f.task(projectId, { code: "WK-003" });
  const dependency = await f.task(projectId, { code: "WK-002" });
  const c = taskCommand(projectId, { parentTaskId: parent, dependsOn: [parent, dependency],
    placement: "portable", sideEffect: "none", reviewPolicy: "automatic", requiresGo: false,
    requiredCapabilities: ["runtime.test"], acceptance: ["Works"], inputs: [],
  });
  success(await f.post(c));
  const task = getTask(f.raw, projectId, c.payload.taskId);
  assert.deepEqual(task.requiredCapabilities, c.payload.requiredCapabilities);
  assert.deepEqual(task.acceptance, c.payload.acceptance);
  assert.deepEqual(task.inputs, []);
  assert.deepEqual(task.dependsOn, [parent, dependency].sort());
  assert.equal(task.parentTaskId, parent);
  assert.equal(task.placement, "portable");
  assert.equal(task.sideEffect, "none");
  assert.equal(task.reviewPolicy, "automatic");
  assert.equal(task.gate.requiresGo, false);
  f.raw.prepare("INSERT INTO task_holds (project_id, task_id, kind, reason, ref_kind, ref_id, since, needs_action) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(projectId, task.id, "input", "Need input", null, null, clock().toISOString(), 1);
  assert.deepEqual(getTask(f.raw, projectId, task.id).holds, [{ kind: "input", reason: "Need input", ref: null, since: clock().toISOString(), needsAction: true }]);
});

test("duplicate code or task ID conflicts, but the same code is allowed in another project", async (t) => {
  const f = await fixture(t);
  const projectId = await f.project();
  const taskId = await f.task(projectId);
  const duplicateCode = failure(await f.post(taskCommand(projectId)), 409, "conflict");
  assert.equal(duplicateCode.nextAction, "correct-input");
  failure(await f.post(taskCommand(projectId, { taskId, code: "WK-002" })), 409, "conflict");
  const other = await f.project();
  success(await f.post(taskCommand(other)));
  failure(await f.post(taskCommand(other, { taskId, code: "WK-003" })), 409, "conflict");
});

test("unknown projects and project-external parent/dependency/engagement references are rejected", async (t) => {
  const f = await fixture(t);
  failure(await f.post(taskCommand(randomUUID())), 404, "not-found");
  const first = await f.project();
  const second = await f.project();
  const otherTask = await f.task(second);
  for (const overrides of [{ parentTaskId: otherTask }, { dependsOn: [otherTask] }, { parentTaskId: randomUUID() }, { dependsOn: [randomUUID()] }])
    failure(await f.post(taskCommand(first, overrides)), 404, "not-found");
  const otherEngagement = (await f.get(`/projects/${second}/team`)).json().engagement.id;
  failure(await f.post(taskCommand(first, { engagementId: otherEngagement })), 404, "not-found");
  failure(await f.post(taskCommand(first, { engagementId: randomUUID() })), 404, "not-found");
  failure(await f.post(transition(first, otherTask, 1, "proposed")), 404, "not-found");
  failure(await f.post(transition(first, randomUUID(), 1, "proposed")), 404, "not-found");
  assert.equal(getTask(f.raw, first, otherTask), undefined);
});

test("self references and duplicate dependencies are rejected", async (t) => {
  const f = await fixture(t);
  const projectId = await f.project();
  const existing = await f.task(projectId, { code: "WK-002" });
  const self = randomUUID();
  for (const overrides of [{ taskId: self, parentTaskId: self }, { taskId: self, dependsOn: [self] }, { dependsOn: [existing, existing] }])
    failure(await f.post(taskCommand(projectId, overrides)), 400, "validation");
  assert.equal(listTasks(f.raw, projectId).length, 1);
});

test("owner seat must belong to the task engagement team; explicit engagement is honored", async (t) => {
  const f = await fixture(t);
  const projectId = await f.project();
  const anotherPack = { ...pack, manifest: { ...pack.manifest, key: "another-team" } };
  const deps = { newId: randomUUID, clock };
  const team = ensureTeamFromPack(f.raw, anotherPack, deps);
  const ownerSeatId = listSeats(f.raw, team.teamId)[0].id;
  failure(await f.post(taskCommand(projectId, { ownerSeatId })), 400, "validation");
  failure(await f.post(taskCommand(projectId, { ownerSeatId: randomUUID() })), 400, "validation");
  const { engagementId } = ensureEngagement(f.raw, { projectId, teamId: team.teamId }, deps);
  const c = taskCommand(projectId, { engagementId, ownerSeatId });
  success(await f.post(c));
  assert.equal(getTask(f.raw, projectId, c.payload.taskId).engagementId, engagementId);
});

test("task engagement stays null without an active engagement, and an owner then cannot be assigned", async (t) => {
  const f = await fixture(t, { projectHandler: projectsCreateHandler });
  const projectId = await f.project();
  const taskId = await f.task(projectId);
  assert.equal(getTask(f.raw, projectId, taskId).engagementId, null);
  const team = ensureTeamFromPack(f.raw, pack, { newId: randomUUID, clock });
  failure(await f.post(taskCommand(projectId, { code: "WK-002", ownerSeatId: listSeats(f.raw, team.teamId)[0].id })), 400, "validation");
  failure(await f.get(`/projects/${projectId}/team`), 404, "not-found");
});

test("draft -> proposed -> accepted increments revision and reports stale revisions", async (t) => {
  const f = await fixture(t);
  const projectId = await f.project();
  const taskId = await f.task(projectId);
  assert.deepEqual(success(await f.post(transition(projectId, taskId, 1, "proposed"))).receipt.effects, [{ kind: "task", id: taskId, revision: 2 }]);
  const stale = failure(await f.post(transition(projectId, taskId, 1, "accepted")), 409, "conflict");
  assert.equal(stale.currentRevision, 2);
  assert.equal(stale.nextAction, "refresh");
  assert.deepEqual(success(await f.post(transition(projectId, taskId, 2, "accepted"))).receipt.effects, [{ kind: "task", id: taskId, revision: 3 }]);
  assert.equal(getTask(f.raw, projectId, taskId).state, "accepted");
  failure(await f.post(transition(projectId, taskId, 3, "proposed")), 409, "conflict");
  failure(await f.post(transition(projectId, taskId, 3, "accepted")), 409, "conflict");
  const direct = await f.task(projectId, { code: "WK-002" });
  success(await f.post(transition(projectId, direct, 1, "accepted")));
});

test("transition legality is checked before M1 target support", async (t) => {
  const f = await fixture(t);
  const projectId = await f.project();
  const taskId = await f.task(projectId);
  failure(await f.post(transition(projectId, taskId, 1, "done")), 409, "conflict");
  failure(await f.post(transition(projectId, taskId, 1, "draft")), 409, "conflict");
  success(await f.post(transition(projectId, taskId, 1, "accepted")));
  const unsupported = failure(await f.post(transition(projectId, taskId, 2, "ready")), 501, "unsupported");
  assert.equal(unsupported.message, "transition not available yet");
  assert.equal(unsupported.nextAction, "contact-host");
  // Seed later states to exercise valid contract transitions which M1 cannot yet execute.
  f.raw.prepare("UPDATE tasks SET state = ? WHERE project_id = ? AND id = ?").run("ready", projectId, taskId);
  failure(await f.post(transition(projectId, taskId, 2, "active")), 501, "unsupported");
  f.raw.prepare("UPDATE tasks SET state = ? WHERE project_id = ? AND id = ?").run("in-review", projectId, taskId);
  failure(await f.post(transition(projectId, taskId, 2, "done")), 501, "unsupported");
  assert.equal(getTask(f.raw, projectId, taskId).revision, 2);
});

for (const terminal of ["cancelled", "declined"]) test(`${terminal} dependencies block acceptance and terminal tasks have no exit`, async (t) => {
  const f = await fixture(t);
  const projectId = await f.project();
  const dependency = await f.task(projectId, { code: "WK-002" });
  const taskId = await f.task(projectId, { dependsOn: [dependency] });
  let revision = 1;
  if (terminal === "declined") { success(await f.post(transition(projectId, dependency, revision++, "proposed"))); }
  success(await f.post(transition(projectId, dependency, revision++, terminal)));
  failure(await f.post(transition(projectId, taskId, 1, "accepted")), 409, "conflict");
  assert.equal(getTask(f.raw, projectId, taskId).revision, 1);
  for (const to of ["draft", "proposed", "accepted", "declined", "cancelled", "ready", "active", "done"])
    failure(await f.post(transition(projectId, dependency, revision, to)), 409, "conflict");
});

test("task create and transition replay by commandId without additional writes or events", async (t) => {
  const f = await fixture(t);
  const projectId = await f.project();
  const c = taskCommand(projectId);
  const first = await f.post(c);
  success(first);
  const before = f.raw.prepare("SELECT total_changes() AS n").get().n;
  const replay = await f.post(c);
  success(replay);
  assert.equal(replay.body, first.body);
  assert.equal(f.raw.prepare("SELECT total_changes() AS n").get().n, before);
  assert.equal(listTasks(f.raw, projectId).length, 1);
  const change = transition(projectId, c.payload.taskId, 1, "proposed");
  const changed = await f.post(change);
  success(changed);
  const after = f.raw.prepare("SELECT total_changes() AS n").get().n;
  assert.equal((await f.post(change)).body, changed.body);
  assert.equal(f.raw.prepare("SELECT total_changes() AS n").get().n, after);
  assert.equal(getTask(f.raw, projectId, c.payload.taskId).revision, 2);
  const all = events(f.raw, projectId);
  assert.equal(all.length, 8);
  for (const id of [c.commandId, change.commandId]) {
    assert.deepEqual(all.filter((event) => event.causationId === id).map((event) => event.payload.type), ["entity.changed", "command.receipted"]);
  }
});

test("GET tasks is session protected, ordered by code and schema-valid; GET team also requires a session", async (t) => {
  const f = await fixture(t);
  const projectId = await f.project();
  for (const route of ["tasks", "team"]) {
    failure(await f.get(`/projects/${projectId}/${route}`, false), 401, "needs-auth");
    failure(await f.get(`/projects/${randomUUID()}/${route}`), 404, "not-found");
    failure(await f.get(`/projects/invalid/${route}`), 400, "validation");
  }
  const empty = await f.get(`/projects/${projectId}/tasks`);
  assert.deepEqual(empty.json(), { apiVersion: API_VERSION, ok: true, items: [] });
  for (const code of ["WK-003", "WK-001", "WK-002"]) await f.task(projectId, { code });
  const other = await f.project();
  await f.task(other, { code: "WK-004" });
  const response = await f.get(`/projects/${projectId}/tasks`);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().items.map((task) => task.code), ["WK-001", "WK-002", "WK-003"]);
  for (const task of response.json().items) assert.deepEqual(taskSchema.parse(task), task);
  assert.deepEqual(response.json().items, listTasks(f.raw, projectId));
});

test("failing event append rolls back task, dependencies, receipt, event log and outbox atomically", async (t) => {
  const f = await fixture(t);
  const projectId = await f.project();
  const dependency = await f.task(projectId, { code: "WK-002" });
  const counts = () => Object.fromEntries(["tasks", "task_dependencies", "command_receipts", "event_log", "outbox"]
    .map((table) => [table, f.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
  const before = counts();
  const cursor = f.hub.currentCursor(projectId);
  const notifications = [];
  f.hub.subscribe(projectId, (next) => notifications.push(next));
  const append = f.hub.append.bind(f.hub);
  let calls = 0;
  f.hub.append = (input) => { if (++calls === 2) throw new Error("event append failure"); return append(input); };
  const c = taskCommand(projectId, { dependsOn: [dependency] });
  failure(await f.post(c), 500, "internal");
  assert.deepEqual(counts(), before);
  assert.deepEqual(f.hub.currentCursor(projectId), cursor);
  assert.deepEqual(notifications, []);
  assert.equal(getTask(f.raw, projectId, c.payload.taskId), undefined);
  f.hub.append = append;
  success(await f.post(c));
  const beforeTransition = counts();
  f.hub.append = () => { throw new Error("transition event failure"); };
  failure(await f.post(transition(projectId, c.payload.taskId, 1, "proposed")), 500, "internal");
  assert.equal(getTask(f.raw, projectId, c.payload.taskId).state, "draft");
  assert.equal(getTask(f.raw, projectId, c.payload.taskId).revision, 1);
  assert.deepEqual(counts(), beforeTransition);
});

test("pack-aware project creation is atomic when event append fails", async (t) => {
  const f = await fixture(t);
  const append = f.hub.append.bind(f.hub);
  let calls = 0;
  f.hub.append = (input) => { if (++calls === 3) throw new Error("engagement event failure"); return append(input); };
  failure(await f.post(projectCommand()), 500, "internal");
  for (const table of ["projects", "teams", "seats", "engagements", "project_streams", "command_receipts", "event_log", "outbox"])
    assert.equal(f.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
});

test("database constraints reject cross-project parent, requester, engagement and dependency references", async (t) => {
  const f = await fixture(t);
  const first = await f.project();
  const second = await f.project();
  const taskId = await f.task(first);
  const otherTask = await f.task(second);
  const engagement = (await f.get(`/projects/${second}/team`)).json().engagement.id;
  assert.throws(() => f.raw.prepare("UPDATE tasks SET parent_task_id = ? WHERE project_id = ? AND id = ?").run(otherTask, first, taskId), /FOREIGN KEY/);
  assert.throws(() => f.raw.prepare("UPDATE tasks SET engagement_id = ? WHERE project_id = ? AND id = ?").run(engagement, first, taskId), /FOREIGN KEY/);
  assert.throws(() => f.raw.prepare(`UPDATE tasks SET origin_kind = ?, requester_task_id = ?, request_kind = ?, hop = ?
    WHERE project_id = ? AND id = ?`).run("cross-team", otherTask, "consult", 0, first, taskId), /FOREIGN KEY/);
  assert.throws(() => f.raw.prepare("INSERT INTO task_dependencies (project_id, task_id, depends_on_task_id) VALUES (?, ?, ?)")
    .run(first, taskId, otherTask), /FOREIGN KEY/);
  assert.throws(() => f.raw.prepare("INSERT INTO task_dependencies (project_id, task_id, depends_on_task_id) VALUES (?, ?, ?)")
    .run(first, otherTask, taskId), /FOREIGN KEY/);
});
