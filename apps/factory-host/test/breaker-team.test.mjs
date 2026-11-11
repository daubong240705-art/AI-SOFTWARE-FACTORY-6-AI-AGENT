import assert from "node:assert/strict";
import { test } from "node:test";
import { teamFixture } from "./breaker-fixture.mjs";
import { TEAM_FAILURE_THRESHOLD, TEAM_FAILURE_WINDOW_MS, tickTeamBreakers } from "../dist/automation/breakers.js";

test("team constants match AP-8 defaults", () => { assert.equal(TEAM_FAILURE_THRESHOLD, 5); assert.equal(TEAM_FAILURE_WINDOW_MS, 3600000); });
for (const count of [0, 1, 4, 5, 6]) test(`team failure threshold ${count}`, t => {
  const f = teamFixture(t); f.fail(count); f.tick(); assert.equal(f.team().lifecycle, count >= 5 ? "paused" : "active");
  if (count >= 5) assert.equal(f.breaker().failures, count); else assert.equal(f.breaker(), undefined);
});
for (const age of [3599000, 3600000, 3601000]) test(`sliding failure window ${age}ms`, t => {
  const f = teamFixture(t); f.fail(5, { at: f.clock().getTime() - age }); f.tick(); assert.equal(f.team().lifecycle, age <= 3600000 ? "paused" : "active");
});
test("future failures do not count", t => { const f = teamFixture(t); f.fail(5, { at: f.clock().getTime() + 1 }); f.tick(); assert.equal(f.team().lifecycle, "active"); });
test("repeated transitions of a single task count once", t => { const f = teamFixture(t); const [id] = f.fail(1); f.fail(8, { taskId: id }); f.tick(); assert.equal(f.team().lifecycle, "active"); });
test("current task state alone never counts", t => { const f = teamFixture(t); for (let i = 0; i < 5; i++) f.task({ state: "failed", engagementId: f.primary.id }); f.tick(); assert.equal(f.breaker(), undefined); });
test("failed events still count after task changes state", t => { const f = teamFixture(t); f.fail(); f.raw.exec("UPDATE tasks SET state='done'"); f.tick(); assert.equal(f.team().lifecycle, "paused"); });
test("non-failed status transitions do not count", t => { const f = teamFixture(t); f.fail(5, { to: "done" }); f.tick(); assert.equal(f.breaker(), undefined); });
test("pause revision and entity effect match lifecycle command", t => {
  const f = teamFixture(t); const revision = f.team().revision; f.fail(); const cursor = f.hub.currentCursor(f.projectId);
  let notifications = 0; const off = f.hub.subscribe(f.projectId, () => { notifications++; assert.equal(f.breaker().state, "open"); assert.equal(f.team().lifecycle, "paused"); });
  f.tick(); off(); assert.equal(f.team().revision, revision + 1); assert.equal(notifications, 1);
  const result = f.hub.readAfter(f.projectId, cursor); assert.equal(result.kind, "events");
  assert.deepEqual(result.events.map(e => e.payload), [{ type: "entity.changed", entity: { kind: "team", id: f.teamId, revision: revision + 1 } }]);
  assert.equal(f.breaker().reason, "5 tasks failed within 60 minutes"); assert.equal(f.breaker().opened_at, f.clock().toISOString());
});
test("second tick neither reopens nor announces", t => { const f = teamFixture(t); f.fail(); f.tick(); const row = f.breaker(), cursor = f.cursor(), revision = f.team().revision; f.advance(60000); f.tick(); assert.deepEqual(f.breaker(), row); assert.equal(f.cursor(), cursor); assert.equal(f.team().revision, revision); });
test("breaker never unpauses after window expires", t => { const f = teamFixture(t); f.fail(); f.tick(); f.advance(7200000); f.tick(); assert.equal(f.team().lifecycle, "paused"); assert.equal(f.breaker().state, "open"); });
test("operator resume closes silently and does not retrip at same timestamp", t => {
  const f = teamFixture(t); f.fail(); f.tick(); f.lifecycle("active"); const cursor = f.cursor(); f.tick();
  assert.equal(f.breaker().state, "closed"); assert.equal(f.breaker().opened_at, null); assert.equal(f.breaker().closed_at, f.clock().toISOString());
  assert.equal(f.team().lifecycle, "active"); assert.equal(f.cursor(), cursor); f.tick(); assert.equal(f.team().lifecycle, "active");
});
test("resume excludes earlier failures and allows fresh failures to trip", t => {
  const f = teamFixture(t); f.fail(); f.tick(); f.advance(60000); f.lifecycle("active"); f.tick(); const closed = f.breaker().closed_at;
  f.advance(1); f.fail(4); f.tick(); assert.equal(f.team().lifecycle, "active"); f.fail(1); f.tick(); assert.equal(f.team().lifecycle, "paused"); assert.equal(f.breaker().failures, 5); assert.equal(f.breaker().closed_at, closed);
});
test("manual pause stays paused without opening breaker", t => { const f = teamFixture(t); f.lifecycle("paused"); f.fail(); f.tick(); assert.equal(f.breaker(), undefined); assert.equal(f.team().lifecycle, "paused"); });
test("archived team is ignored", t => { const f = teamFixture(t); f.lifecycle("archived"); const revision = f.team().revision; f.fail(); f.tick(); assert.equal(f.breaker(), undefined); assert.equal(f.team().revision, revision); });
test("open breaker on archived team is ignored", t => { const f = teamFixture(t); f.fail(); f.tick(); f.lifecycle("archived"); const row = f.breaker(); f.tick(); assert.deepEqual(f.breaker(), row); });
for (const state of ["paused", "ended"]) test(`${state} engagement does not qualify a team`, t => {
  const f = teamFixture(t); f.fail(); f.raw.prepare("UPDATE engagements SET state=? WHERE project_id=?").run(state, f.projectId); f.tick(); assert.equal(f.breaker(), undefined);
});
test("failures from ended engagements count when team has an active engagement", t => {
  const f = teamFixture(t); f.fail(); f.raw.prepare("UPDATE engagements SET state='ended' WHERE project_id=?").run(f.projectId); f.engage(f.teamId); f.tick(); assert.equal(f.team().lifecycle, "paused");
});
test("failures of different teams do not combine", t => {
  const f = teamFixture(t), team = f.secondTeam(), engagement = f.engage(team); f.fail(4); f.fail(4, { engagementId: engagement }); f.tick(); assert.equal(f.breaker(), undefined); assert.equal(f.team(team).lifecycle, "active");
});
test("failures of different projects do not combine", t => {
  const f = teamFixture(t), other = f.project(); f.fail(4); const engagement = f.raw.prepare("SELECT id FROM engagements WHERE project_id=? AND team_id=?").get(other, f.teamId); f.fail(4, { projectId: other, engagementId: engagement.id }); f.tick(); assert.equal(f.breaker(), undefined); assert.equal(f.breaker(other), undefined);
});
test("only tripping project gets breaker and event", t => {
  const f = teamFixture(t), other = f.project(); const before = f.hub.currentCursor(other); f.fail(); f.tick(); assert.equal(f.breaker().state, "open"); assert.equal(f.breaker(other), undefined); assert.deepEqual(f.hub.currentCursor(other), before);
});
test("resume reconciles even after engagement ends", t => { const f = teamFixture(t); f.fail(); f.tick(); f.raw.exec("UPDATE engagements SET state='ended'"); f.lifecycle("active"); f.tick(); assert.equal(f.breaker().state, "closed"); });
test("transaction rolls back pause when hub append fails", t => {
  const f = teamFixture(t); f.fail(); const revision = f.team().revision; const error = t.mock.method(console, "error", () => {});
  const brokenHub = { transaction: fn => f.hub.transaction(fn), append() { throw new Error("private detail"); } };
  assert.doesNotThrow(() => tickTeamBreakers({ raw: f.raw, hub: brokenHub }, f.clock())); assert.equal(f.team().revision, revision); assert.equal(f.team().lifecycle, "active"); assert.equal(f.breaker(), undefined); assert.deepEqual(error.mock.calls[0].arguments, ["Team breaker tick failed"]);
});
test("invalid clock never throws and logs generic error once", t => { const f = teamFixture(t); const log = t.mock.method(console, "error", () => {}); assert.doesNotThrow(() => f.tick(new Date(NaN))); assert.equal(log.mock.callCount(), 1); assert.deepEqual(log.mock.calls[0].arguments, ["Team breaker tick failed"]); });
test("multiple project failures log only once per tick", t => {
  const f = teamFixture(t); f.project(); const log = t.mock.method(console, "error", () => {});
  const brokenHub = { transaction() { throw new Error("private detail"); } };
  assert.doesNotThrow(() => tickTeamBreakers({ raw: f.raw, hub: brokenHub }, f.clock())); assert.equal(log.mock.callCount(), 1);
});
