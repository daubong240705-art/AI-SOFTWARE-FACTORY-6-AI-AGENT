import assert from "node:assert/strict";
import { createServer } from "node:http";
import { inspect } from "node:util";
import { test as nodeTest } from "node:test";
import { createUpstream, createResponseGuard, ModelError } from "../dist/models/index.js";

const test = (name, fn) => nodeTest(name, { timeout: 10000 }, fn);
const key = "local-upstream-private-marker";
const options = { baseUrl: "https://example.test/v1", apiKey: key };
const config = (extra) => assert.throws(() => createUpstream({ ...options, ...extra }), (error) => {
  assert.ok(error instanceof ModelError); assert.equal(error.kind, "config");
  assert.equal(inspect(error, { showHidden: true }).includes(key), false); return true;
});
async function server(t, handler) {
  const app = createServer(handler);
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  t.after(async () => { app.closeAllConnections(); await new Promise((resolve) => app.close(resolve)); });
  return `http://127.0.0.1:${app.address().port}/v1`;
}
for (const [label, baseUrl] of [["remote http", "http://example.test/v1"], ["ftp", "ftp://example.test"],
  ["invalid", "bad"], ["credentials", "https://user:pass@example.test"], ["query", "https://example.test/?q=x"],
  ["fragment", "https://example.test/#x"]]) test(`upstream rejects ${label} configuration`, () => config({ baseUrl }));
for (const [label, apiKey] of [["empty", ""], ["space", "one two"], ["newline", "one\ntwo"],
  ["control", "one\u0001two"], ["unicode space", "one\u00a0two"]])
  test(`upstream rejects ${label} credentials generically`, () => config({ apiKey }));
for (const baseUrl of ["https://example.test/v1", "http://localhost:9000", "http://127.0.0.1:9000", "http://[::1]:9000"])
  test(`upstream accepts validated protocol and hostname ${new URL(baseUrl).hostname}`, () => {
    assert.equal(createUpstream({ ...options, baseUrl }).providerId, "9router");
  });
test("upstream properties and inspection do not expose the private credential", () => {
  const upstream = createUpstream(options);
  assert.deepEqual(Object.keys(upstream), ["providerId", "listModels", "chatCompletions"]);
  assert.equal(inspect(upstream, { showHidden: true, depth: null }).includes(key), false);
  config({ providerId: key });
});
test("upstream posts the exact validated string and returns the raw response", async (t) => {
  let received;
  const baseUrl = await server(t, async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    received = { url: req.url, method: req.method, auth: req.headers.authorization, body };
    res.setHeader("content-type", "application/json"); res.end('{"ok":true}');
  });
  const upstream = createUpstream({ ...options, baseUrl: `${baseUrl}///`, providerId: "local" });
  const response = await upstream.chatCompletions('{ "model": "approved" }', new AbortController().signal);
  assert.ok(response instanceof Response); assert.equal(await response.text(), '{"ok":true}');
  assert.deepEqual(received, { url: "/v1/chat/completions", method: "POST", auth: `Bearer ${key}`, body: '{ "model": "approved" }' });
});
test("upstream refuses redirects without contacting the destination", async (t) => {
  let calls = 0;
  const baseUrl = await server(t, (_req, res) => { calls++; res.writeHead(302, { location: "/destination" }); res.end(key); });
  await assert.rejects(createUpstream({ ...options, baseUrl }).chatCompletions("{}", new AbortController().signal), { kind: "unavailable" });
  assert.equal(calls, 1);
});
test("upstream connection deadline produces a generic timeout", async (t) => {
  const baseUrl = await server(t, () => {});
  await assert.rejects(createUpstream({ ...options, baseUrl, connectTimeoutMs: 20 }).chatCompletions("{}", new AbortController().signal), { kind: "timeout" });
});
test("upstream cancellation and fetch failures expose no original error", async () => {
  const upstream = createUpstream({ ...options, fetchImpl: async () => { throw new Error(key); } });
  await assert.rejects(upstream.chatCompletions("{}", new AbortController().signal), { message: "unavailable" });
  await assert.rejects(upstream.chatCompletions("{}", AbortSignal.abort()), { message: "cancelled" });
});
test("upstream response guard catches credentials split across arbitrary chunks", () => {
  const guard = createResponseGuard(createUpstream(options), "agent-private-marker");
  assert.equal(guard.push(Buffer.from(`safe ${key.slice(0, 9)}`)).toString(), "safe ");
  assert.equal(guard.push(Buffer.from(key.slice(9))), null);
});
test("upstream response guard preserves safe bytes and partial suffixes", () => {
  const guard = createResponseGuard(createUpstream(options), "agent-private-marker");
  const chunks = [guard.push(Buffer.from("one lo")), guard.push(Buffer.from("op two")), guard.finish()];
  assert.equal(Buffer.concat(chunks).toString(), "one loop two");
});
