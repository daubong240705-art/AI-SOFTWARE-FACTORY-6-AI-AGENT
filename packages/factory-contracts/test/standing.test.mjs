import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { STANDING_ACTION_KINDS, STANDING_FORBIDDEN, STANDING_MAX_DAYS, STANDING_DEFAULT_LIMIT_PER_DAY,
  STANDING_EXPIRY_WARNING_DAYS, standingCreateSchema, standingRevokeSchema, standingActionKindSchema,
  notifySendInternalInputSchema, commandSchema, entityKindSchema, FOUNDATION_COMMANDS, MCP_TOOLS, MCP_TOOL_NAMES } from "../dist/index.js";

const input = (patch = {}) => ({ standingId: randomUUID(), actionKind: "notify.send-internal", scope: { kind: "project", ref: randomUUID() }, expiresAt: "2026-12-01T00:00:00.000Z", ...patch });
test("AP-8 standing defaults", () => { assert.equal(STANDING_MAX_DAYS, 30); assert.equal(STANDING_DEFAULT_LIMIT_PER_DAY, 5); assert.equal(STANDING_EXPIRY_WARNING_DAYS, 3); });
test("standing action kinds are closed", () => assert.deepEqual(STANDING_ACTION_KINDS, ["notify.send-internal", "deploy.staging", "artifact.publish-to-project"]));
test("forbidden action kinds document the always-Operator rule", () => assert.deepEqual(STANDING_FORBIDDEN, ["deploy.production", "spend-money", "publish-external", "delete-data"]));
for (const actionKind of STANDING_ACTION_KINDS) test(`contract accepts ${actionKind}`, () => assert.equal(standingCreateSchema.parse(input({ actionKind })).actionKind, actionKind));
for (const actionKind of STANDING_FORBIDDEN) test(`contract refuses ${actionKind} with rule`, () => {
  const r = standingCreateSchema.safeParse(input({ actionKind })); assert.equal(r.success, false);
  assert.match(r.error.issues[0].message, /STANDING_FORBIDDEN/); assert.ok(r.error.issues[0].message.includes(actionKind));
});
test("unknown kind is refused", () => assert.equal(standingActionKindSchema.safeParse("unknown").success, false));
test("daily limit defaults to five", () => assert.equal(standingCreateSchema.parse(input()).limitPerDay, 5));
for (const limitPerDay of [1, 5, 50]) test(`daily limit accepts ${limitPerDay}`, () => assert.equal(standingCreateSchema.parse(input({ limitPerDay })).limitPerDay, limitPerDay));
for (const limitPerDay of [0, -1, 51, 1.5, "5"]) test(`daily limit rejects ${limitPerDay}`, () => assert.equal(standingCreateSchema.safeParse(input({ limitPerDay })).success, false));
for (const maxTokensPerUse of [1, 50000]) test(`token cap accepts ${maxTokensPerUse}`, () => assert.equal(standingCreateSchema.parse(input({ maxTokensPerUse })).maxTokensPerUse, maxTokensPerUse));
for (const maxTokensPerUse of [0, -1, 0.5, null]) test(`token cap rejects ${maxTokensPerUse}`, () => assert.equal(standingCreateSchema.safeParse(input({ maxTokensPerUse })).success, false));
for (const scope of [{ kind: "team", ref: randomUUID() }, { kind: "project", ref: randomUUID() }]) test(`scope accepts ${scope.kind}`, () => assert.deepEqual(standingCreateSchema.parse(input({ scope })).scope, scope));
for (const patch of [{ standingId: "bad" }, { expiresAt: "tomorrow" }, { scope: { kind: "organization", ref: randomUUID() } }, { scope: { kind: "team", ref: "bad" } }, { scope: { kind: "team", ref: randomUUID(), extra: true } }, { extra: true }]) test(`create closed input ${JSON.stringify(patch)}`, () => assert.equal(standingCreateSchema.safeParse(input(patch)).success, false));
for (const type of ["standing-approvals.create", "standing-approvals.revoke"]) test(`${type} registered exactly once`, () => {
  assert.equal(FOUNDATION_COMMANDS.filter(x => x === type).length, 1);
  const payload = type.endsWith("create") ? input() : { standingId: randomUUID(), expectedRevision: 1 };
  assert.equal(commandSchema.safeParse({ apiVersion: 1, commandId: randomUUID(), projectId: randomUUID(), type, payload }).success, true);
});
for (const expectedRevision of [0, -1, 1.5, null]) test(`revoke rejects revision ${expectedRevision}`, () => assert.equal(standingRevokeSchema.safeParse({ standingId: randomUUID(), expectedRevision }).success, false));
test("standing entity is registered", () => assert.equal(entityKindSchema.parse("standing-approval"), "standing-approval"));
test("notify tool is registered with its closed schema", () => { assert.equal(MCP_TOOL_NAMES.filter(x => x === "notify.send-internal").length, 1); assert.equal(MCP_TOOLS["notify.send-internal"], notifySendInternalInputSchema); });
for (const [title, body, valid] of [["x", "", true], ["x".repeat(200), "x".repeat(1000), true], ["", "", false], ["x".repeat(201), "", false], ["x", "x".repeat(1001), false]]) test(`notify lengths ${title.length}/${body.length}`, () => assert.equal(notifySendInternalInputSchema.safeParse({ title, body }).success, valid));
for (const field of ["projectId", "teamId", "tokens", "id", "standingId"]) test(`notify refuses identity field ${field}`, () => assert.equal(notifySendInternalInputSchema.safeParse({ title: "Report", body: "", [field]: randomUUID() }).success, false));
