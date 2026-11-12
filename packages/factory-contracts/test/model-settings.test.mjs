import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { commandSchema, FOUNDATION_COMMANDS, hostCapabilitiesSchema, entityRefSchema } from "../dist/index.js";

const payload = { leadModel: "provider/lead", leadEffort: "high", agentModels: ["provider/default", "other"], expectedRevision: null };
const command = patch => ({ apiVersion: 1, commandId: randomUUID(), projectId: randomUUID(), type: "models.set", payload: { ...payload, ...patch } });
test("models.set is registered once, advertised and has a typed effect", () => {
  assert.equal(FOUNDATION_COMMANDS.filter(type => type === "models.set").length, 1);
  assert.deepEqual(commandSchema.parse(command()).payload, payload);
  assert.equal(hostCapabilitiesSchema.safeParse({ apiVersion: 1, hostId: randomUUID(), commands: ["models.set"] }).success, true);
  assert.equal(entityRefSchema.safeParse({ kind: "model-settings", id: randomUUID(), revision: 1 }).success, true);
});
for (const [label, patch] of [
  ["duplicates", { agentModels: ["a", "a"] }], ["empty list", { agentModels: [] }],
  ["empty model", { agentModels: [""] }], ["whitespace", { agentModels: ["a b"] }],
  ["newline", { agentModels: ["a\nb"] }], ["control", { agentModels: ["a\u0000b"] }],
  ["unicode whitespace", { agentModels: ["a\u00a0b"] }], ["too many", { agentModels: Array.from({ length: 9 }, (_, i) => `m${i}`) }],
  ["long model", { agentModels: ["a".repeat(257)] }], ["empty lead", { leadModel: "" }],
  ["lead whitespace", { leadModel: "a b" }], ["lead control", { leadModel: "a\u007fb" }],
  ["long lead", { leadModel: "a".repeat(257) }], ["effort", { leadEffort: "max" }],
  ["null effort", { leadEffort: null }], ["zero revision", { expectedRevision: 0 }],
  ["fraction revision", { expectedRevision: 1.5 }], ["credential field", { apiKey: "synthetic-not-a-credential" }],
]) test(`models.set rejects ${label}`, () => assert.equal(commandSchema.safeParse(command(patch)).success, false));
for (const leadEffort of ["low", "medium", "high", "xhigh"])
  test(`models.set accepts ${leadEffort} with eight 256-character unique models`, () => {
    assert.equal(commandSchema.safeParse(command({ leadEffort, leadModel: "a".repeat(256), expectedRevision: 2,
      agentModels: Array.from({ length: 8 }, (_, i) => String(i) + "a".repeat(255)) })).success, true);
  });
