import assert from "node:assert/strict";
import { createServer } from "node:http";
import { inspect } from "node:util";
import { test as nodeTest } from "node:test";
import { createChatCompletionsGateway, createFakeGateway, ModelError } from "../dist/models/index.js";

const test = (name, fn) => nodeTest(name, { timeout: 10_000 }, fn);
const key = "model-test-secret-marker-7d5e9c";
const usage = { inputTokens: 20, cachedInputTokens: 5, outputTokens: 12, reasoningOutputTokens: 3 };
const request = (overrides = {}) => ({ model: "test-model", effort: null, system: "System instructions",
  messages: [{ role: "user", content: "Question" }, { role: "assistant", content: "Earlier answer" }],
  maxOutputTokens: 1234, ...overrides });
const completion = (extra = {}) => ({ choices: [{ message: { content: "Answer" }, finish_reason: "stop" }], ...extra });

function noKey(value, secret = key) {
  assert.equal(inspect(value, { showHidden: true, depth: null }).includes(secret), false);
  assert.equal((JSON.stringify(value) ?? "").includes(secret), false);
}

function checkError(error, kind, gateway, secret = key) {
  assert.ok(error instanceof ModelError);
  assert.equal(error.kind, kind);
  assert.match(error.message, new RegExp(`^${kind}(?: [0-9]+)?$`));
  for (const value of [error.message, error.stack, Object.getOwnPropertyNames(error),
    Object.getOwnPropertyDescriptors(error), Object.getOwnPropertyNames(error).map((name) => error[name]), error, gateway]) {
    noKey(value, secret);
  }
  return true;
}

const rejects = (promise, kind, gateway) => assert.rejects(promise, (error) => checkError(error, kind, gateway));
const throwsConfig = (options, secret = key) => assert.throws(() => createChatCompletionsGateway({
  baseUrl: "https://gateway.example/v1", apiKey: key, ...options,
}), (error) => checkError(error, "config", undefined, secret));

async function fixture(t, respond = (res) => res.end(JSON.stringify(completion())), options = {}, basePath = "") {
  const requests = [];
  let received;
  const seen = new Promise((resolve) => { received = resolve; });
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const call = { method: req.method, path: req.url, headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
      requests.push(call);
      received(call);
      respond(res, call);
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => {
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}${basePath}`;
  const gateway = createChatCompletionsGateway({ baseUrl, apiKey: key, ...options });
  noKey(gateway);
  return { server, gateway, requests, baseUrl, seen };
}

test("chat completions maps usage details and sends the OpenAI request shape exactly once", async (t) => {
  const f = await fixture(t, (res) => res.end(JSON.stringify(completion({ usage: {
    prompt_tokens: 20, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 5 },
    completion_tokens_details: { reasoning_tokens: 3 }, total_tokens: 32,
  } }))));
  const input = request({ effort: "high" });
  assert.deepEqual(await f.gateway.complete(input), { text: "Answer", usage, provider: "9router", model: "test-model", finishReason: "stop" });
  assert.equal(f.gateway.providerId, "9router");
  assert.equal(f.requests.length, 1);
  const call = f.requests[0];
  assert.equal(call.method, "POST");
  assert.equal(call.path, "/chat/completions");
  assert.equal(call.headers["content-type"], "application/json");
  assert.equal(call.headers.authorization, `Bearer ${key}`);
  assert.deepEqual(call.body, { model: input.model, messages: [{ role: "system", content: input.system }, ...input.messages],
    max_tokens: 1234, stream: false, reasoning_effort: "high" });
  noKey(f.gateway);
});

test("usage defaults cached and reasoning counts to zero; absent or empty usage stays null", async (t) => {
  const bodies = [
    completion({ usage: { prompt_tokens: 7, completion_tokens: 0 } }),
    completion(), completion({ usage: {} }), completion({ usage: { total_tokens: 0 } }), completion({ usage: null }),
    { choices: [{ message: { content: "" } }] },
  ];
  const f = await fixture(t, (res) => res.end(JSON.stringify(bodies.shift())), { providerId: "local" }, "/v1///");
  const first = await f.gateway.complete(request());
  assert.deepEqual(first.usage, { inputTokens: 7, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 });
  assert.equal(first.provider, "local");
  for (let i = 0; i < 5; i++) {
    const result = await f.gateway.complete(request());
    assert.equal(result.usage, null);
    if (i === 4) { assert.equal(result.text, ""); assert.equal(result.finishReason, null); }
  }
  assert.ok(f.requests.every((call) => call.path === "/v1/chat/completions"));
  assert.ok(f.requests.every((call) => !Object.hasOwn(call.body, "reasoning_effort")));
});

for (const [status, kind] of [[401, "auth"], [403, "auth"], [429, "rate-limit"], [500, "unavailable"], [400, "unavailable"]]) {
  test(`HTTP ${status} maps to ${kind}, keeps diagnostics private and never retries`, async (t) => {
    const f = await fixture(t, (res) => {
      res.writeHead(status, { "x-secret": key });
      res.end(JSON.stringify({ error: { message: key } }));
    });
    await assert.rejects(f.gateway.complete(request({ system: key })), (error) => {
      assert.equal(error.message, `${kind} ${status}`);
      return checkError(error, kind, f.gateway);
    });
    assert.equal(f.requests.length, 1);
  });
}

test("redirects are not followed or replayed", async (t) => {
  const f = await fixture(t, (res) => {
    res.writeHead(307, { location: `${f.baseUrl}/redirect`, "x-secret": key });
    res.end(key);
  });
  await rejects(f.gateway.complete(request()), "unavailable", f.gateway);
  assert.equal(f.requests.length, 1);
});

test("connection refused maps to unavailable", async (t) => {
  const f = await fixture(t);
  await new Promise((resolve, reject) => f.server.close((error) => error ? reject(error) : resolve()));
  await rejects(f.gateway.complete(request()), "unavailable", f.gateway);
  assert.equal(f.requests.length, 0);
});

for (const bodyStarted of [false, true]) {
  test(`timeout covers ${bodyStarted ? "reading the response body" : "waiting for response headers"}`, async (t) => {
    const f = await fixture(t, (res) => {
      if (bodyStarted) { res.writeHead(200); res.write('{"choices":'); }
      const timer = setTimeout(() => res.end(JSON.stringify(completion())), 2000);
      res.on("close", () => clearTimeout(timer));
    });
    await rejects(f.gateway.complete(request({ timeoutMs: 150 })), "timeout", f.gateway);
    assert.equal(f.requests.length, 1);
  });
}

test("default timeout applies when the request has no timeout override", async (t) => {
  const f = await fixture(t, () => {}, { defaultTimeoutMs: 150 });
  await rejects(f.gateway.complete(request()), "timeout", f.gateway);
  assert.equal(f.requests.length, 1);
});

for (const bodyStarted of [false, true]) {
  test(`caller abort maps to cancelled ${bodyStarted ? "while reading the body" : "before headers"}`, async (t) => {
    const f = await fixture(t, (res) => {
      if (bodyStarted) { res.writeHead(200); res.write('{"choices":'); }
    });
    const controller = new AbortController();
    const pending = rejects(f.gateway.complete(request({ signal: controller.signal })), "cancelled", f.gateway);
    await f.seen;
    controller.abort(new Error(key));
    await pending;
    assert.equal(f.requests.length, 1);
  });
}

test("already aborted requests are cancelled without sending a request", async (t) => {
  const f = await fixture(t);
  await rejects(f.gateway.complete(request({ signal: AbortSignal.abort(new Error(key)) })), "cancelled", f.gateway);
  assert.equal(f.requests.length, 0);
});

const invalidBodies = [
  ["invalid JSON", `{"private":"${key}",`], ["missing choices", { private: key }],
  ["empty choices", { choices: [], private: key }],
  ["null content", { choices: [{ message: { content: null } }], private: key }],
  ["array content", { choices: [{ message: { content: [key] } }] }],
  ["invalid finish reason", { choices: [{ message: { content: "ok" }, finish_reason: { private: key } }] }],
  ["negative token count", completion({ usage: { prompt_tokens: -1, completion_tokens: 2 } })],
  ["fractional token count", completion({ usage: { prompt_tokens: 1, completion_tokens: 2.5 } })],
  ["string token count", completion({ usage: { prompt_tokens: key, completion_tokens: 2 } })],
  ["incomplete token counts", completion({ usage: { prompt_tokens: 2 } })],
  ["invalid usage shape", completion({ usage: key })],
  ["reflected key", { choices: [{ message: { content: key } }] }],
  ["reflected finish reason", { choices: [{ message: { content: "ok" }, finish_reason: key }] }],
];
for (const [name, body] of invalidBodies) {
  test(`${name} maps to bad-response without disclosing response data`, async (t) => {
    const f = await fixture(t, (res) => res.end(typeof body === "string" ? body : JSON.stringify(body)));
    await rejects(f.gateway.complete(request()), "bad-response", f.gateway);
    assert.equal(f.requests.length, 1);
  });
}

test("response byte cap is enforced on streamed UTF-8 bytes without Content-Length", async (t) => {
  const body = JSON.stringify({ choices: [{ message: { content: "é".repeat(100) } }] });
  const f = await fixture(t, (res) => {
    res.writeHead(200, { "transfer-encoding": "chunked" });
    res.write(body.slice(0, 40));
    res.end(body.slice(40));
  }, { maxResponseBytes: body.length + 1 });
  await rejects(f.gateway.complete(request()), "bad-response", f.gateway);
});

test("response exactly at byte cap succeeds; the default cap rejects oversized bodies", async (t) => {
  const body = JSON.stringify(completion());
  const exact = await fixture(t, (res) => res.end(body), { maxResponseBytes: Buffer.byteLength(body) });
  assert.equal((await exact.gateway.complete(request())).text, "Answer");
  const large = await fixture(t, (res) => res.end(JSON.stringify(completion({ padding: key + "x".repeat(1_048_576) }))));
  await rejects(large.gateway.complete(request()), "bad-response", large.gateway);
});

test("invalid UTF-8 is rejected as a bad response", async (t) => {
  const f = await fixture(t, (res) => res.end(Buffer.concat([
    Buffer.from('{"choices":[{"message":{"content":"'), Buffer.from([0xff]), Buffer.from('"}}]}'),
  ])));
  await rejects(f.gateway.complete(request()), "bad-response", f.gateway);
});

test("construction permits HTTPS and loopback HTTP and rejects unsafe or invalid configuration", () => {
  for (const baseUrl of ["https://gateway.example/v1", "http://127.0.0.1:1", "http://[::1]:1", "http://localhost:1"]) {
    noKey(createChatCompletionsGateway({ baseUrl, apiKey: key }));
  }
  for (const baseUrl of ["http://example.com", "http://192.168.1.2", "http://localhost.example", "http://127.0.0.2",
    "ftp://localhost", `invalid-${key}`, `https://${key}@example.com`, `https://gateway.example/?private=${key}`]) {
    throwsConfig({ baseUrl });
  }
  for (const apiKey of ["", `${key} `, `${key}\n`, `${key}\t`, `${key}\0`, `${key}\u007f`, `${key}\u0085`]) {
    throwsConfig({ apiKey });
  }
  for (const options of [{ defaultTimeoutMs: 0 }, { defaultTimeoutMs: Infinity }, { maxResponseBytes: 0 }, { maxResponseBytes: 1.5 }]) {
    throwsConfig(options);
  }
});

test("requests are validated before dispatch, including model, token bounds and total character limit", async (t) => {
  const f = await fixture(t);
  for (const overrides of [
    { model: "" }, { model: " " }, { model: key }, { maxOutputTokens: 0 }, { maxOutputTokens: -1 },
    { maxOutputTokens: 32_769 }, { maxOutputTokens: 1.5 }, { maxOutputTokens: NaN }, { maxOutputTokens: Infinity },
    { system: "x".repeat(2_000_001), messages: [] },
    { system: "x".repeat(1_000_000), messages: [{ role: "user", content: "x".repeat(1_000_001) }] },
    { effort: "ultra" }, { messages: [{ role: "system", content: key }] }, { timeoutMs: 0 },
  ]) await rejects(f.gateway.complete(request(overrides)), "config", f.gateway);
  assert.equal(f.requests.length, 0);
  for (const maxOutputTokens of [1, 32_768]) {
    await f.gateway.complete(request({ system: "x".repeat(1_000_000),
      messages: [{ role: "user", content: "x".repeat(1_000_000) }], maxOutputTokens }));
  }
  assert.equal(f.requests.length, 2);
});

test("errors from a fetch implementation are sanitized and a failed fetch is never retried", async () => {
  let calls = 0;
  const upstream = new ModelError("auth");
  upstream.private = key;
  const gateway = createChatCompletionsGateway({ baseUrl: "https://gateway.example", apiKey: key,
    fetchImpl: async () => { calls++; throw upstream; },
  });
  await rejects(gateway.complete(request()), "unavailable", gateway);
  assert.equal(calls, 1);
});

test("fake gateway consumes its script in order, reports usage, and fails when exhausted", async () => {
  const gateway = createFakeGateway([{ text: "First", usage }, { error: "rate-limit" }, { text: "Third" }, { text: "Fourth", usage: null }]);
  assert.equal(gateway.providerId, "fake");
  assert.deepEqual(await gateway.complete(request()), { text: "First", usage, provider: "fake", model: "test-model", finishReason: "stop" });
  await rejects(gateway.complete(request()), "rate-limit", gateway);
  assert.equal((await gateway.complete(request())).text, "Third");
  assert.equal((await gateway.complete(request())).usage, null);
  await rejects(gateway.complete(request()), "config", gateway);
  assert.equal(gateway.calls.length, 5);
});

test("fake gateway snapshots requests and script data and returns independent usage", async () => {
  const script = [{ text: "Answer", usage: { ...usage }, delayMs: 15 }];
  const gateway = createFakeGateway(script);
  script[0].text = "Changed";
  script[0].usage.inputTokens = 999;
  const input = request();
  const original = structuredClone(input);
  const pending = gateway.complete(input);
  input.model = "Changed";
  input.messages[0].content = "Changed";
  input.messages.push({ role: "user", content: "More" });
  const result = await pending;
  assert.deepEqual(gateway.calls, [original]);
  assert.equal(result.model, original.model);
  assert.equal(result.text, "Answer");
  assert.deepEqual(result.usage, usage);
  result.usage.inputTokens = 1000;
  assert.equal(script[0].usage.inputTokens, 999);
  gateway.calls[0].messages[0].content = "Record changed";
  assert.equal(input.messages[0].content, "Changed");
});

test("fake gateway honours delay and caller abort, consuming the cancelled step", async () => {
  const controller = new AbortController();
  const gateway = createFakeGateway([{ text: "Late", delayMs: 1000 }, { text: "Next", delayMs: 20 }, { error: "auth", delayMs: 1000 }]);
  const pending = rejects(gateway.complete(request({ signal: controller.signal })), "cancelled", gateway);
  controller.abort(new Error(key));
  await pending;
  let settled = false;
  const next = gateway.complete(request()).then((value) => { settled = true; return value; });
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(settled, false);
  assert.equal((await next).text, "Next");
  await rejects(gateway.complete(request({ signal: AbortSignal.abort() })), "cancelled", gateway);
  assert.equal(gateway.calls.length, 3);
});
