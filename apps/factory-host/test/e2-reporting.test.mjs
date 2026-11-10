import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { e2Fixture, scenario, oneStage } from "./e2-fixture.mjs";
import { occurrenceId } from "../dist/schedule/scheduler.js";
import { notificationKey } from "../dist/notify/service.js";
import { notifyFixture } from "./notify-fixture.mjs";
import { standingMcpFixture } from "./standing-fixture.mjs";
import { tickTeamBreakers } from "../dist/automation/breakers.js";

const reporting = (t, options = {}) => e2Fixture(t, { definitions: [oneStage("daily-report", "Daily report")], ...options });
const scheduleRow = (f, id) => f.raw.prepare("SELECT * FROM schedules WHERE id=?").get(id);
const schedulerReceipts = f => f.raw.prepare("SELECT command_id FROM command_receipts WHERE actor_id='scheduler' ORDER BY rowid").all().map(r => r.command_id);

test("E2 R1: 07:00 local starts and completes one daily report, deduplicates, then runs next day", scenario, async t => {
  const f = reporting(t), schedule = f.schedule();
  f.set("2026-11-08T00:00:00.000Z"); f.tickSchedules();
  const occurrence = f.occurrences(schedule)[0], id = occurrence.instance_id;
  assert.equal(occurrence.status, "started"); assert.equal(f.view(id).state, "active");
  assert.equal(f.view(id).title, "Daily report 2026-11-08");
  assert.equal(id, occurrenceId(f.projectId, schedule, occurrence.scheduled_for, "time"));
  assert.deepEqual(schedulerReceipts(f).sort(), [id, occurrenceId(f.projectId, schedule, occurrence.scheduled_for, "time", "start")].sort());
  const cursor = f.hub.currentCursor(f.projectId); f.tickSchedules();
  assert.deepEqual(f.hub.currentCursor(f.projectId), cursor); assert.equal(f.occurrences(schedule).length, 1);
  await f.complete(id); assert.equal(f.runtime.started.length, 1);
  assert.equal(f.runtime.started[0].seat.name, "BA");
  assert.equal((await f.read("inbox")).counts.total, 0);
  f.set("2026-11-09T00:00:00.000Z"); f.tickSchedules();
  const next = f.occurrences(schedule)[1]; assert.notEqual(next.instance_id, id);
  await f.complete(next.instance_id);
  assert.equal(f.raw.prepare("SELECT count(*) n FROM approvals WHERE state='applied'").get().n, 2);
  assert.equal(schedulerReceipts(f).length, 4);
  assert.equal(f.events().filter(e => e.payload.type === "workflow.state-changed" && e.payload.to === "completed").length, 2);
});

test("E2 R2: outage coalesces to one catch-up report and a running predecessor records a skip", scenario, async t => {
  const f = reporting(t), schedule = f.schedule();
  // No control-plane ticks from local 06:59 through 09:00.
  f.set("2026-11-08T02:00:00.000Z"); f.tickSchedules(); f.tickSchedules();
  assert.equal(f.occurrences(schedule).length, 1);
  const first = f.occurrences(schedule)[0]; assert.equal(first.scheduled_for, "2026-11-08T00:00:00.000Z");
  assert.equal(first.status, "started"); await f.live(first.instance_id, "report");
  f.set("2026-11-09T00:00:00.000Z"); f.tickSchedules();
  assert.equal(f.occurrences(schedule)[1].status, "skipped");
  assert.equal(f.occurrences(schedule)[1].reason, "previous still running");
  // The clock jumped a day: renew the fake attempt's lease before releasing its scripted completion.
  f.raw.prepare("UPDATE attempts SET lease_expires_at=? WHERE state='running'").run("2026-11-09T01:00:00.000Z");
  await f.complete(first.instance_id);
  // Three more missed daily occurrences coalesce to the newest one, not three reports.
  f.set("2026-11-12T02:00:00.000Z"); f.tickSchedules();
  const rows = f.occurrences(schedule);
  assert.deepEqual(rows.slice(2).map(r => [r.status, r.reason]), [["skipped", "coalesced"], ["skipped", "coalesced"], ["started", null]]);
  await f.complete(rows.at(-1).instance_id);
  assert.equal(f.runtime.started.length, 2); assert.equal(schedulerReceipts(f).length, 4);
  assert.equal((await f.read("inbox")).counts.total, 0);
});

test("E2 R3a: three start failures quarantine a schedule, notify once per revision, and resume", scenario, async t => {
  const f = reporting(t), schedule = f.schedule({ name: "Morning report" });
  const action = scheduleRow(f, schedule).action_json;
  // Valid command creates the schedule; simulate a definition becoming unavailable after restart.
  f.raw.prepare("UPDATE schedules SET action_json=? WHERE id=?").run(JSON.stringify({ definitionKey: "missing", autoStart: true }), schedule);
  for (let day = 8; day <= 10; day++) { f.set(`2026-11-${day.toString().padStart(2, "0")}T00:00:00.000Z`); f.tickSchedules(); }
  assert.equal(scheduleRow(f, schedule).state, "quarantined");
  assert.equal(scheduleRow(f, schedule).consecutive_failures, 3); assert.equal(scheduleRow(f, schedule).next_run_at, null);
  assert.deepEqual(f.occurrences(schedule).map(r => r.reason), Array(3).fill("workflow start failed"));
  assert.equal(schedulerReceipts(f).length, 0, "failed creates/starts leave no scheduler receipts");
  await f.notify(); await f.notify();
  const notification = f.rows().filter(n => n.entity_id === schedule);
  assert.equal(notification.length, 1);
  assert.equal(notification[0].title, "Schedule quarantined: Morning report");
  assert.equal(notification[0].category, "action"); assert.equal(notification[0].urgency, "normal");
  assert.equal(notification[0].dedup_key, notificationKey("schedule", schedule, scheduleRow(f, schedule).revision, "quarantined"));
  assert.equal(notification[0].entity_kind, "schedule");
  assert.equal((await f.read("notifications")).items.some(n => n.title === notification[0].title), true);
  f.advance(86400000); f.tickSchedules(); await f.notify();
  assert.equal(f.occurrences(schedule).length, 3); assert.equal(f.rows().filter(n => n.entity_id === schedule).length, 1);
  f.raw.prepare("UPDATE schedules SET action_json=? WHERE id=?").run(action, schedule);
  f.ok("schedules.resume", { scheduleId: schedule, expectedRevision: scheduleRow(f, schedule).revision });
  assert.equal(scheduleRow(f, schedule).consecutive_failures, 0);
  f.advance(86400000); f.tickSchedules(); await f.complete(f.occurrences(schedule).at(-1).instance_id);
  // A later quarantine revision is a distinct action; normal ticks still deduplicate it.
  f.raw.prepare("UPDATE schedules SET state='quarantined',revision=revision+1 WHERE id=?").run(schedule);
  await f.notify(); await f.notify(); assert.equal(f.rows().filter(n => n.entity_id === schedule).length, 2);
  assert.ok(f.events().some(e => e.payload.type === "entity.changed" && e.payload.entity.kind === "schedule"));
});

test("E2 R3b: failed runtime reports currently do not increment the schedule quarantine counter", scenario, async t => {
  const f = reporting(t, { definitions: [oneStage("daily-report", "[fake:fail]")] }), schedule = f.schedule({ concurrency: "allow-parallel", parallelLimit: 3 });
  for (let day = 8; day <= 10; day++) {
    f.set(`2026-11-${day.toString().padStart(2, "0")}T00:00:00.000Z`); f.tickSchedules();
    const id = f.occurrences(schedule).at(-1).instance_id;
    await f.until(() => f.view(id).state === "stalled", "failed report stalls");
    assert.equal(f.stageTask(id, "report").state, "failed");
  }
  // KNOWN DEFECT: schedule failures count workflow command failures, never failed workflow runs.
  assert.equal(scheduleRow(f, schedule).state, "active"); assert.equal(scheduleRow(f, schedule).consecutive_failures, 0);
  assert.equal(f.occurrences(schedule).filter(r => r.status === "started").length, 3);
  await f.notify(); assert.equal(f.rows().filter(n => n.entity_id === schedule).length, 0);
});

test("E2 R3c: schedule quarantine collection ignores healthy schedules and isolates projects", scenario, async t => {
  const f = reporting(t), active = f.schedule(), paused = f.schedule({ name: "Paused report", enabled: false });
  await f.notify(); assert.equal(f.rows().length, 0);
  const other = randomUUID();
  const execute = (type, payload) => {
    const r = f.pipeline.execute({ apiVersion: 1, commandId: randomUUID(), projectId: other, type, payload });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  };
  execute("projects.create", { name: "Other project", workspace: { kind: "directory", root: "/workspace/other-project" } });
  execute("schedules.create", { scheduleId: active, name: "Other report", kind: "interval", expr: "60",
    action: { definitionKey: "daily-report", packKey: "software-team" } });
  f.raw.prepare("UPDATE schedules SET state='quarantined' WHERE project_id=?").run(other);
  await f.notify(); await f.notify(); assert.equal(f.rows().length, 0);
  assert.equal(f.raw.prepare("SELECT count(*) n FROM notifications WHERE project_id=?").get(other).n, 1);
  f.raw.prepare("UPDATE schedules SET state='quarantined' WHERE project_id=? AND id=?").run(f.projectId, active);
  await f.notify(); await f.notify();
  assert.equal(f.rows().length, 1); assert.equal(f.rows()[0].entity_id, active);
  assert.equal(f.rows()[0].title, "Schedule quarantined: Daily report");
  assert.equal(f.rows().filter(n => n.entity_id === paused).length, 0);
  assert.equal(f.raw.prepare("SELECT count(*) n FROM notifications WHERE project_id=?").get(other).n, 1);
});

test("E2 R4a: real completed/failed reports expose missing failure-transition digest counts", scenario, async t => {
  const f = reporting(t), id = f.create({}, "daily-report"); f.command("start", id); await f.complete(id);
  const failed = f.createTask("software", { goal: "[fake:fail]", requiresGo: false });
  await f.until(() => f.task(failed).state === "failed", "failed daily work");
  f.usage(37); f.set("2026-11-08T11:00:00.000Z"); await f.notify(); await f.notify();
  const digest = f.rows().filter(n => n.category === "digest"); assert.equal(digest.length, 1);
  // KNOWN DEFECT: failed runtime tasks emit entity.changed, not the task.status-changed events counted by digests.
  assert.equal(digest[0].body, "Tasks done: 1; approvals decided: 1; approvals pending: 0; failed tasks: 0; 37 tokens; cost: no price list");
  assert.equal(f.stageTask(id, "report").state, "done"); assert.equal(f.task(failed).state, "failed");
});

test("E2 R4b: recorded daily activity yields one exact digest and minimal fake push", scenario, async t => {
  const sent = [], pushChannel = { name: "fake", async send(payload) { sent.push(payload); } };
  const f = notifyFixture(t, { at: "2026-11-10T00:00:00.000Z", pushChannel });
  f.clearActivity(); const done = f.event("done"); f.event("done", f.clock().toISOString(), f.projectId, done);
  f.event("failed"); const decided = f.approval(); f.decide(decided); const pending = f.approval(); f.usage(123);
  f.at("2026-11-10T10:59:59.999Z"); await f.tick(); assert.equal(f.rows().filter(n => n.category === "digest").length, 0);
  f.advance(1); await f.tick(); f.advance(60000); await f.tick();
  const digest = f.rows().filter(n => n.category === "digest"); assert.equal(digest.length, 1);
  assert.equal(digest[0].body, "Tasks done: 1; approvals decided: 1; approvals pending: 1; failed tasks: 1; 123 tokens; cost: no price list");
  const pushed = sent.filter(p => p.level === "digest");
  assert.deepEqual(pushed, [{ title: "Daily digest: 2026-11-10", level: "digest", urgency: "normal", link: "/inbox" }]);
  assert.equal(f.deliveries().filter(d => d.notification_id === digest[0].id)[0].attempts, 1);
  assert.equal(f.raw.prepare("SELECT state FROM approvals WHERE id=?").get(pending).state, "pending");
});

test("E2 R4c: normal schedule action waits from 23:00 to 07:00; urgent team breaker pushes immediately", scenario, async t => {
  const sent = [], pushChannel = { name: "fake", async send(payload) { sent.push(payload); } };
  const f = reporting(t, { at: "2026-11-08T16:00:00.000Z", pushChannel });
  const schedule = f.schedule({ kind: "interval", expr: "60" });
  f.raw.prepare("UPDATE schedules SET action_json=? WHERE id=?").run(JSON.stringify({ definitionKey: "missing", autoStart: true }), schedule);
  for (let i = 0; i < 3; i++) { f.advance(60000); f.tickSchedules(); }
  await f.notify(); assert.equal(sent.length, 0);
  const delivery = f.raw.prepare("SELECT * FROM notification_deliveries").get();
  assert.equal(delivery.state, "held-quiet"); assert.equal(delivery.deliver_after, "2026-11-09T00:00:00.000Z");
  const team = f.teams.software.id;
  // Existing breaker fixture convention: recorded failures, independent of the D6 event-wiring defect.
  for (let i = 0; i < 5; i++) {
    const id = f.createTask("software");
    f.hub.transaction(() => f.hub.append({ projectId: f.projectId, causationId: id, payload: { type: "task.status-changed", taskId: id, to: "failed" } }));
  }
  tickTeamBreakers(f.deps, f.clock()); await f.notify();
  assert.deepEqual(sent, [{ title: "Team paused by circuit breaker", level: "action", urgency: "urgent", link: "/inbox" }]);
  assert.ok((await f.read("inbox")).teamBreakers.some(b => b.teamId === team));
  f.set("2026-11-08T23:59:59.999Z"); await f.notify(); assert.equal(sent.length, 1);
  f.advance(1); await f.notify(); await f.notify();
  assert.equal(sent.filter(p => p.title === "Schedule quarantined: Daily report").length, 1);
  assert.ok(sent.every(p => Object.keys(p).sort().join() === "level,link,title,urgency"));
});

test("E2 R5: Reporting MCP standing notify enforces autonomy, daily limit, midnight reset, revocation and expiry", scenario, async t => {
  const f = standingMcpFixture(t);
  const refuse = reason => {
    const before = f.rows().length, uses = f.uses().length;
    assert.equal(f.call().content[0].text, `standing approval refused: ${reason}`);
    assert.equal(f.rows().length, before); assert.equal(f.uses().length, uses);
  };
  const send = () => { const before = f.rows().length; assert.equal(f.call().isError, false); assert.equal(f.rows().length, before + 1); };
  refuse("autonomy"); f.level(4); const standing = f.create({ limitPerDay: 2, maxTokensPerUse: 50 });
  send(); send(); refuse("limit");
  assert.deepEqual(f.uses().map(u => u.local_day), ["2026-11-10", "2026-11-10"]);
  assert.equal(f.row(standing).max_tokens_per_use, 50);
  // Advance to local midnight and renew the synthetic grant, not the approval.
  f.at("2026-11-10T16:59:59.999Z");
  f.raw.prepare("UPDATE attempts SET lease_expires_at=? WHERE id=?").run("2026-11-11T01:00:00.000Z", f.grant.attemptId);
  refuse("limit"); f.advance(1); send(); assert.equal(f.uses().at(-1).local_day, "2026-11-11");
  assert.equal(f.revoke(standing).status, 200); refuse("none");
  f.create({ expiresAt: new Date(f.clock().getTime() + 1).toISOString(), maxTokensPerUse: 50 });
  f.advance(1); refuse("expired");
  assert.equal(f.rows().length, 3); assert.equal(f.uses().length, 3);
  assert.equal(f.effects().filter(p => p.entity.kind === "notification").length, 3);
  assert.ok(f.rows().every(n => n.category === "important" && n.urgency === "normal"));
});
