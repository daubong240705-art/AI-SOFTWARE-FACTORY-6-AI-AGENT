import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { commandSchema, FOUNDATION_COMMANDS, hostCapabilitiesSchema } from "../dist/index.js";

for (const type of ["integration.retry", "integration.skip"]) {
  const command = payload => ({ apiVersion: 1, commandId: randomUUID(), projectId: randomUUID(), type, payload });
  test(`${type} accepts only task identity`, () => { const payload = { taskId: randomUUID() }; assert.deepEqual(commandSchema.parse(command(payload)).payload, payload); });
  test(`${type} is registered exactly once`, () => assert.equal(FOUNDATION_COMMANDS.filter(x => x === type).length, 1));
  test(`${type} can be advertised by the Host`, () => assert.equal(hostCapabilitiesSchema.safeParse({ apiVersion: 1, hostId: randomUUID(), commands: [type] }).success, true));
  for (const payload of [{}, { taskId: "" }, { taskId: randomUUID(), expectedRevision: 1 }, { taskId: randomUUID(), actorId: "operator" }, { taskId: randomUUID(), branch: "factory/other" }])
    test(`${type} refuses unsupported payload ${Object.keys(payload).join(",")}`, () => assert.equal(commandSchema.safeParse(command(payload)).success, false));
}
