import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { commandSchema, FOUNDATION_COMMANDS } from "../dist/index.js";
const command = (type, payload) => ({ apiVersion: 1, commandId: randomUUID(), projectId: randomUUID(), type, payload });
const samples = {
  "teams.create-from-pack": { teamId: randomUUID(), packKey: "software-team", packVersion: "1.0.0" },
  "teams.set-lifecycle": { teamId: randomUUID(), expectedRevision: 1, lifecycle: "paused" },
  "engagements.update": { engagementId: randomUUID(), expectedRevision: 1, priority: 100, maxConcurrent: 32, state: "ended" },
  "seats.update": { seatId: randomUUID(), expectedRevision: 1, slots: 8 },
};
for (const [type, payload] of Object.entries(samples)) {
  test(`org contract accepts ${type} additively`, () => {
    assert.ok(FOUNDATION_COMMANDS.includes(type)); assert.deepEqual(commandSchema.parse(command(type, payload)).payload, payload);
  });
  test(`org contract rejects unknown fields in ${type}`, () => {
    assert.equal(commandSchema.safeParse(command(type, { ...payload, injected: true })).success, false);
  });
}
for (const [field, values] of [["priority", [-1, 101, 1.5]], ["maxConcurrent", [0, 33, 1.5]]])
  for (const [i, value] of values.entries()) test(`org contract rejects engagement ${field} boundary ${i}`, () => {
    assert.equal(commandSchema.safeParse(command("engagements.update", { ...samples["engagements.update"], [field]: value })).success, false);
  });
for (const [i, slots] of [0, 9, 1.5].entries()) test(`org contract rejects seat slots boundary ${i}`, () => {
  assert.equal(commandSchema.safeParse(command("seats.update", { ...samples["seats.update"], slots })).success, false);
});
test("org contract accepts partial updates", () => {
  assert.equal(commandSchema.safeParse(command("engagements.update", { engagementId: randomUUID(), expectedRevision: 1, state: "active" })).success, true);
  assert.equal(commandSchema.safeParse(command("seats.update", { seatId: randomUUID(), expectedRevision: 1 })).success, true);
});
