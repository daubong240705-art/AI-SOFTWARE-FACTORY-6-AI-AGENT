import assert from "node:assert/strict";
import { createTokenRegistry } from "../dist/proxy/index.js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { API_VERSION, ATTEMPT_TRANSITIONS, TERMINAL_ATTEMPT_STATES, eventSchema } from "@factory/contracts";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { EventHub } from "../dist/events/hub.js";
import { loadPack, findLeadSeat, getActiveEngagement } from "../dist/org/index.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { openStorage } from "../dist/storage/database.js";
import { tasksCreateHandler, getTask } from "../dist/work/service.js";
import { createDispatcher, createFakeRuntime, RuntimeRegistry, AttemptError, createAttempt, getAttempt,
  listAttempts, listAttemptEvents, transitionAttempt, PLACED_ATTEMPT_STATES, LOCAL_NODE_ID, ensureLocalNode, moveTask } from "../dist/dispatch/index.js";

const pack = loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)));
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const now = "2026-11-07T10:00:00.000Z";
const clock = () => new Date(now);
const pumped = async () => { await new Promise(setImmediate); for (let i = 0; i < 20; i++) await Promise.resolve(); };
const code = (value) => (error) => error instanceof AttemptError && error.code === value;

function fixture(t) {
  const storage = openStorage(":memory:"); storage.migrate({ migrationsDir, backupDir: null });
  const raw = storage.raw; const hub = new EventHub(raw, { clock });
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
    "projects.create": createProjectsCreateHandler({ pack }), "tasks.create": tasksCreateHandler,
  } });
  const projectId = randomUUID();
  const execute = (type, payload) => {
    const result = pipeline.execute({ apiVersion: API_VERSION, commandId: randomUUID(), projectId, type, payload });
    assert.equal(result.status, 200, JSON.stringify(result.body));
  };
  execute("projects.create", { name: "Recovery project", workspace: { kind: "directory", root: `/workspace/${projectId}` } });
  const seat = findLeadSeat(raw, getActiveEngagement(raw, projectId).teamId);
  ensureLocalNode(raw, { slots: 2, now });
  let taskCode = 0;
  const task = (goal = "Deliver work", safe = false) => {
    const taskId = randomUUID();
    execute("tasks.create", { taskId, code: `REC-${String(++taskCode).padStart(3, "0")}`, title: "Recovery task", goal,
      brief: "Brief", parentTaskId: null, engagementId: null, ownerSeatId: null,
      requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] });
    for (const to of ["accepted", "ready", "active"]) moveTask(raw, projectId, taskId, to);
    if (safe) raw.prepare("UPDATE tasks SET placement = ?, side_effect = ? WHERE project_id = ? AND id = ?").run("repo-bound", "artifact", projectId, taskId);
    return taskId;
  };
  const seed = (state, safe = false, expired = false) => {
    const taskId = task("Deliver work", safe);
    let a = createAttempt(raw, { projectId, id: randomUUID(), taskId, seatId: seat.id,
      runtime: "fake", provider: "fake", model: "fake", effort: "medium", now });
    const paths = {
      queued: [], leased: ["leased"], preparing: ["leased", "preparing"], running: ["leased", "preparing", "running"],
      "waiting-input": ["leased", "preparing", "running", "waiting-input"],
      stopping: ["leased", "preparing", "running", "stopping"],
      submitting: ["leased", "preparing", "running", "submitting"],
      "lease-expired": ["leased", "lease-expired"], unknown: ["leased", "lease-expired", "unknown"],
      reconciling: ["leased", "lease-expired", "unknown", "reconciling"],
      succeeded: ["leased", "preparing", "running", "submitting", "succeeded"],
      failed: ["leased", "preparing", "failed"], stopped: ["stopped"],
      parked: ["leased", "preparing", "running", "waiting-input", "parked"],
      requeued: ["leased", "lease-expired", "requeued"],
    };
    for (const to of paths[state]) a = transitionAttempt(raw, a, to, { now,
      ...(PLACED_ATTEMPT_STATES.has(to) ? { nodeId: LOCAL_NODE_ID, leaseId: a.leaseId ?? randomUUID(),
        leaseExpiresAt: expired ? now : "2026-11-07T11:00:00.000Z" } : {}) });
    return a;
  };
  const dispatchers = [];
  const create = (modelAccess) => {
    const runtime = createFakeRuntime({ stepMs: 0 });
    const dispatcher = createDispatcher({ storage, hub, registry: new RuntimeRegistry([runtime]), clock,
      ...(modelAccess === undefined ? {} : { modelAccess }) });
    dispatchers.push(dispatcher);
    return { dispatcher, runtime };
  };
  t.after(async () => { for (const d of dispatchers) await d.stop(); storage.close(); });
  const read = (a) => getAttempt(raw, a.projectId, a.id);
  return { storage, raw, hub, projectId, seat, task, seed, create, read };
}

test("boot recovery revokes every surviving attempt credential before allowing more work", async (t) => {
  const f = fixture(t); const a = f.seed("running"); const tokens = createTokenRegistry({ clock }); t.after(() => tokens.revokeAll());
  const { token } = tokens.issue({ attemptId: a.id, projectId: a.projectId, taskId: a.taskId, epoch: a.epoch, allowedModels: ["approved"] });
  const { dispatcher, runtime } = f.create({ issue() { throw new Error("Unexpected issue"); }, revoke: (id) => tokens.revoke(id) });
  dispatcher.start(); assert.equal(tokens.resolve(token), null); assert.equal(runtime.started.length, 0); assert.equal(f.read(a).state, "unknown");
  assert.equal(f.raw.serialize().includes(Buffer.from(token)), false);
});

for (const state of [...PLACED_ATTEMPT_STATES, "lease-expired"]) {
  for (const safe of [false, true]) test(`recovery of ${state} ${safe ? "safe" : "default"} work never starts a runtime`, async (t) => {
    // A stop in progress is never turned into a restart: after a crash it stays 'unknown' for the operator.
    const requeue = safe && state !== "stopping";
    const f = fixture(t); const a = f.seed(state, safe);
    const { dispatcher, runtime } = f.create();
    const cursor = f.hub.currentCursor(f.projectId);
    const summary = dispatcher.start();
    assert.deepEqual(summary, { leaseExpired: state === "lease-expired" ? 0 : 1,
      unknown: requeue ? 0 : 1, requeued: requeue ? 1 : 0, untouched: 0 });
    assert.equal(f.read(a).state, requeue ? "requeued" : "unknown");
    assert.equal(f.read(a).leaseId, null);
    assert.equal(f.read(a).leaseExpiresAt, null);
    assert.equal(getTask(f.raw, a.projectId, a.taskId).state, "active");
    const attempts = listAttempts(f.raw, a.projectId, a.taskId);
    assert.equal(attempts.length, requeue ? 2 : 1);
    if (requeue) { assert.equal(attempts[1].state, "queued"); assert.equal(attempts[1].epoch, 2); }
    const events = f.hub.readAfter(f.projectId, cursor).events;
    assert.ok(events.length >= 1);
    assert.ok(events.every((e) => eventSchema.safeParse(e).success));
    assert.equal(listAttemptEvents(f.raw, f.projectId, a.id).at(-1).body.to, requeue ? "requeued" : "unknown");
    const before = f.raw.serialize();
    const again = dispatcher.recover();
    assert.deepEqual(again, { leaseExpired: 0, unknown: 0, requeued: 0, untouched: 1 });
    assert.deepEqual(f.raw.serialize(), before);
    await pumped();
    assert.equal(runtime.started.length, 0);
  });
}

for (const state of ["queued", "unknown", "reconciling", ...TERMINAL_ATTEMPT_STATES]) test(`recovery leaves ${state} unchanged`, async (t) => {
  const f = fixture(t); const a = f.seed(state); const { dispatcher, runtime } = f.create();
  const cursor = f.hub.currentCursor(f.projectId);
  const result = dispatcher.recover();
  assert.deepEqual(result, { leaseExpired: 0, unknown: 0, requeued: 0, untouched: TERMINAL_ATTEMPT_STATES.has(state) ? 0 : 1 });
  assert.deepEqual(f.read(a), a);
  assert.equal(f.hub.readAfter(f.projectId, cursor).events.length, 0);
  await pumped(); assert.equal(runtime.started.length, 0);
});

for (const state of Object.keys(ATTEMPT_TRANSITIONS).filter((s) => s !== "unknown")) test(`reconcile refuses ${state}`, (t) => {
  const f = fixture(t); const a = f.seed(state); const { dispatcher } = f.create();
  assert.throws(() => dispatcher.reconcileAttempt(a.projectId, a.id), code("transition-not-allowed"));
  assert.deepEqual(f.read(a), a);
});

for (const state of ["succeeded", "failed", "stopped", "parked", "requeued", "unknown", "reconciling", "lease-expired", "submitting"]) {
  test(`stop refuses ${state}`, async (t) => {
    const f = fixture(t); const a = f.seed(state); const { dispatcher } = f.create();
    await assert.rejects(dispatcher.stopAttempt(a.projectId, a.id), code("transition-not-allowed"));
    assert.deepEqual(f.read(a), a);
  });
}

test("crash story: shutdown preserves running, restart fences to unknown, reconciliation permits epoch two with handoff", async (t) => {
  const f = fixture(t); const first = f.create(); first.dispatcher.start();
  const taskId = f.task("[fake:hang]");
  const a = first.dispatcher.enqueue({ projectId: f.projectId, taskId, seatId: f.seat.id });
  await pumped();
  assert.equal(f.read(a).state, "running");
  const before = f.raw.serialize(); await first.dispatcher.stop();
  assert.deepEqual(f.raw.serialize(), before);
  assert.equal(first.runtime.stopped[0].attemptId, a.id);
  const second = f.create();
  assert.deepEqual(second.dispatcher.start(), { leaseExpired: 1, unknown: 1, requeued: 0, untouched: 0 });
  assert.equal(f.read(a).state, "unknown");
  assert.equal(getTask(f.raw, f.projectId, taskId).state, "active");
  assert.equal(second.runtime.started.length, 0);
  const result = second.dispatcher.reconcileAttempt(f.projectId, a.id);
  assert.equal(result.state, "failed"); assert.equal(result.outcome, "known");
  assert.equal(getTask(f.raw, f.projectId, taskId).state, "failed");
  assert.deepEqual(listAttemptEvents(f.raw, f.projectId, a.id).at(-1).body,
    { to: "failed", reason: "reconciled by operator: outcome was unknown" });
  moveTask(f.raw, f.projectId, taskId, "active");
  const b = second.dispatcher.enqueue({ projectId: f.projectId, taskId, seatId: f.seat.id });
  await pumped();
  assert.equal(b.epoch, 2);
  assert.match(second.runtime.started[0].handoff, /Epoch 1: failed/);
  assert.equal(second.runtime.started[0].ref.epoch, 2);
});

test("start initializes node capacity, is idempotent and leaves queued work for explicit kick", async (t) => {
  const f = fixture(t); const a = f.seed("queued"); const { dispatcher, runtime } = f.create();
  assert.deepEqual(dispatcher.start(), { leaseExpired: 0, unknown: 0, requeued: 0, untouched: 1 });
  dispatcher.start(); await pumped();
  assert.equal(runtime.started.length, 0);
  assert.equal(dispatcher.status().nodeTotal, 2);
  dispatcher.kick(); await dispatcher.idle();
  assert.equal(f.read(a).state, "succeeded");
  assert.equal(runtime.started.length, 1);
});

test("recovery ignores lease freshness because a session cannot survive a process restart", (t) => {
  const f = fixture(t); const future = f.seed("running", false, false); const expired = f.seed("running", false, true);
  const { dispatcher } = f.create();
  assert.equal(dispatcher.start().unknown, 2);
  assert.equal(f.read(future).state, "unknown"); assert.equal(f.read(expired).state, "unknown");
});

test("reconciliation keeps a task cancelled by the operator unchanged", (t) => {
  const f = fixture(t); const a = f.seed("unknown"); const { dispatcher } = f.create();
  moveTask(f.raw, a.projectId, a.taskId, "cancelled");
  assert.equal(dispatcher.reconcileAttempt(a.projectId, a.id).state, "failed");
  assert.equal(getTask(f.raw, a.projectId, a.taskId).state, "cancelled");
});

test("recovery of safe work on a cancelled task retains uncertainty without replay", (t) => {
  const f = fixture(t); const a = f.seed("running", true); const { dispatcher } = f.create();
  moveTask(f.raw, a.projectId, a.taskId, "cancelled");
  assert.equal(dispatcher.start().unknown, 1);
  assert.equal(listAttempts(f.raw, a.projectId, a.taskId).length, 1);
});

test("unknown work blocks capacity and a second enqueue until operator reconciliation", (t) => {
  const f = fixture(t); const a = f.seed("unknown"); const { dispatcher } = f.create(); dispatcher.start();
  assert.equal(dispatcher.status().nodeUsed, 1);
  assert.throws(() => dispatcher.enqueue({ projectId: a.projectId, taskId: a.taskId, seatId: f.seat.id }), code("live-attempt-exists"));
  dispatcher.reconcileAttempt(a.projectId, a.id);
  assert.equal(dispatcher.status().nodeUsed, 0);
});

test("attempt operations are project scoped", async (t) => {
  const f = fixture(t); const a = f.seed("unknown"); const { dispatcher } = f.create();
  assert.throws(() => dispatcher.reconcileAttempt(randomUUID(), a.id), code("not-found"));
  await assert.rejects(dispatcher.stopAttempt(randomUUID(), a.id), code("not-found"));
  assert.deepEqual(f.read(a), a);
});
