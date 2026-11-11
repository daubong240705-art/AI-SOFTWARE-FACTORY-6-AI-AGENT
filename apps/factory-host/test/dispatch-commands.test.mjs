import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { API_VERSION, eventSchema, failureResponseSchema, successResponseSchema } from "@factory/contracts";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { EventHub } from "../dist/events/hub.js";
import { startHost } from "../dist/host.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
import { loadPack, listSeats, getActiveEngagement, ensureTeamFromPack } from "../dist/org/index.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { openStorage } from "../dist/storage/database.js";
import { tasksCreateHandler, tasksTransitionHandler, getTask } from "../dist/work/service.js";
import { advanceTasks, startTask, pickSeat, DispatchCommandError, createDispatchHandlers, createDispatcher,
  createFakeRuntime, RuntimeRegistry, getAttempt, listAttempts, listAttemptEvents, transitionAttempt, LOCAL_NODE_ID } from "../dist/dispatch/index.js";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const pack = loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)));
const command = (type, projectId, payload) => ({ apiVersion: API_VERSION, commandId: randomUUID(), projectId, type, payload });
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const pump = async () => { await new Promise(setImmediate); await flush(); };
const ok = (result) => {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  successResponseSchema.parse(result.body);
  return result.body.receipt;
};
const fail = (result, status = 409, code = "conflict") => {
  assert.equal(result.status, status, JSON.stringify(result.body));
  failureResponseSchema.parse(result.body);
  assert.equal(result.body.error.code, code);
  return result.body.error;
};

function fixture(t, { enabled = true } = {}) {
  const storage = openStorage(":memory:");
  storage.migrate({ migrationsDir, backupDir: null });
  const raw = storage.raw;
  let time = Date.parse("2026-11-07T10:00:00.000Z");
  const clock = () => new Date(time);
  const hub = new EventHub(raw, { clock });
  let timerId = 0;
  const timeouts = new Map();
  const intervals = new Map();
  const timers = {
    setTimeout(callback, ms) { const id = ++timerId; timeouts.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(callback, ms) { const id = ++timerId; intervals.set(id, { callback, ms }); return id; },
    clearInterval(id) { intervals.delete(id); },
  };
  const runtime = createFakeRuntime({ timers, stepMs: 1 });
  const errors = [];
  const dispatcher = createDispatcher({ storage, hub, clock, timers, registry: new RuntimeRegistry([runtime]),
    onError: (error) => errors.push(error), config: { leaseMs: 100, leaseRenewMs: 20, leaseCheckMs: 5, stopTimeoutMs: 10 } });
  dispatcher.start();
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
    "projects.create": createProjectsCreateHandler({ pack }), "tasks.create": tasksCreateHandler,
    "tasks.transition": tasksTransitionHandler, ...(enabled ? createDispatchHandlers({ dispatcher }) : {}),
  } });
  const execute = (type, payload, scope = projectId) => pipeline.execute(command(type, scope, payload));
  const project = () => {
    const id = randomUUID();
    ok(pipeline.execute(command("projects.create", id, { name: "Dispatch commands", workspace: { kind: "directory", root: `/workspace/${id}` } })));
    return id;
  };
  const projectId = project();
  const seats = listSeats(raw, getActiveEngagement(raw, projectId).teamId);
  let code = 0;
  const task = (overrides = {}, state = "draft", scope = projectId) => {
    const payload = { taskId: randomUUID(), code: `CMD-${String(++code).padStart(3, "0")}`, title: "Build service", goal: "Deliver result",
      brief: "Brief", parentTaskId: null, engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [], ...overrides };
    ok(execute("tasks.create", payload, scope));
    if (state !== "draft") raw.prepare("UPDATE tasks SET state = ? WHERE project_id = ? AND id = ?").run(state, scope, payload.taskId);
    return payload.taskId;
  };
  const read = (id, scope = projectId) => getTask(raw, scope, id);
  const transition = (id, to, revision = read(id).revision) => execute("tasks.transition", { taskId: id, expectedRevision: revision, to });
  const release = (id, revision = read(id).revision) => execute("tasks.release", { taskId: id, expectedRevision: revision });
  const advance = () => hub.transaction(() => advanceTasks(raw, projectId, { dispatcher }));
  const attempts = (id) => listAttempts(raw, projectId, id);
  const complete = async () => {
    for (let i = 0; i < 10; i++) {
      await pump();
      for (const [id, timer] of [...timeouts]) if (timer.ms === 1) { timeouts.delete(id); timer.callback(); }
      await flush();
    }
    await dispatcher.idle();
  };
  const unknown = () => {
    const id = task({}, "active");
    const a = dispatcher.enqueue({ projectId, taskId: id, seatId: seats.find((s) => s.name === "BE").id });
    transitionAttempt(raw, { projectId, id: a.id }, "leased", { now: clock().toISOString(), nodeId: LOCAL_NODE_ID,
      leaseId: randomUUID(), leaseExpiresAt: new Date(time - 1).toISOString() });
    dispatcher.recover();
    assert.equal(getAttempt(raw, projectId, a.id).state, "unknown");
    return getAttempt(raw, projectId, a.id);
  };
  t.after(async () => { await dispatcher.stop(); storage.close(); });
  return { storage, raw, hub, clock, pipeline, dispatcher, runtime, errors, projectId, project, seats, task, read,
    execute, transition, release, advance, attempts, complete, unknown, advanceClock: (ms) => { time += ms; } };
}

const keywordCases = [
  ["test.unit", "Build service", "Test"], [null, "Add a test", "Test"],
  ["ui.render", "Build service", "FE"], ["frontend.render", "Build service", "FE"], ["web.render", "Build service", "FE"],
  ...["ui", "frontend", "css", "react"].map((word) => [null, `Implement ${word}`, "FE"]),
  ...["ops.run", "infra.run", "deploy.run"].map((cap) => [cap, "Build service", "DevOps"]),
  ...["docker", "deploy", "ci"].map((word) => [null, `Implement ${word}`, "DevOps"]),
  ...["docs.write", "spec.write", "requirements.write"].map((cap) => [cap, "Build service", "BA"]),
  ...["readme", "document"].map((word) => [null, `Write ${word}`, "BA"]),
  ["plan.work", "Build service", "PM"], ["product.work", "Build service", "PM"],
  ["code.edit", "Build service", "BE"],
  ...["api", "db", "backend", "unclassified", "contest", "circuit"].map((word) => [null, `Build ${word}`, "BE"]),
];
for (const [capability, title, name] of keywordCases) test(`pickSeat: ${capability ?? title} selects ${name}`, (t) => {
  const f = fixture(t);
  const id = f.task({ title, requiredCapabilities: capability ? [capability] : [] });
  const selected = pickSeat(f.raw, f.projectId, f.read(id));
  assert.equal(selected.seatId, f.seats.find((seat) => seat.name === name).id);
  assert.match(selected.reason, new RegExp(name));
});

test("pickSeat explicit owner wins over keywords, including a lead owner", (t) => {
  const f = fixture(t);
  const lead = f.seats.find((s) => s.isLead);
  const id = f.task({ title: "Test UI docker", ownerSeatId: lead.id });
  assert.deepEqual(pickSeat(f.raw, f.projectId, f.read(id)), { seatId: lead.id, reason: "explicit owner" });
});
test("pickSeat uses first non-lead by name when named seat is absent", (t) => {
  const f = fixture(t);
  f.raw.prepare("UPDATE seats SET name = ? WHERE id = ?").run("ZZZ", f.seats.find((s) => s.name === "Test").id);
  const id = f.task({ title: "Write test" });
  const result = pickSeat(f.raw, f.projectId, f.read(id));
  assert.equal(result.seatId, f.seats.find((s) => s.name === "BA").id);
  assert.match(result.reason, /Test.*fallback/);
});
test("pickSeat falls back to lead in a team with only a lead", (t) => {
  const f = fixture(t);
  f.raw.prepare("DELETE FROM seats WHERE is_lead = ?").run(0);
  const id = f.task();
  assert.equal(pickSeat(f.raw, f.projectId, f.read(id)).seatId, f.seats.find((s) => s.isLead).id);
});
test("pickSeat rejects a team with no seats", (t) => {
  const f = fixture(t);
  f.raw.prepare("DELETE FROM seats").run();
  const id = f.task();
  assert.throws(() => pickSeat(f.raw, f.projectId, f.read(id)), (e) => e instanceof DispatchCommandError && e.code === "no-seat");
});
test("pickSeat scopes engagement by project and rejects absent engagement", (t) => {
  const f = fixture(t);
  const id = f.task();
  assert.throws(() => pickSeat(f.raw, f.project(), f.read(id)), /no-seat/);
  f.raw.prepare("UPDATE tasks SET engagement_id = ? WHERE id = ?").run(null, id);
  assert.throws(() => pickSeat(f.raw, f.projectId, f.read(id)), /no-seat/);
});
test("pickSeat is case insensitive and uses table order for competing rules", (t) => {
  const f = fixture(t);
  const id = f.task({ title: "REACT TEST DOCKER" });
  assert.equal(pickSeat(f.raw, f.projectId, f.read(id)).seatId, f.seats.find((s) => s.name === "Test").id);
});

test("advanceTasks advances accepted through ready to awaiting-go with final revision", (t) => {
  const f = fixture(t);
  const id = f.task({}, "accepted");
  assert.deepEqual(f.advance(), [f.read(id)]);
  assert.equal(f.read(id).state, "awaiting-go");
  assert.equal(f.read(id).revision, 3);
  assert.equal(f.attempts(id).length, 0);
  assert.deepEqual(f.advance(), []);
});
test("advanceTasks waits for every dependency and advances when all become done", (t) => {
  const f = fixture(t);
  const a = f.task({}, "done");
  const b = f.task();
  const id = f.task({ dependsOn: [a, b] }, "accepted");
  assert.deepEqual(f.advance(), []);
  f.raw.prepare("UPDATE tasks SET state = ? WHERE id = ?").run("done", b);
  assert.equal(f.advance()[0].id, id);
  assert.equal(f.read(id).state, "awaiting-go");
});
test("advanceTasks starts ungated tasks, assigns owner and is idempotent", async (t) => {
  const f = fixture(t);
  const id = f.task({ requiresGo: false }, "accepted");
  assert.equal(f.advance()[0].state, "active");
  assert.equal(f.read(id).revision, 4);
  assert.ok(f.read(id).ownerSeatId);
  assert.equal(f.attempts(id)[0].state, "queued");
  assert.deepEqual(f.advance(), []);
  assert.equal(f.attempts(id).length, 1);
  await f.complete();
  assert.equal(f.read(id).state, "in-review");
});
test("advanceTasks never starts a ready task with unfinished dependencies", (t) => {
  const f = fixture(t);
  const dependency = f.task();
  const id = f.task({ requiresGo: false, dependsOn: [dependency] }, "ready");
  assert.deepEqual(f.advance(), []);
  assert.equal(f.read(id).state, "ready");
  assert.equal(f.attempts(id).length, 0);
});
test("advanceTasks changes tasks in code order and never crosses project boundaries", (t) => {
  const f = fixture(t);
  const b = f.task({ code: "ORD-002" }, "accepted");
  const a = f.task({ code: "ORD-001" }, "accepted");
  const other = f.project();
  const foreign = f.task({}, "accepted", other);
  assert.deepEqual(f.advance().map((task) => task.id), [a, b]);
  assert.equal(f.read(foreign, other).state, "accepted");
});
for (const state of ["draft", "proposed", "awaiting-go", "active", "in-review", "done", "failed", "cancelled", "declined", "superseded"])
  test(`advanceTasks leaves ${state} untouched`, (t) => {
    const f = fixture(t);
    const id = f.task({}, state);
    const before = f.read(id);
    assert.deepEqual(f.advance(), []);
    assert.deepEqual(f.read(id), before);
  });

test("full command flow gates execution, finishes review and advances dependents", async (t) => {
  const f = fixture(t);
  const id = f.task();
  const dependent = f.task({ dependsOn: [id] });
  ok(f.transition(id, "proposed"));
  const accepted = ok(f.transition(id, "accepted"));
  assert.deepEqual(accepted.effects, [{ kind: "task", id, revision: 5 }]);
  assert.equal(f.read(id).state, "awaiting-go");
  ok(f.transition(dependent, "accepted"));
  assert.equal(f.read(dependent).state, "accepted");
  const released = ok(f.release(id));
  const attempt = f.attempts(id)[0];
  assert.equal(attempt.state, "queued");
  assert.deepEqual(released.effects, [{ kind: "task", id, revision: 7 }, { kind: "attempt", id: attempt.id, revision: 1 }]);
  await f.complete();
  assert.equal(f.read(id).state, "in-review");
  const done = ok(f.transition(id, "done"));
  assert.equal(f.read(dependent).state, "awaiting-go");
  assert.deepEqual(done.effects, [f.read(id), f.read(dependent)].map((task) => ({ kind: "task", id: task.id, revision: task.revision })));
});
test("accepting ungated task reports final task and new attempt effects", async (t) => {
  const f = fixture(t);
  const id = f.task({ requiresGo: false });
  const receipt = ok(f.transition(id, "accepted"));
  assert.equal(receipt.effects[0].revision, f.read(id).revision);
  assert.deepEqual(receipt.effects.map((effect) => effect.kind), ["task", "attempt"]);
  await f.complete();
});
test("changes requested creates epoch two with a context handoff and same owner", async (t) => {
  const f = fixture(t);
  const id = f.task();
  ok(f.transition(id, "accepted")); ok(f.release(id)); await f.complete();
  const owner = f.read(id).ownerSeatId;
  ok(f.transition(id, "active"));
  assert.equal(f.attempts(id)[1].epoch, 2);
  assert.equal(f.attempts(id)[1].seatId, owner);
  await f.complete();
  assert.equal(f.runtime.started.length, 2);
  assert.equal(f.runtime.started[0].handoff, null);
  assert.match(f.runtime.started[1].handoff, /Epoch 1: succeeded/);
});
test("retry of fake failure creates epoch two and carries handoff", async (t) => {
  const f = fixture(t);
  const id = f.task({ goal: "[fake:fail]" });
  ok(f.transition(id, "accepted")); ok(f.release(id)); await f.complete();
  assert.equal(f.read(id).state, "failed");
  ok(f.transition(id, "active"));
  await f.complete();
  assert.deepEqual(f.attempts(id).map((a) => a.epoch), [1, 2]);
  assert.match(f.runtime.started[1].handoff, /Epoch 1: failed/);
});
test("retry uses last attempt seat when the task has no owner", async (t) => {
  const f = fixture(t);
  const id = f.task();
  ok(f.transition(id, "accepted")); ok(f.release(id)); await f.complete();
  const seat = f.attempts(id)[0].seatId;
  f.raw.prepare("UPDATE tasks SET owner_seat_id = ? WHERE id = ?").run(null, id);
  ok(f.transition(id, "active"));
  assert.equal(f.attempts(id)[1].seatId, seat);
  assert.equal(f.read(id).ownerSeatId, seat);
  await f.complete();
});
test("review decision and retry refuse a task with a live attempt", (t) => {
  const f = fixture(t);
  const a = f.unknown();
  for (const state of ["in-review", "failed"]) {
    f.raw.prepare("UPDATE tasks SET state = ? WHERE id = ?").run(state, a.taskId);
    fail(f.transition(a.taskId, "active"));
    assert.equal(f.attempts(a.taskId).length, 1);
  }
});
test("tasks.release replay enqueues once and double release conflicts", async (t) => {
  const f = fixture(t);
  const id = f.task();
  ok(f.transition(id, "accepted"));
  const c = command("tasks.release", f.projectId, { taskId: id, expectedRevision: f.read(id).revision });
  const first = f.pipeline.execute(c);
  ok(first);
  const count = f.raw.prepare("SELECT total_changes() AS n").get().n;
  const replay = f.pipeline.execute(c);
  assert.deepEqual(replay.body, first.body);
  assert.equal(replay.replayed, true);
  assert.equal(f.raw.prepare("SELECT total_changes() AS n").get().n, count);
  assert.equal(f.attempts(id).length, 1);
  assert.equal(fail(f.release(id)).message, "task is not waiting for the start gate");
  await f.complete();
});
test("accept replay never creates a second automatic attempt", async (t) => {
  const f = fixture(t);
  const id = f.task({ requiresGo: false });
  const c = command("tasks.transition", f.projectId, { taskId: id, expectedRevision: 1, to: "accepted" });
  const first = f.pipeline.execute(c);
  ok(first);
  assert.deepEqual(f.pipeline.execute(c).body, first.body);
  assert.equal(f.attempts(id).length, 1);
  await f.complete();
});
for (const state of ["draft", "proposed", "accepted", "ready", "in-review", "failed", "done", "cancelled"])
  test(`tasks.release refuses ${state}`, (t) => {
    const f = fixture(t);
    const id = f.task({}, state);
    assert.equal(fail(f.release(id)).message, "task is not waiting for the start gate");
    assert.equal(f.attempts(id).length, 0);
  });
for (const to of ["ready", "awaiting-go", "active", "in-review", "failed", "superseded"])
  test(`tasks.transition keeps ${to} unsupported when contract permits`, (t) => {
    const f = fixture(t);
    const from = { ready: "accepted", "awaiting-go": "ready", active: "awaiting-go", "in-review": "active", failed: "active", superseded: "done" }[to];
    const id = f.task({}, from);
    fail(f.transition(id, to), 501, "unsupported");
    assert.equal(f.read(id).state, from);
  });
for (const state of ["cancelled", "declined"])
  test(`acceptance preserves M1 refusal for ${state} dependency`, (t) => {
    const f = fixture(t);
    const dependency = f.task({}, state);
    const id = f.task({ dependsOn: [dependency] });
    assert.equal(fail(f.transition(id, "accepted")).message, "dependency is cancelled or declined");
    assert.equal(f.read(id).revision, 1);
  });
test("M1 propose/decline rules and transition legality remain unchanged", (t) => {
  const f = fixture(t);
  const id = f.task();
  fail(f.transition(id, "declined"));
  ok(f.transition(id, "proposed")); ok(f.transition(id, "declined"));
  fail(f.transition(id, "accepted"));
  const draft = f.task();
  assert.equal(fail(f.transition(draft, "done")).message, "transition not allowed");
});
test("dispatch disabled retains M1 accepted state and unsupported done decision", (t) => {
  const f = fixture(t, { enabled: false });
  const id = f.task();
  ok(f.transition(id, "accepted"));
  assert.equal(f.read(id).state, "accepted");
  f.raw.prepare("UPDATE tasks SET state = ? WHERE id = ?").run("in-review", id);
  fail(f.transition(id, "done"), 501, "unsupported");
  fail(f.release(id), 501, "unsupported");
});

for (const type of ["tasks.release", "tasks.transition", "work.assign", "runs.cancel", "runs.reconcile"])
  test(`${type} stale revision reports currentRevision`, (t) => {
    const f = fixture(t);
    let payload;
    let revision;
    if (type.startsWith("runs.")) {
      const a = f.unknown(); revision = a.revision;
      payload = { runId: a.id, expectedRevision: 1 };
    } else {
      const id = f.task(); ok(f.transition(id, "accepted")); revision = f.read(id).revision;
      payload = type === "work.assign" ? { workItemId: id, agentId: null, expectedRevision: 1 }
        : { taskId: id, expectedRevision: 1, ...(type === "tasks.transition" ? { to: "cancelled" } : {}) };
    }
    assert.equal(fail(f.execute(type, payload)).currentRevision, revision);
  });
for (const type of ["tasks.release", "tasks.transition", "work.assign", "runs.cancel", "runs.reconcile"])
  for (const scope of ["missing project", "missing entity", "other project"])
    test(`${type} rejects ${scope} with not-found`, (t) => {
      const f = fixture(t);
      const entity = type.startsWith("runs.") ? f.unknown().id : f.task();
      const id = scope === "missing entity" ? randomUUID() : entity;
      const projectId = scope === "missing project" ? randomUUID() : scope === "other project" ? f.project() : f.projectId;
      const payload = type.startsWith("runs.") ? { runId: id, expectedRevision: 1 }
        : type === "work.assign" ? { workItemId: id, agentId: null, expectedRevision: 1 }
          : { taskId: id, expectedRevision: 1, ...(type === "tasks.transition" ? { to: "proposed" } : {}) };
      fail(f.execute(type, payload, projectId), 404, "not-found");
    });

for (const state of ["draft", "proposed", "accepted", "ready", "awaiting-go"])
  test(`work.assign permits ${state}, assigns then clears owner`, (t) => {
    const f = fixture(t);
    const id = f.task({}, state);
    const seat = f.seats.find((s) => s.name === "FE");
    const assigned = ok(f.execute("work.assign", { workItemId: id, agentId: seat.id, expectedRevision: 1 }));
    assert.deepEqual(assigned.effects, [{ kind: "task", id, revision: 2 }]);
    assert.equal(f.read(id).ownerSeatId, seat.id);
    ok(f.execute("work.assign", { workItemId: id, agentId: null, expectedRevision: 2 }));
    assert.equal(f.read(id).ownerSeatId, null);
    assert.equal(f.read(id).revision, 3);
  });
for (const state of ["active", "in-review", "failed", "done", "cancelled", "declined", "superseded"])
  test(`work.assign refuses ${state}`, (t) => {
    const f = fixture(t);
    const id = f.task({}, state);
    fail(f.execute("work.assign", { workItemId: id, agentId: null, expectedRevision: 1 }));
    assert.equal(f.read(id).revision, 1);
  });
test("work.assign validates unknown and other-team seats", (t) => {
  const f = fixture(t);
  const team = ensureTeamFromPack(f.raw, { ...pack, manifest: { ...pack.manifest, key: "other-team" } }, { clock: f.clock, newId: randomUUID });
  const id = f.task();
  for (const seatId of [randomUUID(), listSeats(f.raw, team.teamId)[0].id])
    fail(f.execute("work.assign", { workItemId: id, agentId: seatId, expectedRevision: 1 }), 400, "validation");
  assert.equal(f.read(id).revision, 1);
});
test("work.assign replay changes revision only once", (t) => {
  const f = fixture(t);
  const id = f.task();
  const c = command("work.assign", f.projectId, { workItemId: id, agentId: f.seats[0].id, expectedRevision: 1 });
  const result = f.pipeline.execute(c); ok(result);
  assert.deepEqual(f.pipeline.execute(c).body, result.body);
  assert.equal(f.read(id).revision, 2);
});
for (const state of ["ready", "awaiting-go"])
  test(`tasks.transition can cancel ${state} without starting an attempt`, (t) => {
    const f = fixture(t);
    const id = f.task({}, state);
    ok(f.transition(id, "cancelled"));
    assert.equal(f.read(id).state, "cancelled");
    assert.equal(f.attempts(id).length, 0);
  });
test("task cancellation refuses active queued, running and unknown attempts", async (t) => {
  const f = fixture(t);
  const id = f.task({ goal: "[fake:hang]" });
  ok(f.transition(id, "accepted")); ok(f.release(id));
  assert.equal(fail(f.transition(id, "cancelled")).message, "stop the attempt before cancelling the task");
  await pump();
  assert.equal(f.attempts(id)[0].state, "running");
  assert.equal(fail(f.transition(id, "cancelled")).message, "stop the attempt before cancelling the task");
  const a = f.unknown();
  fail(f.transition(a.taskId, "cancelled"));
});
test("task cancellation permits active task whose attempt is terminal", (t) => {
  const f = fixture(t);
  const id = f.task({}, "awaiting-go");
  ok(f.release(id));
  const a = f.attempts(id)[0];
  transitionAttempt(f.raw, { projectId: f.projectId, id: a.id }, "stopped", { now: f.clock().toISOString() });
  ok(f.transition(id, "cancelled"));
  assert.equal(f.read(id).state, "cancelled");
});
test("runs.cancel reports current revision then dispatcher stops hang; replay stops once", async (t) => {
  const f = fixture(t);
  const id = f.task({ goal: "[fake:hang]" });
  ok(f.transition(id, "accepted")); ok(f.release(id)); await pump();
  const a = f.attempts(id)[0];
  assert.equal(a.state, "running");
  const c = command("runs.cancel", f.projectId, { runId: a.id, expectedRevision: a.revision });
  const result = f.pipeline.execute(c);
  assert.deepEqual(ok(result).effects, [{ kind: "attempt", id: a.id, revision: a.revision }]);
  assert.equal(getAttempt(f.raw, f.projectId, a.id).state, "running");
  assert.deepEqual(f.pipeline.execute(c).body, result.body);
  await flush(); await f.dispatcher.idle();
  assert.equal(getAttempt(f.raw, f.projectId, a.id).state, "stopped");
  assert.equal(f.read(id).state, "failed");
  assert.equal(f.runtime.stopped.length, 1);
  assert.equal(f.runtime.ended.length, 1);
  assert.deepEqual(f.pipeline.execute(c).body, result.body);
  assert.equal(f.runtime.stopped.length, 1);
});
test("runs.cancel accepts queued attempt and does not invoke runtime", async (t) => {
  const f = fixture(t);
  const id = f.task({}, "awaiting-go"); ok(f.release(id));
  const a = f.attempts(id)[0];
  ok(f.execute("runs.cancel", { runId: a.id, expectedRevision: a.revision }));
  await flush();
  assert.equal(getAttempt(f.raw, f.projectId, a.id).state, "stopped");
  assert.equal(f.read(id).state, "failed");
  assert.equal(f.runtime.started.length, 0);
});
test("runs.cancel refuses terminal and unknown attempts", async (t) => {
  const f = fixture(t);
  const id = f.task({}, "awaiting-go"); ok(f.release(id)); await f.complete();
  const terminal = f.attempts(id)[0];
  const unknown = f.unknown();
  for (const a of [terminal, unknown])
    assert.equal(fail(f.execute("runs.cancel", { runId: a.id, expectedRevision: a.revision })).message, "attempt cannot be stopped in its current state");
});
test("runs.reconcile resolves recovered unknown attempt and task to failed with effects", (t) => {
  const f = fixture(t);
  const a = f.unknown();
  const c = command("runs.reconcile", f.projectId, { runId: a.id, expectedRevision: a.revision });
  const result = f.pipeline.execute(c);
  const next = getAttempt(f.raw, f.projectId, a.id);
  assert.equal(next.state, "failed");
  assert.equal(next.outcome, "known");
  assert.equal(f.read(a.taskId).state, "failed");
  assert.deepEqual(ok(result).effects, [{ kind: "attempt", id: a.id, revision: next.revision },
    { kind: "task", id: a.taskId, revision: f.read(a.taskId).revision }]);
  assert.deepEqual(f.pipeline.execute(c).body, result.body);
  fail(f.execute("runs.reconcile", { runId: a.id, expectedRevision: next.revision }));
});
test("runs.reconcile refuses queued, running and succeeded states", async (t) => {
  const f = fixture(t);
  const id = f.task({}, "awaiting-go"); ok(f.release(id));
  let a = f.attempts(id)[0];
  fail(f.execute("runs.reconcile", { runId: a.id, expectedRevision: a.revision }));
  await pump(); a = f.attempts(id)[0];
  assert.equal(a.state, "running");
  fail(f.execute("runs.reconcile", { runId: a.id, expectedRevision: a.revision }));
  await f.complete(); a = f.attempts(id)[0];
  fail(f.execute("runs.reconcile", { runId: a.id, expectedRevision: a.revision }));
});
test("command effects generate valid entity.changed events for final task/attempt revisions", (t) => {
  const f = fixture(t);
  const id = f.task(); ok(f.transition(id, "accepted"));
  const c = command("tasks.release", f.projectId, { taskId: id, expectedRevision: f.read(id).revision });
  const receipt = ok(f.pipeline.execute(c));
  const events = f.raw.prepare("SELECT body_json FROM event_log WHERE project_id = ? ORDER BY sequence").all(f.projectId)
    .map((r) => eventSchema.parse(JSON.parse(r.body_json)));
  const commandEvents = events.filter((e) => e.causationId === c.commandId);
  assert.deepEqual(commandEvents.filter((e) => e.payload.type === "entity.changed").map((e) => e.payload.entity), receipt.effects);
  assert.equal(commandEvents.at(-1).payload.type, "command.receipted");
});
test("failing hub.append during release rolls back task, attempt, receipt, log and outbox", async (t) => {
  const f = fixture(t);
  const id = f.task(); ok(f.transition(id, "accepted"));
  const before = f.read(id);
  const counts = () => ["attempts", "attempt_seats", "command_receipts", "event_log", "outbox"].map((table) => f.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
  const prior = counts();
  const cursor = f.hub.currentCursor(f.projectId);
  const notifications = [];
  f.hub.subscribe(f.projectId, (next) => notifications.push(next));
  const append = f.hub.append.bind(f.hub);
  let calls = 0;
  f.hub.append = (input) => { if (++calls === 2) throw new Error("append failed"); return append(input); };
  const c = command("tasks.release", f.projectId, { taskId: id, expectedRevision: before.revision });
  assert.throws(() => f.pipeline.execute(c), /append failed/);
  assert.deepEqual(f.read(id), before);
  assert.deepEqual(counts(), prior);
  assert.deepEqual(f.hub.currentCursor(f.projectId), cursor);
  assert.deepEqual(notifications, []);
  await pump();
  assert.equal(f.runtime.started.length, 0);
  f.hub.append = append;
  ok(f.pipeline.execute(c)); await f.complete();
});
test("no-seat business failure rolls back acceptance and automatic advancement", (t) => {
  const f = fixture(t);
  const id = f.task({ requiresGo: false });
  f.raw.prepare("DELETE FROM seats").run();
  fail(f.transition(id, "accepted"), 400, "validation");
  assert.equal(f.read(id).state, "draft");
  assert.equal(f.read(id).revision, 1);
  assert.equal(f.attempts(id).length, 0);
});
test("startTask refuses unfinished dependencies and existing live attempt", (t) => {
  const f = fixture(t);
  const dependency = f.task();
  const id = f.task({ dependsOn: [dependency] }, "awaiting-go");
  fail(f.release(id));
  assert.equal(f.attempts(id).length, 0);
  const a = f.unknown();
  f.raw.prepare("UPDATE tasks SET state = ? WHERE id = ?").run("awaiting-go", a.taskId);
  fail(f.release(a.taskId));
  assert.equal(f.attempts(a.taskId).length, 1);
  assert.throws(() => startTask(f.raw, f.projectId, randomUUID(), { dispatcher: f.dispatcher }), /task not found/);
});

async function routes(t, f, enabled = true) {
  const host = "127.0.0.1:8787";
  const origin = `http://${host}`;
  const app = createApiServer({ origins: [origin], clock: f.clock,
    gate: createBootstrapGate({ token: "dispatch-command-test-bootstrap", clock: f.clock }), sessions: createSessionStore({ clock: f.clock }),
    register: createRoutes({ storage: f.storage, hub: f.hub, pipeline: f.pipeline, ...(enabled ? { dispatch: f.dispatcher } : {}) }),
  });
  t.after(() => app.close());
  const auth = await app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host, origin, "content-type": "application/json" },
    payload: { token: "dispatch-command-test-bootstrap" } });
  assert.equal(auth.statusCode, 200);
  const cookie = auth.headers["set-cookie"].split(";")[0];
  return (url, authenticated = true) => app.inject({ method: "GET", url, headers: { host, ...(authenticated ? { cookie } : {}) } });
}
test("attempt list route returns ordered epochs and only public fields", async (t) => {
  const f = fixture(t);
  const id = f.task(); ok(f.transition(id, "accepted")); ok(f.release(id)); await f.complete();
  ok(f.transition(id, "active")); await f.complete();
  const get = await routes(t, f);
  const response = await get(`/projects/${f.projectId}/tasks/${id}/attempts`);
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.apiVersion, API_VERSION); assert.equal(body.ok, true);
  assert.deepEqual(body.attempts.map((a) => a.epoch), [1, 2]);
  for (const a of body.attempts) {
    assert.deepEqual(Object.keys(a).sort(), ["id", "taskId", "epoch", "revision", "state", "outcome", "runtime", "seatId", "seatName", "startedAt", "endedAt"].sort());
    assert.equal(a.taskId, id); assert.equal(a.state, "succeeded"); assert.equal(a.runtime, "fake");
    assert.equal(a.seatName, "BE"); assert.ok(a.startedAt); assert.ok(a.endedAt);
  }
  const empty = f.task();
  assert.deepEqual((await get(`/projects/${f.projectId}/tasks/${empty}/attempts`)).json().attempts, []);
});
test("attempt events route pages by exclusive afterSeq and bounded limit", async (t) => {
  const f = fixture(t);
  const id = f.task({}, "awaiting-go"); ok(f.release(id)); await f.complete();
  const a = f.attempts(id)[0];
  const get = await routes(t, f);
  const url = `/projects/${f.projectId}/attempts/${a.id}/events`;
  const all = (await get(url)).json();
  assert.deepEqual(all.events, listAttemptEvents(f.raw, f.projectId, a.id).map(({ seq, at, kind, body }) => ({ seq, at, kind, body })));
  assert.ok(all.events.length > 2);
  const page = (await get(`${url}?afterSeq=1&limit=2`)).json();
  assert.deepEqual(page.events, all.events.slice(1, 3));
  assert.deepEqual((await get(`${url}?afterSeq=999&limit=500`)).json().events, []);
});
for (const query of ["limit=0", "limit=501", "limit=-1", "limit=1.5", "limit=abc", "limit=", "limit=Infinity", "afterSeq=-1", "afterSeq=1.1", "afterSeq=NaN", "afterSeq=9007199254740992", "limit=1&limit=2"])
  test(`attempt events rejects invalid pagination: ${query}`, async (t) => {
    const f = fixture(t);
    const a = f.unknown();
    const get = await routes(t, f);
    const response = await get(`/projects/${f.projectId}/attempts/${a.id}/events?${query}`);
    assert.equal(response.statusCode, 400);
    failureResponseSchema.parse(response.json());
    assert.equal(response.json().error.code, "validation");
  });
test("attempt routes require session and reject unknown/project-external identities", async (t) => {
  const f = fixture(t);
  const a = f.unknown();
  const other = f.project();
  const get = await routes(t, f);
  for (const url of [`/projects/${f.projectId}/tasks/${a.taskId}/attempts`, `/projects/${f.projectId}/attempts/${a.id}/events`])
    assert.equal((await get(url, false)).statusCode, 401);
  for (const scope of [other, randomUUID()]) for (const path of [`tasks/${a.taskId}/attempts`, `attempts/${a.id}/events`]) {
    const response = await get(`/projects/${scope}/${path}`);
    assert.equal(response.statusCode, 404); failureResponseSchema.parse(response.json());
  }
  for (const path of [`tasks/${randomUUID()}/attempts`, `attempts/${randomUUID()}/events`])
    assert.equal((await get(`/projects/${f.projectId}/${path}`)).statusCode, 404);
  for (const url of [`/projects/invalid/tasks/${a.taskId}/attempts`, `/projects/${f.projectId}/tasks/invalid/attempts`, `/projects/${f.projectId}/attempts/invalid/events`])
    assert.equal((await get(url)).statusCode, 400);
});
test("disabled dispatch routes return not-found failure format", async (t) => {
  const f = fixture(t);
  const a = f.unknown();
  const get = await routes(t, f, false);
  for (const url of [`/projects/${f.projectId}/tasks/${a.taskId}/attempts`, `/projects/${f.projectId}/attempts/${a.id}/events`]) {
    const response = await get(url);
    assert.equal(response.statusCode, 404); failureResponseSchema.parse(response.json());
    assert.equal(response.json().error.code, "not-found");
  }
});

test("startHost catches up accepted tasks, preserves gates across restart and wires release", { timeout: 15000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "factory-dispatch-commands-"));
  const hosts = [];
  t.after(async () => {
    for (const host of hosts) await host.close();
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep + "factory-dispatch-commands-"));
    rmSync(dir, { recursive: true, force: true });
  });
  const launch = async (dispatch) => {
    const host = await startHost({ stateDir: dir, port: 0, dispatch, onBootstrapToken() {} });
    hosts.push(host); return host;
  };
  const first = await launch(null);
  const seed = createCommandPipeline({ storage: first.storage, hub: first.hub, handlers: {
    "projects.create": createProjectsCreateHandler({ pack }), "tasks.create": tasksCreateHandler, "tasks.transition": tasksTransitionHandler,
  } });
  const projectId = randomUUID();
  ok(seed.execute(command("projects.create", projectId, { name: "Catch up", workspace: { kind: "directory", root: `/workspace/${projectId}` } })));
  const taskId = randomUUID();
  ok(seed.execute(command("tasks.create", projectId, { taskId, code: "BOOT-001", title: "Build service", goal: "Deliver", brief: "Brief",
    parentTaskId: null, engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] })));
  ok(seed.execute(command("tasks.transition", projectId, { taskId, expectedRevision: 1, to: "accepted" })));
  await first.close();
  const second = await launch({ stepMs: 0 });
  const waiting = getTask(second.storage.raw, projectId, taskId);
  assert.equal(waiting.state, "awaiting-go");
  assert.equal(waiting.revision, 4);
  assert.equal(listAttempts(second.storage.raw, projectId, taskId).length, 0);
  await second.close();
  let bootstrapToken;
  const third = await startHost({ stateDir: dir, port: 0, dispatch: { stepMs: 0 }, onBootstrapToken(token) { bootstrapToken = token; } });
  hosts.push(third);
  assert.deepEqual(getTask(third.storage.raw, projectId, taskId), waiting);
  const host = `127.0.0.1:${third.port}`; const origin = `http://${host}`;
  const auth = await third.app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host, origin, "content-type": "application/json" }, payload: { token: bootstrapToken } });
  const cookie = auth.headers["set-cookie"].split(";")[0];
  const result = await third.app.inject({ method: "POST", url: "/commands", headers: { host, origin, cookie,
    "x-csrf-token": auth.json().csrfToken, "content-type": "application/json" },
    payload: command("tasks.release", projectId, { taskId, expectedRevision: waiting.revision }) });
  assert.equal(result.statusCode, 200, result.body);
  await third.dispatch.idle();
  assert.equal(getTask(third.storage.raw, projectId, taskId).state, "in-review");
  assert.equal(listAttempts(third.storage.raw, projectId, taskId).length, 1);
  assert.equal((await third.app.inject({ url: `/projects/${projectId}/tasks/${taskId}/attempts`, headers: { host, cookie } })).statusCode, 200);
});
