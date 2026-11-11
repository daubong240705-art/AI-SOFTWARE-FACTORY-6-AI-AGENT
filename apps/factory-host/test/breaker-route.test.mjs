import assert from "node:assert/strict";
import { test } from "node:test";
import { createRouteBreaker } from "../dist/policy/breaker.js";
const fixture = (options = {}) => { let time = 0; const breaker = createRouteBreaker({ clock: () => new Date(time), ...options });
  return { breaker, advance: ms => { time += ms; }, record: outcomes => { for (const outcome of outcomes) breaker.record("m", outcome); },
    row: () => breaker.snapshot().find(row => row.key === "m"), allow: () => breaker.allow("m") }; };
const trip = f => f.record(Array(5).fill("fail"));

test("route initially allows a closed key", () => { const f = fixture(); assert.deepEqual(f.allow(), { allowed: true, state: "closed" }); });
test("snapshot starts empty", () => assert.deepEqual(fixture().breaker.snapshot(), []));
for (const n of [1, 2, 3, 4, 5]) test(`${n} consecutive failures boundary`, () => {
  const f = fixture(); f.record(Array(n).fill("fail")); assert.equal(f.allow().allowed, n < 5); assert.equal(f.row().consecutiveFailures, n);
});
test("success resets consecutive failures", () => { const f = fixture(); f.record(["fail", "fail", "fail", "fail", "ok", "fail"]); assert.equal(f.row().consecutiveFailures, 1); assert.equal(f.allow().allowed, true); });
test("exactly half of twenty outcomes stays closed", () => { const f = fixture(); f.record(Array.from({ length: 20 }, (_, i) => i % 2 ? "ok" : "fail")); assert.equal(f.row().windowFailures, 10); assert.equal(f.allow().allowed, true); });
test("eleven failures of twenty opens without five consecutive", () => { const f = fixture(); f.record([...Array.from({ length: 18 }, (_, i) => i % 2 ? "ok" : "fail"), "fail", "fail"]); assert.equal(f.row().windowFailures, 11); assert.equal(f.row().consecutiveFailures, 2); assert.equal(f.allow().allowed, false); });
for (const n of [3, 7, 11, 15, 19]) test(`ratio cannot open with only ${n} samples`, () => {
  const f = fixture(); f.record(Array.from({ length: n }, (_, i) => i % 4 === 3 ? "ok" : "fail")); assert.equal(f.allow().allowed, true);
});
test("rolling window removes old failures", () => { const f = fixture(); f.record(["fail", "fail", "fail", "fail", ...Array(20).fill("ok")]); assert.equal(f.row().windowSize, 20); assert.equal(f.row().windowFailures, 0); });
for (const ms of [299999, 300000]) test(`cooldown boundary ${ms}`, () => {
  const f = fixture(); trip(f); f.advance(ms); assert.deepEqual(f.allow(), { allowed: ms === 300000, state: ms === 300000 ? "half-open" : "open" });
});
test("half-open permits one concurrent trial", () => { const f = fixture(); trip(f); f.advance(300000); assert.equal(f.allow().allowed, true); for (let i = 0; i < 20; i++) assert.deepEqual(f.allow(), { allowed: false, state: "half-open" }); });
test("trial success closes and clears all history", () => { const f = fixture(); trip(f); f.advance(300000); f.allow(); f.record(["ok"]); assert.deepEqual(f.row(), { key: "m", state: "closed", openedAt: null, consecutiveFailures: 0, windowFailures: 0, windowSize: 0 }); });
test("trial failure restarts cooldown", () => { const f = fixture(); trip(f); f.advance(300000); f.allow(); f.record(["fail"]); assert.equal(f.row().openedAt, new Date(300000).toISOString()); f.advance(299999); assert.equal(f.allow().allowed, false); f.advance(1); assert.equal(f.allow().allowed, true); });
test("backwards clock never admits an early trial", () => { const f = fixture(); f.advance(1000); trip(f); f.advance(-100000); assert.equal(f.allow().allowed, false); f.advance(399999); assert.equal(f.allow().allowed, false); f.advance(1); assert.equal(f.allow().allowed, true); });
test("failed trial under backwards clock restarts full cooldown", () => { const f = fixture(); trip(f); f.advance(300000); f.allow(); f.advance(-400000); f.record(["fail"]); assert.equal(f.row().openedAt, new Date(300000).toISOString()); f.advance(699999); assert.equal(f.allow().allowed, false); f.advance(1); assert.equal(f.allow().allowed, true); });
test("snapshots do not mutate health or admit a trial", () => { const f = fixture(); trip(f); f.advance(300000); f.row().state = "closed"; assert.equal(f.row().state, "open"); assert.equal(f.allow().state, "half-open"); });
test("oldest closed key is evicted at sixty-four", () => { const f = fixture(); for (let i = 0; i < 64; i++) f.breaker.record(`m${i}`, "ok"); f.breaker.allow("m0"); f.breaker.record("new", "ok"); assert.equal(f.breaker.snapshot().length, 64); assert.equal(f.breaker.snapshot().some(row => row.key === "m0"), false); });
test("open and half-open keys are never evicted", () => { const f = fixture(); trip(f); for (let i = 0; i < 63; i++) f.breaker.record(String(i), "ok"); f.advance(300000); f.allow(); f.breaker.record("extra", "ok"); assert.equal(f.row().state, "half-open"); assert.equal(f.breaker.snapshot().some(row => row.key === "0"), false); });
test("all unhealthy keys refuse new keys without growing memory", () => { const f = fixture(); for (let i = 0; i < 64; i++) for (let j = 0; j < 5; j++) f.breaker.record(String(i), "fail"); assert.equal(f.breaker.allow("new").allowed, false); f.breaker.record("new", "fail"); assert.equal(f.breaker.snapshot().length, 64); });
test("models have independent histories", () => { const f = fixture(); trip(f); assert.equal(f.breaker.allow("other").allowed, true); assert.equal(f.row().state, "open"); });
test("abandoned trial is released without an outcome", () => { const f = fixture(); trip(f); f.advance(300000); f.allow(); f.breaker.abandon("m"); assert.equal(f.row().state, "open"); assert.equal(f.row().windowSize, 5); assert.equal(f.allow().allowed, true); });
test("late outcome while open does not close it", () => { const f = fixture(); trip(f); f.record(["ok"]); assert.equal(f.row().state, "open"); });
test("failed trial adds its outcome to health counters", () => { const f = fixture(); trip(f); f.advance(300000); f.allow(); f.record(["fail"]); assert.equal(f.row().consecutiveFailures, 6); assert.equal(f.row().windowFailures, 6); assert.equal(f.row().windowSize, 6); });
