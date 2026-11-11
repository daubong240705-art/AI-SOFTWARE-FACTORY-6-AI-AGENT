import assert from "node:assert/strict";
import { test } from "node:test";
import { notifyFixture } from "./notify-fixture.mjs";
const start = Date.parse("2026-11-10T00:00:00Z"), ttl = 10 * 86400000;
for (const [fraction, expected] of [[0, 0], [0.499, 0], [0.5, 1], [0.501, 1], [0.899, 1], [0.9, 2], [0.901, 2], [1, 2]]) {
  test(`approval reminder boundary ${fraction}`, async t => { const f = notifyFixture(t); f.approval(); await f.tick(new Date(start + ttl * fraction)); const reminders = f.rows().filter(x => x.title.startsWith("Approval reminder")); assert.equal(reminders.length, expected); });
}
for (const [remaining, urgency] of [[86400001, "normal"], [86400000, "urgent"], [86399999, "urgent"], [1, "urgent"], [-1, "urgent"]]) test(`approval urgency with ${remaining} ms left`, async t => {
  const f = notifyFixture(t); f.approval({ requestedAt: new Date(start - ttl).toISOString(), expiresAt: new Date(start + remaining).toISOString() }); await f.tick(); assert.equal(f.rows().find(x => x.title.startsWith("Approval needed")).urgency, urgency);
});
test("50 percent reminder is normal and 90 percent is urgent", async t => { const f = notifyFixture(t); f.approval(); await f.tick(new Date(start + ttl * 0.9)); assert.equal(f.rows().find(x => x.title.startsWith("Approval reminder (50%)")).urgency, "normal"); assert.equal(f.rows().find(x => x.title.startsWith("Approval reminder (90%)")).urgency, "urgent"); });
test("decided approval skips both reminders", async t => { const f = notifyFixture(t), id = f.approval(); f.decide(id); await f.tick(new Date(start + ttl * 0.9)); assert.equal(f.rows().filter(x => x.category === "action").length, 0); });
test("decision after first reminder skips the second", async t => { const f = notifyFixture(t), id = f.approval(); await f.tick(new Date(start + ttl * 0.5)); f.decide(id); await f.tick(new Date(start + ttl * 0.9)); assert.equal(f.rows().filter(x => x.title.startsWith("Approval reminder")).length, 1); });
test("requested approval gets initial notice but no pending reminders", async t => { const f = notifyFixture(t); f.approval({ state: "requested" }); await f.tick(new Date(start + ttl * 0.9)); assert.equal(f.rows().filter(x => x.category === "action").length, 1); });
test("reminders dedup across ticks and approval revisions", async t => { const f = notifyFixture(t), id = f.approval(); const now = new Date(start + ttl * 0.9); await f.tick(now); await f.tick(now); f.raw.prepare("UPDATE approvals SET revision=revision+1 WHERE id=?").run(id); await f.tick(now); assert.equal(f.rows().filter(x => x.title.startsWith("Approval reminder")).length, 2); assert.equal(f.rows().filter(x => x.title.startsWith("Approval needed")).length, 2); });
