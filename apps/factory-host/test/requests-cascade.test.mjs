import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, blocked, attempts, wait, until } from "./requests-blocking-fixture.mjs";
import { cancelRequester } from "../dist/requests/waits.js";
import { snapshot } from "./requests-fixture.mjs";

for (const kind of ["clarify", "consult", "produce", "review", "decision", "notify"]) {
  test(`cancelling a sole requester cancels its ${kind} CTR`, (t) => {
    const f = fixture(t); const r = f.create({ kind }); f.moveTask(f.raw, f.projectId, f.grant.taskId, "cancelled");
    assert.equal(f.getTask(r.requestId).state, "cancelled"); assert.ok(f.meta(r.requestId).closed_at);
    assert.equal(f.view(r.requestId).thread.at(-1).text, "requester cancelled");
    const before = snapshot(f.raw); cancelRequester(f.deps, f.projectId, f.grant.taskId); assert.equal(snapshot(f.raw), before);
  });
}
for (const kind of ["produce", "review", "decision"]) test(`shared ${kind} CTR survives requester cancellation`, (t) => {
  const f = fixture(t); const r = f.create({ kind }); const follower = f.seed(); f.create({ kind }, follower);
  f.moveTask(f.raw, f.projectId, f.grant.taskId, "cancelled"); assert.equal(f.getTask(r.requestId).state, "proposed");
  assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM ctr_followers WHERE task_id = ?").get(r.requestId).n, 1);
});
test("cancelling a waiter resolves its own waits without resuming", async (t) => {
  const f = fixture(t); const r = await blocked(f); f.moveTask(f.raw, f.projectId, r.grant.taskId, "cancelled");
  assert.equal(wait(f, r.grant, r.requestId).outcome, "cancelled"); assert.equal(attempts(f, r.grant.taskId).length, 1);
});
test("cancelled shared follower is unsubscribed", async (t) => {
  const f = fixture(t); const original = f.create(); const r = await blocked(f);
  f.moveTask(f.raw, f.projectId, r.grant.taskId, "cancelled");
  assert.equal(f.getTask(original.requestId).state, "proposed"); assert.equal(wait(f, r.grant, original.requestId).outcome, "cancelled");
  assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM ctr_followers WHERE follower_task_id = ?").get(r.grant.taskId).n, 0);
});
test("cancellation recursively reaches child CTRs", (t) => {
  const f = fixture(t); f.engage(f.team); const first = f.create(); const seat = f.raw.prepare("SELECT id FROM seats WHERE team_id = ? LIMIT 1").get(f.team).id;
  f.raw.prepare("UPDATE tasks SET owner_seat_id = ?,state = 'active' WHERE id = ?").run(seat, first.requestId);
  const by = f.seed(first.requestId, seat); const child = f.create({ targetTeamId: f.secondTeam(), ask: "Child" }, by);
  f.moveTask(f.raw, f.projectId, f.grant.taskId, "cancelled"); assert.equal(f.getTask(first.requestId).state, "cancelled"); assert.equal(f.getTask(child.requestId).state, "cancelled");
});
test("cascading a running CTR stops its attempt", async (t) => {
  const f = fixture(t); const r = f.create({ kind: "clarify" }); f.raw.prepare("UPDATE tasks SET goal = '[fake:hang]' WHERE id = ?").run(r.requestId);
  await until(() => attempts(f, r.requestId).at(-1)?.state === "running");
  f.moveTask(f.raw, f.projectId, f.grant.taskId, "cancelled"); await until(() => attempts(f, r.requestId).at(-1)?.state === "stopped");
  assert.equal(f.getTask(r.requestId).state, "cancelled");
});
