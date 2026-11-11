// C1a contracts: cross-team request tools and operator commands.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import * as c from "@factory/contracts";

const id = () => randomUUID();
const create = (patch = {}) => ({ kind: "consult", targetTeamId: id(), subject: "Need advice", ask: "How should we split it?",
  expectedResponse: { form: "answer", format: "Markdown", acceptance: ["Names the trade-offs"] }, ...patch });

test("request.create applies defaults and accepts every kind", () => {
  for (const kind of ["clarify", "consult", "produce", "review", "decision", "notify"]) assert.ok(c.requestCreateInputSchema.safeParse(create({ kind })).success);
  const parsed = c.requestCreateInputSchema.parse(create());
  assert.equal(parsed.responseMode, "async"); assert.deepEqual(parsed.contextRefs, []);
});
test("request.create rejects unknown fields, kinds and bad sizes", () => {
  const bad = [create({ extra: 1 }), create({ kind: "other" }), create({ targetTeamId: "nope" }), create({ ask: "" }), create({ ask: "x".repeat(2001) }),
    create({ responseMode: "sync" }), create({ excerpt: "x".repeat(1001) }), create({ contextRefs: Array.from({ length: 21 }, () => ({ artifactId: id(), version: 1 })) }),
    create({ expectedResponse: { form: "answer", format: "x", acceptance: Array.from({ length: 9 }, () => "a") } }),
    create({ expectedResponse: { form: "answer", format: "x", acceptance: [""] } }),
    create({ expectedResponse: { form: "other", format: "x", acceptance: [] } }),
    create({ expectedResponse: { form: "answer", format: "x".repeat(201), acceptance: [] } }),
    create({ expectedResponse: { form: "answer", format: "x", acceptance: [], extra: true } })];
  for (const value of bad) assert.equal(c.requestCreateInputSchema.safeParse(value).success, false);
});
test("request.create accepts the largest valid sizes", () => {
  const value = create({ ask: "x".repeat(2000), excerpt: "y".repeat(1000), contextRefs: Array.from({ length: 20 }, () => ({ artifactId: id(), version: 1 })),
    expectedResponse: { form: "artifact", format: "f".repeat(200), acceptance: Array.from({ length: 8 }, () => "a".repeat(500)) } });
  assert.ok(c.requestCreateInputSchema.safeParse(value).success);
});
test("request.reply requires a message except for accept", () => {
  const requestId = id();
  assert.ok(c.requestReplyInputSchema.safeParse({ requestId, action: "accept" }).success);
  for (const action of ["message", "request-changes"]) {
    assert.equal(c.requestReplyInputSchema.safeParse({ requestId, action }).success, false);
    assert.equal(c.requestReplyInputSchema.safeParse({ requestId, action, message: "   " }).success, false);
    assert.ok(c.requestReplyInputSchema.safeParse({ requestId, action, message: "ok" }).success);
  }
  assert.equal(c.requestReplyInputSchema.safeParse({ requestId, action: "message", message: "x".repeat(2001) }).success, false);
  assert.equal(c.requestReplyInputSchema.safeParse({ requestId, action: "bogus", message: "x" }).success, false);
  assert.equal(c.requestReplyInputSchema.safeParse({ requestId: "bad", action: "accept" }).success, false);
});
test("request.get takes only a request id", () => {
  assert.ok(c.requestGetInputSchema.safeParse({ requestId: id() }).success);
  assert.equal(c.requestGetInputSchema.safeParse({ requestId: id(), extra: 1 }).success, false);
  assert.equal(c.requestGetInputSchema.safeParse({}).success, false);
});
test("the request tools are part of the agent tool surface", () => {
  for (const name of ["request.create", "request.reply", "request.get"]) assert.ok(c.MCP_TOOL_NAMES.includes(name));
});
const command = (type, payload) => c.commandSchema.safeParse({ apiVersion: 1, commandId: id(), projectId: id(), type, payload });
test("requests.triage validates decision, reason and optional targets", () => {
  const base = { requestTaskId: id(), reason: "Because" };
  for (const decision of ["accept", "need-info", "decline", "redirect", "merge"]) assert.ok(command("requests.triage", { ...base, decision }).success);
  assert.ok(command("requests.triage", { ...base, decision: "redirect", redirectTeamId: id() }).success);
  assert.ok(command("requests.triage", { ...base, decision: "merge", mergeIntoTaskId: id() }).success);
  assert.ok(command("requests.triage", { ...base, decision: "accept", ownerSeatId: id() }).success);
  for (const bad of [{ ...base, decision: "other" }, { ...base, decision: "accept", reason: "" }, { ...base, decision: "accept", reason: "x".repeat(1001) },
    { ...base, decision: "accept", extra: 1 }, { requestTaskId: "bad", reason: "x", decision: "accept" }, { reason: "x", decision: "accept" }])
    assert.equal(command("requests.triage", bad).success, false);
});
test("requests.message validates text", () => {
  assert.ok(command("requests.message", { requestTaskId: id(), text: "Note" }).success);
  for (const bad of [{ requestTaskId: id(), text: "" }, { requestTaskId: id(), text: "x".repeat(2001) }, { requestTaskId: id(), text: "a", extra: 1 }, { text: "a" }])
    assert.equal(command("requests.message", bad).success, false);
});
