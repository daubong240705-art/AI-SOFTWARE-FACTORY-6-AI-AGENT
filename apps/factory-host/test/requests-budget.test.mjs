import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fixture, refused } from "./requests-fixture.mjs";
import { MAX_REQUESTS_PER_ROOT, MAX_ATTEMPTS_PER_ROOT } from "../dist/requests/service.js";

for (const limit of [1,2,3,4,5]) test(`root request budget ${limit} refuses atomically`, (t) => {
  const f = fixture(t); for (let i = 0; i < limit; i++) { const r = f.create({ ask: `Request ${i}` }); f.triage(r.requestId, "decline"); }
  refused(f, () => f.create({ ask: "Overflow" }, f.grant, { maxRequestsPerRoot: limit }), "request budget exhausted");
});
for (const limit of [0,1]) test(`root attempt budget ${limit} refuses atomically`, (t) => {
  const f = fixture(t); refused(f, () => f.create({}, f.grant, { maxAttemptsPerRoot: limit }), "request budget exhausted");
});
for (const cap of ["maxRequestsPerRoot", "maxAttemptsPerRoot"]) test(`${cap} does not spend another root budget`, (t) => {
  const f = fixture(t); f.create(); const other = f.seed(); assert.ok(f.create({ ask: "Independent" }, other, { [cap]: cap === "maxRequestsPerRoot" ? 1 : 2 }).requestId);
});
test("default budgets are fifteen requests and forty attempts", () => {
  assert.equal(MAX_REQUESTS_PER_ROOT, 15); assert.equal(MAX_ATTEMPTS_PER_ROOT, 40);
});
for (const kind of ["produce", "review", "decision"]) test(`${kind} cycle without a new artifact is atomic`, (t) => {
  const f = fixture(t); f.engage(f.team); const first = f.create({ kind }); const seat = f.raw.prepare("SELECT id FROM seats WHERE team_id = ? LIMIT 1").get(f.team).id;
  f.raw.prepare("UPDATE tasks SET state = 'active',owner_seat_id = ? WHERE id = ?").run(seat, first.requestId);
  const by = f.seed(first.requestId, seat);
  refused(f, () => f.create({ targetTeamId: f.teamId, ask: "Return to root" }, by), "request would loop");
});
test("a new artifact permits a return to an ancestor team", (t) => {
  const f = fixture(t); f.engage(f.team); const first = f.create(); const seat = f.raw.prepare("SELECT id FROM seats WHERE team_id = ? LIMIT 1").get(f.team).id;
  f.raw.prepare("UPDATE tasks SET state = 'active',owner_seat_id = ? WHERE id = ?").run(seat, first.requestId);
  const by = f.seed(first.requestId, seat); const ref = f.artifact({ producer: by.attemptId });
  f.raw.prepare("UPDATE artifact_versions SET created_at = '2026-11-08T00:00:01.000Z' WHERE artifact_id = ?").run(ref.artifactId);
  assert.ok(f.create({ targetTeamId: f.teamId, ask: "Return with evidence" }, by).requestId);
});
test("a team outside the chain remains allowed", (t) => {
  const f = fixture(t); f.engage(f.team); const first = f.create(); const seat = f.raw.prepare("SELECT id FROM seats WHERE team_id = ? LIMIT 1").get(f.team).id;
  f.raw.prepare("UPDATE tasks SET state = 'active',owner_seat_id = ? WHERE id = ?").run(seat, first.requestId);
  assert.ok(f.create({ targetTeamId: f.secondTeam(), ask: "New team" }, f.seed(first.requestId, seat)).requestId);
});
test("migration seven has strict waits and composite foreign keys", (t) => {
  const f = fixture(t); assert.deepEqual(f.raw.prepare("SELECT version FROM migration_ledger ORDER BY version").all().map((r) => r.version), [1,2,3,4,5,6,7,8,9,10,11,12]);
  assert.equal(f.raw.prepare("SELECT strict FROM pragma_table_list WHERE name = 'ctr_waits'").get().strict, 1);
  assert.equal(f.raw.pragma("foreign_key_list(ctr_waits)").length, 6); assert.deepEqual(f.raw.pragma("foreign_key_check"), []);
});
for (const outcome of ["unknown", "done", "timeout"]) test(`migration rejects invalid wait outcome ${outcome}`, (t) => {
  const f = fixture(t); const r = f.create({ responseMode: "blocking" });
  assert.throws(() => f.raw.prepare("UPDATE ctr_waits SET resolved_at = ?,outcome = ? WHERE ctr_task_id = ?").run(f.clock().toISOString(), outcome, r.requestId), /CHECK/);
});
test("migration rejects cross-project waiter references", (t) => {
  const f = fixture(t); const r = f.create(); const other = f.project();
  assert.throws(() => f.raw.prepare("INSERT INTO ctr_waits VALUES (?,?,?,?,?,NULL,NULL)").run(other, f.grant.taskId, r.requestId, f.grant.attemptId, f.clock().toISOString()), /FOREIGN KEY/);
});
test("request budget includes descendants", (t) => {
  const f = fixture(t); f.engage(f.team); const r = f.create(); const seat = f.raw.prepare("SELECT id FROM seats WHERE team_id = ? LIMIT 1").get(f.team).id;
  f.raw.prepare("UPDATE tasks SET state = 'active',owner_seat_id = ? WHERE id = ?").run(seat, r.requestId);
  const by = f.seed(r.requestId, seat); const targetTeamId = f.secondTeam(); refused(f, () => f.create({ targetTeamId, ask: randomUUID() }, by, { maxRequestsPerRoot: 1 }), "request budget exhausted");
});
