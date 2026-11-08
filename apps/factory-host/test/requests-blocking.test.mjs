import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fixture, until, live, blocked, attempts, wait } from "./requests-blocking-fixture.mjs";
import { refused, snapshot } from "./requests-fixture.mjs";
import { releaseWaiters } from "../dist/requests/service.js";
import { appendRequestMessage, listRequests } from "../dist/requests/service.js";
import { buildHandoff } from "../dist/dispatch/handoff.js";
import { createRequestsMcp } from "../dist/requests/mcp.js";

for (const kind of ["clarify", "consult", "produce", "review", "decision"]) {
  test(`${kind} blocking create parks and releases the node slot`, async (t) => {
    const f = fixture(t); const grant = await live(f); const before = f.dispatcher.status().nodeUsed;
    const r = await blocked(f, { kind }, grant);
    assert.equal(attempts(f, grant.taskId)[0].state, "parked");
    assert.ok(f.dispatcher.status().nodeUsed < before || ["clarify", "consult"].includes(kind));
    assert.equal(f.getTask(grant.taskId).state, "active");
    assert.equal(wait(f, grant, r.requestId).outcome, null);
    assert.equal(f.getTask(grant.taskId).holds[0].kind, "cross-team");
    assert.match(r.message, /resumed with the answer/);
  });
  for (const outcome of ["delivered", "declined", "cancelled", "expired", "timed-out"]) {
    test(`${kind} wait resumes once for ${outcome}`, async (t) => {
      const f = fixture(t); const r = await blocked(f, { kind });
      f.hub.transaction(() => releaseWaiters(f.deps, r.requestId, outcome));
      f.hub.transaction(() => releaseWaiters(f.deps, r.requestId, outcome));
      await until(() => attempts(f, r.grant.taskId).length === 2);
      const next = attempts(f, r.grant.taskId).at(-1);
      assert.equal(next.epoch, r.grant.epoch + 1); assert.equal(next.seatId, f.seat.id);
      assert.equal(wait(f, r.grant, r.requestId).outcome, outcome);
      assert.equal(f.getTask(r.grant.taskId).holds.length, 0);
      assert.match(buildHandoff(f.raw, f.projectId, r.grant.taskId), /Request results:/);
      if (outcome === "timed-out") assert.match(buildHandoff(f.raw, f.projectId, r.grant.taskId), /still open; continue without it or ask again/);
    });
  }
}
test("notify blocking refusal is atomic", (t) => {
  const f = fixture(t); refused(f, () => f.create({ kind: "notify", responseMode: "blocking" }), "notify cannot block");
});
test("three waits cap refuses a fourth atomically", (t) => {
  const f = fixture(t); for (let i = 0; i < 3; i++) f.create({ responseMode: "blocking", ask: `Ask ${i}` });
  refused(f, () => f.create({ responseMode: "blocking", ask: "Fourth" }), "too many blocking requests");
});
test("another unresolved wait prevents a replacement attempt", async (t) => {
  const f = fixture(t); const grant = await live(f);
  const first = f.create({ responseMode: "blocking", ask: "First" }, grant);
  const second = f.create({ responseMode: "blocking", ask: "Second" }, grant);
  await until(() => attempts(f, grant.taskId).at(-1).state === "parked");
  releaseWaiters(f.deps, first.requestId, "delivered"); assert.equal(attempts(f, grant.taskId).length, 1);
  releaseWaiters(f.deps, second.requestId, "delivered"); assert.equal(attempts(f, grant.taskId).length, 2);
});
test("dedup followers receive a durable wait", async (t) => {
  const f = fixture(t); const original = f.create(); const r = await blocked(f);
  assert.equal(r.merged, true); assert.equal(r.requestId, original.requestId);
  assert.equal(wait(f, r.grant, r.requestId).resolved_at, null);
});
test("blocking views include the waiting count and task reference", (t) => {
  const f = fixture(t); const r = f.create({ responseMode: "blocking" });
  assert.equal(f.view(r.requestId).waiting, 1); assert.equal(listRequests(f.raw, f.projectId)[0].waiting, 1);
  assert.equal(f.getTask(f.grant.taskId).holds[0].ref.kind, "task");
});
test("an answer before parking still resumes exactly once", async (t) => {
  const f = fixture(t); const grant = await live(f); const r = f.create({ responseMode: "blocking" }, grant);
  releaseWaiters(f.deps, r.requestId, "delivered");
  await until(() => attempts(f, grant.taskId).length === 2); assert.equal(attempts(f, grant.taskId)[0].state, "parked");
});
for (const decision of ["merge", "redirect"]) test(`${decision} transfers holds and waits`, async (t) => {
  const f = fixture(t); const r = await blocked(f); const target = f.create({ ask: "Other ask" });
  f.triage(r.requestId, decision, decision === "merge" ? { mergeIntoTaskId: target.requestId } : { redirectTeamId: f.secondTeam() });
  const id = decision === "merge" ? target.requestId : f.meta(r.requestId).redirected_to_task_id;
  assert.equal(wait(f, r.grant, r.requestId), undefined); assert.equal(wait(f, r.grant, id).outcome, null);
  assert.equal(f.getTask(r.grant.taskId).holds[0].ref.id, id); assert.equal(attempts(f, r.grant.taskId).length, 1);
  releaseWaiters(f.deps, id, "delivered"); assert.equal(attempts(f, r.grant.taskId).length, 2);
});
test("triage decline releases the parked requester", async (t) => {
  const f = fixture(t); const r = await blocked(f); f.triage(r.requestId, "decline");
  assert.equal(wait(f, r.grant, r.requestId).outcome, "declined"); assert.equal(attempts(f, r.grant.taskId).length, 2);
});
test("triage command replay has no extra resume", async (t) => {
  const f = fixture(t); const r = await blocked(f); const commandId = randomUUID();
  const payload = { requestTaskId: r.requestId, decision: "decline", reason: "Declined" };
  assert.equal(f.executeCtr("requests.triage", payload, commandId).status, 200);
  const before = snapshot(f.raw); assert.equal(f.executeCtr("requests.triage", payload, commandId).status, 200);
  assert.equal(snapshot(f.raw), before); assert.equal(attempts(f, r.grant.taskId).length, 2);
});
test("handoff sanitizes target text and limits total size", async (t) => {
  const f = fixture(t); const r = await blocked(f); const foreign = randomUUID();
  appendRequestMessage(f.raw, { projectId: f.projectId, requestTaskId: r.requestId, author: "target", text: `${foreign} /synthetic/file ${"answer ".repeat(600)}`, now: f.clock().toISOString() });
  releaseWaiters(f.deps, r.requestId, "delivered"); const handoff = buildHandoff(f.raw, f.projectId, r.grant.taskId);
  assert.ok(handoff.length <= 4000); assert.equal(handoff.includes(foreign), false); assert.equal(handoff.includes("/synthetic/file"), false);
  assert.ok(handoff.split("answer").length < 100);
});
test("flag off refuses blocking atomically", (t) => {
  const f = fixture(t, { enabled: false }); refused(f, () => f.create({ responseMode: "blocking" }), "multi-team is disabled");
});
test("MCP blocking result includes finish-turn instruction", (t) => {
  const f = fixture(t); const mcp = createRequestsMcp(f.deps);
  const result = mcp.call(f.grant, "request.create", { kind: "produce", targetTeamId: f.team, subject: "Advice", ask: "Explain", responseMode: "blocking", expectedResponse: { form: "answer", format: "Markdown", acceptance: [] } });
  assert.equal(result.isError, false); assert.match(result.content[0].text, /Finish your turn/);
});
