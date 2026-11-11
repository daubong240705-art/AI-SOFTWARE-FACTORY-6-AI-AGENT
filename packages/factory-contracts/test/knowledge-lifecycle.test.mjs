import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { commandSchema, FOUNDATION_COMMANDS, hostCapabilitiesSchema, artifactStatusSchema } from "../dist/index.js";

const payloads = {
  "artifacts.transition": { artifactId: randomUUID(), version: 1, to: "in-review", comment: "Review" },
  "artifacts.share": { artifactId: randomUUID(), version: 1, visibility: "shared" },
  "artifacts.clear-stale": { artifactId: randomUUID(), version: 1, becauseArtifactId: randomUUID(), becauseVersion: 2 },
};
const command = (type, payload) => ({ apiVersion: 1, projectId: randomUUID(), commandId: randomUUID(), type, payload });
for (const [type, payload] of Object.entries(payloads)) {
  test(`${type} is additive and advertised by the capability schema`, () => {
    assert.ok(FOUNDATION_COMMANDS.includes(type)); assert.equal(commandSchema.safeParse(command(type, payload)).success, true);
    assert.equal(hostCapabilitiesSchema.safeParse({ apiVersion: 1, hostId: randomUUID(), commands: [type] }).success, true);
  });
  for (const version of [0, -1, 1.5, "1", null]) test(`${type} rejects invalid version ${String(version)}`, () => {
    assert.equal(commandSchema.safeParse(command(type, { ...payload, version })).success, false);
  });
  test(`${type} rejects actor and artifact revision fields`, () => {
    for (const fields of [{ actorId: randomUUID() }, { expectedRevision: 1 }])
      assert.equal(commandSchema.safeParse(command(type, { ...payload, ...fields })).success, false);
  });
}
for (const to of artifactStatusSchema.options) test(`transition accepts contract status ${to}`, () => {
  assert.equal(commandSchema.safeParse(command("artifacts.transition", { ...payloads["artifacts.transition"], to })).success, true);
});
test("transition comment is required and bounded", () => {
  const { comment, ...payload } = payloads["artifacts.transition"];
  assert.equal(commandSchema.safeParse(command("artifacts.transition", payload)).success, false);
  for (const length of [0, 4000, 4001]) assert.equal(commandSchema.safeParse(command("artifacts.transition", { ...payload, comment: "x".repeat(length) })).success, length <= 4000);
});
test("sharing uses the public shared visibility name", () => {
  for (const visibility of ["team-draft", "project", "shared", "organization", "other"])
    assert.equal(commandSchema.safeParse(command("artifacts.share", { ...payloads["artifacts.share"], visibility })).success,
      ["team-draft", "project", "shared"].includes(visibility));
});
test("clear stale requires a pinned because artifact and positive integer version", () => {
  for (const fields of [{ becauseArtifactId: "invalid" }, { becauseVersion: 0 }, { becauseVersion: 1.5 }])
    assert.equal(commandSchema.safeParse(command("artifacts.clear-stale", { ...payloads["artifacts.clear-stale"], ...fields })).success, false);
});
