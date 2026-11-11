import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelError } from "../dist/models/gateway.js";
import { proxyFixture, body, completion, gate, open, expectStatus } from "./breaker-fixture.mjs";

for (const status of [500, 502, 503, 504, 429]) test(`proxy records HTTP ${status} as failure`, async t => {
  const f = await proxyFixture(t, { respond: () => new Response("rejected", { status }) });
  await f.inject(); assert.deepEqual(f.outcomes, [["approved", "fail"]]); assert.equal(f.rows().length, 0);
});
for (const status of [400, 401, 403, 404, 422]) test(`proxy ignores client HTTP ${status}`, async t => {
  const f = await proxyFixture(t, { respond: () => new Response("rejected", { status }) });
  for (let i = 0; i < 6; i++) await f.inject();
  assert.deepEqual(f.outcomes, []); assert.equal(f.breaker.snapshot()[0].windowSize, 0); assert.equal(f.calls(), 6);
});
for (const kind of ["network", "timeout"]) test(`proxy records ${kind} error`, async t => {
  const f = await proxyFixture(t, { respond: () => { throw kind === "network" ? new TypeError("network") : new ModelError("timeout"); } });
  expectStatus(await f.inject(), kind === "timeout" ? 504 : 502); assert.deepEqual(f.outcomes, [["approved", "fail"]]);
});
test("proxy records completed 2xx exactly once", async t => { const f = await proxyFixture(t); expectStatus(await f.inject(), 200); assert.deepEqual(f.outcomes, [["approved", "ok"]]); });
test("proxy opens after five upstream failures and refuses sixth", async t => {
  const f = await proxyFixture(t, { respond: () => new Response("", { status: 500 }) });
  for (let i = 0; i < 5; i++) expectStatus(await f.inject(), 502);
  expectStatus(await f.inject(), 503, "route_circuit_open"); assert.equal(f.calls(), 5); assert.equal(f.proxy.inflight(), 0); assert.equal(f.rows().length, 0);
});
test("refusals do not spend request allowance or reserve budget", async t => {
  const f = await proxyFixture(t, { maxRequestsPerAttempt: 1 }); open(f.breaker);
  for (let i = 0; i < 6; i++) { expectStatus(await f.inject(), 503, "route_circuit_open"); assert.equal(f.proxy.inflight(), 0); }
  assert.equal(f.calls(), 0); assert.equal(f.rows().length, 0); f.advance(300000); expectStatus(await f.inject(), 200); assert.equal(f.calls(), 1);
});
test("validation precedes the open breaker", async t => { const f = await proxyFixture(t); open(f.breaker); expectStatus(await f.inject({ model: "approved" }), 400, "invalid_request"); assert.equal(f.calls(), 0); });
test("model allowlist precedes breaker", async t => { const f = await proxyFixture(t); open(f.breaker, "unknown"); expectStatus(await f.inject(body({ model: "unknown" })), 403, "model_not_allowed"); assert.equal(f.calls(), 0); });
test("other model still reaches upstream", async t => { const f = await proxyFixture(t); open(f.breaker); expectStatus(await f.inject(body({ model: "other" })), 200); assert.deepEqual(f.outcomes, [["other", "ok"]]); });
test("single proxy half-open trial refuses concurrent caller", async t => {
  const entered = gate(), finish = gate(); const f = await proxyFixture(t, { respond: async () => { entered.resolve(); await finish.promise; return completion(); } });
  open(f.breaker); f.advance(300000); const first = f.inject(); await entered.promise;
  expectStatus(await f.inject(), 503, "route_circuit_open"); assert.equal(f.calls(), 1); assert.equal(f.proxy.inflight(), 1);
  finish.resolve(); expectStatus(await first, 200); assert.equal(f.breaker.snapshot()[0].state, "closed"); assert.equal(f.proxy.inflight(), 0);
});
test("budget rejection releases half-open trial without reservation", async t => {
  const budget = { defaultDayTokens: 1, defaultTaskTokens: 1, warnAtPercent: 80, utcOffsetMinutes: 420 };
  const f = await proxyFixture(t, { budget }); open(f.breaker); f.advance(300000);
  for (let i = 0; i < 2; i++) expectStatus(await f.inject(), 429, "budget_exceeded");
  assert.equal(f.breaker.snapshot()[0].state, "open"); assert.equal(f.proxy.inflight(), 0); assert.equal(f.calls(), 0); assert.deepEqual(f.outcomes, []);
});
test("half-open client mistake releases the trial", async t => { const f = await proxyFixture(t, { respond: () => new Response("", { status: 400 }) }); open(f.breaker); f.advance(300000); await f.inject(); assert.deepEqual(f.outcomes, []); assert.equal(f.breaker.allow("approved").allowed, true); });
test("caller token revocation is not an upstream failure", async t => {
  const entered = gate(); const f = await proxyFixture(t, { respond: (_input, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new ModelError("cancelled")), { once: true }); entered.resolve();
  }) }); const pending = f.inject(); await entered.promise; f.tokens.revoke(f.attemptId); await pending;
  assert.deepEqual(f.outcomes, []); assert.equal(f.proxy.inflight(), 0);
});
test("request timeout counts once using injected timers", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const entered = gate();
  const f = await proxyFixture(t, { requestTimeoutMs: 1000, respond: (_input, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new ModelError("cancelled")), { once: true }); entered.resolve();
  }) }); const pending = f.inject(); await entered.promise; t.mock.timers.tick(1000);
  expectStatus(await pending, 504, "upstream_timeout"); assert.deepEqual(f.outcomes, [["approved", "fail"]]); assert.equal(f.proxy.inflight(), 0);
});
test("stream records success only at end", async t => {
  const reading = gate(); let controller;
  const f = await proxyFixture(t, { respond: () => new Response(new ReadableStream({ start(c) { controller = c; }, pull() { reading.resolve(); } }),
    { headers: { "content-type": "text/event-stream" } }) }); const pending = f.inject(body({ stream: true })); await reading.promise;
  assert.deepEqual(f.outcomes, []); controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\ndata: [DONE]\n\n')); controller.close();
  expectStatus(await pending, 200); assert.deepEqual(f.outcomes, [["approved", "ok"]]);
});
test("upstream stream error records a single failure", async t => {
  const f = await proxyFixture(t, { respond: () => new Response(new ReadableStream({ start(c) { c.error(new Error("stream failed")); } }),
    { headers: { "content-type": "text/event-stream" } }) }); await f.inject(body({ stream: true })); assert.deepEqual(f.outcomes, [["approved", "fail"]]);
});
test("caller disconnect does not record route health", async t => {
  const entered = gate(); const f = await proxyFixture(t, { respond: (_input, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new ModelError("cancelled")), { once: true }); entered.resolve();
  }) });
  f.proxy.app.addHook("preHandler", async (request) => { entered.promise.then(() => request.raw.emit("aborted")); });
  await f.inject(); assert.deepEqual(f.outcomes, []); assert.equal(f.proxy.inflight(), 0);
});
test("default proxy dependency opens without explicit breaker", async t => {
  const f = await proxyFixture(t, { routeBreaker: undefined, respond: () => new Response("", { status: 503 }) });
  for (let i = 0; i < 5; i++) await f.inject(); expectStatus(await f.inject(), 503, "route_circuit_open"); assert.equal(f.calls(), 5);
});
for (const ignored of [false, true]) test(`older request cannot ${ignored ? "release" : "complete"} a half-open trial`, async t => {
  const oldEntered = gate(), trialEntered = gate(), oldFinish = gate(), trialFinish = gate(); let calls = 0;
  const f = await proxyFixture(t, { respond: async () => {
    if (++calls === 1) { oldEntered.resolve(); await oldFinish.promise; return ignored ? new Response("", { status: 400 }) : completion(); }
    trialEntered.resolve(); await trialFinish.promise; return completion();
  } });
  const old = f.inject(); await oldEntered.promise; open(f.breaker); f.advance(300000);
  const trial = f.inject(); await trialEntered.promise; oldFinish.resolve(); await old;
  assert.equal(f.breaker.snapshot()[0].state, "half-open"); expectStatus(await f.inject(), 503, "route_circuit_open");
  trialFinish.resolve(); expectStatus(await trial, 200); assert.deepEqual(f.outcomes, [["approved", "ok"]]);
});
test("caller abort cannot become a timeout if upstream settles late", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const entered = gate(), finish = gate();
  const f = await proxyFixture(t, { requestTimeoutMs: 1000, respond: async () => { entered.resolve(); await finish.promise; return completion(); } });
  const pending = f.inject(); await entered.promise; f.tokens.revoke(f.attemptId); t.mock.timers.tick(1000); finish.resolve(); await pending;
  assert.deepEqual(f.outcomes, []); assert.equal(f.proxy.inflight(), 0);
});
