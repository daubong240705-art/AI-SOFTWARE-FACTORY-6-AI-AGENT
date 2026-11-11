import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { notificationViewSchema, notificationCategorySchema, notificationUrgencySchema, commandSchema, FOUNDATION_COMMANDS,
  REMINDER_FRACTIONS, QUIET_HOURS, DIGEST_HOUR, PUSH_MAX_ATTEMPTS, PUSH_RETRY_MS } from "../dist/index.js";
const view = () => ({ id: randomUUID(), category: "action", urgency: "normal", title: "Approval needed", body: "Details", entityKind: "approval", entityId: randomUUID(), state: "unread", createdAt: "2026-11-10T00:00:00Z", readAt: null });
test("AP-8 notification constants", () => { assert.deepEqual(REMINDER_FRACTIONS, [0.5, 0.9]); assert.deepEqual(QUIET_HOURS, { startHour: 22, endHour: 7 }); assert.equal(DIGEST_HOUR, 18); assert.equal(PUSH_MAX_ATTEMPTS, 3); assert.equal(PUSH_RETRY_MS, 300000); });
for (const category of ["action", "important", "digest"]) test(`category ${category} allowed`, () => assert.equal(notificationCategorySchema.parse(category), category));
for (const urgency of ["normal", "urgent"]) test(`urgency ${urgency} allowed`, () => assert.equal(notificationUrgencySchema.parse(urgency), urgency));
test("valid notification view", () => { const input = view(); assert.deepEqual(notificationViewSchema.parse(input), input); });
for (const patch of [{ title: "" }, { title: "x".repeat(201) }, { body: "x".repeat(1001) }, { id: "bad" }, { category: "bad" }, { urgency: "bad" }, { state: "read" }, { state: "dismissed" }, { readAt: "2026-11-10T00:00:00Z" }, { extra: true }]) test(`invalid notification view ${Object.keys(patch).join()}/${JSON.stringify(patch).length}`, () => assert.equal(notificationViewSchema.safeParse({ ...view(), ...patch }).success, false));
for (const state of ["read", "dismissed"]) test(`read timestamp valid for ${state}`, () => assert.equal(notificationViewSchema.safeParse({ ...view(), state, readAt: "2026-11-10T00:00:00Z" }).success, true));
for (const type of ["notifications.mark-read", "notifications.dismiss"]) {
  const command = payload => ({ apiVersion: 1, projectId: randomUUID(), commandId: randomUUID(), type, payload });
  test(`${type} registered once`, () => { assert.equal(FOUNDATION_COMMANDS.filter(x => x === type).length, 1); assert.equal(commandSchema.safeParse(command({ notificationId: randomUUID() })).success, true); });
  for (const payload of [{}, { notificationId: "bad" }, { notificationId: randomUUID(), actor: "operator" }]) test(`${type} rejects malformed payload ${Object.keys(payload).join()}`, () => assert.equal(commandSchema.safeParse(command(payload)).success, false));
}
