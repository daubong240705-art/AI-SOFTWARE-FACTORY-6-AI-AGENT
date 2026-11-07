import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import Fastify from "fastify";
import { API_VERSION, failureResponseSchema, uuidV7Schema } from "@factory/contracts";
import { clearSessionCookie, createApiServer, failure, listenLoopback, originsFor, parseCookies, sessionCookie, STATUS_BY_CODE } from "../dist/api/index.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";

const host = "127.0.0.1:8787";
const origin = `http://${host}`;
const bootstrapToken = "a".repeat(64);
const successBody = { ok: true, apiVersion: API_VERSION };

function fakeClock() {
  let time = Date.parse("2026-11-07T10:00:00.000Z");
  return { clock: () => new Date(time), advance: (ms) => { time += ms; } };
}

function fixture(t, { sessionOptions = {}, gateOptions = {}, register, ...options } = {}) {
  const time = fakeClock();
  const sessions = createSessionStore({ clock: time.clock, ...sessionOptions });
  const gate = createBootstrapGate({ token: bootstrapToken, clock: time.clock, ...gateOptions });
  const app = createApiServer({
    origins: originsFor(8787), gate, sessions, clock: time.clock, ...options,
    register(app, guards) {
      app.get("/private", { preHandler: guards.session }, async (request) => ({
        ...successBody, authenticated: request.session !== null,
      }));
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        app.route({ method, url: "/private", preHandler: guards.write, handler: async () => successBody });
      }
      app.post("/explode", { preHandler: guards.write }, async (request) => {
        throw new Error(`private-handler-marker E:\\private\\host.ts ${JSON.stringify(request.body)}`);
      });
      register?.(app, guards);
    },
  });
  t.after(() => app.close());
  return { app, gate, sessions, ...time };
}

function request(app, { headers = {}, ...options } = {}) {
  const presentHeaders = Object.fromEntries(Object.entries({ host, ...headers }).filter(([, value]) => value !== undefined));
  return app.inject({ url: "/health", ...options, headers: presentHeaders });
}

function bootstrap(app, { headers = {}, payload = { token: bootstrapToken }, ...options } = {}) {
  return request(app, {
    method: "POST", url: "/auth/bootstrap", payload, ...options,
    headers: { origin, "content-type": "application/json", ...headers },
  });
}

function sessionHeaders(session) {
  return { cookie: `factory_session=${session.id}`, origin, "x-csrf-token": session.csrfToken };
}

function write(app, session, headers = {}, options = {}) {
  return request(app, {
    method: "POST", url: "/private", payload: {}, ...options,
    headers: { ...sessionHeaders(session), ...headers },
  });
}

function failureBody(response, status, code, nextAction) {
  assert.equal(response.statusCode, status);
  const body = response.json();
  assert.deepEqual(failureResponseSchema.parse(body), body);
  assert.equal(body.apiVersion, API_VERSION);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, code);
  if (nextAction !== undefined) assert.equal(body.error.nextAction, nextAction);
  uuidV7Schema.parse(body.error.correlationId);
  securityHeaders(response);
  return body;
}

function success(response, expected = successBody) {
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), expected);
  securityHeaders(response);
}

function securityHeaders(response) {
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["cross-origin-resource-policy"], "same-origin");
  assert.ok(Object.keys(response.headers).every((name) => !name.startsWith("access-control-")));
}

function onlyCookie(response) {
  const value = response.headers["set-cookie"];
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  assert.equal(values.length, 1);
  return values[0];
}

function assertCleared(response) {
  assert.equal(onlyCookie(response), clearSessionCookie());
}

test("bootstrap gate generates a 32-byte hex token and exposes it only once", () => {
  const gate = createBootstrapGate();
  assert.equal(JSON.stringify(gate), "{}");
  const token = gate.token;
  assert.ok(/^[a-f0-9]{64}$/.test(token));
  assert.equal(gate.token, undefined);
  assert.ok(!JSON.stringify(gate).includes(token));
  assert.equal(gate.consume(token), "ok");
  assert.equal(gate.consume(token), "used");
  assert.equal(gate.consume(null), "used");
});

test("bootstrap gate hashes candidates of different lengths and rejects nonstrings without coercion", () => {
  const gate = createBootstrapGate({ token: bootstrapToken, maxFailures: 20 });
  const candidate = { toString() { throw new Error("must not coerce"); } };
  for (const value of [undefined, null, 1, candidate, [], Symbol(), "", "short", "b".repeat(1000)])
    assert.equal(gate.consume(value), "invalid");
  assert.equal(gate.consume(bootstrapToken), "ok");
  assert.equal(gate.token, undefined);
});

test("bootstrap gate locks on the fifth failure until the exact clock boundary, then stays used forever", () => {
  const time = fakeClock();
  const gate = createBootstrapGate({ token: bootstrapToken, clock: time.clock });
  for (let attempt = 0; attempt < 4; attempt += 1) assert.equal(gate.consume("wrong"), "invalid");
  assert.equal(gate.consume("wrong"), "locked");
  const candidate = { toString() { throw new Error("must not evaluate while locked"); } };
  assert.equal(gate.consume(candidate), "locked");
  assert.equal(gate.consume(bootstrapToken), "locked");
  time.advance(59_999);
  assert.equal(gate.consume(bootstrapToken), "locked");
  time.advance(1);
  assert.equal(gate.consume(bootstrapToken), "ok");
  time.advance(7 * 24 * 60 * 60 * 1000);
  assert.equal(gate.consume(bootstrapToken), "used");
});

test("bootstrap lock counters restart after a configurable lock expires", () => {
  const time = fakeClock();
  const gate = createBootstrapGate({ token: bootstrapToken, clock: time.clock, maxFailures: 2, lockMs: 10 });
  assert.equal(gate.consume("wrong"), "invalid");
  assert.equal(gate.consume("wrong"), "locked");
  time.advance(10);
  assert.equal(gate.consume("wrong"), "invalid");
  assert.equal(gate.consume(bootstrapToken), "ok");
});

test("sessions create independent base64url credentials, refresh timestamps and destroy idempotently", () => {
  const time = fakeClock();
  const sessions = createSessionStore({ clock: time.clock });
  const session = sessions.create();
  assert.deepEqual(Object.keys(session).sort(), ["createdAt", "csrfToken", "id", "lastSeenAt"]);
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(session.id));
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(session.csrfToken));
  assert.ok(session.id !== session.csrfToken);
  assert.equal(session.createdAt, time.clock().getTime());
  assert.equal(session.createdAt, session.lastSeenAt);
  time.advance(100);
  const refreshed = sessions.get(session.id);
  assert.equal(refreshed.createdAt, session.createdAt);
  assert.equal(refreshed.lastSeenAt, time.clock().getTime());
  assert.equal(sessions.size(), 1);
  sessions.destroy(session.id);
  sessions.destroy(session.id);
  assert.equal(sessions.get(session.id), null);
  assert.equal(sessions.get("forged"), null);
  assert.equal(sessions.size(), 0);
});

test("sessions expire at the idle deadline and are deleted", () => {
  const time = fakeClock();
  const sessions = createSessionStore({ clock: time.clock, idleMs: 100 });
  const session = sessions.create();
  time.advance(99);
  assert.ok(sessions.get(session.id));
  time.advance(100);
  assert.equal(sessions.get(session.id), null);
  assert.equal(sessions.size(), 0);
});

test("absolute session expiry cannot be extended by repeated access", () => {
  const time = fakeClock();
  const sessions = createSessionStore({ clock: time.clock, idleMs: 100, absoluteMs: 250 });
  const session = sessions.create();
  for (let i = 0; i < 3; i += 1) {
    time.advance(80);
    assert.ok(sessions.get(session.id));
  }
  time.advance(10);
  assert.equal(sessions.get(session.id), null);
  assert.equal(sessions.size(), 0);
});

test("default session deadlines are 12 hours idle and 7 days absolute", () => {
  const time = fakeClock();
  const sessions = createSessionStore({ clock: time.clock });
  const first = sessions.create();
  time.advance(12 * 60 * 60 * 1000);
  assert.equal(sessions.get(first.id), null);
  const second = sessions.create();
  for (let i = 0; i < 15; i += 1) {
    time.advance(11 * 60 * 60 * 1000);
    assert.ok(sessions.get(second.id));
  }
  time.advance(3 * 60 * 60 * 1000);
  assert.equal(sessions.get(second.id), null);
});

test("session eviction removes the oldest created session even when recently accessed", () => {
  const time = fakeClock();
  const sessions = createSessionStore({ clock: time.clock, maxSessions: 2 });
  const oldest = sessions.create();
  time.advance(1);
  const second = sessions.create();
  time.advance(1);
  assert.ok(sessions.get(oldest.id));
  const newest = sessions.create();
  assert.equal(sessions.size(), 2);
  assert.equal(sessions.get(oldest.id), null);
  assert.ok(sessions.get(second.id));
  assert.ok(sessions.get(newest.id));
});

test("session ids and CSRF tokens are unique over 1000 creations", () => {
  const sessions = createSessionStore({ maxSessions: 1000 });
  const ids = new Set();
  const csrfTokens = new Set();
  for (let i = 0; i < 1000; i += 1) {
    const session = sessions.create();
    ids.add(session.id);
    csrfTokens.add(session.csrfToken);
  }
  assert.equal(ids.size, 1000);
  assert.equal(csrfTokens.size, 1000);
  assert.equal(new Set([...ids, ...csrfTokens]).size, 2000);
  assert.equal(sessions.size(), 1000);
});

test("session injection uses separate newToken calls and returned objects cannot change stored credentials", () => {
  let count = 0;
  const sessions = createSessionStore({ newToken: () => String(++count) });
  const session = sessions.create();
  assert.equal(count, 2);
  const id = session.id;
  const csrf = session.csrfToken;
  session.csrfToken = "changed";
  assert.ok(sessions.get(id).csrfToken === csrf);
  const retrieved = sessions.get(id);
  retrieved.lastSeenAt = 0;
  assert.ok(sessions.get(id));
});

test("cookie parsing ignores malformed pairs, preserves raw values and rejects every duplicate name", () => {
  assert.deepEqual([...parseCookies(undefined)], []);
  assert.deepEqual([...parseCookies('a=one; bad; =bad; bad name=value; b="two"; c=raw%2Fvalue; d=bad value; e=x=y; f="; g="unterminated')], [
    ["a", "one"], ["b", "two"], ["c", "raw%2Fvalue"], ["e", "x=y"],
  ]);
  for (const header of ["a=one; a=two", "a=one; a=two; a=three", "a=one; a=bad value", "a=bad value; a=one", "a; a=one"])
    assert.equal(parseCookies(header).has("a"), false);
  assert.deepEqual([...parseCookies("a=one; A=two")], [["a", "one"], ["A", "two"]]);
  assert.deepEqual([...parseCookies("a=value\r\n; b=value\n; c=valid")], [["c", "valid"]]);
});

test("cookie helpers set HttpOnly, Strict, Path and Max-Age, and refuse header injection", () => {
  assert.equal(sessionCookie("session_id-1", { maxAgeSec: 60 }), "factory_session=session_id-1; Path=/; HttpOnly; SameSite=Strict; Max-Age=60");
  assert.equal(clearSessionCookie(), "factory_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
  assert.throws(() => sessionCookie("invalid\r\nheader", { maxAgeSec: 60 }), /Invalid session cookie parameters/);
  assert.throws(() => sessionCookie("invalid\n", { maxAgeSec: 60 }), /Invalid session cookie parameters/);
});

test("status mapping and failure helper preserve contract fields and create fresh correlation ids", async (t) => {
  assert.deepEqual(STATUS_BY_CODE, {
    validation: 400, "needs-auth": 401, forbidden: 403, "not-found": 404, conflict: 409,
    "resource-exhausted": 429, unsupported: 501, internal: 500, "outcome-unknown": 500,
    "runtime-unavailable": 503, "permission-configuration": 403,
  });
  let sequence = 0;
  const { app } = fixture(t, { register(app) {
    app.get("/failure", (_request, reply) => failure(reply, 409, "conflict", "Revision changed.", "refresh",
      () => `019a5d90-7400-7000-8000-${String(++sequence).padStart(12, "0")}`,
      { currentRevision: 2, fields: [{ path: "revision", message: "Refresh revision." }] }));
  } });
  const first = failureBody(await request(app, { url: "/failure" }), 409, "conflict", "refresh");
  const second = failureBody(await request(app, { url: "/failure" }), 409, "conflict", "refresh");
  assert.notEqual(first.error.correlationId, second.error.correlationId);
  assert.equal(first.error.currentRevision, 2);
  assert.deepEqual(first.error.fields, [{ path: "revision", message: "Refresh revision." }]);
});

for (const foreignHost of ["evil.com", "127.0.0.1:9999", "localhost.evil.com:8787", "127.0.0.1:8787.evil.com", "LOCALHOST:8787"]) {
  test(`foreign Host ${foreignHost} is rejected before every route, parser and guard`, async (t) => {
    const { app } = fixture(t);
    for (const [method, url] of [
      ["GET", "/health"], ["HEAD", "/health"], ["POST", "/auth/bootstrap"], ["POST", "/auth/logout"],
      ["GET", "/private"], ["POST", "/private"], ["PUT", "/private"], ["PATCH", "/private"],
      ["DELETE", "/private"], ["POST", "/explode"], ["GET", "/missing"], ["OPTIONS", "/health"],
    ]) {
      const response = await request(app, { method, url, headers: { host: foreignHost, origin } });
      if (method === "HEAD") {
        assert.equal(response.statusCode, 403);
        assert.equal(response.body, "");
        securityHeaders(response);
      } else failureBody(response, 403, "forbidden");
    }
    failureBody(await bootstrap(app, { headers: { host: foreignHost, "content-type": "text/plain" }, payload: "{" }), 403, "forbidden");
  });
}

test("missing Host is rejected on every route", async (t) => {
  const { app } = fixture(t);
  // Injection normally supplies Host. Remove it before dispatch to model a missing raw header.
  class MissingHostRequest extends Readable {
    once(...args) {
      delete this.headers.host;
      return super.once(...args);
    }
  }
  for (const [method, url] of [
    ["GET", "/health"], ["POST", "/auth/bootstrap"], ["POST", "/auth/logout"], ["GET", "/private"],
    ["POST", "/private"], ["PUT", "/private"], ["PATCH", "/private"], ["DELETE", "/private"],
    ["POST", "/explode"], ["GET", "/missing"], ["OPTIONS", "/health"],
  ]) failureBody(await request(app, { method, url, Request: MissingHostRequest }), 403, "forbidden");
});

test("forwarding headers cannot override an unapproved Host", async (t) => {
  const { app } = fixture(t);
  failureBody(await request(app, { headers: { host: "evil.com", "x-forwarded-host": host, forwarded: `host=${host}` } }), 403, "forbidden");
  success(await request(app, { headers: { "x-forwarded-host": "evil.com" } }));
});

test("health succeeds without authentication, Origin or CSRF for each configured Host", async (t) => {
  const { app } = fixture(t);
  for (const allowedHost of [host, "localhost:8787"]) success(await request(app, { headers: { host: allowedHost } }));
});

test("OPTIONS always returns 405 without any CORS headers", async (t) => {
  const { app } = fixture(t);
  for (const url of ["/health", "/auth/bootstrap", "/auth/logout", "/private", "/missing"]) {
    failureBody(await request(app, { method: "OPTIONS", url, headers: {
      origin: "https://evil.com", "access-control-request-method": "POST", "access-control-request-headers": "x-csrf-token",
    } }), 405, "unsupported");
  }
});

test("unknown routes return the sanitized failure format", async (t) => {
  const { app } = fixture(t);
  failureBody(await request(app, { url: "/unknown/private-path-marker" }), 404, "not-found");
});

test("router failures sanitize URL text and apply Host validation before parsing errors", async (t) => {
  const { app } = fixture(t, { register(app) { app.get("/parameter/:value", async () => successBody); } });
  for (const [url, status] of [["/private-path-marker/%ZZ", 400], [`/parameter/${"x".repeat(200)}`, 414]]) {
    const response = await request(app, { url });
    failureBody(response, status, "validation");
    assert.ok(!response.body.includes(url));
    failureBody(await request(app, { url, headers: { host: "evil.com" } }), 403, "forbidden");
  }
});

test("registered routes cannot send CORS response headers", async (t) => {
  const { app } = fixture(t, { register(app) {
    app.get("/cors", async (_request, reply) => reply.header("Access-Control-Allow-Origin", "*").send(successBody));
  } });
  success(await request(app, { url: "/cors" }));
});

test("bootstrap refuses a wrong token with generic 401 and no cookie", async (t) => {
  const { app } = fixture(t);
  const response = await bootstrap(app, { payload: { token: "wrong" } });
  failureBody(response, 401, "needs-auth", "authenticate");
  assert.equal(response.headers["set-cookie"], undefined);
});

test("bootstrap accepts string token input without imposing unrelated error-message length limits", async (t) => {
  const { app } = fixture(t);
  for (const token of ["", "x".repeat(3000)])
    failureBody(await bootstrap(app, { payload: { token } }), 401, "needs-auth", "authenticate");
});

test("bootstrap success sets exactly one protected HTTP cookie and returns a per-session CSRF token", async (t) => {
  const { app, sessions } = fixture(t);
  const response = await bootstrap(app);
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(body.csrfToken));
  assert.deepEqual(body, { ...successBody, csrfToken: body.csrfToken });
  securityHeaders(response);
  const cookie = onlyCookie(response);
  assert.ok(/^factory_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=604800$/.test(cookie));
  assert.ok(!/(?:^|;\s*)Secure(?:;|$)/i.test(cookie));
  const id = parseCookies(cookie).get("factory_session");
  assert.ok(sessions.get(id).csrfToken === body.csrfToken);
  assert.ok(id !== body.csrfToken);
});

test("replayed bootstrap tokens have exactly the same message as invalid tokens", async (t) => {
  const { app } = fixture(t);
  const wrong = failureBody(await bootstrap(app, { payload: { token: "wrong" } }), 401, "needs-auth", "authenticate");
  const accepted = await bootstrap(app);
  assert.equal(accepted.statusCode, 200);
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(accepted.json().csrfToken));
  const replayResponse = await bootstrap(app);
  const replay = failureBody(replayResponse, 401, "needs-auth", "authenticate");
  assert.equal(replay.error.message, wrong.error.message);
  assert.equal(replayResponse.headers["set-cookie"], undefined);
});

test("five invalid bootstrap requests lock out even the correct token for exactly 60 seconds", async (t) => {
  const { app, advance } = fixture(t);
  for (let i = 0; i < 4; i += 1)
    failureBody(await bootstrap(app, { payload: { token: "wrong" } }), 401, "needs-auth", "authenticate");
  failureBody(await bootstrap(app, { payload: { token: "wrong" } }), 429, "resource-exhausted", "wait");
  failureBody(await bootstrap(app), 429, "resource-exhausted", "wait");
  advance(59_999);
  failureBody(await bootstrap(app), 429, "resource-exhausted", "wait");
  advance(1);
  const response = await bootstrap(app);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ...successBody, csrfToken: response.json().csrfToken });
  failureBody(await bootstrap(app), 401, "needs-auth", "authenticate");
});

for (const [description, payload] of [
  ["missing token", {}], ["numeric token", { token: 1 }], ["null body", "null"],
  ["array body", []], ["unknown extra keys", { token: bootstrapToken, extra: true }],
]) {
  test(`bootstrap rejects ${description} with 400 and does not consume the gate`, async (t) => {
    const { app, gate } = fixture(t);
    failureBody(await bootstrap(app, { payload }), 400, "validation", "correct-input");
    assert.equal(gate.consume(bootstrapToken), "ok");
  });
}

test("bootstrap rejects a missing JSON body with 400", async (t) => {
  const { app } = fixture(t);
  failureBody(await request(app, { method: "POST", url: "/auth/bootstrap", headers: { origin, "content-type": "application/json" } }), 400, "validation");
});

test("malformed JSON is sanitized as 400 without echoing its text", async (t) => {
  const { app } = fixture(t);
  const response = await bootstrap(app, { payload: `{"token":"${bootstrapToken}","body-marker":` });
  failureBody(response, 400, "validation", "correct-input");
  assert.ok(!response.body.includes("body-marker"));
  assert.ok(!response.body.includes(bootstrapToken));
});

for (const contentType of [undefined, "text/plain", "application/x-www-form-urlencoded", "application/jsonp", "application/json; boundary=test"]) {
  test(`POST rejects unsupported Content-Type ${contentType ?? "missing"} as 415`, async (t) => {
    const { app } = fixture(t);
    failureBody(await bootstrap(app, { headers: { "content-type": contentType }, payload: JSON.stringify({ token: bootstrapToken }) }), 415, "validation");
  });
}

test("application/json with optional charset is accepted", async (t) => {
  for (const contentType of ["application/json", "application/json; charset=utf-8", 'application/json; charset="UTF-8"']) {
    const { app } = fixture(t);
    const response = await bootstrap(app, { headers: { "content-type": contentType } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ...successBody, csrfToken: response.json().csrfToken });
    assert.ok(/^[A-Za-z0-9_-]{43}$/.test(response.json().csrfToken));
  }
});

test("oversized JSON receives sanitized 413 before consuming bootstrap", async (t) => {
  const { app, gate } = fixture(t, { bodyLimit: 100 });
  failureBody(await bootstrap(app, { payload: { token: bootstrapToken, body: "oversized-marker".repeat(20) } }), 413, "validation");
  assert.equal(gate.consume(bootstrapToken), "ok");
});

test("default body limit is 262144 bytes", async (t) => {
  const { app } = fixture(t);
  failureBody(await bootstrap(app, { payload: { token: "x".repeat(262_144) } }), 413, "validation");
});

for (const forbiddenOrigin of [undefined, "null", "https://evil.com", "http://127.0.0.1:9999", `${origin}/`]) {
  test(`bootstrap rejects Origin ${forbiddenOrigin ?? "missing"} before consuming the gate`, async (t) => {
    const { app, gate } = fixture(t);
    failureBody(await bootstrap(app, { headers: { origin: forbiddenOrigin } }), 403, "forbidden");
    assert.equal(gate.consume(bootstrapToken), "ok");
  });
}

test("bootstrap plaintext never appears in success, failure, headers or sanitized thrown errors", async (t) => {
  const { app, sessions, gate } = fixture(t);
  const session = sessions.create();
  const responses = [
    await bootstrap(app, { headers: { origin: "https://evil.com" } }),
    await bootstrap(app, { payload: { token: bootstrapToken, extra: bootstrapToken } }),
    await bootstrap(app, { payload: `{"token":"${bootstrapToken}"` }),
    await bootstrap(app), await bootstrap(app),
    await write(app, session, {}, { url: "/explode", payload: { secret: bootstrapToken } }),
  ];
  const expected = [[403, "forbidden"], [400, "validation"], [400, "validation"], [200], [401, "needs-auth"], [500, "internal"]];
  responses.forEach((response, index) => {
    const [status, code] = expected[index];
    if (code) failureBody(response, status, code);
    else {
      assert.equal(response.statusCode, status);
      assert.deepEqual(response.json(), { ...successBody, csrfToken: response.json().csrfToken });
    }
    assert.ok(!response.body.includes(bootstrapToken));
    assert.ok(!JSON.stringify(response.headers).includes(bootstrapToken));
  });
  assert.ok(!JSON.stringify(gate).includes(bootstrapToken));
});

test("session guard rejects a missing cookie with 401 before Origin and CSRF", async (t) => {
  const { app } = fixture(t);
  failureBody(await request(app, { url: "/private" }), 401, "needs-auth", "authenticate");
  const response = await request(app, { method: "POST", url: "/private", payload: {}, headers: { origin: "https://evil.com" } });
  failureBody(response, 401, "needs-auth", "authenticate");
  assert.equal(response.headers["set-cookie"], undefined);
});

test("forged cookies receive 401 and are cleared", async (t) => {
  const { app } = fixture(t);
  for (const cookie of ["factory_session=forged", "factory_session=", "factory_session=bad value"]) {
    const response = await request(app, { url: "/private", headers: { cookie } });
    failureBody(response, 401, "needs-auth", "authenticate");
    assertCleared(response);
  }
});

test("expired session cookies receive 401 and are cleared", async (t) => {
  const { app, sessions, advance } = fixture(t, { sessionOptions: { idleMs: 100 } });
  const session = sessions.create();
  advance(100);
  const response = await request(app, { url: "/private", headers: sessionHeaders(session) });
  failureBody(response, 401, "needs-auth", "authenticate");
  assertCleared(response);
  assert.equal(sessions.size(), 0);
});

test("duplicate session cookie names are rejected and cleared even when both are valid", async (t) => {
  const { app, sessions } = fixture(t);
  const first = sessions.create();
  const second = sessions.create();
  for (const cookie of [
    `factory_session=${first.id}; factory_session=${second.id}`,
    `factory_session=${first.id}; factory_session=${first.id}`,
    `factory_session=${first.id}; factory_session=bad value`,
  ]) {
    const response = await request(app, { url: "/private", headers: { cookie } });
    failureBody(response, 401, "needs-auth", "authenticate");
    assertCleared(response);
  }
});

test("registered session routes attach the session and GET requires neither Origin nor CSRF", async (t) => {
  const { app, sessions } = fixture(t);
  const session = sessions.create();
  success(await request(app, { url: "/private", headers: { cookie: `factory_session=${session.id}` } }), { ...successBody, authenticated: true });
});

for (const forbiddenOrigin of [undefined, "null", "https://evil.com", "http://127.0.0.1:9999", `${origin}/`, "HTTP://127.0.0.1:8787"]) {
  test(`write guard rejects Origin ${forbiddenOrigin ?? "missing"} with 403`, async (t) => {
    const { app, sessions } = fixture(t);
    failureBody(await write(app, sessions.create(), { origin: forbiddenOrigin }), 403, "forbidden");
  });
}

test("listed localhost Origin is accepted exactly", async (t) => {
  const { app, sessions } = fixture(t);
  success(await write(app, sessions.create(), { origin: "http://localhost:8787" }));
});

for (const csrfToken of [undefined, "", "wrong", "wrong".repeat(1000)]) {
  test(`write guard rejects ${csrfToken === undefined ? "missing" : csrfToken === "" ? "empty" : csrfToken.length > 5 ? "long wrong" : "wrong"} CSRF with 403`, async (t) => {
    const { app, sessions } = fixture(t);
    failureBody(await write(app, sessions.create(), { "x-csrf-token": csrfToken }), 403, "forbidden");
  });
}

test("CSRF from another session cannot authenticate a write", async (t) => {
  const { app, sessions } = fixture(t);
  const session = sessions.create();
  const other = sessions.create();
  failureBody(await write(app, session, { "x-csrf-token": other.csrfToken }), 403, "forbidden");
});

test("write checks session, then Origin, then CSRF without reading later credentials", async (t) => {
  let csrfReads = 0;
  const current = {
    id: "valid-session", createdAt: 0, lastSeenAt: 0,
    get csrfToken() { csrfReads += 1; return "expected-csrf"; },
  };
  // A separate store makes the order observable without exposing failure details to clients.
  const ordered = createApiServer({
    origins: originsFor(8787), gate: createBootstrapGate(),
    sessions: { create: () => current, get: (id) => id === current.id ? current : null, destroy() {}, size: () => 1 },
    register(app, guards) { app.post("/ordered", { preHandler: guards.write }, async () => successBody); },
  });
  t.after(() => ordered.close());
  failureBody(await request(ordered, { method: "POST", url: "/ordered", payload: {}, headers: { origin: "https://evil.com" } }), 401, "needs-auth");
  failureBody(await request(ordered, { method: "POST", url: "/ordered", payload: {}, headers: { cookie: "factory_session=valid-session", origin: "https://evil.com" } }), 403, "forbidden");
  assert.equal(csrfReads, 0);
  failureBody(await request(ordered, { method: "POST", url: "/ordered", payload: {}, headers: { cookie: "factory_session=valid-session", origin } }), 403, "forbidden");
  assert.equal(csrfReads, 1);
});

test("correct session, exact Origin and matching CSRF authorize POST, PUT, PATCH and DELETE", async (t) => {
  const { app, sessions } = fixture(t);
  const session = sessions.create();
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    success(await write(app, session, {}, { method }));
    failureBody(await write(app, session, { "x-csrf-token": "wrong" }, { method }), 403, "forbidden");
    failureBody(await write(app, session, { cookie: undefined }, { method }), 401, "needs-auth");
  }
});

test("logout destroys the session, clears the cookie and rejects later requests", async (t) => {
  const { app, sessions } = fixture(t);
  const session = sessions.create();
  const response = await write(app, session, {}, { url: "/auth/logout" });
  success(response);
  assertCleared(response);
  assert.equal(sessions.get(session.id), null);
  failureBody(await request(app, { url: "/private", headers: sessionHeaders(session) }), 401, "needs-auth", "authenticate");
  failureBody(await write(app, session, {}, { url: "/auth/logout" }), 401, "needs-auth", "authenticate");
});

test("logout requires both Origin and CSRF before destroying a session", async (t) => {
  const { app, sessions } = fixture(t);
  const session = sessions.create();
  for (const headers of [{ origin: undefined }, { "x-csrf-token": undefined }]) {
    failureBody(await write(app, session, headers, { url: "/auth/logout" }), 403, "forbidden");
    assert.ok(sessions.get(session.id));
  }
});

test("handler exceptions return generic 500 internal with UUID correlation and no secret, stack, path or body", async (t) => {
  const { app, sessions } = fixture(t);
  const session = sessions.create();
  const response = await write(app, session, {}, { url: "/explode", payload: { token: bootstrapToken, privateBody: "private-body-marker" } });
  const body = failureBody(response, 500, "internal", "contact-host");
  assert.equal(body.error.message, "Internal server error.");
  assert.deepEqual(Object.keys(body.error).sort(), ["code", "correlationId", "message", "nextAction"]);
  for (const text of [bootstrapToken, session.id, session.csrfToken, "private-body-marker", "private-handler-marker", "host.ts", "E:\\private", "stack", "Error:"])
    assert.ok(!response.body.includes(text));
});

test("Fastify route validation errors map to sanitized 400 validation", async (t) => {
  const { app } = fixture(t, { register(app) {
    app.post("/validated", { schema: { body: { type: "object", required: ["name"], properties: { name: { type: "string" } } } } }, async () => successBody);
  } });
  failureBody(await request(app, { method: "POST", url: "/validated", payload: {} }), 400, "validation");
});

test("listenLoopback refuses every non-loopback host before calling listen", async () => {
  let listens = 0;
  const app = { listen() { listens += 1; throw new Error("must not listen"); } };
  for (const invalidHost of ["0.0.0.0", "::", "localhost", "", "192.168.1.5", "127.0.0.2", "[::1]"])
    await assert.rejects(listenLoopback(app, 0, invalidHost), /^Error: Host must be a loopback IP literal$/);
  assert.equal(listens, 0);
});

test("listenLoopback accepts the IPv6 loopback literal", async () => {
  const app = {
    async listen(options) { assert.deepEqual(options, { port: 0, host: "::1" }); },
    server: { address: () => ({ address: "::1", family: "IPv6", port: 45678 }) },
  };
  assert.equal(await listenLoopback(app, 0, "::1"), 45678);
});

test("listenLoopback binds IPv4 port 0 and serves health over real fetch", async (t) => {
  // Exercise the listener separately: the OS assigns its port after the API's origins would be configured.
  const app = Fastify({ logger: false });
  app.get("/health", async () => successBody);
  t.after(() => app.close());
  const port = await listenLoopback(app, 0);
  assert.ok(Number.isInteger(port) && port > 0);
  assert.equal(app.server.address().address, "127.0.0.1");
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), successBody);
  assert.ok([...response.headers.keys()].every((name) => !name.startsWith("access-control-")));
});

test("originsFor returns only the configured IPv4 and localhost HTTP origins", () => {
  assert.deepEqual(originsFor(8787), ["http://127.0.0.1:8787", "http://localhost:8787"]);
});

test("GET /auth/session returns the CSRF token of a valid session only", async (t) => {
  const { app, sessions, advance } = fixture(t);
  const login = await bootstrap(app);
  const cookie = `factory_session=${/factory_session=([^;]+)/.exec(login.headers["set-cookie"])[1]}`;
  const csrf = login.json().csrfToken;

  const ok = await request(app, { url: "/auth/session", headers: { cookie } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json(), { ...successBody, csrfToken: csrf });
  assert.equal(ok.headers["cache-control"], "no-store");
  assert.equal(ok.headers["access-control-allow-origin"], undefined);

  failureBody(await request(app, { url: "/auth/session" }), 401, "needs-auth", "authenticate");
  failureBody(await request(app, { url: "/auth/session", headers: { cookie: "factory_session=forged" } }), 401, "needs-auth", "authenticate");
  failureBody(await request(app, { url: "/auth/session", headers: { cookie, host: "evil.example:8787" } }), 403, "forbidden", "correct-input");
  assert.ok(!JSON.stringify((await request(app, { url: "/auth/session" })).json()).includes(csrf));

  // the recovered token is the one the write guard accepts
  const recovered = await request(app, { method: "POST", url: "/private", payload: {}, headers: { cookie, origin, "x-csrf-token": ok.json().csrfToken } });
  assert.equal(recovered.statusCode, 200);

  // an expired session recovers nothing
  advance(13 * 60 * 60 * 1000);
  assert.equal(sessions.size(), 0);
  failureBody(await request(app, { url: "/auth/session", headers: { cookie } }), 401, "needs-auth", "authenticate");
});
