// Closes mutation survivors of the A1 review: which times fire under coalesce / catch-up, the global tick budget and the manual clock guard.
import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduleFixture } from "./schedule-fixture.mjs";
import { fireOccurrence } from "../dist/schedule/scheduler.js";

test("coalesce-once fires the LATEST due time and records the older ones as coalesced", (t) => {
  const f = scheduleFixture(t), id = f.create({ missedPolicy: "coalesce-once" });
  f.advance(600000); f.tick();
  const started = f.occurrences(id).filter((r) => r.status === "started");
  assert.equal(started.length, 1);
  const all = f.occurrences(id).map((r) => r.scheduled_for).sort();
  assert.equal(started[0].scheduled_for, all.at(-1));
  assert.ok(f.occurrences(id).filter((r) => r.status === "skipped").every((r) => r.reason === "coalesced" && r.scheduled_for < started[0].scheduled_for));
});
test("catch-up-limited fires the NEWEST late times and skips the oldest", (t) => {
  const f = scheduleFixture(t), id = f.create({ expr: "300", missedPolicy: "catch-up-limited", catchUpLimit: 2, concurrency: "allow-parallel", parallelLimit: 5 });
  f.advance(10 * 300000 + 100000); f.tick();
  const rows = f.occurrences(id); const started = rows.filter((r) => r.status === "started").map((r) => r.scheduled_for).sort();
  const skipped = rows.filter((r) => r.status === "skipped").map((r) => r.scheduled_for).sort();
  assert.equal(started.length, 2);
  assert.ok(started[0] > skipped.at(-1), "every fired time is newer than every skipped time");
});
test("a schedule whose batch does not fit the remaining tick budget is deferred whole to the next tick", (t) => {
  const f = scheduleFixture(t);
  const mk = (name, expr) => f.create({ name, expr, missedPolicy: "catch-up-limited", catchUpLimit: 5, concurrency: "allow-parallel", parallelLimit: 5 });
  const ids = [mk("A", "60"), mk("B", "120"), mk("C", "90")];
  f.advance(60 * 60000); f.tick();
  const counts = ids.map((id) => f.occurrences(id).length);
  assert.ok(counts.reduce((x, y) => x + y, 0) <= 100, JSON.stringify(counts));
  assert.equal(counts.filter((n) => n === 0).length, 1, JSON.stringify(counts));
  const waiting = ids[counts.findIndex((n) => n === 0)];
  f.tick(); assert.ok(f.occurrences(waiting).length > 0);
});
test("a manual occurrence is refused while the clock is behind the schedule's last run", (t) => {
  const f = scheduleFixture(t), id = f.create();
  f.advance(60000); f.tick();
  const row = f.row(id);
  assert.equal(fireOccurrence(f.deps, row, new Date(f.clock().getTime() - 120000).toISOString(), "manual", new Date(Date.parse(row.last_run_at) - 1000)), false);
  assert.equal(f.occurrences(id).filter((r) => r.trigger === "manual").length, 0);
});
