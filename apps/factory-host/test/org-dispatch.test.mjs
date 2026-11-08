import assert from "node:assert/strict";
import { test } from "node:test";
import { getPrimaryEngagement, listSeats } from "../dist/org/index.js";
import { CAPACITY_ATTEMPT_STATES, createDispatcher, createFakeRuntime, RuntimeRegistry, engagementLoad, getAttempt,
  listAttempts, transitionAttempt, LOCAL_NODE_ID } from "../dist/dispatch/index.js";
import { fixture, pumped } from "./org-fixture.mjs";

test("engagement limit keeps excess attempts queued exactly at the limit", async (t) => {
  const f = fixture(t); f.slots(8); f.updateEngagement(f.primary.id, { maxConcurrent: 2 });
  const attempts = [f.enqueue(), f.enqueue(), f.enqueue()]; await pumped();
  assert.deepEqual(attempts.map((a) => f.read(a).state), ["running", "running", "queued"]);
  assert.equal(engagementLoad(f.raw, f.projectId, f.primary.id), 2);
});
test("releasing an engagement slot starts the next queued attempt", async (t) => {
  const f = fixture(t); f.slots(8); f.updateEngagement(f.primary.id, { maxConcurrent: 1 });
  const first = f.enqueue(); const next = f.enqueue(); await pumped();
  await f.dispatcher.stopAttempt(first.projectId, first.id); await pumped();
  assert.equal(f.read(first).state, "stopped"); assert.equal(f.read(next).state, "running");
});
test("successful completion releases engagement capacity for queued work", async (t) => {
  const f = fixture(t); f.slots(8); f.updateEngagement(f.primary.id, { maxConcurrent: 1 });
  const first = f.enqueue(f.task({ goal: "Deliver" })); const next = f.enqueue();
  await pumped();
  for (let i = 0; i < 100 && f.read(first).state !== "succeeded"; i++) await new Promise((done) => setTimeout(done, 2));
  await pumped(); assert.equal(f.read(first).state, "succeeded"); assert.equal(f.read(next).state, "running");
});
test("two engagements sharing a Team share seat capacity across projects", async (t) => {
  const f = fixture(t); const second = f.project(); f.slots(1);
  const first = f.enqueue(); const next = f.enqueue(f.task({ scope: second }), second); await pumped();
  assert.equal(f.read(first).state, "running"); assert.equal(f.read(next).state, "queued");
  await f.dispatcher.stopAttempt(first.projectId, first.id); await pumped(); assert.equal(f.read(next).state, "running");
});
test("one project dispatches two Teams in parallel up to each engagement limit", async (t) => {
  const f = fixture(t); const other = f.secondTeam(); const engagement = f.engage(other, f.projectId, 90, 1);
  const otherSeat = listSeats(f.raw, other).find((s) => s.name === "BE"); f.slots(8); f.slots(8, otherSeat.id);
  f.updateEngagement(f.primary.id, { maxConcurrent: 1 });
  const first = f.enqueue(); const queued = f.enqueue();
  const parallel = f.enqueue(f.task({ engagementId: engagement }), f.projectId, otherSeat.id);
  const otherQueued = f.enqueue(f.task({ engagementId: engagement }), f.projectId, otherSeat.id); await pumped();
  assert.deepEqual([first, queued, parallel, otherQueued].map((a) => f.read(a).state), ["running", "queued", "running", "queued"]);
});
test("queue prioritizes higher engagement priority before earlier enqueue time", async (t) => {
  const f = fixture(t, { nodeSlots: 1 }); const second = f.project();
  f.updateEngagement(getPrimaryEngagement(f.raw, second).id, { priority: 100 }, second);
  const low = f.enqueue(); const high = f.enqueue(f.task({ scope: second }), second); await pumped();
  assert.equal(f.read(high).state, "running"); assert.equal(f.read(low).state, "queued");
});
test("equal priority preserves FIFO across engagements", async (t) => {
  const f = fixture(t, { nodeSlots: 1 }); const second = f.project();
  const first = f.enqueue(); const next = f.enqueue(f.task({ scope: second }), second); await pumped();
  assert.equal(f.read(first).state, "running"); assert.equal(f.read(next).state, "queued");
  await f.dispatcher.stopAttempt(first.projectId, first.id); await pumped(); assert.equal(f.read(next).state, "running");
});
for (const state of ["paused", "ended"]) {
  test(`${state} engagement keeps queued attempts waiting and resumes when active`, async (t) => {
    const f = fixture(t); const attempt = f.enqueue(); f.updateEngagement(f.primary.id, { state }); await pumped();
    assert.equal(f.read(attempt).state, "queued"); assert.equal(f.runtime.started.length, 0);
    f.updateEngagement(f.primary.id, { state: "active" }); f.dispatcher.kick(); await pumped();
    assert.equal(f.read(attempt).state, "running");
  });
  test(`${state} engagement refuses task release without changing task or attempts`, (t) => {
    const f = fixture(t); const id = f.task({ state: "awaiting-go" }); f.updateEngagement(f.primary.id, { state }); const before = f.getTask(id);
    const result = f.execute("tasks.release", { taskId: id, expectedRevision: before.revision });
    assert.equal(result.status, 409); assert.deepEqual(f.getTask(id), before); assert.deepEqual(listAttempts(f.raw, f.projectId, id), []);
  });
  test(`${state} engagement does not interrupt running attempts`, async (t) => {
    const f = fixture(t); const attempt = f.enqueue(); await pumped(); const before = f.read(attempt);
    f.updateEngagement(f.primary.id, { state }); f.dispatcher.kick(); await pumped();
    assert.deepEqual(f.read(attempt), before); assert.equal(f.runtime.stopped.length, 0);
  });
}
for (const lifecycle of ["paused", "archived"]) {
  test(`${lifecycle} Team blocks queued attempts and can resume`, async (t) => {
    const f = fixture(t); const attempt = f.enqueue(); f.lifecycle(lifecycle); await pumped();
    assert.equal(f.read(attempt).state, "queued"); assert.equal(f.runtime.started.length, 0);
    f.lifecycle("active"); f.dispatcher.kick(); await pumped(); assert.equal(f.read(attempt).state, "running");
  });
  test(`${lifecycle} Team refuses release`, (t) => {
    const f = fixture(t); const id = f.task({ state: "awaiting-go" }); f.lifecycle(lifecycle);
    assert.equal(f.execute("tasks.release", { taskId: id, expectedRevision: f.getTask(id).revision }).status, 409);
    assert.equal(f.getTask(id).state, "awaiting-go");
  });
  test(`${lifecycle} Team leaves running attempts untouched`, async (t) => {
    const f = fixture(t); const first = f.enqueue(); await pumped(); const before = f.read(first);
    f.lifecycle(lifecycle); const next = f.enqueue(); await pumped();
    assert.deepEqual(f.read(first), before); assert.equal(f.read(next).state, "queued"); assert.equal(f.runtime.stopped.length, 0);
  });
}
test("paused automatic task stays ready and starts after Team resumes", async (t) => {
  const f = fixture(t); f.lifecycle("paused"); const id = f.task({ state: "ready", requiresGo: false });
  f.dispatcher.kick(); await pumped(); assert.equal(f.getTask(id).state, "ready"); assert.equal(listAttempts(f.raw, f.projectId, id).length, 0);
  f.lifecycle("active"); f.dispatcher.kick(); await pumped(); assert.equal(f.getTask(id).state, "active");
  assert.equal(listAttempts(f.raw, f.projectId, id)[0].state, "running");
});
test("paused automatic task resumes after Engagement activation", async (t) => {
  const f = fixture(t); f.updateEngagement(f.primary.id, { state: "paused" }); const id = f.task({ state: "ready", requiresGo: false, engagementId: f.primary.id });
  f.dispatcher.kick(); await pumped(); assert.equal(f.getTask(id).state, "ready");
  f.updateEngagement(f.primary.id, { state: "active" }); f.dispatcher.kick(); await pumped(); assert.equal(listAttempts(f.raw, f.projectId, id)[0].state, "running");
});
test("at-limit engagement accepts task release into the queue", async (t) => {
  const f = fixture(t); f.slots(8); f.updateEngagement(f.primary.id, { maxConcurrent: 1 }); f.enqueue(); await pumped();
  const id = f.task({ state: "awaiting-go" }); f.ok("tasks.release", { taskId: id, expectedRevision: f.getTask(id).revision });
  await pumped(); assert.equal(listAttempts(f.raw, f.projectId, id)[0].state, "queued"); assert.equal(f.getTask(id).state, "active");
});
test("increasing seat slots enables more attempts without exceeding engagement limit", async (t) => {
  const f = fixture(t); f.updateEngagement(f.primary.id, { maxConcurrent: 3 });
  const attempts = [f.enqueue(), f.enqueue(), f.enqueue()]; await pumped();
  assert.deepEqual(attempts.map((a) => f.read(a).state), ["running", "queued", "queued"]);
  f.slots(2); f.dispatcher.kick(); await pumped(); assert.deepEqual(attempts.map((a) => f.read(a).state), ["running", "running", "queued"]);
});
test("reducing seat slots keeps running attempts and blocks further starts", async (t) => {
  const f = fixture(t); f.slots(3); f.updateEngagement(f.primary.id, { maxConcurrent: 4 });
  const attempts = [f.enqueue(), f.enqueue(), f.enqueue()]; await pumped(); f.slots(1); const next = f.enqueue(); await pumped();
  assert.ok(attempts.every((a) => f.read(a).state === "running")); assert.equal(f.read(next).state, "queued");
  assert.equal(f.runtime.stopped.length, 0);
});
test("increasing engagement limit starts queued work", async (t) => {
  const f = fixture(t); f.slots(8); f.updateEngagement(f.primary.id, { maxConcurrent: 1 }); const attempts = [f.enqueue(), f.enqueue()]; await pumped();
  f.updateEngagement(f.primary.id, { maxConcurrent: 2 }); f.dispatcher.kick(); await pumped();
  assert.ok(attempts.every((a) => f.read(a).state === "running"));
});
test("lowering engagement limit retains executions until capacity falls below limit", async (t) => {
  const f = fixture(t); f.slots(8); const first = f.enqueue(); const second = f.enqueue(); const third = f.enqueue(); await pumped();
  f.updateEngagement(f.primary.id, { maxConcurrent: 1 }); await f.dispatcher.stopAttempt(first.projectId, first.id); await pumped();
  assert.equal(f.read(third).state, "queued"); await f.dispatcher.stopAttempt(second.projectId, second.id); await pumped(); assert.equal(f.read(third).state, "running");
});
test("paused high priority engagement does not block eligible lower priority work", async (t) => {
  const f = fixture(t, { nodeSlots: 1 }); const second = f.project(); const e = getPrimaryEngagement(f.raw, second);
  f.updateEngagement(e.id, { priority: 100, state: "paused" }, second); const high = f.enqueue(f.task({ scope: second, engagementId: e.id }), second); const low = f.enqueue(); await pumped();
  assert.equal(f.read(high).state, "queued"); assert.equal(f.read(low).state, "running");
});
test("full high priority engagement does not block another Team", async (t) => {
  const f = fixture(t); f.slots(8); f.updateEngagement(f.primary.id, { priority: 100, maxConcurrent: 1 });
  const team = f.secondTeam(); const e = f.engage(team, f.projectId, 10, 1); const seat = listSeats(f.raw, team).find((s) => s.name === "BE");
  f.enqueue(); const held = f.enqueue(); const other = f.enqueue(f.task({ engagementId: e }), f.projectId, seat.id); await pumped();
  assert.equal(f.read(held).state, "queued"); assert.equal(f.read(other).state, "running");
});
test("flag off preserves M2 dispatch without engagement limits", async (t) => {
  const f = fixture(t, { multiTeam: false }); f.raw.prepare("UPDATE seats SET slots = 8 WHERE id = ?").run(f.seat.id);
  const attempts = [f.enqueue(), f.enqueue(), f.enqueue()]; await pumped(); assert.ok(attempts.every((a) => f.read(a).state === "running"));
});
test("flag off preserves existing dispatch state behavior", async (t) => {
  const f = fixture(t, { multiTeam: false }); f.raw.prepare("UPDATE engagements SET state = 'paused'").run();
  const attempt = f.enqueue(f.task({ engagementId: f.primary.id })); await pumped(); assert.equal(f.read(attempt).state, "running");
});
for (const state of CAPACITY_ATTEMPT_STATES) test(`engagement capacity includes ${state} executions`, async (t) => {
  const f = fixture(t); f.slots(8); f.updateEngagement(f.primary.id, { maxConcurrent: 1 });
  const first = f.enqueue(); await pumped();
  f.raw.prepare("UPDATE attempts SET state = ?, outcome = ? WHERE project_id = ? AND id = ?")
    .run(state, state === "unknown" ? "unknown" : "known", first.projectId, first.id);
  const next = f.enqueue(); await pumped(); assert.equal(engagementLoad(f.raw, f.projectId, f.primary.id), 1); assert.equal(f.read(next).state, "queued");
});
for (const paused of ["engagement", "team"]) test(`restart retains queued work behind a paused ${paused}`, async (t) => {
  const f = fixture(t); const attempt = f.enqueue();
  if (paused === "engagement") f.updateEngagement(f.primary.id, { state: "paused" }); else f.lifecycle("paused");
  await f.dispatcher.stop(); const runtime = createFakeRuntime({ stepMs: 0 });
  const restarted = createDispatcher({ storage: f.storage, hub: f.hub, registry: new RuntimeRegistry([runtime]), clock: f.clock, multiTeam: true });
  f.cleanup(() => restarted.stop()); const recovery = restarted.start(); restarted.kick(); await pumped();
  assert.equal(recovery.untouched, 1); assert.equal(f.read(attempt).state, "queued"); assert.equal(runtime.started.length, 0);
  if (paused === "engagement") f.updateEngagement(f.primary.id, { state: "active" }); else f.lifecycle("active");
  restarted.kick(); await pumped(); assert.equal(f.read(attempt).state, "running");
});
test("crash recovery requeues safe executions but waits for engagement activation", async (t) => {
  const f = fixture(t); const attempt = f.enqueue(); await f.dispatcher.stop();
  transitionAttempt(f.raw, { projectId: attempt.projectId, id: attempt.id }, "leased", {
    nodeId: LOCAL_NODE_ID, leaseId: "recovery-lease", leaseExpiresAt: "2026-11-08T00:01:00.000Z", now: f.clock().toISOString() });
  f.updateEngagement(f.primary.id, { state: "paused" });
  const runtime = createFakeRuntime({ stepMs: 0 }); const restarted = createDispatcher({ storage: f.storage, hub: f.hub,
    registry: new RuntimeRegistry([runtime]), clock: f.clock, multiTeam: true }); f.cleanup(() => restarted.stop());
  assert.equal(restarted.start().requeued, 1); restarted.kick(); await pumped();
  assert.equal(getAttempt(f.raw, attempt.projectId, attempt.id).state, "requeued");
  const replacement = listAttempts(f.raw, f.projectId, attempt.taskId)[1]; assert.equal(replacement.state, "queued"); assert.equal(runtime.started.length, 0);
  f.updateEngagement(f.primary.id, { state: "active" }); restarted.kick(); await pumped(); assert.equal(f.read(replacement).state, "running");
});
