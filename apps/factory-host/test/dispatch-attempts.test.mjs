import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  API_VERSION, ATTEMPT_TRANSITIONS, TASK_TRANSITIONS, TERMINAL_ATTEMPT_STATES, LIVE_ATTEMPT_STATES,
  attemptSchema, nodeSchema, taskSchema,
} from "@factory/contracts";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { EventHub } from "../dist/events/hub.js";
import { loadPack, findLeadSeat, getActiveEngagement, deterministicUuid } from "../dist/org/index.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { openStorage } from "../dist/storage/database.js";
import { tasksCreateHandler, getTask } from "../dist/work/service.js";
import {
  AttemptError, TaskMoveError, CAPACITY_ATTEMPT_STATES, PLACED_ATTEMPT_STATES, LOCAL_NODE_ID,
  createAttempt, getAttempt, listAttempts, liveAttemptOfTask, listLiveAttempts, nextEpoch, transitionAttempt,
  renewLease, appendAttemptEvent, listAttemptEvents, isStaleCallback, ensureLocalNode, nodeLoad, seatLoad,
  heartbeatNode, markNodeSlots, moveTask, applyAttemptOutcome, eventsForAttempt, eventsForTask, buildHandoff,
} from "../dist/dispatch/index.js";

const now = "2026-11-07T10:00:00.000Z";
const later = "2026-11-07T10:01:00.000Z";
const expiry = "2026-11-07T10:10:00.000Z";
const clock = () => new Date(now);
const pack = loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)));
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const command = (type, projectId, payload) => ({ apiVersion: API_VERSION, commandId: randomUUID(), type, projectId, payload });
const errorCode = (Type, code) => (error) => error instanceof Type && error.code === code;

function fixture(t) {
  const storage = openStorage(":memory:");
  storage.migrate({ migrationsDir, backupDir: null });
  t.after(() => storage.close());
  const raw = storage.raw;
  const hub = new EventHub(raw, { clock });
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
    "projects.create": createProjectsCreateHandler({ pack }), "tasks.create": tasksCreateHandler,
  } });
  const execute = (c) => {
    const result = pipeline.execute(c);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result;
  };
  const project = () => {
    const id = randomUUID();
    execute(command("projects.create", id, { name: "Dispatch project", workspace: { kind: "directory", root: `/workspace/${id}` } }));
    return id;
  };
  const projectId = project();
  const engagement = getActiveEngagement(raw, projectId);
  const seat = findLeadSeat(raw, engagement.teamId);
  ensureLocalNode(raw, { slots: 64, now });
  let code = 0;
  const task = ({ state = "active", projectId: scope = projectId, ...overrides } = {}) => {
    const id = randomUUID();
    execute(command("tasks.create", scope, { taskId: id, code: `DSP-${String(++code).padStart(3, "0")}`,
      title: "Dispatch task", goal: "Deliver work", brief: "Work brief", parentTaskId: null, engagementId: null,
      ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [], ...overrides }));
    if (state !== "draft") raw.prepare("UPDATE tasks SET state = ? WHERE project_id = ? AND id = ?").run(state, scope, id);
    return id;
  };
  const taskId = task();
  const create = (overrides = {}) => createAttempt(raw, { projectId, id: randomUUID(), taskId, seatId: seat.id,
    runtime: "fake", provider: "fake", model: "fake-model", effort: "medium", now, ...overrides });
  const seed = (state, overrides = {}) => {
    const attempt = create(overrides);
    const placed = PLACED_ATTEMPT_STATES.has(state);
    raw.prepare(`UPDATE attempts SET state = ?, outcome = ?, node_id = ?, lease_id = ?, lease_expires_at = ?, ended_at = ?
      WHERE project_id = ? AND id = ?`).run(state, state === "unknown" || state === "reconciling" ? "unknown" : "known",
      state === "queued" ? null : LOCAL_NODE_ID, placed ? randomUUID() : null, placed ? expiry : null,
      TERMINAL_ATTEMPT_STATES.has(state) ? now : null, attempt.projectId, attempt.id);
    return getAttempt(raw, attempt.projectId, attempt.id);
  };
  const event = (attempt, body, kind = "progress") => appendAttemptEvent(raw,
    { projectId: attempt.projectId, attemptId: attempt.id, kind, body, at: now });
  return { raw, pipeline, projectId, project, seat, taskId, task, create, seed, event };
}

// Exercise every pair, including self transitions and all terminal exits, against real SQLite CHECKs.
for (const [from, targets] of Object.entries(ATTEMPT_TRANSITIONS)) {
  for (const to of Object.keys(ATTEMPT_TRANSITIONS)) {
    test(`attempt ${from} -> ${to}: ${targets.includes(to) ? "allowed" : "refused"}`, (t) => {
      const f = fixture(t);
      const attempt = f.seed(from);
      const patch = { expectedState: from, expectedLeaseId: attempt.leaseId, now: later,
        ...(PLACED_ATTEMPT_STATES.has(to) ? { nodeId: LOCAL_NODE_ID, leaseId: attempt.leaseId ?? randomUUID(), leaseExpiresAt: expiry } : {}) };
      if (!targets.includes(to)) {
        assert.throws(() => transitionAttempt(f.raw, attempt, to, patch), errorCode(AttemptError, "transition-not-allowed"));
        assert.deepEqual(getAttempt(f.raw, f.projectId, attempt.id), attempt);
        return;
      }
      const moved = transitionAttempt(f.raw, attempt, to, patch);
      assert.equal(moved.state, to);
      assert.equal(moved.revision, 2);
      assert.equal(moved.epoch, 1);
      assert.equal(moved.endedAt, TERMINAL_ATTEMPT_STATES.has(to) ? later : null);
      if (PLACED_ATTEMPT_STATES.has(to)) {
        assert.equal(moved.nodeId, LOCAL_NODE_ID);
        assert.ok(moved.leaseId);
        assert.equal(moved.leaseExpiresAt, expiry);
      } else {
        assert.equal(moved.leaseId, null);
        assert.equal(moved.leaseExpiresAt, null);
      }
      if (to === "unknown") assert.equal(moved.outcome, "unknown");
      if (TERMINAL_ATTEMPT_STATES.has(to)) assert.equal(moved.outcome, "known");
    });
  }
}

test("createAttempt queues epoch 1, revision 1, attaches the seat and exposes contract-compatible fields", (t) => {
  const f = fixture(t);
  assert.equal(nextEpoch(f.raw, f.projectId, f.taskId), 1);
  const a = f.create();
  assert.equal(a.state, "queued");
  assert.equal(a.outcome, "known");
  assert.equal(a.epoch, 1);
  assert.equal(a.revision, 1);
  for (const field of ["nodeId", "leaseId", "leaseExpiresAt", "startedAt", "endedAt"]) assert.equal(a[field], null);
  assert.equal(a.seatId, f.seat.id);
  assert.equal(f.raw.prepare("SELECT seat_id FROM attempt_seats WHERE project_id = ? AND attempt_id = ?").get(f.projectId, a.id).seat_id, f.seat.id);
  // The public contract still uses run/assignment identity; the internal record deliberately uses task/attempt identity.
  const { projectId, epoch, seatId, leaseId, ...fields } = a;
  assert.ok(seatId);
  assert.equal(leaseId, null);
  assert.ok(attemptSchema.parse({ ...fields, identity: { projectId, epoch, runId: a.id, assignmentId: a.taskId, leaseId: randomUUID() } }));
});

for (const state of LIVE_ATTEMPT_STATES) test(`a ${state} attempt prevents a second live attempt`, (t) => {
  const f = fixture(t);
  const a = f.seed(state);
  assert.throws(() => f.create(), errorCode(AttemptError, "live-attempt-exists"));
  assert.equal(liveAttemptOfTask(f.raw, f.projectId, f.taskId).id, a.id);
  assert.equal(listAttempts(f.raw, f.projectId, f.taskId).length, 1);
  assert.equal(nextEpoch(f.raw, f.projectId, f.taskId), 2);
  // The unique index remains a backstop even if a caller bypasses this repository.
  assert.throws(() => f.raw.prepare(`INSERT INTO attempts (project_id, id, task_id, revision, epoch, state, outcome, runtime, provider, model, effort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.projectId, randomUUID(), f.taskId, 1, 2, "queued", "known", "fake", "fake", "fake", "low"), /UNIQUE/);
});

for (const state of TERMINAL_ATTEMPT_STATES) test(`a ${state} attempt allows epoch 2`, (t) => {
  const f = fixture(t);
  const first = f.seed(state);
  const second = f.create();
  assert.equal(second.epoch, 2);
  assert.deepEqual(listAttempts(f.raw, f.projectId, f.taskId).map((a) => a.id), [first.id, second.id]);
});

for (const state of Object.keys(TASK_TRANSITIONS).filter((s) => s !== "active")) test(`attempt creation rejects ${state} tasks`, (t) => {
  const f = fixture(t);
  assert.throws(() => f.create({ taskId: f.task({ state }) }), errorCode(AttemptError, "task-not-active"));
});

test("attempt creation rejects absent tasks, seats, other-team seats and tasks without engagements", (t) => {
  const f = fixture(t);
  assert.throws(() => f.create({ taskId: randomUUID() }), errorCode(AttemptError, "task-not-active"));
  assert.throws(() => f.create({ seatId: randomUUID() }), errorCode(AttemptError, "seat-not-in-team"));
  const teamId = randomUUID();
  const seatId = randomUUID();
  f.raw.prepare("INSERT INTO teams (id, revision, name, charter, lifecycle) VALUES (?, ?, ?, ?, ?)").run(teamId, 1, "Other team", "Other", "active");
  f.raw.prepare(`INSERT INTO seats (id, team_id, revision, name, role, profile_id, profile_revision, runtime, slots, node_policy, is_lead)
    SELECT ?, ?, revision, name, role, profile_id, profile_revision, runtime, slots, node_policy, is_lead FROM seats WHERE id = ?`)
    .run(seatId, teamId, f.seat.id);
  assert.throws(() => f.create({ seatId }), errorCode(AttemptError, "seat-not-in-team"));
  f.raw.prepare("UPDATE tasks SET engagement_id = NULL WHERE project_id = ? AND id = ?").run(f.projectId, f.taskId);
  assert.throws(() => f.create(), errorCode(AttemptError, "seat-not-in-team"));
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM attempts").get().n, 0);
});

test("attempt reads are project-scoped and live listing includes seat/node across projects", (t) => {
  const f = fixture(t);
  const first = f.seed("running");
  const otherProject = f.project();
  const otherTask = f.task({ projectId: otherProject });
  const second = f.create({ projectId: otherProject, taskId: otherTask });
  f.seed("failed", { taskId: f.task() });
  assert.equal(getAttempt(f.raw, otherProject, first.id), undefined);
  assert.deepEqual(listAttempts(f.raw, otherProject, f.taskId), []);
  assert.equal(liveAttemptOfTask(f.raw, otherProject, f.taskId), undefined);
  const live = listLiveAttempts(f.raw);
  assert.equal(live.length, 2);
  assert.deepEqual(new Set(live.map((a) => a.id)), new Set([first.id, second.id]));
  assert.equal(live.find((a) => a.id === first.id).nodeId, LOCAL_NODE_ID);
  assert.ok(live.every((a) => a.seatId === f.seat.id));
});

test("transition CAS rejects changed state and lease without changing the record", (t) => {
  const f = fixture(t);
  const a = f.seed("running");
  assert.throws(() => transitionAttempt(f.raw, a, "stopping", { expectedState: "preparing", now }), errorCode(AttemptError, "state-changed"));
  assert.throws(() => transitionAttempt(f.raw, a, "stopping", { expectedLeaseId: randomUUID(), now }), errorCode(AttemptError, "lease-changed"));
  assert.throws(() => transitionAttempt(f.raw, { projectId: f.projectId, id: randomUUID() }, "stopping", { now }), errorCode(AttemptError, "not-found"));
  assert.deepEqual(getAttempt(f.raw, f.projectId, a.id), a);
  const moved = transitionAttempt(f.raw, a, "stopping", { expectedState: "running", expectedLeaseId: a.leaseId, startedAt: now, now: later });
  assert.equal(moved.revision, 2);
  assert.equal(moved.startedAt, now);
  assert.equal(moved.leaseId, a.leaseId);
});

test("invalid placement and outcome patches produce domain errors and roll back", (t) => {
  const f = fixture(t);
  const a = f.create();
  assert.throws(() => transitionAttempt(f.raw, a, "leased", { now }), errorCode(AttemptError, "placement-required"));
  assert.throws(() => transitionAttempt(f.raw, a, "stopped", { outcome: "unknown", now }), errorCode(AttemptError, "invalid-outcome"));
  assert.deepEqual(getAttempt(f.raw, f.projectId, a.id), a);
  const stopping = f.seed("stopping", { taskId: f.task() });
  assert.throws(() => transitionAttempt(f.raw, stopping, "unknown", { outcome: "known", now }), errorCode(AttemptError, "invalid-outcome"));
});

test("nonterminal transitions clear premature endedAt; terminal transitions honor explicit endedAt", (t) => {
  const f = fixture(t);
  const a = f.seed("running");
  const stopping = transitionAttempt(f.raw, a, "stopping", { endedAt: now, now });
  assert.equal(stopping.endedAt, null);
  const stopped = transitionAttempt(f.raw, stopping, "stopped", { endedAt: later, now });
  assert.equal(stopped.endedAt, later);
  assert.equal(stopped.revision, 3);
});

for (const state of Object.keys(ATTEMPT_TRANSITIONS)) test(`renewLease rules in ${state}`, (t) => {
  const f = fixture(t);
  const a = f.seed(state);
  if (PLACED_ATTEMPT_STATES.has(state)) {
    const renewed = renewLease(f.raw, a, a.leaseId, "2026-11-07T10:20:00.000Z", later);
    assert.equal(renewed.leaseExpiresAt, "2026-11-07T10:20:00.000Z");
    assert.equal(renewed.revision, 2);
    assert.equal(renewed.state, state);
  } else {
    assert.throws(() => renewLease(f.raw, a, a.leaseId ?? randomUUID(), expiry, now), errorCode(AttemptError, "transition-not-allowed"));
    assert.deepEqual(getAttempt(f.raw, f.projectId, a.id), a);
  }
});

test("lease renewal rejects stale identities, expired leases and non-increasing expiry", (t) => {
  const f = fixture(t);
  const a = f.seed("running");
  assert.throws(() => renewLease(f.raw, a, randomUUID(), expiry, now), errorCode(AttemptError, "lease-changed"));
  for (const at of [expiry, "2026-11-07T11:00:00.000Z", "invalid"])
    assert.throws(() => renewLease(f.raw, a, a.leaseId, "2026-11-07T12:00:00.000Z", at), errorCode(AttemptError, "lease-expired"));
  for (const end of [expiry, now, "invalid"])
    assert.throws(() => renewLease(f.raw, a, a.leaseId, end, now), errorCode(AttemptError, "invalid-lease-expiry"));
  assert.deepEqual(getAttempt(f.raw, f.projectId, a.id), a);
});

for (const state of Object.keys(ATTEMPT_TRANSITIONS)) test(`callback placement guard in ${state}`, (t) => {
  const f = fixture(t);
  const a = f.seed(state);
  const ref = { projectId: a.projectId, attemptId: a.id, epoch: a.epoch, leaseId: a.leaseId ?? randomUUID() };
  assert.equal(isStaleCallback(a, ref, Date.parse(now)), !PLACED_ATTEMPT_STATES.has(state));
});

test("callback fencing checks project, attempt, epoch, lease, expiry boundary and invalid times", (t) => {
  const f = fixture(t);
  const a = f.seed("running");
  const ref = { projectId: a.projectId, attemptId: a.id, epoch: a.epoch, leaseId: a.leaseId };
  for (const patch of [{ projectId: randomUUID() }, { attemptId: randomUUID() }, { epoch: 2 }, { leaseId: randomUUID() }])
    assert.equal(isStaleCallback(a, { ...ref, ...patch }, Date.parse(now)), true);
  for (const at of [Date.parse(expiry), Date.parse(expiry) + 1, NaN, Infinity]) assert.equal(isStaleCallback(a, ref, at), true);
  assert.equal(isStaleCallback(a, ref, Date.parse(expiry) - 1), false);
  assert.equal(isStaleCallback({ ...a, leaseExpiresAt: "invalid" }, ref, Date.parse(now)), true);
});

test("event sequence is continuous, independent per attempt and paging is project-scoped", (t) => {
  const f = fixture(t);
  const a = f.create();
  const b = f.create({ taskId: f.task() });
  for (let i = 1; i <= 5; i++) assert.equal(f.event(a, { message: `Step ${i}` }), i);
  assert.equal(f.event(b, { text: "Output" }, "output"), 1);
  const page = listAttemptEvents(f.raw, f.projectId, a.id, { afterSeq: 1, limit: 2 });
  assert.deepEqual(page.map((event) => event.seq), [2, 3]);
  assert.deepEqual(page[0], { projectId: f.projectId, attemptId: a.id, seq: 2, kind: "progress", at: now, body: { message: "Step 2" } });
  assert.deepEqual(listAttemptEvents(f.raw, randomUUID(), a.id), []);
  assert.deepEqual(listAttemptEvents(f.raw, f.projectId, a.id, { afterSeq: 5 }), []);
  assert.equal(listAttemptEvents(f.raw, f.projectId, a.id, { limit: 0 }).length, 1);
  assert.equal(listAttemptEvents(f.raw, f.projectId, a.id, { limit: NaN }).length, 5);
});

for (const text of ["x".repeat(100000), "🧪".repeat(30000), '\\"\n'.repeat(40000)]) test(`event truncation handles ${text.codePointAt(0)} safely within 64 KiB`, (t) => {
  const f = fixture(t);
  const a = f.create();
  f.event(a, { message: text, nested: { long: text } });
  const json = f.raw.prepare("SELECT body_json FROM attempt_events WHERE project_id = ? AND attempt_id = ?").get(f.projectId, a.id).body_json;
  assert.ok(Buffer.byteLength(json) <= 64 * 1024);
  assert.ok(Buffer.byteLength(json) > 64 * 1024 - 20);
  const body = listAttemptEvents(f.raw, f.projectId, a.id)[0].body;
  assert.equal(body.truncated, true);
  assert.ok(text.startsWith(body.message));
  assert.ok(json.endsWith('"truncated":true}'));
});

test("event bodies at the byte boundary are kept exactly and failed event writes do not leave gaps", (t) => {
  const f = fixture(t);
  const a = f.create();
  const body = { message: "x".repeat(65536 - Buffer.byteLength(JSON.stringify({ message: "" }))) };
  assert.equal(Buffer.byteLength(JSON.stringify(body)), 65536);
  f.event(a, body);
  assert.deepEqual(listAttemptEvents(f.raw, f.projectId, a.id)[0].body, body);
  assert.throws(() => f.event(a, undefined), errorCode(AttemptError, "invalid-event-body"));
  assert.throws(() => f.event(a, {}, "bad-kind"), /CHECK/);
  assert.equal(f.event(a, { summary: "next" }), 2);
});

for (const state of Object.keys(ATTEMPT_TRANSITIONS)) test(`node and seat capacity counting in ${state}`, (t) => {
  const f = fixture(t);
  f.seed(state);
  const used = CAPACITY_ATTEMPT_STATES.has(state) ? 1 : 0;
  assert.deepEqual(nodeLoad(f.raw, LOCAL_NODE_ID), { total: 64, used });
  assert.deepEqual(seatLoad(f.raw, f.seat.id), { slots: f.seat.slots, used });
  markNodeSlots(f.raw, LOCAL_NODE_ID);
  assert.equal(f.raw.prepare("SELECT slots_used FROM nodes WHERE id = ?").get(LOCAL_NODE_ID).slots_used, used);
});

test("ensureLocalNode is idempotent, updates slots/state/heartbeat and validates its result", (t) => {
  const f = fixture(t);
  assert.equal(LOCAL_NODE_ID, deterministicUuid("node:local"));
  f.raw.prepare("UPDATE nodes SET state = ? WHERE id = ?").run("offline", LOCAL_NODE_ID);
  const node = ensureLocalNode(f.raw, { slots: 3, now: later });
  assert.deepEqual(nodeSchema.parse(node), node);
  assert.equal(node.id, LOCAL_NODE_ID);
  assert.equal(node.name, "local");
  assert.equal(node.trust, "server-sandboxed");
  assert.equal(node.platform, process.platform === "win32" ? "windows" : "linux");
  assert.equal(node.state, "online");
  assert.equal(node.lastHeartbeatAt, later);
  assert.deepEqual(node.slots, { total: 3, used: 0 });
  assert.deepEqual(node.capabilities, []);
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM nodes").get().n, 1);
  heartbeatNode(f.raw, LOCAL_NODE_ID, expiry);
  assert.equal(f.raw.prepare("SELECT last_heartbeat_at FROM nodes WHERE id = ?").get(LOCAL_NODE_ID).last_heartbeat_at, expiry);
  assert.deepEqual(nodeLoad(f.raw, randomUUID()), { total: 0, used: 0 });
  assert.deepEqual(seatLoad(f.raw, randomUUID()), { slots: 0, used: 0 });
});

test("invalid local node slot changes roll back and capacity is preserved", (t) => {
  const f = fixture(t);
  f.seed("unknown");
  markNodeSlots(f.raw, LOCAL_NODE_ID);
  for (const slots of [0, 65, 1.5]) assert.throws(() => ensureLocalNode(f.raw, { slots, now }));
  const node = ensureLocalNode(f.raw, { slots: 2, now });
  assert.deepEqual(node.slots, { total: 2, used: 1 });
});

for (const [from, targets] of Object.entries(TASK_TRANSITIONS)) {
  for (const to of Object.keys(TASK_TRANSITIONS)) test(`task ${from} -> ${to}: ${targets.includes(to) ? "allowed" : "refused"}`, (t) => {
    const f = fixture(t);
    const id = f.task({ state: from });
    if (!targets.includes(to)) {
      assert.throws(() => moveTask(f.raw, f.projectId, id, to, { now }), errorCode(TaskMoveError, "transition-not-allowed"));
      assert.equal(getTask(f.raw, f.projectId, id).state, from);
    } else {
      const task = moveTask(f.raw, f.projectId, id, to, { expectedRevision: 1, expectedState: from, now });
      assert.equal(task.state, to);
      assert.equal(task.revision, 2);
      assert.deepEqual(taskSchema.parse(task), task);
    }
  });
}

test("task CAS checks revision and state and rejects cross-project access", (t) => {
  const f = fixture(t);
  for (const options of [{ expectedRevision: 0 }, { expectedState: "draft" }, { expectedRevision: 1, expectedState: "ready" }])
    assert.throws(() => moveTask(f.raw, f.projectId, f.taskId, "in-review", options), errorCode(TaskMoveError, "task-changed"));
  assert.throws(() => moveTask(f.raw, randomUUID(), f.taskId, "in-review"), errorCode(TaskMoveError, "not-found"));
  const task = moveTask(f.raw, f.projectId, f.taskId, "in-review", { expectedRevision: 1, expectedState: "active" });
  assert.equal(task.revision, 2);
  assert.throws(() => moveTask(f.raw, f.projectId, f.taskId, "done", { expectedRevision: 1 }), errorCode(TaskMoveError, "task-changed"));
});

test("task schema validation happens before writes when a gate or hold prevents a valid target", (t) => {
  const f = fixture(t);
  const ready = f.task({ state: "ready", requiresGo: false });
  assert.throws(() => moveTask(f.raw, f.projectId, ready, "awaiting-go"));
  assert.equal(getTask(f.raw, f.projectId, ready).state, "ready");
  assert.equal(getTask(f.raw, f.projectId, ready).revision, 1);
  const review = f.task({ state: "in-review" });
  f.raw.prepare("INSERT INTO task_holds (project_id, task_id, kind, reason, since, needs_action) VALUES (?, ?, ?, ?, ?, ?)")
    .run(f.projectId, review, "input", "Needs input", now, 1);
  assert.throws(() => moveTask(f.raw, f.projectId, review, "done"));
  assert.equal(getTask(f.raw, f.projectId, review).state, "in-review");
});

for (const outcome of ["succeeded", "failed", "stopped"]) test(`outcome ${outcome} applies only to active tasks`, (t) => {
  const f = fixture(t);
  const task = applyAttemptOutcome(f.raw, f.projectId, f.taskId, outcome, now);
  assert.equal(task.state, outcome === "succeeded" ? "in-review" : "failed");
  assert.equal(task.revision, 2);
  for (const state of Object.keys(TASK_TRANSITIONS).filter((s) => s !== "active")) {
    const id = f.task({ state });
    assert.equal(applyAttemptOutcome(f.raw, f.projectId, id, outcome, now), null);
    assert.equal(getTask(f.raw, f.projectId, id).revision, 1);
  }
  assert.equal(applyAttemptOutcome(f.raw, randomUUID(), f.taskId, outcome, now), null);
});

test("automatic review still goes to in-review and entity payloads carry current revisions", (t) => {
  const f = fixture(t);
  const id = f.task({ reviewPolicy: "automatic" });
  const task = applyAttemptOutcome(f.raw, f.projectId, id, "succeeded", now);
  assert.equal(task.state, "in-review");
  assert.deepEqual(eventsForTask(task), { type: "entity.changed", entity: { kind: "task", id, revision: 2 } });
  const a = f.create();
  assert.deepEqual(eventsForAttempt(a), { type: "entity.changed", entity: { kind: "attempt", id: a.id, revision: 1 } });
});

test("handoff is null before earlier work, including after first queued attempt creation", (t) => {
  const f = fixture(t);
  assert.equal(buildHandoff(f.raw, f.projectId, f.taskId), null);
  f.create();
  assert.equal(buildHandoff(f.raw, f.projectId, f.taskId), null);
});

test("handoff includes epochs, states, seat names and last ten work events from only the latest earlier attempt", (t) => {
  const f = fixture(t);
  const a = f.seed("failed");
  f.event(a, { message: "OLD WORK" });
  const b = f.seed("stopped");
  for (let i = 0; i < 12; i++) f.event(b, { message: `Recent step ${i}` });
  f.event(b, { summary: "QUESTION SECRET" }, "question");
  f.event(b, { text: "Latest output" }, "output");
  f.event(b, { name: "check", detail: "Evidence passed" }, "evidence");
  f.create();
  const text = buildHandoff(f.raw, f.projectId, f.taskId);
  assert.match(text, /Epoch 1: failed/);
  assert.match(text, /Epoch 2: stopped/);
  assert.ok(text.includes(f.seat.name));
  assert.ok(!text.includes("Epoch 3"));
  assert.ok(!text.includes("OLD WORK"));
  assert.ok(!text.includes("Recent step 3\n"));
  assert.ok(text.includes("Recent step 4\n"));
  assert.ok(text.includes("Latest output"));
  assert.ok(text.includes("Evidence passed"));
  assert.ok(!text.includes("QUESTION SECRET"));
  assert.ok(text.endsWith("Do not repeat work that is already done; check the workspace first."));
});

test("handoff caps total and per-event text and excludes project/lease identities and JSON", (t) => {
  const f = fixture(t);
  const a = f.seed("stopped");
  const otherProject = f.project();
  const lease = randomUUID();
  f.event(a, { message: `Saved work ${lease} ${otherProject} {"secret":"hidden"}` });
  for (let i = 0; i < 9; i++) f.event(a, { message: String(i).repeat(1000) });
  const text = buildHandoff(f.raw, f.projectId, f.taskId);
  assert.ok(text.length <= 4000);
  assert.ok(!text.includes(lease));
  assert.ok(!text.includes(otherProject));
  assert.ok(!text.includes("secret"));
  assert.ok(!text.includes("0".repeat(301)));
  assert.equal(buildHandoff(f.raw, otherProject, f.taskId), null);
});

test("handoff remains bounded across many earlier attempts and always retains the final instruction", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 90; i++) f.seed("stopped");
  const text = buildHandoff(f.raw, f.projectId, f.taskId);
  assert.ok(text.length <= 4000);
  assert.ok(text.endsWith("Do not repeat work that is already done; check the workspace first."));
});

test("outer transaction rollback removes attempts, ownership, events and task outcome together", (t) => {
  const f = fixture(t);
  assert.throws(() => f.raw.transaction(() => {
    const a = f.create();
    f.event(a, { message: "not committed" });
    applyAttemptOutcome(f.raw, f.projectId, f.taskId, "failed", now);
    throw new Error("rollback example");
  })(), /rollback example/);
  for (const table of ["attempts", "attempt_seats", "attempt_events"])
    assert.equal(f.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
  assert.equal(getTask(f.raw, f.projectId, f.taskId).state, "active");
  assert.equal(nextEpoch(f.raw, f.projectId, f.taskId), 1);
});
