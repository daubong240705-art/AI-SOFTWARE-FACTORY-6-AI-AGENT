import assert from "node:assert/strict";
import { test } from "node:test";
import { integrationFixture, mockWorkspace, deferred, sha } from "./integration-fixture.mjs";

test("worker records merged SHA and resolution and publishes a task change", async t => {
  const f = integrationFixture(t), id = f.merge(), before = f.getTask(id).revision;
  assert.equal(await f.work(), true); const row = f.row(id);
  assert.equal(row.state, "merged"); assert.equal(row.merge_sha, sha); assert.equal(row.error_kind, null); assert.equal(row.resolved_at, f.clock().toISOString());
  const event = f.raw.prepare("SELECT body_json FROM event_log ORDER BY rowid DESC LIMIT 1").get();
  assert.deepEqual(JSON.parse(event.body_json).payload.entity, { kind: "task", id, revision: before + 1 });
});
test("worker records a merge conflict", async t => {
  const f = integrationFixture(t, { workspace: mockWorkspace({ async integrate() { return { outcome: "conflict" }; } }) }), id = f.merge();
  await f.work(); assert.equal(f.row(id).state, "conflict"); assert.equal(f.row(id).error_kind, "conflict"); assert.equal(f.row(id).merge_sha, null); assert.equal(f.row(id).resolved_at, f.clock().toISOString());
});
test("worker processes one row per project in creation order", async t => {
  const f = integrationFixture(t), later = f.merge(undefined, { createdAt: "2026-11-09T00:00:00.000Z" }), earlier = f.merge(undefined, { createdAt: "2026-11-07T00:00:00.000Z" });
  await f.work(); assert.equal(f.row(earlier).state, "merged"); assert.equal(f.row(later).state, "pending");
  await f.work(); assert.equal(f.row(later).state, "merged"); assert.equal(f.workspace.integrated.length, 2);
});
test("worker visits separate projects in one step", async t => {
  const f = integrationFixture(t), other = f.project(), id = f.merge(), second = f.task({ scope: other, seatId: null, state: "done" }); f.merge(second, {}, other);
  await f.work(); assert.equal(f.row(id).state, "merged"); assert.equal(f.row(second, other).state, "merged");
});
test("worker claims a project before yielding so reentrant workers cannot merge twice", async t => {
  const hold = deferred(); let calls = 0;
  const f = integrationFixture(t, { workspace: mockWorkspace({ async integrate() { calls++; await hold.promise; return { outcome: "merged", sha }; } }) }), id = f.merge();
  const first = f.work(); assert.equal(calls, 1); assert.equal(await f.work(), false); assert.equal(calls, 1);
  hold.resolve(); await first; assert.equal(f.row(id).state, "merged"); assert.equal(await f.work(), false);
});
test("claims serialize all rows of a project", async t => {
  const hold = deferred(); let calls = 0;
  const f = integrationFixture(t, { workspace: mockWorkspace({ async integrate() { calls++; await hold.promise; return { outcome: "merged", sha }; } }) }); f.merge(); f.merge();
  const first = f.work(); await f.work(); assert.equal(calls, 1); hold.resolve(); await first; await f.work(); assert.equal(calls, 2);
});
for (const attempts of [0, 1, 2]) test(`thrown git failure at attempt ${attempts + 1} persists bounded retry`, async t => {
  const f = integrationFixture(t, { workspace: mockWorkspace({ async integrate() { throw Error("sensitive git details"); } }) }), id = f.merge(undefined, { attempts });
  await assert.doesNotReject(f.work()); const row = f.row(id);
  assert.equal(row.attempts, attempts + 1); assert.equal(row.state, attempts === 2 ? "conflict" : "pending"); assert.equal(row.error_kind, "git-failed");
  assert.equal(row.resolved_at, attempts === 2 ? f.clock().toISOString() : null); assert.equal(JSON.stringify(row).includes("sensitive"), false);
});
test("three errors become conflict and stop retrying", async t => {
  let calls = 0; const f = integrationFixture(t, { workspace: mockWorkspace({ async integrate() { calls++; throw Error("failed"); } }) }), id = f.merge();
  for (let i = 0; i < 4; i++) await f.work(); assert.equal(calls, 3); assert.equal(f.row(id).attempts, 3); assert.equal(f.row(id).state, "conflict");
});
test("explicit git-failed result is retried only three times", async t => {
  const f = integrationFixture(t, { workspace: mockWorkspace({ async integrate() { return { outcome: "git-failed" }; } }) }), id = f.merge();
  f.dispatcher.kick(); await f.dispatcher.idle(); assert.equal(f.row(id).state, "conflict"); assert.equal(f.row(id).error_kind, "git-failed"); assert.equal(f.row(id).attempts, 3);
});
test("success after a git failure clears error kind", async t => {
  let calls = 0; const f = integrationFixture(t, { workspace: mockWorkspace({ async integrate() { if (++calls === 1) throw Error("failed"); return { outcome: "merged", sha }; } }) }), id = f.merge();
  await f.work(); await f.work(); assert.equal(f.row(id).state, "merged"); assert.equal(f.row(id).error_kind, null); assert.equal(f.row(id).attempts, 1);
});
test("missing project root counts as git failure", async t => {
  const f = integrationFixture(t, { projectRootFor: () => null }), id = f.merge(); await f.work(); assert.equal(f.row(id).attempts, 1); assert.equal(f.workspace.integrated.length, 0);
});
test("root resolver exception cannot escape worker", async t => {
  const f = integrationFixture(t, { projectRootFor: () => { throw Error("resolver failed"); } }), id = f.merge(); await assert.doesNotReject(f.work()); assert.equal(f.row(id).attempts, 1);
});
test("merge runs outside a database transaction", async t => {
  let f; f = integrationFixture(t, { workspace: mockWorkspace({ async integrate() { assert.equal(f.raw.inTransaction, false); return { outcome: "merged", sha }; } }) });
  const id = f.merge(); await f.work(); assert.equal(f.row(id).state, "merged");
});
for (const state of ["merged", "conflict", "skipped"]) test(`worker ignores ${state} row`, async t => {
  const f = integrationFixture(t), id = f.merge(undefined, { state }), before = f.row(id); assert.equal(await f.work(), false); assert.deepEqual(f.row(id), before); assert.equal(f.workspace.integrated.length, 0);
});
test("optional integrate method leaves pending rows alone", async t => {
  const f = integrationFixture(t, { workspace: mockWorkspace({ integrate: undefined }) }), id = f.merge(); assert.equal(await f.work(), false); assert.equal(f.row(id).attempts, 0);
});
test("database failures cannot escape worker", async t => {
  const f = integrationFixture(t); f.raw.exec("DROP TABLE integration_merges"); await assert.doesNotReject(f.work());
});
test("bookkeeping failure releases claim and rolls back completion", async t => {
  const f = integrationFixture(t), id = f.merge();
  f.raw.exec("CREATE TRIGGER reject_merge BEFORE UPDATE ON integration_merges BEGIN SELECT RAISE(ABORT,'bookkeeping'); END");
  await assert.doesNotReject(f.work()); assert.equal(f.row(id).state, "pending"); f.raw.exec("DROP TRIGGER reject_merge");
  await f.work(); assert.equal(f.row(id).state, "merged"); assert.equal(f.workspace.integrated.length, 2);
});
test("dispatcher pumps integration even without queued attempts", async t => {
  const f = integrationFixture(t), id = f.merge(); f.dispatcher.kick(); await f.dispatcher.idle(); assert.equal(f.row(id).state, "merged");
});
test("dispatcher drains multiple integration rows", async t => {
  const f = integrationFixture(t), ids = [f.merge(), f.merge(), f.merge()]; f.dispatcher.kick(); await f.dispatcher.idle(); for (const id of ids) assert.equal(f.row(id).state, "merged");
});
test("dispatcher never throws when integrate throws", async t => {
  const f = integrationFixture(t, { workspace: mockWorkspace({ async integrate() { throw Error("git failed"); } }) }), id = f.merge();
  f.dispatcher.kick(); await assert.doesNotReject(f.dispatcher.idle()); assert.equal(f.row(id).state, "conflict"); assert.equal(f.row(id).attempts, 3); assert.deepEqual(f.errors, []);
});

test("a row resolved by someone else while git ran is left untouched: no extra revision or event", async t => {
  let f;
  const workspace = mockWorkspace({ async integrate() {
    f.raw.prepare("UPDATE integration_merges SET state='skipped',resolved_at=? WHERE task_id=?").run(f.clock().toISOString(), f.id);
    return { outcome: "merged", sha };
  } });
  f = integrationFixture(t, { workspace }); f.id = f.merge();
  const before = f.getTask(f.id).revision, events = f.raw.prepare("SELECT COUNT(*) AS n FROM event_log").get().n;
  await f.work();
  assert.equal(f.row(f.id).state, "skipped"); assert.equal(f.row(f.id).merge_sha, null);
  assert.equal(f.getTask(f.id).revision, before);
  assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM event_log").get().n, events);
});
