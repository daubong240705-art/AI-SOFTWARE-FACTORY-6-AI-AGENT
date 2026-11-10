import assert from "node:assert/strict";
import { test } from "node:test";
import { teamFixture, proxyFixture, completion, gate, open } from "./breaker-fixture.mjs";

test("a half-open trial refused by the per-attempt request cap is released", async t => {
  const f = await proxyFixture(t, { maxRequestsPerAttempt: 1 });
  assert.equal((await f.inject()).statusCode, 200);
  open(f.breaker); f.advance(300000);
  const refused = await f.inject();
  assert.equal(refused.statusCode, 429);
  assert.equal(f.breaker.snapshot()[0].state, "open");
  assert.deepEqual(f.outcomes.filter(([, outcome]) => outcome === "ok").length, 1);
});

test("an upstream that ignores the abort and succeeds after the timeout still counts as a failure", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const entered = gate(), finish = gate();
  const f = await proxyFixture(t, { requestTimeoutMs: 1000, respond: async () => { entered.resolve(); await finish.promise; return completion(); } });
  const pending = f.inject(); await entered.promise; t.mock.timers.tick(1000); finish.resolve(); await pending;
  assert.deepEqual(f.outcomes, [["approved", "fail"]]);
  assert.equal(f.proxy.inflight(), 0);
});

test("only failed transitions count toward the team breaker", t => {
  const f = teamFixture(t);
  f.fail(4); f.fail(5, { to: "cancelled" }); f.fail(5, { to: "accepted" });
  f.tick();
  assert.equal(f.team().lifecycle, "active");
  assert.equal(f.breaker(), undefined);
  f.fail(1); f.tick();
  assert.equal(f.team().lifecycle, "paused");
  assert.equal(f.breaker().failures, 5);
});

test("an archived team is never paused by the breaker", t => {
  const f = teamFixture(t);
  f.raw.prepare("UPDATE teams SET lifecycle='archived' WHERE id=?").run(f.teamId);
  f.fail(6); f.tick();
  assert.equal(f.team().lifecycle, "archived");
  assert.equal(f.breaker(), undefined);
});
