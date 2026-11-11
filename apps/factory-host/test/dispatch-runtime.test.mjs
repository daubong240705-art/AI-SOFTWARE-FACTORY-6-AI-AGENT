import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { API_VERSION } from "@factory/contracts";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { EventHub } from "../dist/events/hub.js";
import { loadPack, getActiveEngagement, findLeadSeat } from "../dist/org/index.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { openStorage } from "../dist/storage/database.js";
import { getTask, tasksCreateHandler } from "../dist/work/service.js";
import { createFakeRuntime, RuntimeRegistry, moveTask } from "../dist/dispatch/index.js";

const now = "2026-11-07T10:00:00.000Z";
const clock = () => new Date(now);
const pack = loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)));
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

function context(t, goal = "Deliver work") {
  const storage = openStorage(":memory:");
  storage.migrate({ migrationsDir, backupDir: null });
  t.after(() => storage.close());
  const raw = storage.raw;
  const hub = new EventHub(raw, { clock });
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
    "projects.create": createProjectsCreateHandler({ pack }), "tasks.create": tasksCreateHandler,
  } });
  const projectId = randomUUID();
  const execute = (type, payload) => {
    const result = pipeline.execute({ apiVersion: API_VERSION, commandId: randomUUID(), projectId, type, payload });
    assert.equal(result.status, 200, JSON.stringify(result.body));
  };
  execute("projects.create", { name: "Runtime project", workspace: { kind: "directory", root: `/workspace/${projectId}` } });
  const id = randomUUID();
  execute("tasks.create", { taskId: id, code: "RUN-001", title: "Run task", goal, brief: "Work brief",
    parentTaskId: null, engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] });
  for (const state of ["accepted", "ready", "active"]) moveTask(raw, projectId, id, state, { now });
  const seat = findLeadSeat(raw, getActiveEngagement(raw, projectId).teamId);
  const controller = new AbortController();
  return { controller, value: { ref: { projectId, attemptId: randomUUID(), epoch: 1, leaseId: randomUUID() },
    task: getTask(raw, projectId, id), seat: { id: seat.id, name: seat.name, role: seat.role },
    handoff: null, signal: controller.signal } };
}

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fakeTimers() {
  let time = 0;
  let id = 0;
  const pending = new Map();
  const delays = [];
  return {
    delays,
    get pending() { return pending.size; },
    setTimeout(callback, ms) { delays.push(ms); const handle = ++id; pending.set(handle, { at: time + ms, callback }); return handle; },
    clearTimeout(handle) { pending.delete(handle); },
    async advance(ms) {
      await flush();
      const until = time + ms;
      while (true) {
        const next = [...pending].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next || next[1].at > until) break;
        time = next[1].at;
        pending.delete(next[0]);
        next[1].callback();
        await flush();
      }
      time = until;
      await flush();
    },
  };
}
const collect = async (session) => { const events = []; for await (const event of session.events()) events.push(event); return events; };

test("fake default script emits progress, evidence and completion in order and records the exact context", async (t) => {
  const ctx = context(t);
  const runtime = createFakeRuntime();
  const session = await runtime.start(ctx.value);
  assert.equal(runtime.kind, "fake");
  assert.deepEqual(await collect(session), [
    { type: "progress", message: "Starting" },
    { type: "progress", message: "Working", percent: 50 },
    { type: "evidence", name: "fake-check", detail: "passed" },
    { type: "completed", summary: "Fake work done for RUN-001" },
  ]);
  assert.equal(runtime.started.length, 1);
  assert.equal(runtime.started[0], ctx.value);
  assert.deepEqual(runtime.stopped, []);
});

test("fake failure marker emits Starting then runtime failure without completion", async (t) => {
  const ctx = context(t, "Try [fake:fail]");
  const timers = fakeTimers();
  const runtime = createFakeRuntime({ stepMs: 7, timers });
  const session = await runtime.start(ctx.value);
  const all = collect(session);
  await timers.advance(7);
  assert.deepEqual(await all, [
    { type: "progress", message: "Starting" }, { type: "failed", kind: "runtime", message: "Fake failure" },
  ]);
  assert.deepEqual(timers.delays, [7]);
  assert.equal(timers.pending, 0);
});

for (const [marker, multiplier] of [["", 1], ["[fake:slow]", 10]]) test(`injected timers honor stepMs ${marker || "default script"}`, async (t) => {
  const ctx = context(t, `Deliver ${marker}`);
  const timers = fakeTimers();
  const runtime = createFakeRuntime({ stepMs: 11, timers });
  const session = await runtime.start(ctx.value);
  const iterator = session.events()[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.message, "Starting");
  let second;
  const waiting = iterator.next().then((result) => { second = result; });
  await timers.advance(11 * multiplier - 1);
  assert.equal(second, undefined);
  await timers.advance(1);
  await waiting;
  assert.deepEqual(second, { done: false, value: { type: "progress", message: "Working", percent: 50 } });
  await timers.advance(22 * multiplier);
  assert.equal((await iterator.next()).value.type, "evidence");
  assert.equal((await iterator.next()).value.type, "completed");
  assert.equal((await iterator.next()).done, true);
  assert.deepEqual(timers.delays, [11 * multiplier, 11 * multiplier, 11 * multiplier]);
  assert.equal(timers.pending, 0);
});

test("default stepMs is 5 through injected timers", async (t) => {
  const timers = fakeTimers();
  const runtime = createFakeRuntime({ timers });
  const session = await runtime.start(context(t).value);
  const all = collect(session);
  await timers.advance(15);
  assert.equal((await all).length, 4);
  assert.deepEqual(timers.delays, [5, 5, 5]);
});

test("hang marker never finishes until stopped and stop ends pending reads before resolving", async (t) => {
  const ctx = context(t, "[fake:hang]");
  const timers = fakeTimers();
  const runtime = createFakeRuntime({ timers });
  const session = await runtime.start(ctx.value);
  const iterator = session.events()[Symbol.asyncIterator]();
  assert.deepEqual((await iterator.next()).value, { type: "progress", message: "Starting" });
  let ended = false;
  const reading = iterator.next().then((result) => { assert.equal(result.done, true); ended = true; });
  await timers.advance(100000);
  assert.equal(ended, false);
  const stopping = session.stop();
  assert.equal(session.stop(), stopping);
  await stopping.then(() => { assert.equal(ended, true); });
  await reading;
  assert.equal((await iterator.next()).done, true);
  assert.deepEqual(runtime.stopped, [ctx.value.ref]);
  assert.equal(timers.pending, 0);
});

test("silent marker emits nothing and stop closes all pending reads", async (t) => {
  const ctx = context(t, "[fake:silent]");
  const runtime = createFakeRuntime();
  const session = await runtime.start(ctx.value);
  const iterator = session.events()[Symbol.asyncIterator]();
  let received = 0;
  const reads = [iterator.next(), iterator.next()].map((promise) => promise.then((result) => { received++; assert.equal(result.done, true); }));
  await flush();
  assert.equal(received, 0);
  await session.stop();
  await Promise.all(reads);
  assert.equal(received, 2);
  assert.deepEqual(runtime.stopped, [ctx.value.ref]);
});

for (const marker of ["", "[fake:slow]", "[fake:hang]", "[fake:silent]", "[fake:fail]"]) test(`abort immediately ends ${marker || "default"} execution`, async (t) => {
  const ctx = context(t, `Run ${marker}`);
  const timers = fakeTimers();
  const runtime = createFakeRuntime({ timers, stepMs: 10000 });
  const session = await runtime.start(ctx.value);
  const iterator = session.events()[Symbol.asyncIterator]();
  if (marker !== "[fake:silent]") assert.equal((await iterator.next()).value.type, "progress");
  const next = iterator.next();
  ctx.controller.abort();
  assert.equal((await next).done, true);
  await session.stop();
  assert.equal(timers.pending, 0);
  await timers.advance(1000000);
  assert.equal((await iterator.next()).done, true);
  assert.deepEqual(runtime.stopped, [ctx.value.ref]);
});

test("an already aborted context produces no events and no scheduled timer", async (t) => {
  const ctx = context(t);
  ctx.controller.abort();
  const timers = fakeTimers();
  const runtime = createFakeRuntime({ timers });
  const session = await runtime.start(ctx.value);
  assert.deepEqual(await collect(session), []);
  await session.stop();
  assert.equal(timers.pending, 0);
  assert.deepEqual(runtime.stopped, [ctx.value.ref]);
});

test("crash marker rejects start with Error and still records the context", async (t) => {
  const ctx = context(t, "[fake:crash]");
  const runtime = createFakeRuntime();
  await assert.rejects(runtime.start(ctx.value), { name: "Error", message: "Fake crash" });
  assert.equal(runtime.started[0], ctx.value);
  assert.deepEqual(runtime.stopped, []);
});

test("stop before reading discards buffered events, cancels timers and is idempotent", async (t) => {
  const ctx = context(t);
  const timers = fakeTimers();
  const runtime = createFakeRuntime({ timers });
  const session = await runtime.start(ctx.value);
  const first = session.stop();
  assert.equal(first, session.stop());
  await first;
  assert.deepEqual(await collect(session), []);
  await session.stop();
  assert.equal(timers.pending, 0);
  assert.equal(runtime.stopped.length, 1);
});

test("stop during normal execution closes the iterator before resolving and prevents later events", async (t) => {
  const ctx = context(t);
  const timers = fakeTimers();
  const runtime = createFakeRuntime({ timers });
  const session = await runtime.start(ctx.value);
  const iterator = session.events()[Symbol.asyncIterator]();
  await iterator.next();
  let closed = false;
  const pending = iterator.next().then((result) => { assert.equal(result.done, true); closed = true; });
  await session.stop();
  assert.equal(closed, true);
  await pending;
  assert.equal(timers.pending, 0);
  await timers.advance(100);
  assert.equal((await iterator.next()).done, true);
});

test("consumer return stops execution and natural completion accepts repeated stop", async (t) => {
  const runtime = createFakeRuntime({ stepMs: 0 });
  const ctx = context(t, "[fake:hang]");
  const session = await runtime.start(ctx.value);
  for await (const event of session.events()) { assert.equal(event.type, "progress"); break; }
  assert.deepEqual(runtime.stopped, [ctx.value.ref]);
  assert.deepEqual(await collect(session), []);
  const done = await runtime.start(context(t).value);
  assert.equal((await collect(done)).length, 4);
  const stop = done.stop();
  assert.equal(done.stop(), stop);
  await stop;
  assert.equal(runtime.stopped.length, 2);
});

test("sessions have independent cancellation, buffers and context records", async (t) => {
  const runtime = createFakeRuntime({ stepMs: 0 });
  const a = context(t, "[fake:hang]");
  const b = context(t);
  b.value.handoff = "Earlier work is ready.";
  const first = await runtime.start(a.value);
  const second = await runtime.start(b.value);
  await first.stop();
  assert.equal((await collect(second)).at(-1).type, "completed");
  assert.equal(runtime.started[0], a.value);
  assert.equal(runtime.started[1], b.value);
  assert.deepEqual(runtime.stopped, [a.value.ref]);
});

test("RuntimeRegistry selects adapters by kind and returns undefined for missing adapters", () => {
  const runtime = createFakeRuntime();
  const registry = new RuntimeRegistry([runtime]);
  assert.equal(registry.get("fake"), runtime);
  assert.equal(registry.get("native-opencode"), undefined);
  assert.equal(new RuntimeRegistry().get("fake"), undefined);
});

test("invalid fake timer intervals fail without starting execution", () => {
  for (const stepMs of [-1, Infinity, NaN]) assert.throws(() => createFakeRuntime({ stepMs }), /stepMs/);
});
