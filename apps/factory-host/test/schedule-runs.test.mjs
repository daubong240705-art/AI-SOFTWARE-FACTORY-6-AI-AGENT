import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { scheduleFixture } from "./schedule-fixture.mjs";
import { e2Fixture, oneStage, scenario } from "./e2-fixture.mjs";
import { reconcileScheduleRuns } from "../dist/schedule/scheduler.js";
import { notificationKey } from "../dist/notify/service.js";

// Record terminal outcomes independently of runtime progression, so reconciliation boundaries
// remain testable even when a runtime failure stalls rather than terminates its workflow.
function runsFixture(t) {
  const f = scheduleFixture(t); let serial = 0;
  const schedule = f.create();
  function run(state = "failed", { scheduleId = schedule, projectId = f.projectId, status = "started", firedAt, trigger = "time" } = {}) {
    const id = randomUUID(), at = new Date(f.clock().getTime() + ++serial).toISOString();
    f.raw.prepare(`INSERT INTO workflow_instances
      (project_id,id,revision,key,pack_key,pack_version,definition_revision,definition_json,params_json,title,state,created_at,ended_at)
      VALUES (?,?,1,'example','software-team','1.0.0',1,'{}','{}','Run',?,?,?)`)
      .run(projectId, id, state, at, ["completed", "failed", "cancelled", "superseded"].includes(state) ? at : null);
    f.raw.prepare(`INSERT INTO schedule_occurrences
      (project_id,schedule_id,scheduled_for,trigger,status,reason,instance_id,fired_at) VALUES (?,?,?,?,?,NULL,?,?)`)
      .run(projectId, scheduleId, at, trigger, status, id, firedAt ?? f.clock().toISOString());
    return id;
  }
  const reconcile = () => reconcileScheduleRuns(f.raw, f.clock());
  const occurrence = id => f.raw.prepare("SELECT * FROM schedule_occurrences WHERE instance_id=?").get(id);
  return { ...f, schedule, run, reconcile, occurrence };
}

test("0020 schedule counters and reconciliation markers default safely", t => {
  const f = runsFixture(t), id = f.run();
  assert.equal(f.row(f.schedule).run_failures, 0); assert.equal(f.occurrence(id).reconciled_at, null);
});

for (const count of [1, 2, 3]) test(`failed runs quarantine exactly at three: ${count} failures`, t => {
  const f = runsFixture(t); for (let i = 0; i < count; i++) f.run(); f.reconcile();
  assert.equal(f.row(f.schedule).run_failures, count);
  assert.equal(f.row(f.schedule).state, count === 3 ? "quarantined" : "active");
  assert.ok(f.occurrences(f.schedule).every(row => row.reconciled_at === f.clock().toISOString()));
});

test("a second scheduler tick never counts a terminal run twice", t => {
  const f = runsFixture(t), id = f.run(); f.tick(); const first = f.row(f.schedule), at = f.occurrence(id).reconciled_at;
  f.advance(1); f.tick(); assert.deepEqual(f.row(f.schedule), first); assert.equal(f.occurrence(id).reconciled_at, at);
});

test("completed run resets the consecutive failed-run counter", t => {
  const f = runsFixture(t); f.run(); f.run(); f.reconcile(); assert.equal(f.row(f.schedule).run_failures, 2);
  const id = f.run("completed"); f.reconcile(); assert.equal(f.row(f.schedule).run_failures, 0);
  assert.ok(f.occurrence(id).reconciled_at); assert.equal(f.row(f.schedule).state, "active");
});

test("fail fail complete fail fail stays active until the next consecutive failure", t => {
  const f = runsFixture(t);
  for (const state of ["failed", "failed", "completed", "failed", "failed"]) { f.run(state); f.tick(); }
  assert.equal(f.row(f.schedule).run_failures, 2); assert.equal(f.row(f.schedule).state, "active");
  f.run(); f.tick(); assert.equal(f.row(f.schedule).run_failures, 3); assert.equal(f.row(f.schedule).state, "quarantined");
});

for (const state of ["cancelled", "superseded"]) test(`${state} run is reconciled without resetting or incrementing failures`, t => {
  const f = runsFixture(t); f.raw.prepare("UPDATE schedules SET run_failures=2 WHERE id=?").run(f.schedule);
  const id = f.run(state), before = f.row(f.schedule); f.reconcile();
  assert.deepEqual(f.row(f.schedule), before); assert.ok(f.occurrence(id).reconciled_at);
  f.reconcile(); assert.deepEqual(f.row(f.schedule), before);
});

for (const state of ["proposed", "active", "paused", "stalled", "awaiting-approval"]) test(`${state} workflow is not a terminal run`, t => {
  const f = runsFixture(t), id = f.run(state); f.reconcile();
  assert.equal(f.row(f.schedule).run_failures, 0); assert.equal(f.occurrence(id).reconciled_at, null);
});

for (const status of ["failed", "skipped", "no-op"]) test(`${status} occurrence is excluded even if its linked workflow failed`, t => {
  const f = runsFixture(t), id = f.run("failed", { status }); f.reconcile();
  assert.equal(f.row(f.schedule).run_failures, 0); assert.equal(f.occurrence(id).reconciled_at, null);
});

test("an already reconciled occurrence is excluded even when its workflow outcome changes", t => {
  const f = runsFixture(t), id = f.run("completed"); f.reconcile();
  f.raw.prepare("UPDATE workflow_instances SET state='failed' WHERE id=?").run(id); f.reconcile();
  assert.equal(f.row(f.schedule).run_failures, 0);
});

test("the run failure counter saturates at ten", t => {
  const f = runsFixture(t); for (let i = 0; i < 12; i++) f.run(); f.reconcile();
  assert.equal(f.row(f.schedule).run_failures, 10); assert.equal(f.row(f.schedule).state, "quarantined");
  assert.equal(f.occurrences(f.schedule).filter(row => row.reconciled_at !== null).length, 12);
});

for (const state of ["paused", "quarantined"]) test(`${state} schedule is not re-quarantined by a failed run`, t => {
  const f = runsFixture(t); f.raw.prepare("UPDATE schedules SET state=?,run_failures=3 WHERE id=?").run(state, f.schedule);
  const revision = f.row(f.schedule).revision; f.run(); f.reconcile(); const row = f.row(f.schedule);
  assert.equal(row.state, state); assert.equal(row.run_failures, 4); assert.equal(row.revision, revision);
});

test("completion resets failures without automatically resuming a quarantined schedule", t => {
  const f = runsFixture(t); f.raw.prepare("UPDATE schedules SET state='quarantined',run_failures=3 WHERE id=?").run(f.schedule);
  f.run("completed"); f.reconcile(); assert.equal(f.row(f.schedule).run_failures, 0); assert.equal(f.row(f.schedule).state, "quarantined");
});

test("quarantine affects only the failing schedule and isolates identical IDs in other projects", t => {
  const f = runsFixture(t), sibling = f.create({ name: "Sibling" }), projectId = f.project();
  f.raw.prepare(`INSERT INTO schedules (project_id,id,revision,name,kind,expr,timezone,action_json,missed_policy,catch_up_limit,
    concurrency,parallel_limit,state,next_run_at,created_at) SELECT ?,id,revision,name,kind,expr,timezone,action_json,missed_policy,
    catch_up_limit,concurrency,parallel_limit,state,next_run_at,created_at FROM schedules WHERE project_id=? AND id=?`)
    .run(projectId, f.projectId, f.schedule);
  for (let i = 0; i < 3; i++) f.run();
  f.run("failed", { scheduleId: sibling }); f.run("failed", { projectId }); f.reconcile();
  assert.equal(f.row(f.schedule).state, "quarantined"); assert.equal(f.row(sibling).state, "active"); assert.equal(f.row(sibling).run_failures, 1);
  const other = f.raw.prepare("SELECT * FROM schedules WHERE project_id=? AND id=?").get(projectId, f.schedule);
  assert.equal(other.state, "active"); assert.equal(other.run_failures, 1);
});

test("failed starts and failed runs keep independent counters", t => {
  const f = runsFixture(t); f.raw.prepare("UPDATE schedules SET consecutive_failures=2 WHERE id=?").run(f.schedule);
  f.run(); f.reconcile(); assert.equal(f.row(f.schedule).consecutive_failures, 2); assert.equal(f.row(f.schedule).run_failures, 1);
  assert.equal(f.row(f.schedule).state, "active");
  f.run("completed"); f.reconcile(); assert.equal(f.row(f.schedule).consecutive_failures, 2); assert.equal(f.row(f.schedule).run_failures, 0);
});

test("a real failed start never increments the failed-run counter", t => {
  const f = runsFixture(t); f.raw.prepare("UPDATE schedules SET action_json=?,run_failures=2 WHERE id=?")
    .run(JSON.stringify({ definitionKey: "missing", autoStart: true }), f.schedule);
  f.advance(60000); f.tick(); assert.equal(f.occurrences(f.schedule)[0].status, "failed");
  assert.equal(f.row(f.schedule).consecutive_failures, 1); assert.equal(f.row(f.schedule).run_failures, 2);
});

test("a successful workflow start does not reset previous failed runs", t => {
  const f = runsFixture(t); f.raw.prepare("UPDATE schedules SET run_failures=2,consecutive_failures=2 WHERE id=?").run(f.schedule);
  f.advance(60000); f.tick(); assert.equal(f.occurrences(f.schedule)[0].status, "started");
  assert.equal(f.row(f.schedule).run_failures, 2); assert.equal(f.row(f.schedule).consecutive_failures, 0);
});

for (const state of ["paused", "quarantined"]) test(`resume ${state} clears both counters and schedules the next run`, t => {
  const f = runsFixture(t); f.raw.prepare("UPDATE schedules SET state=?,run_failures=3,consecutive_failures=2 WHERE id=?").run(state, f.schedule);
  assert.equal(f.change("resume", f.schedule).status, 200); const row = f.row(f.schedule);
  assert.equal(row.state, "active"); assert.equal(row.run_failures, 0); assert.equal(row.consecutive_failures, 0);
  assert.ok(Date.parse(row.next_run_at) > f.clock().getTime());
});

test("a stale schedule resume does not forgive either counter", t => {
  const f = runsFixture(t); f.raw.prepare("UPDATE schedules SET run_failures=3,consecutive_failures=2,state='quarantined' WHERE id=?").run(f.schedule);
  assert.equal(f.change("resume", f.schedule, { expectedRevision: f.row(f.schedule).revision + 1 }).status, 409);
  assert.equal(f.row(f.schedule).run_failures, 3); assert.equal(f.row(f.schedule).consecutive_failures, 2);
});

test("reconciliation handles at most 200 runs per tick and leaves the rest for the next tick", t => {
  const f = runsFixture(t); for (let i = 0; i < 199; i++) f.run("cancelled");
  const failed = f.run(), completed = f.run("completed"); f.tick();
  assert.equal(f.occurrences(f.schedule).filter(row => row.reconciled_at !== null).length, 200);
  assert.ok(f.occurrence(failed).reconciled_at); assert.equal(f.occurrence(completed).reconciled_at, null);
  assert.equal(f.row(f.schedule).run_failures, 1);
  f.tick(); assert.equal(f.occurrences(f.schedule).filter(row => row.reconciled_at !== null).length, 201);
  assert.equal(f.row(f.schedule).run_failures, 0);
});

test("reconciliation orders outcomes by fired_at before insertion order", t => {
  const f = runsFixture(t); f.run("completed", { firedAt: "2026-11-08T00:00:01.000Z" });
  f.run("failed", { firedAt: "2026-11-08T00:00:00.000Z" }); f.reconcile(); assert.equal(f.row(f.schedule).run_failures, 0);
});

test("manual started occurrences are reconciled just like timed runs", t => {
  const f = runsFixture(t), id = f.run("failed", { trigger: "manual" }); f.reconcile();
  assert.equal(f.row(f.schedule).run_failures, 1); assert.ok(f.occurrence(id).reconciled_at);
});

test("run reconciliation occurs before scheduling so a third failed run prevents a new start", t => {
  const f = runsFixture(t); for (let i = 0; i < 3; i++) f.run(); f.advance(60000); f.tick();
  assert.equal(f.row(f.schedule).state, "quarantined"); assert.equal(f.occurrences(f.schedule).length, 3);
});

test("terminal run quarantine produces one notification and resume keeps reconciled history", scenario, async t => {
  const f = e2Fixture(t, { definitions: [oneStage("daily-report")], deferDispatch: true });
  const schedule = f.schedule();
  const row = () => f.raw.prepare("SELECT * FROM schedules WHERE id=?").get(schedule);
  for (let day = 8; day <= 10; day++) {
    f.set(`2026-11-${String(day).padStart(2, "0")}T00:00:00.000Z`); f.tickSchedules();
    const id = f.occurrences(schedule).at(-1).instance_id;
    // Terminal outcome fixture: the separate R3b scenarios require real runtime failures.
    f.raw.prepare("UPDATE workflow_instances SET state='failed',ended_at=? WHERE id=?").run(f.clock().toISOString(), id);
    f.tickSchedules();
  }
  assert.equal(row().state, "quarantined"); assert.equal(row().run_failures, 3);
  await f.notify(); await f.notify();
  const notifications = f.rows().filter(n => n.entity_id === schedule);
  assert.equal(notifications.length, 1); assert.equal(notifications[0].title, "Schedule quarantined: Daily report");
  assert.equal(notifications[0].dedup_key, notificationKey("schedule", schedule, row().revision, "quarantined"));
  assert.equal(notifications[0].category, "action"); assert.equal(notifications[0].urgency, "normal");
  const history = f.occurrences(schedule);
  f.ok("schedules.resume", { scheduleId: schedule, expectedRevision: row().revision }); f.tickSchedules();
  assert.equal(row().state, "active"); assert.equal(row().run_failures, 0);
  assert.deepEqual(f.occurrences(schedule), history);
  await f.notify(); assert.equal(f.rows().filter(n => n.entity_id === schedule).length, 1);
});
