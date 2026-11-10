import assert from "node:assert/strict";
import { test } from "node:test";
import { integrationBlocked } from "../dist/integration/service.js";
import { integrationFixture, mockWorkspace, deferred, sha, tick, success } from "./integration-fixture.mjs";

for (const [state, blocked] of [["pending", true], ["conflict", true], ["merged", false], ["skipped", false], [null, false]]) test(`direct dependency ${state} gating`, async t => {
  const f = integrationFixture(t, { workspace: mockWorkspace({ integrate: undefined }) }), parent = f.task({ state: "done" }), id = f.task({ dependsOn: [parent] });
  if (state) f.merge(parent, { state });
  assert.equal(integrationBlocked(f.raw, f.projectId, id), blocked);
  const a = f.enqueue(id); await f.dispatcher.idle(); assert.equal(f.read(a).state, blocked ? "queued" : "succeeded");
});
for (const state of ["pending", "conflict"]) test(`unrelated ${state} merge does not block`, async t => {
  const f = integrationFixture(t, { workspace: mockWorkspace({ integrate: undefined }) }); f.merge(undefined, { state }); const a = f.enqueue(f.task());
  await f.dispatcher.idle(); assert.equal(f.read(a).state, "succeeded");
});
for (const state of ["pending", "conflict"]) test(`no workspace ignores dependency ${state}`, async t => {
  const f = integrationFixture(t, { workspace: false }), parent = f.merge(undefined, { state }), a = f.enqueue(f.task({ dependsOn: [parent] }));
  await f.dispatcher.idle(); assert.equal(f.read(a).state, "succeeded"); assert.equal(f.row(parent).state, state);
});
test("transitive dependency alone does not block", async t => {
  const f = integrationFixture(t, { workspace: mockWorkspace({ integrate: undefined }) }), first = f.merge(), parent = f.task({ state: "done", dependsOn: [first] });
  const a = f.enqueue(f.task({ dependsOn: [parent] })); await f.dispatcher.idle(); assert.equal(f.read(a).state, "succeeded");
});
test("any one of multiple direct dependencies blocks", async t => {
  const f = integrationFixture(t, { workspace: mockWorkspace({ integrate: undefined }) }), first = f.merge(undefined, { state: "merged" }), second = f.merge(undefined, { state: "conflict" });
  const a = f.enqueue(f.task({ dependsOn: [first, second] })); await f.dispatcher.idle(); assert.equal(f.read(a).state, "queued");
});
test("pending async merge fences dependency work until completion", async t => {
  const hold = deferred(), entered = deferred(); const f = integrationFixture(t, { workspace: mockWorkspace({ async integrate() { entered.resolve(); await hold.promise; return { outcome: "merged", sha }; } }) });
  const parent = f.merge(), a = f.enqueue(f.task({ dependsOn: [parent] })); await entered.promise; await tick();
  assert.equal(f.read(a).state, "queued"); assert.equal(f.workspace.prepared.length, 0); hold.resolve();
  await f.dispatcher.idle(); assert.equal(f.row(parent).state, "merged"); assert.equal(f.read(a).state, "succeeded");
});
test("skip releases queued dependent on the next pump", async t => {
  const f = integrationFixture(t), parent = f.merge(undefined, { state: "conflict" }), a = f.enqueue(f.task({ dependsOn: [parent] }));
  await f.dispatcher.idle(); assert.equal(f.read(a).state, "queued"); success(f.command("integration.skip", parent));
  f.dispatcher.kick(); await f.dispatcher.idle(); assert.equal(f.read(a).state, "succeeded"); assert.equal(f.workspace.integrated.length, 0);
});
test("retry merges and then releases queued dependent", async t => {
  const f = integrationFixture(t), parent = f.merge(undefined, { state: "conflict" }), a = f.enqueue(f.task({ dependsOn: [parent] }));
  await f.dispatcher.idle(); success(f.command("integration.retry", parent)); f.dispatcher.kick(); await f.dispatcher.idle(); assert.equal(f.row(parent).state, "merged"); assert.equal(f.read(a).state, "succeeded");
});
