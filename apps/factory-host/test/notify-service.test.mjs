import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { notifyFixture } from "./notify-fixture.mjs";
import { createNotification, listNotifications, notificationKey } from "../dist/notify/index.js";

test("notification insertion returns created and preserves initial state", t => {
  const f = notifyFixture(t), id = f.notify(); const row = f.rows()[0];
  assert.equal(row.id, id); assert.equal(row.state, "unread"); assert.equal(row.read_at, null); assert.equal(row.created_at, f.clock().toISOString());
});
test("service returns false on duplicate key without replacing content", t => {
  const f = notifyFixture(t), input = { projectId: f.projectId, id: randomUUID(), dedupKey: "same", category: "action", urgency: "normal", title: "First", body: "Body", now: f.clock() };
  assert.deepEqual(createNotification(f.raw, input), { created: true });
  assert.deepEqual(createNotification(f.raw, { ...input, id: randomUUID(), title: "Second" }), { created: false });
  assert.equal(f.rows()[0].title, "First"); assert.equal(f.rows().length, 1);
});
for (const [title, expected] of [["sk-syntheticfixture", "[redacted]"], ["fpx_syntheticfixture", "[redacted]"], ["C:\\private\\report.txt", "[path]"], ["/private/report.txt", "[path]"], ["\\\\server\\share", "[path]"], ["a\u0000b", "a b"], ["a\u202eb", "a b"]]) {
  test(`service sanitizes synthetic input ${JSON.stringify(title)}`, t => {
    const f = notifyFixture(t); f.notify({ title, body: title }); assert.equal(f.rows()[0].title, expected); assert.equal(f.rows()[0].body, expected);
  });
}
for (const [field, limit] of [["title", 200], ["body", 1000]]) test(`service truncates ${field}`, t => {
  const f = notifyFixture(t); f.notify({ [field]: "x".repeat(limit + 30) }); assert.equal(f.rows()[0][field].length, limit);
});
test("empty title becomes a valid generic title", t => { const f = notifyFixture(t); f.notify({ title: "   " }); assert.equal(f.rows()[0].title, "Notification"); });
test("optional entity is stored or null", t => { const f = notifyFixture(t), id = randomUUID(); f.notify(); f.notify({ entity: { kind: "task", id } }); assert.equal(f.rows()[0].entity_kind, null); assert.equal(f.rows()[1].entity_id, id); });
test("same dedup key is isolated by project", t => { const f = notifyFixture(t), other = f.project(); f.notify({ dedupKey: "same" }); f.notify({ projectId: other, dedupKey: "same" }); assert.equal(f.rows().length, 1); assert.equal(f.rows(other).length, 1); });
test("tuple keys cannot collide through separators", () => { assert.notEqual(notificationKey("a:b", "c"), notificationKey("a", "b:c")); assert.notEqual(notificationKey("a", 1), notificationKey("a", "1")); });
test("duplicate key never resets read or dismissed state", t => { const f = notifyFixture(t), id = f.notify({ dedupKey: "key" }); f.command("dismiss", id); f.notify({ dedupKey: "key" }); assert.equal(f.rows()[0].state, "dismissed"); assert.equal(f.rows().length, 1); });
test("service list reads newest first and caps at hundred while counting all unread", t => { const f = notifyFixture(t); for (let i = 0; i < 103; i++) f.notify({ title: `Item ${i}` }); const result = listNotifications(f.raw, f.projectId); assert.equal(result.items.length, 100); assert.equal(result.items[0].title, "Item 102"); assert.equal(result.unread, 103); });
