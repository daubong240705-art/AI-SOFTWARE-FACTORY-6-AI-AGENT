import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { test as nodeTest } from "node:test";
import { API_VERSION, eventSchema, failureResponseSchema, streamResetSchema } from "@factory/contracts";
import { createApiServer, createRoutes, listenLoopback, originsFor } from "../dist/api/index.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { EventHub } from "../dist/events/hub.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
import { openStorage } from "../dist/storage/database.js";

const test = (name, fn) => nodeTest(name, { timeout: 15_000 }, fn);
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const command = () => ({ apiVersion: API_VERSION, commandId: randomUUID(), projectId: randomUUID(),
  type: "projects.create", payload: { name: "Stream project", workspace: { kind: "directory", root: `/workspace/${randomUUID()}` } } });
const cursorId = (cursor) => `${cursor.epoch}:${cursor.sequence}`;
const sequences = (events) => events.map((event) => Number(event.cursor.sequence));
const range = (start, count) => Array.from({ length: count }, (_, i) => start + i);

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(predicate) {
  const until = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() >= until) assert.fail("Timed out waiting for stream cleanup");
    await delay(5);
  }
}

function parseFrame(raw) {
  const fields = {};
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) { fields.comment = line.slice(2); continue; }
    const colon = line.indexOf(":");
    if (colon >= 0) fields[line.slice(0, colon)] = line.slice(colon + 1).replace(/^ /, "");
  }
  return { ...fields, raw };
}

function frameReader(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next() {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const raw = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          return parseFrame(raw);
        }
        const chunk = await reader.read();
        if (chunk.done) { assert.equal(buffer, ""); return null; }
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
    async event() {
      for (;;) {
        const frame = await this.next();
        assert.ok(frame, "Expected an event before stream ended");
        if (frame.comment !== undefined) continue;
        assert.equal(frame.event, "factory-event");
        const event = eventSchema.parse(JSON.parse(frame.data));
        assert.equal(frame.id, cursorId(event.cursor));
        assert.equal(frame.raw, `id: ${frame.id}\nevent: factory-event\ndata: ${JSON.stringify(event)}`);
        return event;
      }
    },
    async events(count) {
      const events = [];
      for (let i = 0; i < count; i++) events.push(await this.event());
      return events;
    },
  };
}

async function fixture(t, options = {}) {
  const storage = openStorage(":memory:");
  storage.migrate({ migrationsDir, backupDir: null });
  const hub = new EventHub(storage.raw);
  let subscriptions = 0;
  const subscribe = hub.subscribe.bind(hub);
  hub.subscribe = (id, listener) => {
    subscriptions++;
    const unsubscribe = subscribe(id, listener);
    let active = true;
    return () => { if (active) { active = false; subscriptions--; unsubscribe(); } };
  };
  const port = await freePort();
  const origin = originsFor(port)[0];
  const gate = createBootstrapGate();
  // Generated only for this isolated test, handed directly to the bootstrap request.
  const token = gate.token;
  const pipeline = createCommandPipeline({ storage, hub });
  const app = createApiServer({ origins: originsFor(port), gate, sessions: createSessionStore(),
    register: createRoutes({ storage, hub, pipeline, keepAliveMs: 10_000, ...options.limits }) });
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.abort();
    try { await app.close(); } finally { storage.close(); }
  });
  options.configure?.({ app, hub, storage });
  await listenLoopback(app, port);
  const bootstrap = await fetch(`${origin}/auth/bootstrap`, { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token }) });
  assert.equal(bootstrap.status, 200);
  const cookie = bootstrap.headers.get("set-cookie").split(";")[0];
  const csrf = (await bootstrap.json()).csrfToken;
  const post = (body) => fetch(`${origin}/commands`, { method: "POST", body: JSON.stringify(body),
    headers: { origin, cookie, "x-csrf-token": csrf, "content-type": "application/json" } });
  const project = command();
  const created = await post(project);
  assert.equal(created.status, 200);
  await created.json();
  const append = (count = 1, projectId = project.projectId) => hub.transaction(() =>
    Array.from({ length: count }, () => hub.append({ projectId, causationId: randomUUID(),
      payload: { type: "entity.changed", entity: { kind: "project", id: projectId, revision: 1 } } })));
  const get = (path, headers = {}) => fetch(`${origin}${path}`, { headers: { cookie, ...headers } });
  return { app, hub, storage, origin, cookie, post, append, projectId: project.projectId, get,
    subscriptions: () => subscriptions,
    cursor: (id = project.projectId) => hub.currentCursor(id),
    async open({ projectId = project.projectId, after, lastEventId, headers = {} } = {}) {
      const controller = new AbortController();
      clients.push(controller);
      const path = `/projects/${projectId}/events${after === undefined ? "" : `?after=${encodeURIComponent(after)}`}`;
      const response = await fetch(`${origin}${path}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        headers: { cookie, ...(lastEventId === undefined ? {} : { "Last-Event-ID": lastEventId }), ...headers } });
      return { response, frames: frameReader(response), abort: () => controller.abort() };
    },
  };
}

async function failure(response, status, code) {
  assert.equal(response.status, status);
  const body = failureResponseSchema.parse(await response.json());
  assert.equal(body.error.code, code);
  return body;
}

test("stream requires a session cookie", async (t) => {
  const f = await fixture(t);
  await failure(await fetch(`${f.origin}/projects/${f.projectId}/events`), 401, "needs-auth");
});

test("stream validates project ids", async (t) => {
  const f = await fixture(t);
  await failure(await f.get("/projects/not-a-uuid/events"), 400, "validation");
});

test("unknown projects have no stream", async (t) => {
  const f = await fixture(t);
  await failure(await f.get(`/projects/${randomUUID()}/events`), 404, "not-found");
});

test("existing project without a stream returns 404", async (t) => {
  const f = await fixture(t);
  const projectId = randomUUID();
  f.storage.raw.prepare("INSERT INTO projects (id, revision, name, workspace_kind, workspace_root, disposition) VALUES (?, ?, ?, ?, ?, ?)")
    .run(projectId, 1, "No stream", "directory", `/workspace/${projectId}`, "active");
  await failure(await f.get(`/projects/${projectId}/events`), 404, "not-found");
});

test("malformed query cursors return validation failures", async (t) => {
  const f = await fixture(t);
  for (const after of ["", "invalid", `${randomUUID()}:01`, `${randomUUID()}:-1`, `${randomUUID()}:1:2`,
    `invalid:1`, `${randomUUID()}:9223372036854775808`, `${randomUUID()}:1.5`]) {
    await failure(await f.get(`/projects/${f.projectId}/events?after=${encodeURIComponent(after)}`), 400, "validation");
  }
});

test("malformed Last-Event-ID and duplicate after values return 400", async (t) => {
  const f = await fixture(t);
  await failure(await f.get(`/projects/${f.projectId}/events`, { "Last-Event-ID": "invalid" }), 400, "validation");
  await failure(await f.get(`/projects/${f.projectId}/events?after=a&after=b`), 400, "validation");
});

test("hijacked stream sends all security and streaming headers without CORS", async (t) => {
  const f = await fixture(t);
  const { response } = await f.open();
  assert.equal(response.status, 200);
  for (const [name, value] of Object.entries({ "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store",
    connection: "keep-alive", "x-accel-buffering": "no", "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer", "cross-origin-resource-policy": "same-origin" })) assert.equal(response.headers.get(name), value);
  assert.ok([...response.headers.keys()].every((name) => !name.startsWith("access-control-")));
});

test("default replay delivers command-created events from sequence zero in exact wire format", async (t) => {
  const f = await fixture(t);
  const stream = await f.open();
  const events = await stream.frames.events(2);
  assert.deepEqual(events.map((event) => event.payload.type), ["entity.changed", "command.receipted"]);
  assert.deepEqual(sequences(events), [1, 2]);
  assert.ok(events.every((event) => event.projectId === f.projectId && event.cursor.epoch === f.cursor().epoch));
});

test("live events arrive on the existing stream only after commit", async (t) => {
  let reads = 0;
  const f = await fixture(t, { configure({ hub, storage }) {
    const readAfter = hub.readAfter.bind(hub);
    hub.readAfter = (...args) => { reads++; assert.equal(storage.raw.inTransaction, false); return readAfter(...args); };
  } });
  const stream = await f.open({ after: cursorId(f.cursor()) });
  const before = reads;
  f.hub.transaction(() => { f.append(); assert.equal(reads, before); });
  assert.equal((await stream.frames.event()).cursor.sequence, "3");
  assert.ok(reads > before);
});

test("rolled-back appends never reach streams", async (t) => {
  const f = await fixture(t);
  const stream = await f.open({ after: cursorId(f.cursor()) });
  let rolledBack;
  assert.throws(() => f.hub.transaction(() => { [rolledBack] = f.append(); throw new Error("rollback"); }), /rollback/);
  const [committed] = f.append();
  const received = await stream.frames.event();
  assert.equal(received.eventId, committed.eventId);
  assert.notEqual(received.eventId, rolledBack.eventId);
  assert.equal(received.cursor.sequence, "3");
});

test("Last-Event-ID resumes the five remaining events after reading three of eight", async (t) => {
  const f = await fixture(t);
  f.append(6);
  const first = await f.open();
  const read = await first.frames.events(3);
  first.abort();
  const second = await f.open({ lastEventId: cursorId(read.at(-1).cursor) });
  assert.deepEqual(sequences(await second.frames.events(5)), [4, 5, 6, 7, 8]);
  // A later live event also proves replay did not include a sixth duplicate.
  f.append();
  assert.equal((await second.frames.event()).cursor.sequence, "9");
});

test("query after takes precedence over Last-Event-ID", async (t) => {
  const f = await fixture(t);
  f.append(6);
  const stream = await f.open({ after: `${f.cursor().epoch}:5`, lastEventId: `${f.cursor().epoch}:2` });
  assert.deepEqual(sequences(await stream.frames.events(3)), [6, 7, 8]);
});

test("valid query after takes precedence over a malformed Last-Event-ID", async (t) => {
  const f = await fixture(t);
  const stream = await f.open({ after: `${f.cursor().epoch}:0`, lastEventId: "malformed" });
  assert.equal((await stream.frames.event()).cursor.sequence, "1");
});

test("seeded disconnect and reconnect points preserve the complete sequence exactly once", async (t) => {
  const f = await fixture(t);
  let seed = 9173;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const received = [];
  let lastEventId;
  for (let i = 0; i < 10; i++) {
    const stream = await f.open({ lastEventId });
    f.append(2 + random() % 5);
    const available = Number(f.cursor().sequence) - received.length;
    const count = 1 + random() % available;
    received.push(...await stream.frames.events(count));
    lastEventId = cursorId(received.at(-1).cursor);
    stream.abort();
    f.append(1 + random() % 3);
  }
  const final = await f.open({ lastEventId });
  received.push(...await final.frames.events(Number(f.cursor().sequence) - received.length));
  assert.deepEqual(sequences(received), range(1, Number(f.cursor().sequence)));
  assert.equal(new Set(received.map((event) => event.eventId)).size, received.length);
});

for (const reason of ["epoch-changed", "gap", "expired"]) {
  test(`snapshot-required ${reason} has no id and ends the stream`, async (t) => {
    const f = await fixture(t);
    f.append(6);
    if (reason === "expired") f.hub.prune(f.projectId, 2);
    const after = reason === "epoch-changed" ? `${randomUUID()}:0` : `${f.cursor().epoch}:${reason === "gap" ? "9" : "0"}`;
    const stream = await f.open({ after });
    const frame = await stream.frames.next();
    assert.equal(frame.event, "snapshot-required");
    assert.equal(frame.id, undefined);
    const reset = streamResetSchema.parse(JSON.parse(frame.data));
    assert.deepEqual(reset, { apiVersion: API_VERSION, projectId: f.projectId, type: "snapshot-required", reason });
    assert.equal(frame.raw, `event: snapshot-required\ndata: ${JSON.stringify(reset)}`);
    assert.equal(await stream.frames.next(), null);
    await waitFor(() => f.subscriptions() === 0);
  });
}

test("keep-alive comments arrive on idle streams", async (t) => {
  const f = await fixture(t, { limits: { keepAliveMs: 50 } });
  const stream = await f.open({ after: cursorId(f.cursor()) });
  const frame = await stream.frames.next();
  assert.equal(frame.raw, ": ping");
  assert.equal(frame.comment, "ping");
});

test("project A events never reach the stream for project B", async (t) => {
  const f = await fixture(t);
  const other = command();
  const response = await f.post(other);
  assert.equal(response.status, 200);
  await response.json();
  const stream = await f.open({ projectId: other.projectId, after: cursorId(f.cursor(other.projectId)) });
  f.append(5);
  f.append(1, other.projectId);
  const event = await stream.frames.event();
  assert.equal(event.projectId, other.projectId);
  assert.equal(event.cursor.sequence, "3");
});

test("maxStreams rejects with JSON before hijack and abort frees a slot", async (t) => {
  const f = await fixture(t, { limits: { maxStreams: 1 } });
  const first = await f.open();
  const response = await f.get(`/projects/${f.projectId}/events`);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const body = await failure(response, 429, "resource-exhausted");
  assert.equal(body.error.nextAction, "wait");
  assert.equal(f.subscriptions(), 1);
  first.abort();
  await waitFor(() => f.subscriptions() === 0);
  const next = await f.open();
  assert.equal(next.response.status, 200);
});

test("client abort unsubscribes and permits appends and quick app shutdown", async (t) => {
  const f = await fixture(t);
  const stream = await f.open();
  assert.equal(f.subscriptions(), 1);
  stream.abort();
  await waitFor(() => f.subscriptions() === 0);
  assert.doesNotThrow(() => f.append(3));
  const closed = f.app.close();
  await Promise.race([closed, delay(2000).then(() => assert.fail("app.close hung"))]);
});

test("app.close ends every open stream and removes subscriptions", async (t) => {
  const f = await fixture(t);
  const first = await f.open({ after: cursorId(f.cursor()) });
  const second = await f.open({ after: cursorId(f.cursor()) });
  const closing = f.app.close();
  assert.equal(await first.frames.next(), null);
  assert.equal(await second.frames.next(), null);
  await closing;
  assert.equal(f.subscriptions(), 0);
});

test("a burst of 300 events is replayed completely in ordered batches of 50", async (t) => {
  const f = await fixture(t, { limits: { batchSize: 50 } });
  const after = cursorId(f.cursor());
  f.append(300);
  const stream = await f.open({ after });
  assert.deepEqual(sequences(await stream.frames.events(300)), range(3, 300));
});

test("concurrent appends during paginated replay are never lost", async (t) => {
  const f = await fixture(t, { limits: { batchSize: 1 } });
  f.append(40);
  let appended = false;
  const readAfter = f.hub.readAfter.bind(f.hub);
  f.hub.readAfter = (...args) => {
    const page = readAfter(...args);
    if (!appended) { appended = true; setImmediate(() => f.append(20)); }
    return page;
  };
  const stream = await f.open();
  assert.deepEqual(sequences(await stream.frames.events(62)), range(1, 62));
});

test("notification during the last replay page schedules another drain", async (t) => {
  const f = await fixture(t);
  let appended = false;
  const readAfter = f.hub.readAfter.bind(f.hub);
  f.hub.readAfter = (...args) => {
    const page = readAfter(...args);
    if (!appended) { appended = true; queueMicrotask(() => f.append()); }
    return page;
  };
  const stream = await f.open();
  assert.deepEqual(sequences(await stream.frames.events(3)), [1, 2, 3]);
});

test("attacker Host header receives 403 on the stream route", async (t) => {
  const f = await fixture(t);
  // node:http guarantees an explicit Host override, independent of fetch's pooling.
  const response = await new Promise((resolve, reject) => {
    const request = httpRequest(`${f.origin}/projects/${f.projectId}/events`, { headers: { host: "attacker.example", cookie: f.cookie } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(response.status, 403);
  assert.equal(failureResponseSchema.parse(response.body).error.code, "forbidden");
});

test("one stream read failure ends only that stream", async (t) => {
  const f = await fixture(t);
  const other = command();
  const created = await f.post(other);
  assert.equal(created.status, 200);
  await created.json();
  const first = await f.open({ after: cursorId(f.cursor()) });
  const second = await f.open({ projectId: other.projectId, after: cursorId(f.cursor(other.projectId)) });
  const readAfter = f.hub.readAfter.bind(f.hub);
  f.hub.readAfter = (projectId, ...args) => {
    if (projectId === f.projectId) throw new Error("isolated read failure");
    return readAfter(projectId, ...args);
  };
  assert.doesNotThrow(() => f.append());
  assert.equal(await first.frames.next(), null);
  f.append(1, other.projectId);
  assert.equal((await second.frames.event()).projectId, other.projectId);
});

test("backpressure pauses all frame writes until drain, including keep-alive", async (t) => {
  let release;
  let writes = 0;
  const f = await fixture(t, { limits: { keepAliveMs: 10 }, configure({ app }) {
    app.addHook("onRequest", async (request, reply) => {
      if (!request.url.split("?")[0].endsWith("/events")) return;
      const res = reply.raw;
      const write = res.write.bind(res);
      res.write = (...args) => {
        writes++;
        const result = write(...args);
        if (writes === 1) { release = () => res.emit("drain"); return false; }
        return result;
      };
    });
  } });
  const stream = await f.open();
  assert.equal((await stream.frames.event()).cursor.sequence, "1");
  await delay(35);
  assert.equal(writes, 1);
  f.append();
  release();
  assert.deepEqual(sequences(await stream.frames.events(2)), [2, 3]);
});

test("response write errors are isolated and unsubscribe the failing stream", async (t) => {
  let fail = false;
  const f = await fixture(t, { configure({ app }) {
    app.addHook("onRequest", async (request, reply) => {
      if (!request.url.split("?")[0].endsWith("/events")) return;
      const write = reply.raw.write.bind(reply.raw);
      reply.raw.write = (...args) => { if (fail) throw new Error("isolated write failure"); return write(...args); };
    });
  } });
  const stream = await f.open({ after: cursorId(f.cursor()) });
  fail = true;
  assert.doesNotThrow(() => f.append());
  assert.equal(await stream.frames.next(), null);
  assert.equal(f.subscriptions(), 0);
  fail = false;
  const next = await f.open({ after: `${f.cursor().epoch}:2` });
  assert.equal((await next.frames.event()).cursor.sequence, "3");
});

test("client abort while waiting for drain releases the subscription and pending write", async (t) => {
  const f = await fixture(t, { configure({ app }) {
    app.addHook("onRequest", async (request, reply) => {
      if (!request.url.split("?")[0].endsWith("/events")) return;
      const write = reply.raw.write.bind(reply.raw);
      reply.raw.write = (...args) => { write(...args); return false; };
    });
  } });
  const stream = await f.open();
  assert.equal((await stream.frames.event()).cursor.sequence, "1");
  stream.abort();
  await waitFor(() => f.subscriptions() === 0);
  assert.doesNotThrow(() => f.append());
  await f.app.close();
});

test("shutdown bounds the wait for a response that cannot finish flushing", async (t) => {
  const f = await fixture(t, { configure({ app }) {
    app.addHook("onRequest", async (request, reply) => {
      if (!request.url.split("?")[0].endsWith("/events")) return;
      const write = reply.raw.write.bind(reply.raw);
      reply.raw.write = (...args) => { write(...args); return false; };
      // Model a socket whose send buffer cannot flush, without relying on OS buffer sizes.
      reply.raw.end = () => reply.raw;
    });
  } });
  const stream = await f.open();
  assert.equal((await stream.frames.event()).cursor.sequence, "1");
  await f.app.close();
  assert.equal(f.subscriptions(), 0);
  await assert.rejects(stream.frames.next(), /terminated|closed|abort/i);
});
