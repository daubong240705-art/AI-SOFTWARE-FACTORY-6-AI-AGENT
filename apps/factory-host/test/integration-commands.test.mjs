import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { commandSchema, FOUNDATION_COMMANDS } from "@factory/contracts";
import { integrationFixture, success } from "./integration-fixture.mjs";

for (const [command, target] of [["integration.retry", "pending"], ["integration.skip", "skipped"]]) {
  test(`${command} resolves a conflict and emits task change`, t => {
    const f = integrationFixture(t), id = f.merge(undefined, { state: "conflict", attempts: 3, errorKind: "git-failed" }), revision = f.getTask(id).revision;
    const result = success(f.command(command, id)); assert.equal(f.row(id).state, target); assert.equal(f.row(id).error_kind, null);
    assert.equal(f.row(id).resolved_at, target === "skipped" ? f.clock().toISOString() : null);
    assert.deepEqual(result.body.receipt.effects, [{ kind: "task", id, revision: revision + 1 }]);
    assert.equal(f.row(id).attempts, target === "pending" ? 0 : 3);
  });
  test(`${command} is idempotent already ${target}`, t => {
    const f = integrationFixture(t), id = f.merge(undefined, { state: target }), before = f.row(id), revision = f.getTask(id).revision;
    assert.deepEqual(success(f.command(command, id)).body.receipt.effects, []); assert.deepEqual(f.row(id), before); assert.equal(f.getTask(id).revision, revision);
  });
  for (const state of ["merged", command === "integration.retry" ? "skipped" : "pending"]) test(`${command} refuses ${state}`, t => {
    const f = integrationFixture(t), id = f.merge(undefined, { state }), before = f.row(id), result = f.command(command, id);
    assert.equal(result.status, 409); assert.equal(result.body.error.code, "conflict"); assert.deepEqual(f.row(id), before);
  });
  test(`${command} unknown task is not-found`, t => { const f = integrationFixture(t), result = f.command(command, randomUUID()); assert.equal(result.status, 404); assert.equal(result.body.error.code, "not-found"); });
  test(`${command} known task without merge is conflict`, t => { const f = integrationFixture(t), result = f.command(command, f.task({ state: "done" })); assert.equal(result.status, 409); });
  test(`${command} wrong project is not-found`, t => { const f = integrationFixture(t), id = f.merge(undefined, { state: "conflict" }); assert.equal(f.command(command, id, { scope: f.project() }).status, 404); assert.equal(f.row(id).state, "conflict"); });
  for (const actor of ["agent", "team-lead", randomUUID()]) test(`${command} forbids actor ${actor === "agent" || actor === "team-lead" ? actor : "seat"}`, t => {
    const f = integrationFixture(t), id = f.merge(undefined, { state: "conflict" }), result = f.command(command, id, { actor }); assert.equal(result.status, 403); assert.equal(result.body.error.code, "forbidden"); assert.equal(f.row(id).state, "conflict");
  });
  test(`${command} replay returns stored receipt`, t => {
    const f = integrationFixture(t), id = f.merge(undefined, { state: "conflict" }), commandId = randomUUID(), first = success(f.command(command, id, { commandId }));
    const replay = f.command(command, id, { commandId }); assert.equal(replay.replayed, true); assert.deepEqual(replay.body, first.body);
  });
  test(`${command} is registered exactly once`, () => { assert.equal(FOUNDATION_COMMANDS.filter(x => x === command).length, 1); });
  for (const payload of [{}, { taskId: "bad" }, { taskId: randomUUID(), expectedRevision: 1 }, { taskId: randomUUID(), actor: "operator" }]) test(`${command} rejects invalid payload ${Object.keys(payload).join(",")}`, () => {
    assert.equal(commandSchema.safeParse({ apiVersion: 1, commandId: randomUUID(), projectId: randomUUID(), type: command, payload }).success, false);
  });
}
test("retry clears a previous resolution timestamp", t => {
  const f = integrationFixture(t), id = f.merge(undefined, { state: "conflict" }); f.raw.prepare("UPDATE integration_merges SET resolved_at=? WHERE task_id=?").run(f.clock().toISOString(), id);
  success(f.command("integration.retry", id)); assert.equal(f.row(id).resolved_at, null); assert.equal(f.row(id).attempts, 0);
});
