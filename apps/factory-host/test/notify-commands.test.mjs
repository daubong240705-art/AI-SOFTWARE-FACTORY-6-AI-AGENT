import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { notifyFixture } from "./notify-fixture.mjs";

for (const type of ["mark-read", "dismiss"]) {
  test(`${type} changes unread state and supplies timestamp`, t => { const f = notifyFixture(t), id = f.notify(); const result = f.command(type, id); assert.equal(result.status, 200); assert.equal(f.rows()[0].state, type === "dismiss" ? "dismissed" : "read"); assert.equal(f.rows()[0].read_at, f.clock().toISOString()); assert.equal(result.body.receipt.effects[0].kind, "notification"); });
  test(`${type} is idempotent across different commands`, t => { const f = notifyFixture(t), id = f.notify(); f.command(type, id); const before = f.rows()[0]; f.advance(1000); const result = f.command(type, id); assert.equal(result.status, 200); assert.deepEqual(result.body.receipt.effects, []); assert.deepEqual(f.rows()[0], before); });
  test(`${type} unknown id is not found`, t => { const f = notifyFixture(t), result = f.command(type, randomUUID()); assert.equal(result.status, 404); assert.equal(result.body.error.code, "not-found"); });
  test(`${type} unknown project is not found`, t => { const f = notifyFixture(t), id = f.notify(); assert.equal(f.command(type, id, randomUUID()).status, 404); assert.equal(f.rows()[0].state, "unread"); });
  test(`${type} cannot change another project's notification`, t => { const f = notifyFixture(t), id = f.notify(), other = f.project(); assert.equal(f.command(type, id, other).status, 404); assert.equal(f.rows()[0].state, "unread"); });
  test(`${type} command receipt replays`, t => { const f = notifyFixture(t), id = f.notify(), commandId = randomUUID(); f.command(type, id, f.projectId, commandId); const result = f.command(type, id, f.projectId, commandId); assert.equal(result.status, 200); assert.equal(result.replayed, true); });
}
test("read notification can be dismissed preserving first read time", t => { const f = notifyFixture(t), id = f.notify(); f.command("mark-read", id); const at = f.rows()[0].read_at; f.advance(1000); f.command("dismiss", id); assert.equal(f.rows()[0].state, "dismissed"); assert.equal(f.rows()[0].read_at, at); });
test("dismissed notification cannot return to read or unread", t => { const f = notifyFixture(t), id = f.notify(); f.command("dismiss", id); const result = f.command("mark-read", id); assert.equal(result.status, 200); assert.deepEqual(result.body.receipt.effects, []); assert.equal(f.rows()[0].state, "dismissed"); });
