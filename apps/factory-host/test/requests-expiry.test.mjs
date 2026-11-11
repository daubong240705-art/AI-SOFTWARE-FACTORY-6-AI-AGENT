import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, blocked, attempts, wait } from "./requests-blocking-fixture.mjs";
import { snapshot } from "./requests-fixture.mjs";
import { expireRequests, WAIT_CEILING_MS, TRIAGE_TTL_MS } from "../dist/requests/service.js";

for (const state of ["submitted", "need-info"]) for (const trigger of ["ttl", "needed-by"]) for (const kind of ["produce", "review", "decision", "notify"]) {
  test(`${state} ${kind} proposal expires by ${trigger}`, (t) => {
    const f = fixture(t); const r = f.create({ kind, ...(trigger === "needed-by" ? { neededBy: "2026-11-08T00:00:01.000Z" } : {}) });
    if (state === "need-info") f.triage(r.requestId, "need-info");
    expireRequests(f.deps, new Date(f.clock().getTime() + (trigger === "ttl" ? TRIAGE_TTL_MS + 1 : 1001)));
    assert.equal(f.getTask(r.requestId).state, "declined"); assert.equal(f.meta(r.requestId).triage_by, "system");
    assert.equal(f.meta(r.requestId).triage_reason, "expired"); assert.equal(f.view(r.requestId).thread.at(-1).text, "expired");
    const before = snapshot(f.raw); expireRequests(f.deps, new Date(f.clock().getTime() + TRIAGE_TTL_MS * 2)); assert.equal(snapshot(f.raw), before);
  });
}
test("expiry resumes a parked requester with expired outcome", async (t) => {
  const f = fixture(t); const r = await blocked(f);
  expireRequests(f.deps, new Date(f.clock().getTime() + TRIAGE_TTL_MS + 1));
  assert.equal(wait(f, r.grant, r.requestId).outcome, "expired"); assert.equal(attempts(f, r.grant.taskId).length, 2);
});
test("wait ceiling releases only the wait and leaves the CTR open", async (t) => {
  const f = fixture(t); const r = await blocked(f);
  expireRequests({ ...f.deps, waitCeilingMs: 100 }, new Date(f.clock().getTime() + 101));
  assert.equal(wait(f, r.grant, r.requestId).outcome, "timed-out"); assert.equal(f.getTask(r.requestId).state, "proposed");
  assert.equal(attempts(f, r.grant.taskId).length, 2);
});
test("wait ceiling default is twenty four hours", (t) => {
  const f = fixture(t); const r = f.create({ responseMode: "blocking" });
  expireRequests(f.deps, new Date(f.clock().getTime() + WAIT_CEILING_MS - 1)); assert.equal(wait(f, f.grant, r.requestId).outcome, null);
  expireRequests(f.deps, new Date(f.clock().getTime() + WAIT_CEILING_MS + 1)); assert.equal(wait(f, f.grant, r.requestId).outcome, "timed-out");
});
test("triage TTL can be lowered", (t) => {
  const f = fixture(t); const r = f.create(); expireRequests({ ...f.deps, triageTtlMs: 10 }, new Date(f.clock().getTime() + 11));
  assert.equal(f.getTask(r.requestId).state, "declined");
});
for (const kind of ["clarify", "consult"]) test(`accepted ${kind} never expires`, (t) => {
  const f = fixture(t); const r = f.create({ kind, neededBy: "2026-11-08T00:00:01.000Z" });
  const before = snapshot(f.raw); expireRequests(f.deps, new Date(f.clock().getTime() + TRIAGE_TTL_MS * 2)); assert.equal(snapshot(f.raw), before);
});
test("flag off sweep changes nothing", (t) => {
  const f = fixture(t); f.create({ responseMode: "blocking" }); const before = snapshot(f.raw);
  expireRequests({ ...f.deps, multiTeam: false }, new Date(f.clock().getTime() + TRIAGE_TTL_MS * 2)); assert.equal(snapshot(f.raw), before);
});
test("fresh proposals before TTL remain untouched", (t) => {
  const f = fixture(t); f.create(); const before = snapshot(f.raw); expireRequests(f.deps, new Date(f.clock().getTime() + TRIAGE_TTL_MS)); assert.equal(snapshot(f.raw), before);
});
