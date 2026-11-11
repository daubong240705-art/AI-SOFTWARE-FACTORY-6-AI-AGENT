import assert from "node:assert/strict";
import { createTokenRegistry } from "../dist/proxy/index.js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { API_VERSION, eventSchema, TASK_TRANSITIONS } from "@factory/contracts";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { EventHub } from "../dist/events/hub.js";
import { loadPack, findLeadSeat, getActiveEngagement, listSeats } from "../dist/org/index.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { openStorage } from "../dist/storage/database.js";
import { tasksCreateHandler, getTask } from "../dist/work/service.js";
import { createDispatcher, createFakeRuntime, RuntimeRegistry, AttemptError, getAttempt, listAttempts,
  listAttemptEvents, moveTask, LOCAL_NODE_ID } from "../dist/dispatch/index.js";

const pack = loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)));
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const pumped = async () => { await new Promise(setImmediate); await flush(); };
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const code = (value) => (error) => error instanceof AttemptError && error.code === value;

function fixture(t, options = {}) {
  const storage = openStorage(":memory:");
  storage.migrate({ migrationsDir, backupDir: null });
  const raw = storage.raw;
  let time = Date.parse("2026-11-07T10:00:00.000Z");
  const clock = () => new Date(time);
  const hub = new EventHub(raw, { clock });
  const errors = [];
  const intervals = new Map();
  const timeouts = new Map();
  let timerId = 0;
  const timers = {
    setInterval(callback, ms) { const id = ++timerId; intervals.set(id, { callback, ms }); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(callback, ms) { const id = ++timerId; timeouts.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
  };
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
    "projects.create": createProjectsCreateHandler({ pack }), "tasks.create": tasksCreateHandler,
  } });
  const execute = (projectId, type, payload) => {
    const result = pipeline.execute({ apiVersion: API_VERSION, commandId: randomUUID(), projectId, type, payload });
    assert.equal(result.status, 200, JSON.stringify(result.body));
  };
  const project = () => {
    const id = randomUUID();
    execute(id, "projects.create", { name: "Dispatcher project", workspace: { kind: "directory", root: `/workspace/${id}` } });
    return id;
  };
  const projectId = project();
  const seat = findLeadSeat(raw, getActiveEngagement(raw, projectId).teamId);
  let taskCode = 0;
  const task = (goal = "Deliver work", scope = projectId, state = "active") => {
    const id = randomUUID();
    execute(scope, "tasks.create", { taskId: id, code: `DSP-${String(++taskCode).padStart(3, "0")}`, title: "Dispatcher task", goal,
      brief: "Brief", parentTaskId: null, engagementId: null, ownerSeatId: null,
      requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] });
    if (state === "active") for (const to of ["accepted", "ready", "active"]) moveTask(raw, scope, id, to);
    else raw.prepare("UPDATE tasks SET state = ? WHERE project_id = ? AND id = ?").run(state, scope, id);
    return id;
  };
  const runtime = options.runtime ?? createFakeRuntime({ stepMs: 0 });
  const dispatcher = createDispatcher({ storage, hub: options.wrapHub?.(hub, raw) ?? hub,
    ...(options.workspace ? { workspace: options.workspace, projectRootFor: () => "/synthetic/project" } : {}),
    ...(options.modelAccess ? { modelAccess: options.modelAccess } : {}),
    registry: new RuntimeRegistry([runtime]), clock, timers, onError: (error) => errors.push(error),
    config: { leaseMs: 100, leaseRenewMs: 20, leaseCheckMs: 5, stopTimeoutMs: 10, ...options.config } });
  t.after(async () => { await dispatcher.stop(); storage.close(); });
  dispatcher.start();
  const enqueue = (taskId = task(), scope = projectId, seatId = seat.id) => dispatcher.enqueue({ projectId: scope, taskId, seatId });
  const read = (a) => getAttempt(raw, a.projectId, a.id);
  const events = (a) => listAttemptEvents(raw, a.projectId, a.id);
  const fire = async (ms) => { for (const timer of [...intervals.values()]) if (timer.ms === ms) timer.callback(); await flush(); };
  const timeout = async () => { for (const [id, timer] of [...timeouts]) { timeouts.delete(id); timer.callback(); } await flush(); };
  return { storage, raw, hub, dispatcher, runtime, projectId, seat, project, task, enqueue, read, events, errors,
    timers, clock, intervals, timeouts, fire, timeout, advance: (ms) => { time += ms; } };
}

function controlled({ delayedStart = false, delayedStop = false, rejectStop = false } = {}) {
  const started = [];
  const ended = [];
  const startGate = deferred();
  const stopGate = deferred();
  const sessions = [];
  return {
    kind: "fake", started, ended, sessions, startGate, stopGate,
    async start(context) {
      started.push(context);
      if (delayedStart) await startGate.promise;
      const waiting = [];
      const queue = [];
      let stopped = false;
      const iterator = { [Symbol.asyncIterator]() { return this; },
        next() { return queue.length ? Promise.resolve(queue.shift()) : stopped ? Promise.resolve({ done: true })
          : new Promise((resolve) => waiting.push(resolve)); } };
      const session = {
        emit(value) { const result = { done: false, value }; const reader = waiting.shift(); if (reader) reader(result); else queue.push(result); },
        events: () => iterator,
        async stop() {
          if (rejectStop) throw new Error("private runtime error");
          if (delayedStop) await stopGate.promise;
          stopped = true;
          if (!ended.includes(context.ref.attemptId)) ended.push(context.ref.attemptId);
          for (const resolve of waiting.splice(0)) resolve({ done: true });
        },
      };
      sessions.push(session);
      return session;
    },
  };
}

test("parking records the waiting and terminal states without a task outcome", async (t) => {
  const runtime = controlled(); const f = fixture(t, { runtime }); const a = f.enqueue(); await pumped();
  const taskBefore = getTask(f.raw, f.projectId, a.taskId);
  assert.equal(await f.dispatcher.parkAttempt({ projectId: a.projectId, attemptId: a.id, epoch: a.epoch }), true);
  await f.dispatcher.idle(); const final = f.read(a); assert.equal(final.state, "parked"); assert.ok(final.endedAt);
  assert.equal(final.leaseId, null); assert.equal(final.leaseExpiresAt, null); assert.equal(final.outcome, "known");
  assert.deepEqual(getTask(f.raw, f.projectId, a.taskId), taskBefore); assert.equal(f.dispatcher.status().nodeUsed, 0);
  assert.deepEqual(f.events(a).filter((e) => e.kind === "state").slice(-2).map((e) => e.body),
    [{ to: "waiting-input", reason: "decision" }, { to: "parked", reason: "decision" }]);
  assert.deepEqual(runtime.ended, [a.id]); assert.deepEqual(f.errors, []);
});
test("parking revokes model access before waiting for verified stop", async (t) => {
  const runtime = controlled({ delayedStop: true }); const tokens = createTokenRegistry({ clock: () => new Date("2026-11-07T10:00:00Z") });
  let token; const f = fixture(t, { runtime, modelAccess: { issue(input) { token = tokens.issue({ ...input, allowedModels: ["approved"] }).token;
    return { token, baseUrl: "http://fixture/v1", models: ["approved"] }; }, revoke(id) { tokens.revoke(id); } } });
  t.after(() => tokens.revokeAll()); const a = f.enqueue(); await pumped(); assert.ok(tokens.resolve(token));
  const parking = f.dispatcher.parkAttempt({ projectId: a.projectId, attemptId: a.id, epoch: 1 }); await flush();
  assert.equal(f.read(a).state, "waiting-input"); assert.equal(tokens.resolve(token), null); assert.equal(f.dispatcher.status().nodeUsed, 1);
  assert.equal(f.dispatcher.recordAgentProgress({ projectId: a.projectId, attemptId: a.id, epoch: 1 }, "Late"), false);
  runtime.sessions[0].emit({ type: "completed", summary: "Late completion" }); await flush(); assert.equal(f.read(a).state, "waiting-input");
  runtime.stopGate.resolve(); assert.equal(await parking, true); await f.dispatcher.idle(); assert.equal(f.read(a).state, "parked");
});
test("parking frees the slot and starts the next queued task", async (t) => {
  const f = fixture(t, { config: { nodeSlots: 1 } }); const a = f.enqueue(f.task("[fake:hang]")); const next = f.enqueue(); await pumped();
  assert.equal(f.read(a).state, "running"); assert.equal(f.read(next).state, "queued");
  assert.equal(await f.dispatcher.parkAttempt({ projectId: a.projectId, attemptId: a.id, epoch: 1 }), true);
  await f.dispatcher.idle(); assert.equal(f.read(next).state, "succeeded"); assert.equal(f.runtime.started.length, 2);
  f.dispatcher.kick(); await pumped(); assert.equal(listAttempts(f.raw, f.projectId, a.taskId).length, 1);
});
for (const rejectStop of [false, true]) test(`parking with an unverified ${rejectStop ? "rejected" : "timed out"} stop becomes unknown`, async (t) => {
  const runtime = controlled({ rejectStop, delayedStop: !rejectStop }); const f = fixture(t, { runtime }); const a = f.enqueue(); await pumped();
  const parking = f.dispatcher.parkAttempt({ projectId: a.projectId, attemptId: a.id, epoch: 1 }); await flush();
  if (!rejectStop) await f.timeout(); assert.equal(await parking, false); await f.dispatcher.idle();
  assert.equal(f.read(a).state, "unknown"); assert.equal(f.read(a).outcome, "unknown");
  assert.equal(getTask(f.raw, f.projectId, a.taskId).state, "active"); assert.equal(f.dispatcher.status().nodeUsed, 1);
  runtime.stopGate.resolve(); await flush(); assert.equal(f.read(a).state, "unknown");
});
test("concurrent operator stop joins parking and leaves a consistent parked result", async (t) => {
  const runtime = controlled({ delayedStop: true }); const f = fixture(t, { runtime }); const a = f.enqueue(); await pumped();
  const parking = f.dispatcher.parkAttempt({ projectId: a.projectId, attemptId: a.id, epoch: 1 }); await flush();
  const stopping = f.dispatcher.stopAttempt(a.projectId, a.id); runtime.stopGate.resolve();
  assert.equal(await parking, true); assert.equal((await stopping).state, "parked"); await f.dispatcher.idle();
  assert.deepEqual(runtime.ended, [a.id]); assert.equal(getTask(f.raw, f.projectId, a.taskId).state, "active");
});
test("operator stop winning the race makes a subsequent park inert", async (t) => {
  const f = fixture(t, { runtime: controlled() }); const a = f.enqueue(); await pumped();
  const stopping = f.dispatcher.stopAttempt(a.projectId, a.id); const before = f.raw.serialize();
  assert.equal(await f.dispatcher.parkAttempt({ projectId: a.projectId, attemptId: a.id, epoch: 1 }), false);
  await stopping; assert.equal(f.read(a).state, "stopped"); assert.ok(before);
});
for (const label of ["wrong epoch", "unknown attempt", "foreign project", "expired lease"]) test(`parking refuses ${label} without writes`, async (t) => {
  const f = fixture(t, { runtime: controlled() }); const a = f.enqueue(); await pumped();
  const ref = { projectId: a.projectId, attemptId: a.id, epoch: 1 };
  if (label === "wrong epoch") ref.epoch = 2; else if (label === "unknown attempt") ref.attemptId = randomUUID();
  else if (label === "foreign project") ref.projectId = randomUUID(); else f.advance(100);
  const before = f.raw.serialize(); assert.equal(await f.dispatcher.parkAttempt(ref), false); assert.deepEqual(f.raw.serialize(), before);
});
test("parking a queued or already parked attempt has no effect", async (t) => {
  const f = fixture(t); const a = f.enqueue(f.task("[fake:hang]")); const ref = { projectId: a.projectId, attemptId: a.id, epoch: 1 };
  const before = f.raw.serialize(); assert.equal(await f.dispatcher.parkAttempt(ref), false); assert.deepEqual(f.raw.serialize(), before);
  await pumped(); assert.equal(await f.dispatcher.parkAttempt(ref), true); await f.dispatcher.idle();
  const after = f.raw.serialize(); assert.equal(await f.dispatcher.parkAttempt(ref), false); assert.deepEqual(f.raw.serialize(), after);
});
test("parking collects evidence only after verified runtime termination", async (t) => {
  const runtime = controlled({ delayedStop: true }); const calls = [];
  const f = fixture(t, { runtime, workspace: { async prepare() { return { path: "/synthetic/work", branch: "factory/partial", baseSha: "base" }; },
    async finish(input) { assert.ok(runtime.ended.includes(input.attemptId)); calls.push(input); return { files: [], totals: { files: 0, additions: 0, deletions: 0 } }; } } });
  const a = f.enqueue(); await pumped(); const parking = f.dispatcher.parkAttempt({ projectId: a.projectId, attemptId: a.id, epoch: 1 }); await flush();
  assert.equal(calls.length, 0); runtime.stopGate.resolve(); assert.equal(await parking, true); await f.dispatcher.idle();
  assert.equal(calls.length, 1); assert.equal(f.events(a).filter((e) => e.kind === "evidence").length, 1);
});
test("recovery treats waiting-input like running and never replays uncertain work", async (t) => {
  const runtime = controlled({ delayedStop: true }); const f = fixture(t, { runtime }); const a = f.enqueue(); await pumped();
  const parking = f.dispatcher.parkAttempt({ projectId: a.projectId, attemptId: a.id, epoch: 1 }); await flush();
  assert.equal(f.read(a).state, "waiting-input"); assert.deepEqual(f.dispatcher.recover(), { leaseExpired: 1, unknown: 1, requeued: 0, untouched: 0 });
  runtime.stopGate.resolve(); assert.equal(await parking, false); await f.dispatcher.idle(); assert.equal(f.read(a).state, "unknown");
  assert.equal(listAttempts(f.raw, f.projectId, a.taskId).length, 1);
});

test("agent progress matches runtime progress and fences wrong references", async (t) => {
  const runtime = controlled(); const f = fixture(t, { runtime }); const a = f.enqueue(); await pumped();
  const ref = { projectId: a.projectId, attemptId: a.id, epoch: a.epoch };
  const body = { type: "progress", message: "Milestone", percent: 25 };
  runtime.sessions[0].emit(body); await flush();
  assert.equal(f.dispatcher.recordAgentProgress(ref, "Milestone", 25), true);
  const progress = f.events(a).filter((event) => event.kind === "progress");
  assert.deepEqual(progress.map((event) => event.body), [body, body]);
  const before = f.events(a).length;
  for (const wrong of [{ ...ref, epoch: 2 }, { ...ref, projectId: randomUUID() }, { ...ref, attemptId: randomUUID() }])
    assert.equal(f.dispatcher.recordAgentProgress(wrong, "Late"), false);
  assert.equal(f.events(a).length, before);
  await f.dispatcher.stopAttempt(a.projectId, a.id);
  const ended = f.events(a).length; assert.equal(f.dispatcher.recordAgentProgress(ref, "Late"), false); assert.equal(f.events(a).length, ended);
});
test("agent progress rejects an expired lease without a write", async (t) => {
  const f = fixture(t, { runtime: controlled() }); const a = f.enqueue(); await pumped(); const count = f.events(a).length;
  f.advance(100); assert.equal(f.dispatcher.recordAgentProgress({ projectId: a.projectId, attemptId: a.id, epoch: a.epoch }, "Late"), false);
  assert.equal(f.events(a).length, count);
});
test("dispatcher issues workspace scope only to model access", async (t) => {
  const issued = []; const workspace = { path: "/synthetic/attempt-workspace", branch: "branch", baseSha: "base" };
  const runtime = controlled(); const f = fixture(t, { runtime,
    workspace: { prepare: async () => workspace, finish: async () => ({ files: [] }) },
    modelAccess: { issue(input) { issued.push(input); return { baseUrl: "http://fixture/v1", token: "synthetic-credential", models: ["approved"] }; }, revoke() {} } });
  const a = f.enqueue(); await pumped(); assert.equal(issued[0].workspacePath, workspace.path);
  assert.equal(Object.hasOwn(runtime.started[0].model, "workspacePath"), false);
  assert.equal(JSON.stringify(f.events(a)).includes(workspace.path), false);
});

test("happy path emits the complete state sequence and valid ordered entity events", async (t) => {
  const states = [];
  const f = fixture(t, { wrapHub: (hub, raw) => ({ transaction: (fn) => hub.transaction(fn), append(input) {
    const a = raw.prepare("SELECT state FROM attempts WHERE project_id = ? AND id = ?").get(input.projectId, input.causationId);
    if (a && states.at(-1) !== a.state) states.push(a.state);
    return hub.append(input);
  } }) });
  const taskId = f.task();
  const cursor = f.hub.currentCursor(f.projectId);
  const a = f.enqueue(taskId);
  await f.dispatcher.idle();
  assert.deepEqual(states, ["queued", "leased", "preparing", "running", "submitting", "succeeded"]);
  const done = f.read(a);
  assert.equal(done.state, "succeeded");
  assert.equal(done.leaseId, null);
  assert.equal(done.leaseExpiresAt, null);
  assert.ok(done.startedAt);
  assert.ok(done.endedAt);
  assert.equal(getTask(f.raw, a.projectId, a.taskId).state, "in-review");
  const events = f.hub.readAfter(f.projectId, cursor).events;
  assert.ok(events.every((e) => eventSchema.safeParse(e).success));
  assert.ok(events.every((e) => e.causationId === a.id && e.rootCausationId === a.id));
  assert.deepEqual(events.slice(-3).map((e) => e.payload.entity?.kind ?? e.payload.type), ["attempt", "task", "task.status-changed"]);
  assert.deepEqual({ taskId: events.at(-1).payload.taskId, to: events.at(-1).payload.to }, { taskId: a.taskId, to: "in-review" });
  assert.deepEqual(f.events(a).map((e) => e.kind), ["state", "progress", "progress", "evidence", "state"]);
  assert.deepEqual(f.events(a).map((e) => e.seq), [1, 2, 3, 4, 5]);
  assert.equal(f.raw.prepare("SELECT slots_used FROM nodes WHERE id = ?").get(LOCAL_NODE_ID).slots_used, 0);
});

for (const marker of ["[fake:fail]", "[fake:crash]"]) test(`${marker} fails the attempt and task using generic stored text`, async (t) => {
  const f = fixture(t);
  const a = f.enqueue(f.task(marker));
  await f.dispatcher.idle();
  assert.equal(f.read(a).state, "failed");
  assert.equal(getTask(f.raw, a.projectId, a.taskId).state, "failed");
  assert.equal(f.events(a).at(-1).body.message, "runtime failed");
  assert.ok(!JSON.stringify(f.events(a)).includes("Fake"));
});

for (const throws of [false, true]) test(`iterator ${throws ? "exception" : "ending without result"} fails safely`, async (t) => {
  const runtime = { kind: "fake", async start() { return { stop: async () => {}, async *events() {
    yield { type: "output", text: "Useful output" };
    if (throws) throw new Error("private runtime error");
  } }; } };
  const f = fixture(t, { runtime });
  const a = f.enqueue();
  await f.dispatcher.idle();
  assert.equal(f.read(a).state, "failed");
  assert.equal(f.events(a).at(-1).body.message, throws ? "runtime failed" : "runtime ended without a result");
  assert.ok(!JSON.stringify(f.events(a)).includes("private"));
});

test("node slots bound concurrency across projects and release capacity for the third attempt", async (t) => {
  const runtime = controlled();
  const f = fixture(t, { runtime });
  f.raw.prepare("UPDATE seats SET slots = ? WHERE id = ?").run(3, f.seat.id);
  const other = f.project();
  const attempts = [f.enqueue(), f.enqueue(f.task("Two", other), other), f.enqueue()];
  let maximum = 0;
  f.hub.subscribe(f.projectId, () => { maximum = Math.max(maximum, f.dispatcher.status().nodeUsed); });
  await pumped();
  assert.equal(runtime.started.length, 2);
  assert.equal(f.read(attempts[2]).state, "queued");
  assert.equal(f.raw.prepare("SELECT slots_used FROM nodes WHERE id = ?").get(LOCAL_NODE_ID).slots_used, 2);
  runtime.sessions[0].emit({ type: "completed", summary: "Done" });
  await flush(); await pumped();
  assert.equal(runtime.started.length, 3);
  assert.ok(maximum <= 2);
  assert.equal(f.dispatcher.status().nodeUsed, 2);
});

test("seat slots serialize tasks while a free seat can bypass a blocked queue head", async (t) => {
  const runtime = controlled();
  const f = fixture(t, { runtime });
  const anotherSeat = listSeats(f.raw, getActiveEngagement(f.raw, f.projectId).teamId).find((s) => s.id !== f.seat.id);
  const first = f.enqueue(); const second = f.enqueue(); const third = f.enqueue(f.task(), f.projectId, anotherSeat.id);
  await pumped();
  assert.deepEqual(runtime.started.map((c) => c.ref.attemptId), [first.id, third.id]);
  assert.equal(f.read(second).state, "queued");
  runtime.sessions[0].emit({ type: "completed", summary: "Done" });
  await flush(); await pumped();
  assert.equal(runtime.started.at(-1).ref.attemptId, second.id);
});

test("engagement priority precedes FIFO creation order", async (t) => {
  const runtime = controlled();
  const f = fixture(t, { runtime, config: { nodeSlots: 1 } });
  const other = f.project();
  f.raw.prepare("UPDATE engagements SET priority = ? WHERE project_id = ?").run(99, other);
  const low = f.enqueue(); const high1 = f.enqueue(f.task("First", other), other); const high2 = f.enqueue(f.task("Second", other), other);
  await pumped();
  assert.equal(runtime.started[0].ref.attemptId, high1.id);
  runtime.sessions[0].emit({ type: "completed", summary: "Done" });
  await flush(); await pumped();
  assert.equal(runtime.started[1].ref.attemptId, high2.id);
  runtime.sessions[1].emit({ type: "completed", summary: "Done" });
  await flush(); await pumped();
  assert.equal(runtime.started[2].ref.attemptId, low.id);
});

test("many kicks coalesce and observer kicks during pumping never duplicate execution", async (t) => {
  const f = fixture(t);
  f.hub.subscribe(f.projectId, () => f.dispatcher.kick());
  const a = f.enqueue();
  for (let i = 0; i < 100; i++) f.dispatcher.kick();
  await f.dispatcher.idle();
  assert.equal(f.runtime.started.length, 1);
  assert.equal(f.read(a).state, "succeeded");
});

test("enqueue duplicate and foreign seat errors propagate and roll back events", (t) => {
  const f = fixture(t);
  const a = f.enqueue();
  const cursor = f.hub.currentCursor(f.projectId);
  assert.throws(() => f.enqueue(a.taskId), code("live-attempt-exists"));
  assert.throws(() => f.enqueue(f.task(), f.projectId, randomUUID()), code("seat-not-in-team"));
  assert.equal(listAttempts(f.raw, a.projectId, a.taskId).length, 1);
  // Task creation itself emitted events; the rejected duplicate did not.
  assert.equal(f.hub.readAfter(f.projectId, cursor).events.filter((e) => e.payload.entity?.kind === "attempt").length, 0);
});

for (const state of Object.keys(TASK_TRANSITIONS).filter((s) => s !== "active")) test(`enqueue refuses task in ${state}`, (t) => {
  const f = fixture(t);
  assert.throws(() => f.enqueue(f.task("Work", f.projectId, state)), code("task-not-active"));
});

test("queued stop never starts a runtime and fails the active task", async (t) => {
  const f = fixture(t);
  const a = f.enqueue();
  const result = await f.dispatcher.stopAttempt(a.projectId, a.id);
  await f.dispatcher.idle();
  assert.equal(result.state, "stopped");
  assert.equal(f.runtime.started.length, 0);
  assert.equal(getTask(f.raw, a.projectId, a.taskId).state, "failed");
});

test("running stop waits for execution to end and concurrent calls share one promise", async (t) => {
  const runtime = controlled({ delayedStop: true });
  const f = fixture(t, { runtime });
  const a = f.enqueue(); await pumped();
  const p = f.dispatcher.stopAttempt(a.projectId, a.id);
  assert.equal(f.dispatcher.stopAttempt(a.projectId, a.id), p);
  await flush();
  assert.equal(f.read(a).state, "stopping");
  assert.equal(runtime.ended.length, 0);
  assert.equal(f.dispatcher.status().live, 1);
  runtime.stopGate.resolve();
  const final = await p;
  assert.equal(final.state, "stopped");
  assert.deepEqual(runtime.ended, [a.id]);
  assert.equal(getTask(f.raw, a.projectId, a.taskId).state, "failed");
});

test("stop during preparing waits for start and then waits for session stop", async (t) => {
  const runtime = controlled({ delayedStart: true, delayedStop: true });
  const f = fixture(t, { runtime });
  const a = f.enqueue(); await pumped();
  assert.equal(f.read(a).state, "preparing");
  const p = f.dispatcher.stopAttempt(a.projectId, a.id); await flush();
  assert.equal(f.read(a).state, "stopping");
  assert.equal(f.timeouts.size, 1);
  runtime.startGate.resolve(); await flush();
  assert.equal(f.read(a).state, "stopping");
  runtime.stopGate.resolve();
  assert.equal((await p).state, "stopped");
  assert.equal(runtime.started.length, 1);
});

for (const rejectStop of [false, true]) test(`stop ${rejectStop ? "rejection" : "timeout"} leaves an unknown outcome and task active`, async (t) => {
  const runtime = controlled({ delayedStop: !rejectStop, rejectStop });
  const f = fixture(t, { runtime });
  const a = f.enqueue(); await pumped();
  const p = f.dispatcher.stopAttempt(a.projectId, a.id); await flush();
  if (!rejectStop) await f.timeout();
  assert.equal((await p).state, "unknown");
  assert.equal(getTask(f.raw, a.projectId, a.taskId).state, "active");
  assert.ok(f.errors.length);
  runtime.stopGate.resolve();
  await flush();
  assert.equal(f.read(a).state, "unknown");
  assert.equal(f.dispatcher.status().nodeUsed, 1);
});

test("stop of a hanging fake reports the execution ended", async (t) => {
  const f = fixture(t);
  const a = f.enqueue(f.task("[fake:hang]")); await pumped();
  assert.equal((await f.dispatcher.stopAttempt(a.projectId, a.id)).state, "stopped");
  assert.equal(f.runtime.stopped[0].attemptId, a.id);
});

test("stop timeout while start is unresolved cannot falsely mark stopped on late start", async (t) => {
  const runtime = controlled({ delayedStart: true });
  const f = fixture(t, { runtime });
  const a = f.enqueue(); await pumped();
  const p = f.dispatcher.stopAttempt(a.projectId, a.id); await flush(); await f.timeout();
  assert.equal((await p).state, "unknown");
  runtime.startGate.resolve(); await flush();
  assert.equal(f.read(a).state, "unknown");
  assert.deepEqual(runtime.ended, [a.id]);
});

test("expired default work becomes unknown without replay and late events are dropped", async (t) => {
  const runtime = controlled();
  const f = fixture(t, { runtime });
  const a = f.enqueue(); await pumped();
  const before = f.events(a).length;
  f.advance(100); await f.fire(5);
  runtime.sessions[0].emit({ type: "output", text: "late secret-free output" });
  await pumped();
  assert.equal(f.read(a).state, "unknown");
  assert.equal(listAttempts(f.raw, a.projectId, a.taskId).length, 1);
  assert.equal(runtime.started.length, 1);
  assert.equal(f.events(a).length, before + 1);
  assert.equal(getTask(f.raw, a.projectId, a.taskId).state, "active");
});

test("safe lease expiry creates a new epoch with handoff and fences the old execution", async (t) => {
  const runtime = controlled();
  const f = fixture(t, { runtime });
  const id = f.task();
  f.raw.prepare("UPDATE tasks SET placement = ?, side_effect = ? WHERE project_id = ? AND id = ?").run("repo-bound", "artifact", f.projectId, id);
  const a = f.enqueue(id); await pumped();
  runtime.sessions[0].emit({ type: "progress", message: "Earlier work" }); await flush();
  f.advance(100); await f.fire(5); await pumped();
  assert.equal(f.read(a).state, "requeued");
  const all = listAttempts(f.raw, a.projectId, id);
  assert.equal(all.length, 2);
  assert.equal(all[1].epoch, 2);
  assert.match(runtime.started[1].handoff, /Epoch 1: requeued/);
  assert.match(runtime.started[1].handoff, /Earlier work/);
  runtime.sessions[0].emit({ type: "completed", summary: "Late completion" }); await flush();
  assert.equal(getTask(f.raw, a.projectId, id).state, "active");
});

test("progress output and evidence renew leases so an emitting runtime stays alive", async (t) => {
  const runtime = controlled(); const f = fixture(t, { runtime });
  const a = f.enqueue(); await pumped();
  for (const event of [{ type: "progress", message: "Working" }, { type: "output", text: "Log" }, { type: "evidence", name: "check", detail: "passed" }]) {
    f.advance(80); runtime.sessions[0].emit(event); await flush(); await f.fire(5);
    assert.equal(f.read(a).state, "running");
    assert.equal(Date.parse(f.read(a).leaseExpiresAt), f.clock().getTime() + 100);
  }
  assert.deepEqual(f.events(a).slice(1).map((e) => e.kind), ["progress", "output", "evidence"]);
});

test("renew timer keeps a silent live session alive and refuses resurrection at expiry", async (t) => {
  const f = fixture(t); const a = f.enqueue(f.task("[fake:silent]")); await pumped();
  f.advance(80); await f.fire(20); f.advance(80); await f.fire(5);
  assert.equal(f.read(a).state, "running");
  f.advance(20); await f.fire(20); await f.fire(5);
  assert.equal(f.read(a).state, "unknown");
});

for (const result of ["completed", "failed"]) test(`task cancelled while running preserves cancellation after runtime ${result}`, async (t) => {
  const runtime = controlled(); const f = fixture(t, { runtime });
  const a = f.enqueue(); await pumped(); moveTask(f.raw, a.projectId, a.taskId, "cancelled");
  runtime.sessions[0].emit(result === "completed" ? { type: result, summary: "Done" } : { type: result, kind: "runtime", message: "private" });
  await f.dispatcher.idle();
  assert.equal(f.read(a).state, result === "completed" ? "succeeded" : "failed");
  assert.equal(getTask(f.raw, a.projectId, a.taskId).state, "cancelled");
});

test("outcome bookkeeping rollback gets a separate failure transaction and calls onError", async (t) => {
  let failed = false;
  const f = fixture(t, { wrapHub: (hub, raw) => ({
    transaction: (fn) => hub.transaction(fn),
    append(input) {
      const state = raw.prepare("SELECT state FROM attempts WHERE project_id = ? AND id = ?").get(input.projectId, input.causationId)?.state;
      if (!failed && state === "succeeded") { failed = true; throw new Error("injected bookkeeping failure"); }
      return hub.append(input);
    },
  }) });
  const a = f.enqueue(); await f.dispatcher.idle();
  assert.equal(failed, true);
  assert.equal(f.read(a).state, "failed");
  assert.equal(getTask(f.raw, a.projectId, a.taskId).state, "failed");
  assert.ok(f.errors.length);
});

test("shutdown stops sessions without database writes and disables further work", async (t) => {
  const f = fixture(t); const a = f.enqueue(f.task("[fake:hang]")); await pumped();
  const before = f.raw.serialize();
  const p = f.dispatcher.stop(); assert.equal(f.dispatcher.stop(), p); await p;
  assert.deepEqual(f.raw.serialize(), before);
  assert.equal(f.runtime.stopped[0].attemptId, a.id);
  assert.equal(f.intervals.size, 0);
  assert.throws(() => f.enqueue(a.taskId), code("dispatcher-stopped"));
  f.dispatcher.kick(); await pumped();
  assert.equal(f.runtime.started.length, 1);
  await f.dispatcher.idle();
});

test("shutdown is bounded even when a runtime ignores abort and stop never settles", async (t) => {
  const runtime = controlled({ delayedStop: true }); const f = fixture(t, { runtime });
  const a = f.enqueue(); await pumped(); const before = f.read(a);
  const p = f.dispatcher.stop(); await flush(); await f.timeout(); await p;
  assert.deepEqual(f.read(a), before);
  runtime.stopGate.resolve(); await flush();
});

test("idle waits for scheduled pump and runtime, while queued capacity-blocked work is idle", async (t) => {
  const runtime = controlled(); const f = fixture(t, { runtime, config: { nodeSlots: 1 } });
  const a = f.enqueue(); f.enqueue();
  let idle = false; const pending = f.dispatcher.idle().then(() => { idle = true; });
  await pumped(); assert.equal(idle, false);
  f.advance(100); await f.fire(5); await pumped(); await pending;
  assert.equal(idle, true);
  assert.equal(f.read(a).state, "unknown");
  assert.deepEqual(f.dispatcher.status(), { live: 0, queued: 1, nodeUsed: 1, nodeTotal: 1 });
});

test("enqueue maps an unavailable seat runtime to fake and uses the registered kind when present", async (t) => {
  const runtime = controlled(); const f = fixture(t, { runtime });
  f.raw.prepare("UPDATE seats SET runtime = ? WHERE id = ?").run("api-agent", f.seat.id);
  const a = f.enqueue(); await pumped();
  assert.equal(a.runtime, "fake"); assert.equal(a.provider, "fake"); assert.equal(a.model, "fake"); assert.equal(a.effort, "medium");
});

test("timer storage failures are reported without escaping the interval", async (t) => {
  const runtime = controlled(); const f = fixture(t, { runtime }); const a = f.enqueue(); await pumped();
  const original = f.hub.transaction.bind(f.hub);
  f.hub.transaction = () => { throw new Error("injected storage failure"); };
  f.advance(80); await f.fire(20); f.advance(20); await f.fire(5);
  assert.ok(f.errors.length >= 2);
  f.hub.transaction = original;
  assert.equal(f.read(a).state, "running");
});

test("fake started and ended bookkeeping proves maximum node concurrency across projects", async (t) => {
  const pending = new Map(); let timerId = 0;
  const runtime = createFakeRuntime({ stepMs: 0, timers: {
    setTimeout(callback) { const id = ++timerId; pending.set(id, callback); return id; },
    clearTimeout(id) { pending.delete(id); },
  } });
  const f = fixture(t, { runtime });
  f.raw.prepare("UPDATE seats SET slots = ? WHERE id = ?").run(3, f.seat.id);
  const other = f.project(); f.enqueue(); f.enqueue(f.task("Other project", other), other); f.enqueue();
  await pumped();
  let maximum = runtime.started.length - runtime.ended.length;
  assert.equal(maximum, 2);
  for (let i = 0; i < 12; i++) {
    for (const [id, callback] of [...pending]) {
      pending.delete(id); callback(); await flush();
      maximum = Math.max(maximum, runtime.started.length - runtime.ended.length);
    }
    await pumped();
    maximum = Math.max(maximum, runtime.started.length - runtime.ended.length);
  }
  await f.dispatcher.idle();
  assert.equal(maximum, 2);
  assert.equal(runtime.started.length, 3);
  assert.equal(runtime.ended.length, 3);
});

test("shutdown concurrent with an operator stop is bounded and leaves stopping unchanged", async (t) => {
  const runtime = controlled({ delayedStop: true }); const f = fixture(t, { runtime });
  const a = f.enqueue(); await pumped();
  const operatorStop = f.dispatcher.stopAttempt(a.projectId, a.id); await flush();
  const before = f.read(a); assert.equal(before.state, "stopping");
  const shutdown = f.dispatcher.stop(); await flush(); await f.timeout(); await shutdown;
  assert.equal((await operatorStop).state, "stopping");
  assert.deepEqual(f.read(a), before);
  runtime.stopGate.resolve(); await flush();
});

test("shutdown while preparing waits for a delayed start without changing its row", async (t) => {
  const runtime = controlled({ delayedStart: true }); const f = fixture(t, { runtime });
  const a = f.enqueue(); await pumped(); const before = f.read(a);
  assert.equal(before.state, "preparing");
  const stop = f.dispatcher.stop(); await flush();
  let ended = false; void stop.then(() => { ended = true; }); await flush();
  assert.equal(ended, false);
  runtime.startGate.resolve(); await stop;
  assert.deepEqual(runtime.ended, [a.id]); assert.deepEqual(f.read(a), before);
});

test("registered runtime kinds are retained in the attempt and invoke their adapter", async (t) => {
  const runtime = { ...controlled(), kind: "api-agent" }; const f = fixture(t, { runtime });
  f.raw.prepare("UPDATE seats SET runtime = ? WHERE id = ?").run("api-agent", f.seat.id);
  const a = f.enqueue(); await pumped();
  assert.equal(a.runtime, "api-agent"); assert.equal(runtime.started.length, 1);
});

for (const phase of ["start", "iterator"]) test(`late ${phase} rejection after lease expiry cannot record a known failure`, async (t) => {
  const rejection = deferred();
  const runtime = { kind: "fake", async start() {
    if (phase === "start") await rejection.promise;
    return { stop: async () => {}, events: () => ({ [Symbol.asyncIterator]() { return this; }, next: () => rejection.promise }) };
  } };
  const f = fixture(t, { runtime }); const a = f.enqueue(); await pumped();
  assert.equal(f.read(a).state, phase === "start" ? "preparing" : "running");
  f.advance(100); rejection.reject(new Error("private late runtime error")); await flush();
  assert.equal(f.read(a).state, phase === "start" ? "preparing" : "running");
  await f.fire(5); await f.dispatcher.idle();
  assert.equal(f.read(a).state, "unknown");
  assert.equal(getTask(f.raw, a.projectId, a.taskId).state, "active");
  assert.ok(!JSON.stringify(f.events(a)).includes("private"));
});

function accessFixture(t) {
  const tokens = createTokenRegistry({ clock: () => new Date() }); const issued = [];
  t.after(() => tokens.revokeAll());
  const modelAccess = { issue(input) {
    const grant = tokens.issue({ ...input, allowedModels: ["approved"] });
    issued.push({ input, token: grant.token });
    return { baseUrl: "http://127.0.0.1:8788/v1", token: grant.token, models: ["approved"] };
  }, revoke: (id) => tokens.revoke(id) };
  return { tokens, issued, modelAccess };
}

test("dispatcher without model access passes no model context", async (t) => {
  const f = fixture(t); f.enqueue(); await f.dispatcher.idle(); assert.equal(f.runtime.started[0].model, undefined);
});
for (const type of ["completed", "failed"]) test(`dispatcher revokes model access on runtime ${type}`, async (t) => {
  const access = accessFixture(t); const runtime = controlled(); const f = fixture(t, { runtime, modelAccess: access.modelAccess });
  const a = f.enqueue(); assert.equal(access.issued.length, 0); await pumped();
  const { token, input } = access.issued[0]; assert.equal(input.attemptId, a.id); assert.equal(input.taskId, a.taskId);
  assert.equal(input.projectId, a.projectId); assert.equal(input.epoch, 1); assert.ok(access.tokens.resolve(token));
  assert.deepEqual(runtime.started[0].model, { baseUrl: "http://127.0.0.1:8788/v1", token, models: ["approved"] });
  runtime.sessions[0].emit(type === "completed" ? { type, summary: "Done" } : { type, kind: "runtime", message: "Failure" });
  await f.dispatcher.idle(); assert.equal(access.tokens.resolve(token), null);
  assert.equal(f.raw.serialize().includes(Buffer.from(token)), false); assert.equal(JSON.stringify(f.events(a)).includes(token), false);
  assert.equal(JSON.stringify(f.hub.readAfter(a.projectId, { epoch: f.hub.currentCursor(a.projectId).epoch, sequence: "0" })).includes(token), false);
  assert.equal(JSON.stringify(f.read(a)).includes(token), false); assert.equal(JSON.stringify(f.errors).includes(token), false);
});
test("dispatcher revokes synchronously at the start of an operator stop", async (t) => {
  const access = accessFixture(t); const runtime = controlled({ delayedStop: true });
  const f = fixture(t, { runtime, modelAccess: access.modelAccess }); const a = f.enqueue(); await pumped();
  const token = access.issued[0].token; const pending = f.dispatcher.stopAttempt(a.projectId, a.id);
  assert.equal(access.tokens.resolve(token), null); await flush(); assert.equal(f.read(a).state, "stopping");
  runtime.stopGate.resolve(); await pending;
});
test("dispatcher revokes a preparing runtime while its start is pending", async (t) => {
  const access = accessFixture(t); const runtime = controlled({ delayedStart: true });
  const f = fixture(t, { runtime, modelAccess: access.modelAccess }); const a = f.enqueue(); await pumped();
  const pending = f.dispatcher.stopAttempt(a.projectId, a.id); assert.equal(access.tokens.resolve(access.issued[0].token), null);
  runtime.startGate.resolve(); await pending;
});
test("dispatcher lease expiry fences and revokes the old model grant", async (t) => {
  const access = accessFixture(t); const runtime = controlled(); const f = fixture(t, { runtime, modelAccess: access.modelAccess });
  const a = f.enqueue(); await pumped(); f.advance(100); await f.fire(5); await f.dispatcher.idle();
  assert.equal(f.read(a).state, "unknown"); assert.equal(access.tokens.resolve(access.issued[0].token), null);
});
test("dispatcher shutdown revokes access before awaiting session stop", async (t) => {
  const access = accessFixture(t); const runtime = controlled({ delayedStop: true });
  const f = fixture(t, { runtime, modelAccess: access.modelAccess }); f.enqueue(); await pumped();
  const pending = f.dispatcher.stop(); assert.equal(access.tokens.resolve(access.issued[0].token), null);
  runtime.stopGate.resolve(); await pending;
});
test("dispatcher runtime start failure revokes the issued grant", async (t) => {
  const access = accessFixture(t); const f = fixture(t, { modelAccess: access.modelAccess });
  f.enqueue(f.task("[fake:crash]")); await f.dispatcher.idle(); assert.equal(access.tokens.resolve(access.issued[0].token), null);
});
test("dispatcher refuses to persist model credentials echoed by a runtime", async (t) => {
  const access = accessFixture(t); const runtime = controlled(); const f = fixture(t, { runtime, modelAccess: access.modelAccess });
  const a = f.enqueue(); await pumped(); const token = access.issued[0].token;
  const logs = []; for (const method of ["log", "error", "warn"]) t.mock.method(console, method, (...args) => logs.push(args));
  runtime.sessions[0].emit({ type: "progress", message: token }); await f.dispatcher.idle();
  assert.equal(f.read(a).state, "failed"); assert.equal(f.raw.serialize().includes(Buffer.from(token)), false);
  assert.equal(JSON.stringify(f.events(a)).includes(token), false); assert.equal(JSON.stringify(logs).includes(token), false);
  assert.equal(access.tokens.resolve(token), null);
});

test("node capacity limits concurrency even when every seat has a free slot", async (t) => {
  // Three DIFFERENT seats (1 slot each) so that the seat limit never binds: only the node (2 slots) can.
  const f = fixture(t, { config: { nodeSlots: 2 } });
  const seats = listSeats(f.raw, getActiveEngagement(f.raw, f.projectId).teamId).filter((s) => !s.isLead).slice(0, 3);
  assert.equal(seats.length, 3);
  const attempts = seats.map((s) => f.enqueue(f.task("[fake:hang]"), f.projectId, s.id));
  await pumped();
  assert.equal(f.runtime.started.length, 2, "only two executions may run on a node with two slots");
  const states = attempts.map((a) => f.read(a).state).sort();
  assert.deepEqual(states, ["queued", "running", "running"]);
  assert.deepEqual(f.dispatcher.status(), { live: 2, queued: 1, nodeUsed: 2, nodeTotal: 2 });
  // The database CHECK (slots_used <= slots_total) is only a backstop: the dispatcher itself must never trip it.
  assert.deepEqual(f.errors, []);
  // freeing one slot lets the queued attempt start, still never more than two at once
  const running = attempts.find((a) => f.read(a).state === "running");
  await f.dispatcher.stopAttempt(running.projectId, running.id);
  await pumped();
  assert.equal(f.runtime.started.length, 3);
  assert.equal(f.dispatcher.status().nodeUsed, 2);
});
