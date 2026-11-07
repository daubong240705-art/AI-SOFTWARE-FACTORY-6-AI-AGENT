import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { test as nodeTest } from "node:test";
import { API_VERSION } from "@factory/contracts";
import { createUpstream } from "../dist/models/index.js";
import { createModelProxy, createTokenRegistry } from "../dist/proxy/index.js";
import { openStorage } from "../dist/storage/database.js";
import { EventHub } from "../dist/events/hub.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { loadPack, findLeadSeat, getActiveEngagement } from "../dist/org/index.js";
import { tasksCreateHandler } from "../dist/work/service.js";
import { createAttempt, moveTask } from "../dist/dispatch/index.js";
import { DEFAULT_BUDGET_CONFIG } from "../dist/policy/index.js";

const test = (name, fn) => nodeTest(name, { timeout: 15000 }, fn);
const key = "proxy-local-private-marker-9382";
const host = "127.0.0.1:8788";
const completion = (extra = {}) => ({ choices: [{ message: { content: "Answer" } }], ...extra });
const reported = { prompt_tokens: 20, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 5 }, completion_tokens_details: { reasoning_tokens: 3 } };
const body = (extra = {}) => ({ model: "approved", messages: [{ role: "user", content: "Question" }], max_tokens: 16, ...extra });
const gate = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const poll = async (predicate) => {
  const until = Date.now() + 4000;
  while (!predicate()) { if (Date.now() > until) throw new Error("Condition not reached"); await new Promise((resolve) => setTimeout(resolve, 5)); }
};
function safe(value, token) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert.equal(text.includes(key), false); if (token) assert.equal(text.includes(token), false);
}
async function fixture(t, { respond = (_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(completion())); }, ...extra } = {}) {
  const calls = []; const received = gate(); let closed = 0;
  const server = createServer(async (req, res) => {
    let text = ""; for await (const chunk of req) text += chunk;
    const call = { path: req.url, headers: req.headers, body: JSON.parse(text) };
    calls.push(call); received.resolve(call); res.on("close", () => closed++); respond(req, res, call);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const storage = openStorage(":memory:");
  storage.migrate({ migrationsDir: fileURLToPath(new URL("../migrations/", import.meta.url)), backupDir: null });
  const raw = storage.raw; let time = Date.parse("2026-11-07T10:00:00.000Z"); const clock = () => new Date(time);
  const tokens = createTokenRegistry({ clock, maxLifetimeMs: 5000 });
  const hub = new EventHub(raw, { clock });
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
    "projects.create": createProjectsCreateHandler({ pack: loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url))) }),
    "tasks.create": tasksCreateHandler,
  } });
  const projectId = randomUUID(); const taskId = randomUUID(); const attemptId = randomUUID();
  const execute = (type, payload) => assert.equal(pipeline.execute({ apiVersion: API_VERSION, commandId: randomUUID(), projectId, type, payload }).status, 200);
  execute("projects.create", { name: "Proxy project", workspace: { kind: "directory", root: `/workspace/${projectId}` } });
  execute("tasks.create", { taskId, code: "PROXY-001", title: "Proxy task", goal: "Deliver", brief: "Brief", parentTaskId: null,
    engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] });
  for (const state of ["accepted", "ready", "active"]) moveTask(raw, projectId, taskId, state);
  createAttempt(raw, { projectId, taskId, id: attemptId, seatId: findLeadSeat(raw, getActiveEngagement(raw, projectId).teamId).id,
    runtime: "fake", provider: "fake", model: "fake", effort: "medium", now: clock().toISOString() });
  const grant = { projectId, taskId, attemptId, epoch: 1, allowedModels: ["approved", "provider/other"] };
  const token = tokens.issue(grant).token;
  const upstream = createUpstream({ baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: key, providerId: "local" });
  const reservation = createServer(); await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const proxyPort = reservation.address().port; await new Promise((resolve) => reservation.close(resolve));
  const proxy = createModelProxy({ upstream, tokens, raw, clock, newId: randomUUID, allowedHosts: [host, `127.0.0.1:${proxyPort}`],
    budget: { ...DEFAULT_BUDGET_CONFIG, defaultTaskTokens: 1000000, defaultDayTokens: 2000000 }, ...extra });
  t.after(async () => { tokens.revokeAll(); await proxy.close(); storage.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const headers = { host, authorization: `Bearer ${token}`, "content-type": "application/json" };
  const inject = async (input = body(), overrides = {}) => {
    const response = await proxy.app.inject({ method: "POST", url: "/v1/chat/completions", headers, payload: input, ...overrides });
    safe(response.body, token); safe(response.headers, token); return response;
  };
  const rows = () => raw.prepare("SELECT * FROM usage_records").all();
  return { proxy, tokens, token, raw, calls, headers, inject, received: received.promise, grant, rows,
    advance: (ms) => { time += ms; }, closed: () => closed,
    async listen() { await proxy.app.listen({ port: proxyPort, host: "127.0.0.1" }); return `http://127.0.0.1:${proxy.app.server.address().port}`; } };
}
const rejected = (response, status, code) => { assert.equal(response.statusCode, status, response.body); assert.equal(response.json().error.code, code); };

test("proxy authenticates, lists only grant models, and adds security headers", async (t) => {
  const f = await fixture(t); const r = await f.inject(undefined, { method: "GET", url: "/v1/models", payload: undefined });
  assert.equal(r.statusCode, 200); assert.deepEqual(r.json().data.map((m) => m.id), f.grant.allowedModels);
  assert.equal(r.headers["cache-control"], "no-store"); assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.equal(r.headers["set-cookie"], undefined); assert.equal(r.headers["access-control-allow-origin"], undefined);
});
test("proxy missing malformed unknown revoked and expired auth have identical responses", async (t) => {
  const f = await fixture(t); const responses = [];
  for (const authorization of [undefined, "Basic garbled", "Bearer garbage", `Bearer fpx_${"A".repeat(43)}`]) {
    const headers = { ...f.headers }; if (authorization === undefined) delete headers.authorization; else headers.authorization = authorization;
    responses.push(await f.inject(body(), { headers }));
  }
  f.tokens.revoke(f.grant.attemptId); responses.push(await f.inject());
  const next = f.tokens.issue(f.grant).token; f.advance(5000);
  responses.push(await f.inject(body(), { headers: { ...f.headers, authorization: `Bearer ${next}` } }));
  for (const r of responses) { rejected(r, 401, "invalid_api_key"); assert.equal(r.body, responses[0].body); }
  assert.equal(f.calls.length, 0);
});
test("proxy rejects foreign Host before authentication", async (t) => {
  const f = await fixture(t); rejected(await f.inject(body(), { headers: { host: "evil.example" } }), 403, "forbidden"); assert.equal(f.calls.length, 0);
});
test("proxy rejects non JSON content types", async (t) => {
  const f = await fixture(t); rejected(await f.inject("text", { headers: { ...f.headers, "content-type": "text/plain" } }), 415, "invalid_request");
});
test("proxy enforces the body limit before forwarding", async (t) => {
  const f = await fixture(t, { maxBodyBytes: 64 }); rejected(await f.inject(), 413, "invalid_request"); assert.equal(f.calls.length, 0);
});
for (const [method, url] of [["GET", "/health"], ["GET", "/v1/chat/completions"], ["POST", "/v1/models"],
  ["HEAD", "/v1/models"], ["OPTIONS", "/v1/models"], ["DELETE", "/v1/chat/completions"]])
  test(`proxy exposes no route for ${method} ${url}`, async (t) => {
    const f = await fixture(t); const response = await f.inject(body(), { method, url }); assert.equal(response.statusCode, 404); assert.equal(f.calls.length, 0);
  });
for (const [label, model, status] of [["case variant", "Approved", 403], ["path variant", "approved/path", 403],
  ["whitespace variant", "approved ", 403], ["empty", "", 403], ["missing", undefined, 400], ["array", ["approved"], 400]])
  test(`proxy rejects ${label} model`, async (t) => {
    const f = await fixture(t); rejected(await f.inject(body({ model })), status, status === 403 ? "model_not_allowed" : "invalid_request"); assert.equal(f.calls.length, 0);
  });
test("proxy accepts an exact approved model containing a provider path", async (t) => {
  const f = await fixture(t); assert.equal((await f.inject(body({ model: "provider/other" }))).statusCode, 200);
  assert.equal(f.calls[0].body.model, "provider/other"); assert.equal(f.calls[0].headers.authorization, `Bearer ${key}`);
});
test("proxy rebuilds the allow listed request and strips nested unknown fields", async (t) => {
  const f = await fixture(t); const input = body({ metadata: { hidden: true }, user: "private", stream_options: { anything: true },
    messages: [{ role: "user", content: [{ type: "text", text: "Question", hidden: true }], hidden: true }], stream: false, temperature: 0.5, n: 1 });
  assert.equal((await f.inject(input)).statusCode, 200);
  assert.deepEqual(f.calls[0].body, { model: "approved", messages: [{ role: "user", content: [{ type: "text", text: "Question" }] }],
    max_tokens: 16, stream: false, temperature: 0.5, n: 1 });
});
for (const [label, extra] of [["multiple completions", { n: 2 }], ["invalid role", { messages: [{ role: "developer", content: "x" }] }],
  ["image part", { messages: [{ role: "user", content: [{ type: "image_url", image_url: "x" }] }] }],
  ["invalid effort", { reasoning_effort: "none" }], ["negative max", { max_tokens: -1 }], ["fractional max", { max_tokens: 1.5 }],
  ["wrong streaming type", { stream: "true" }], ["temperature range", { temperature: 3 }]])
  test(`proxy refuses ${label} shape`, async (t) => { const f = await fixture(t); rejected(await f.inject(body(extra)), 400, "invalid_request"); });
for (const [label, payload] of [["array", []], ["null", "null"], ["string", '"text"'], ["malformed", "{"]])
  test(`proxy rejects ${label} request body generically`, async (t) => { const f = await fixture(t); rejected(await f.inject(payload), 400, "invalid_request"); });
test("proxy forwards supported tool shapes and every optional scalar", async (t) => {
  const f = await fixture(t); const input = body({ messages: [
    { role: "assistant", content: "", tool_calls: [{ id: "call", type: "function", function: { name: "lookup", arguments: "{}" } }] },
    { role: "tool", content: "result", tool_call_id: "call", name: "lookup" }], tools: [{ type: "function", function: {
      name: "lookup", description: "Look up", parameters: { type: "object", properties: {} }, strict: true } }],
    tool_choice: { type: "function", function: { name: "lookup" } }, parallel_tool_calls: true, reasoning_effort: "high",
    top_p: 0.8, stop: ["END"], seed: 3, presence_penalty: -1, frequency_penalty: 1 });
  assert.equal((await f.inject(input)).statusCode, 200); assert.deepEqual(f.calls[0].body, input);
});
for (const field of ["max_tokens", "max_completion_tokens"])
  test(`proxy clamps ${field} and uses it for reservation`, async (t) => {
    const f = await fixture(t, { maxOutputTokens: 32 }); const input = body({ max_tokens: undefined, [field]: 900 });
    assert.equal((await f.inject(input)).statusCode, 200); assert.equal(f.calls[0].body[field], 32); assert.ok(f.rows()[0].estimated_tokens > 32);
  });
test("proxy supplies the output cap when no token limit is given", async (t) => {
  const f = await fixture(t, { maxOutputTokens: 32 }); await f.inject(body({ max_tokens: undefined })); assert.equal(f.calls[0].body.max_tokens, 32);
});
for (const scope of ["task", "day"]) test(`proxy refuses exhausted ${scope} budget before any upstream call`, async (t) => {
  const f = await fixture(t, { budget: { ...DEFAULT_BUDGET_CONFIG, defaultTaskTokens: scope === "task" ? 1 : 999999, defaultDayTokens: scope === "day" ? 1 : 999999 } });
  rejected(await f.inject(), 429, "budget_exceeded"); assert.equal(f.calls.length, 0); assert.equal(f.rows().length, 0);
});
test("proxy includes parallel in flight estimates in budget checks", async (t) => {
  const held = gate(); const limit = 2 * (Math.ceil(JSON.stringify(body().messages).length / 3) + 16) - 1;
  const f = await fixture(t, { respond: (_req, res) => held.promise.then(() => res.end(JSON.stringify(completion()))),
    budget: { ...DEFAULT_BUDGET_CONFIG, defaultTaskTokens: limit, defaultDayTokens: limit } });
  const first = f.inject(); await f.received; rejected(await f.inject(), 429, "budget_exceeded"); assert.equal(f.calls.length, 1);
  held.resolve(); assert.equal((await first).statusCode, 200); assert.equal(f.proxy.inflight(), 0);
});
test("proxy records reported usage with complete attempt attribution", async (t) => {
  const f = await fixture(t, { respond: (_req, res) => res.end(JSON.stringify(completion({ usage: reported }))) });
  const response = await f.inject(body({ reasoning_effort: "high" })); assert.equal(response.body, JSON.stringify(completion({ usage: reported })));
  const row = f.rows()[0]; assert.equal(row.project_id, f.grant.projectId); assert.equal(row.task_id, f.grant.taskId); assert.equal(row.attempt_id, f.grant.attemptId);
  assert.equal(row.conversation_id, null); assert.equal(row.provider, "local"); assert.equal(row.model, "approved"); assert.equal(row.effort, "high");
  assert.deepEqual([row.input_tokens, row.output_tokens, row.cached_input_tokens, row.reasoning_output_tokens, row.estimated_tokens], [20, 12, 5, 3, null]);
});
test("proxy records an estimate when usage is absent or incomplete", async (t) => {
  const f = await fixture(t, { respond: (_req, res) => res.end(JSON.stringify(completion({ usage: { prompt_tokens: 2 } }))) });
  await f.inject(); const row = f.rows()[0]; assert.equal(row.input_tokens, null); assert.ok(row.estimated_tokens > 16);
});
for (const [status, expected, code] of [[401, 502, "upstream_auth"], [403, 502, "upstream_auth"], [429, 429, "upstream_rate_limited"],
  [500, 502, "upstream_unavailable"], [503, 502, "upstream_unavailable"], [302, 502, "upstream_unavailable"]])
  test(`proxy maps upstream status ${status} without relaying its body or headers`, async (t) => {
    const f = await fixture(t, { respond: (_req, res) => { res.writeHead(status, { "x-upstream-private": key, location: "/other" }); res.end(`private upstream body ${key}`); } });
    const r = await f.inject(); rejected(r, expected, code); assert.equal(r.body.includes("private upstream body"), false);
    assert.equal(r.headers["x-upstream-private"], undefined); // A real HTTP rejection generated nothing and is not charged; a redirect is an unknown outcome and keeps its estimate.
    assert.equal(f.rows().length, status === 302 ? 1 : 0);
  });
test("proxy accepts assistant tool-call messages without content and still estimates them", async (t) => {
  const f = await fixture(t);
  const r = await f.inject(body({ messages: [{ role: "user", content: "hi" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "ok" }] }));
  assert.equal(r.statusCode, 200);
});
test("proxy request timeout aborts a hanging upstream and records estimate", async (t) => {
  const f = await fixture(t, { requestTimeoutMs: 30, respond: () => {} }); rejected(await f.inject(), 504, "upstream_timeout"); assert.ok(f.rows()[0].estimated_tokens);
});
for (const [label, response] of [["invalid JSON", "private invalid body"], ["non object JSON", "[]"],
  ["key in answer", JSON.stringify(completion({ private: key }))]])
  test(`proxy refuses ${label} with a generic response`, async (t) => {
    const f = await fixture(t, { respond: (_req, res) => res.end(response) }); rejected(await f.inject(), 502, "upstream_invalid"); assert.ok(f.rows()[0].estimated_tokens);
  });
test("proxy refuses an oversized upstream body", async (t) => {
  const f = await fixture(t, { maxResponseBytes: 32 }); rejected(await f.inject(), 502, "upstream_invalid");
});
test("proxy rejects an echoed agent credential", async (t) => {
  let token; const f = await fixture(t, { respond: (_req, res) => res.end(JSON.stringify(completion({ private: token }))) }); token = f.token;
  rejected(await f.inject(), 502, "upstream_invalid");
});
test("proxy revocation immediately aborts in flight requests", async (t) => {
  const f = await fixture(t, { respond: () => {} }); const pending = f.inject(); await f.received;
  f.tokens.revoke(f.grant.attemptId); rejected(await pending, 502, "upstream_unavailable"); assert.equal(f.proxy.inflight(), 0); assert.equal(f.rows().length, 1);
});
test("proxy per attempt concurrency cap rejects excess requests", async (t) => {
  const held = gate(); const f = await fixture(t, { maxConcurrentPerAttempt: 1, respond: (_req, res) => held.promise.then(() => res.end(JSON.stringify(completion()))) });
  const pending = f.inject(); await f.received; rejected(await f.inject(), 429, "too_many_requests"); held.resolve(); await pending; assert.equal(f.calls.length, 1);
});
test("proxy total request cap persists after in flight requests finish", async (t) => {
  const f = await fixture(t, { maxRequestsPerAttempt: 1 }); await f.inject(); rejected(await f.inject(), 429, "too_many_requests"); assert.equal(f.calls.length, 1);
});
test("proxy close aborts all active requests and releases reservations", async (t) => {
  const f = await fixture(t, { respond: () => {} }); const pending = f.inject(); await f.received;
  await f.proxy.close(); await pending; assert.equal(f.proxy.inflight(), 0); assert.equal(f.rows().length, 1);
});
test("proxy usage write failure preserves the response and reports only a generic Error", async (t) => {
  const errors = []; const f = await fixture(t, { onError: (error) => errors.push(error) });
  f.raw.exec("CREATE TRIGGER reject_usage BEFORE INSERT ON usage_records BEGIN SELECT RAISE(ABORT, 'private storage detail'); END");
  assert.equal((await f.inject()).statusCode, 200); assert.equal(errors.length, 1); assert.ok(errors[0] instanceof Error);
  assert.equal(errors[0].message, "Model usage recording failed"); safe(errors[0].stack, f.token);
});
test("proxy streams incrementally forces usage chunks and records final usage", async (t) => {
  const held = gate(); const f = await fixture(t, { respond: (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream", "x-private": key }); res.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n');
    held.promise.then(() => res.end(`data: ${JSON.stringify({ choices: [], usage: reported })}\n\ndata: [DONE]\n\n`));
  } });
  const url = await f.listen(); const response = await fetch(`${url}/v1/chat/completions`, { method: "POST", headers: f.headers,
    body: JSON.stringify(body({ stream: true, stream_options: { include_usage: false, extra: true } })) });
  safe(Object.fromEntries(response.headers), f.token); assert.equal(response.headers.get("content-type"), "text/event-stream");
  const reader = response.body.getReader(); const first = await reader.read(); assert.match(Buffer.from(first.value).toString(), /first/);
  assert.equal(f.rows().length, 0); assert.equal(f.proxy.inflight(), 1);
  assert.deepEqual(f.calls[0].body.stream_options, { include_usage: true }); held.resolve();
  let rest = ""; while (true) { const chunk = await reader.read(); if (chunk.done) break; rest += Buffer.from(chunk.value).toString(); }
  safe(rest, f.token); await poll(() => f.rows().length === 1); assert.equal(f.rows()[0].output_tokens, 12);
});
test("proxy streams without usage record a reservation estimate", async (t) => {
  const f = await fixture(t, { respond: (_req, res) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.end('data: {"choices":[]}\n\ndata: [DONE]\n\n'); } });
  assert.equal((await f.inject(body({ stream: true }))).statusCode, 200); assert.ok(f.rows()[0].estimated_tokens);
});
test("proxy drops a leaking SSE chunk and every later chunk", async (t) => {
  const f = await fixture(t, { respond: (_req, res) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(`data: ${JSON.stringify({ text: key })}\n\ndata: later\n\n`); } });
  const r = await f.inject(body({ stream: true })); assert.equal(r.statusCode, 200); assert.equal(r.body, ""); assert.ok(f.rows()[0].estimated_tokens);
});
test("proxy detects a key split between SSE chunks before releasing it", async (t) => {
  const f = await fixture(t, { respond: (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" }); res.write(`data: ${key.slice(0, 12)}`);
    setTimeout(() => res.end(`${key.slice(12)}\n\ndata: later\n\n`), 20);
  } });
  const r = await f.inject(body({ stream: true })); assert.equal(r.body, "data: "); safe(r.body, f.token);
});
test("proxy bounds SSE line buffering and stops oversized lines", async (t) => {
  const f = await fixture(t, { respond: (_req, res) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(`data: ${"x".repeat(1_048_577)}`); } });
  const r = await f.inject(body({ stream: true })); assert.equal(r.statusCode, 200); assert.ok(r.body.length <= 1_048_576); assert.ok(f.rows()[0].estimated_tokens);
});
test("proxy client disconnect aborts streaming upstream and records known usage", async (t) => {
  const f = await fixture(t, { respond: (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" }); res.write(`data: ${JSON.stringify({ usage: reported })}\n\n`);
  } });
  const url = await f.listen();
  await new Promise((resolve, reject) => {
    const req = httpRequest(`${url}/v1/chat/completions`, { method: "POST", headers: f.headers }, (res) => {
      res.once("data", (chunk) => { safe(chunk.toString(), f.token); res.destroy(); resolve(); });
    }); req.once("error", reject); req.end(JSON.stringify(body({ stream: true })));
  });
  await poll(() => f.proxy.inflight() === 0 && f.closed() > 0); assert.equal(f.rows()[0].input_tokens, 20);
});
test("proxy revocation terminates a running stream with an estimate", async (t) => {
  const f = await fixture(t, { respond: (_req, res) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.write('data: {"choices":[]}\n\n'); } });
  const pending = f.inject(body({ stream: true })); await f.received; f.tokens.revoke(f.grant.attemptId);
  await pending; assert.equal(f.proxy.inflight(), 0); assert.ok(f.rows()[0].estimated_tokens);
});
