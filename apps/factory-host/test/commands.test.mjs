import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  API_VERSION, commandResponseSchema, eventSchema, failureResponseSchema, projectSchema, receiptSchema, successResponseSchema,
} from "@factory/contracts";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { CommandError, createCommandPipeline } from "../dist/commands/index.js";
import { EventHub } from "../dist/events/hub.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
import { getProject, listProjects, projectsCreateHandler } from "../dist/projects/index.js";
import { openStorage } from "../dist/storage/database.js";

const host = "127.0.0.1:8787";
const origin = `http://${host}`;
const bootstrapToken = "commands-test-fixed-bootstrap-token";
const clock = () => new Date("2026-11-07T10:00:00.000Z");
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const command = (overrides = {}) => ({
  apiVersion: API_VERSION, commandId: randomUUID(), projectId: randomUUID(), type: "projects.create",
  payload: { name: "Test project", workspace: { kind: "directory", root: `/workspace/${randomUUID()}` } }, ...overrides,
});
const chat = (overrides = {}) => command({ type: "chat.send", payload: {
  conversationId: randomUUID(), expectedRevision: 1, messageId: randomUUID(), text: "private-message-marker",
  attachmentIds: [], intent: "discuss", context: [], draftRevision: null,
}, ...overrides });
const counts = (raw) => Object.fromEntries([
  ["projects", "SELECT count(*) AS n FROM projects"],
  ["receipts", "SELECT count(*) AS n FROM command_receipts"],
  ["streams", "SELECT count(*) AS n FROM project_streams"],
  ["events", "SELECT count(*) AS n FROM event_log"],
  ["outbox", "SELECT count(*) AS n FROM outbox"],
].map(([key, sql]) => [key, raw.prepare(sql).get().n]));
const empty = { projects: 0, receipts: 0, streams: 0, events: 0, outbox: 0 };
const created = { projects: 1, receipts: 1, streams: 1, events: 2, outbox: 2 };
const receiptRow = (raw, id) => raw.prepare("SELECT * FROM command_receipts WHERE command_id = ?").get(id);
const events = (raw) => raw.prepare("SELECT body_json FROM event_log ORDER BY sequence").all()
  .map((row) => eventSchema.parse(JSON.parse(row.body_json)));

function success(response) {
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(successResponseSchema.parse(body), body);
  assert.equal(body.ok, true);
  assert.equal(body.receipt.state, "completed");
  return body;
}
function failure(response, status, code) {
  assert.equal(response.statusCode, status);
  const body = response.json();
  assert.deepEqual(failureResponseSchema.parse(body), body);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, code);
  assert.equal(response.body.includes("stack"), false);
  return body;
}
async function bootstrap(app) {
  const response = await app.inject({ method: "POST", url: "/auth/bootstrap",
    headers: { host, origin, "content-type": "application/json" }, payload: { token: bootstrapToken } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  return { cookie: response.headers["set-cookie"].split(";")[0], csrf: response.json().csrfToken };
}
async function fixture(t, { file = ":memory:", handlers, configureHub } = {}) {
  const storage = openStorage(file);
  storage.migrate({ migrationsDir, backupDir: null });
  const hub = new EventHub(storage.raw, { clock });
  configureHub?.(hub);
  let pipeline = createCommandPipeline({ storage, hub, clock, handlers });
  const results = [];
  const app = createApiServer({ origins: [origin], clock,
    gate: createBootstrapGate({ token: bootstrapToken, clock }), sessions: createSessionStore({ clock }),
    register: createRoutes({ storage, hub, pipeline: { execute(...args) {
      const result = pipeline.execute(...args);
      results.push(result);
      return result;
    } } }),
  });
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await app.close(); storage.close(); } };
  t.after(close);
  const session = await bootstrap(app);
  const headers = { host, origin, cookie: session.cookie, "x-csrf-token": session.csrf, "content-type": "application/json" };
  return { app, storage, raw: storage.raw, hub, results, headers, close,
    replaceHandlers(next) { pipeline = createCommandPipeline({ storage, hub, clock, handlers: next }); },
    post(payload, overrides = {}) {
      return app.inject({ method: "POST", url: "/commands", payload,
        headers: Object.fromEntries(Object.entries({ ...headers, ...overrides }).filter(([, value]) => value !== undefined)) });
    },
    get(headersOverride = {}) { return app.inject({ method: "GET", url: "/projects", headers: { host, cookie: session.cookie, ...headersOverride } }); },
  };
}

test("projects.create commits the completed receipt, project, stream and ordered valid events", async (t) => {
  const f = await fixture(t);
  const c = command();
  const body = success(await f.post(c));
  assert.deepEqual(body.receipt, { commandId: c.commandId, projectId: c.projectId, state: "completed",
    effects: [{ kind: "project", id: c.projectId, revision: 1 }] });
  assert.deepEqual(getProject(f.raw, c.projectId), { id: c.projectId, revision: 1, ...c.payload, leadAgentId: null, disposition: "active" });
  assert.deepEqual(counts(f.raw), created);
  assert.equal(f.hub.currentCursor(c.projectId).sequence, "2");
  const all = events(f.raw);
  assert.deepEqual(all.map((e) => [e.payload.type, e.cursor.sequence]), [["entity.changed", "1"], ["command.receipted", "2"]]);
  assert.deepEqual(all[0].payload.entity, body.receipt.effects[0]);
  assert.deepEqual(all[1].payload.receipt, body.receipt);
  for (const event of all) {
    assert.equal(event.causationId, c.commandId);
    assert.equal(event.rootCausationId, c.commandId);
    assert.equal(event.occurredAt, clock().toISOString());
  }
  const row = receiptRow(f.raw, c.commandId);
  assert.equal(row.actor_id, "operator");
  assert.equal(row.created_at, clock().toISOString());
});

test("same command replays a byte-identical response with zero database writes", async (t) => {
  const f = await fixture(t);
  const c = command();
  const first = await f.post(c);
  success(first);
  const before = f.raw.prepare("SELECT total_changes() AS n").get().n;
  const replay = await f.post(c);
  success(replay);
  assert.equal(replay.body, first.body);
  assert.deepEqual(f.results.map((r) => r.replayed), [false, true]);
  assert.equal(f.raw.prepare("SELECT total_changes() AS n").get().n, before);
  assert.deepEqual(counts(f.raw), created);
});

test("canonical fingerprint ignores recursive object key ordering", async (t) => {
  const f = await fixture(t);
  const c = command();
  const first = await f.post(c);
  success(first);
  const replay = await f.post({ payload: { workspace: { root: c.payload.workspace.root, kind: "directory" }, name: c.payload.name },
    type: c.type, projectId: c.projectId, commandId: c.commandId, apiVersion: API_VERSION });
  success(replay);
  assert.equal(replay.body, first.body);
  const canonical = JSON.stringify({ payload: { name: c.payload.name, workspace: { kind: "directory", root: c.payload.workspace.root } },
    projectId: c.projectId, type: c.type });
  assert.equal(receiptRow(f.raw, c.commandId).fingerprint, createHash("sha256").update(canonical).digest("hex"));
});

test("reusing commandId with different payload conflicts and preserves the original receipt", async (t) => {
  const f = await fixture(t);
  const c = command();
  const first = await f.post(c);
  success(first);
  const before = receiptRow(f.raw, c.commandId);
  const body = failure(await f.post({ ...c, payload: { ...c.payload, name: "Changed" } }), 409, "conflict");
  assert.equal(body.error.message, "commandId was already used for a different command");
  assert.equal(body.error.nextAction, "correct-input");
  assert.deepEqual(receiptRow(f.raw, c.commandId), before);
  const replay = await f.post(c);
  success(replay);
  assert.equal(replay.body, first.body);
  assert.deepEqual(counts(f.raw), created);
});

test("reusing commandId for a different project conflicts without creating a second project", async (t) => {
  const f = await fixture(t);
  const c = command();
  success(await f.post(c));
  failure(await f.post({ ...c, projectId: randomUUID() }), 409, "conflict");
  assert.deepEqual(counts(f.raw), created);
});

test("reusing commandId for another command type conflicts", async (t) => {
  const f = await fixture(t);
  const c = command();
  success(await f.post(c));
  failure(await f.post(chat({ commandId: c.commandId, projectId: c.projectId })), 409, "conflict");
  assert.deepEqual(counts(f.raw), created);
});

test("a new commandId for an existing project stores a rejection and replays 409 without extra events", async (t) => {
  const f = await fixture(t);
  const c = command();
  success(await f.post(c));
  const duplicate = { ...c, commandId: randomUUID() };
  const response = await f.post(duplicate);
  const body = failure(response, 409, "conflict");
  assert.equal(body.error.message, "project already exists");
  assert.equal(body.error.nextAction, "refresh");
  assert.equal(receiptRow(f.raw, duplicate.commandId).state, "rejected");
  const rejected = events(f.raw).at(-1).payload;
  assert.equal(rejected.type, "command.receipted");
  assert.deepEqual(receiptSchema.parse(rejected.receipt), { commandId: duplicate.commandId, projectId: c.projectId,
    state: "rejected", effects: [], error: body.error });
  const before = f.raw.prepare("SELECT total_changes() AS n").get().n;
  const replay = await f.post(duplicate);
  failure(replay, 409, "conflict");
  assert.equal(replay.body, response.body);
  assert.equal(f.results.at(-1).replayed, true);
  assert.equal(f.raw.prepare("SELECT total_changes() AS n").get().n, before);
  assert.deepEqual(counts(f.raw), { ...created, receipts: 2, events: 3, outbox: 3 });
});

test("another active project's workspace root rejects creation without a new stream", async (t) => {
  const f = await fixture(t);
  const c = command();
  success(await f.post(c));
  const body = failure(await f.post(command({ payload: c.payload })), 409, "conflict");
  assert.equal(body.error.message, "workspace already used by another project");
  assert.equal(body.error.nextAction, "correct-input");
  assert.deepEqual(counts(f.raw), { ...created, receipts: 2 });
});

test("parked projects also reserve their workspace roots", async (t) => {
  const f = await fixture(t);
  const c = command();
  success(await f.post(c));
  f.raw.prepare("UPDATE projects SET disposition = ? WHERE id = ?").run("parked", c.projectId);
  failure(await f.post(command({ payload: c.payload })), 409, "conflict");
  assert.deepEqual(counts(f.raw), { ...created, receipts: 2 });
});

test("archived projects allow workspace reuse by a new project", async (t) => {
  const f = await fixture(t);
  const c = command();
  success(await f.post(c));
  f.raw.prepare("UPDATE projects SET disposition = ? WHERE id = ?").run("archived", c.projectId);
  const next = command({ payload: c.payload });
  const body = success(await f.post(next));
  assert.equal(body.receipt.projectId, next.projectId);
  assert.equal(getProject(f.raw, next.projectId).disposition, "active");
  assert.deepEqual(counts(f.raw), { projects: 2, receipts: 2, streams: 2, events: 4, outbox: 4 });
});

test("invalid body returns field errors and echoes only a valid commandId without storing anything", async (t) => {
  const f = await fixture(t);
  const c = command({ payload: {} });
  const body = failure(await f.post(c), 400, "validation");
  assert.equal(body.commandId, c.commandId);
  assert.ok(body.error.fields.some((field) => field.path === "payload.name"));
  assert.ok(body.error.fields.some((field) => field.path === "payload.workspace"));
  assert.deepEqual(counts(f.raw), empty);
});

for (const invalid of [null, [], { commandId: "bad-id", payload: "private-invalid-marker" }]) {
  test(`invalid envelope ${JSON.stringify(invalid)} omits commandId and stores nothing`, async (t) => {
    const f = await fixture(t);
    const body = failure(await f.post(JSON.stringify(invalid)), 400, "validation");
    assert.equal(Object.hasOwn(body, "commandId"), false);
    assert.ok(Array.isArray(body.error.fields));
    assert.equal(JSON.stringify(body).includes("private-invalid-marker"), false);
    assert.deepEqual(counts(f.raw), empty);
  });
}

test("malformed JSON is rejected by the API parser without storing a receipt", async (t) => {
  const f = await fixture(t);
  failure(await f.post('{"private-json-marker":'), 400, "validation");
  assert.deepEqual(counts(f.raw), empty);
});

test("wrong content type is rejected by the security layer", async (t) => {
  const f = await fixture(t);
  failure(await f.post("private-text-marker", { "content-type": "text/plain" }), 415, "validation");
  assert.deepEqual(counts(f.raw), empty);
});

test("valid chat.send without a handler stores unsupported and replays an identical 501", async (t) => {
  const f = await fixture(t);
  const c = chat();
  const response = await f.post(c);
  const body = failure(response, 501, "unsupported");
  assert.equal(body.commandId, c.commandId);
  assert.equal(response.body.includes(c.payload.text), false);
  const before = receiptRow(f.raw, c.commandId);
  assert.equal(before.state, "rejected");
  const replay = await f.post(c);
  failure(replay, 501, "unsupported");
  assert.equal(replay.body, response.body);
  assert.equal(f.results.at(-1).replayed, true);
  assert.deepEqual(receiptRow(f.raw, c.commandId), before);
  assert.deepEqual(counts(f.raw), { ...empty, receipts: 1 });
});

test("unsupported command on an existing stream appends only its rejected receipt", async (t) => {
  const f = await fixture(t);
  const c = command();
  success(await f.post(c));
  const body = failure(await f.post(chat({ projectId: c.projectId })), 501, "unsupported");
  const all = events(f.raw);
  assert.equal(all.length, 3);
  assert.equal(all[2].payload.type, "command.receipted");
  assert.equal(all[2].payload.receipt.error.correlationId, body.error.correlationId);
});

test("unexpected handler errors roll back all writes, expose a generic 500, and permit retry", async (t) => {
  const f = await fixture(t, { handlers: { "projects.create": (ctx, c) => {
    projectsCreateHandler(ctx, c);
    ctx.hub.append({ projectId: c.projectId, causationId: c.commandId,
      payload: { type: "entity.changed", entity: { kind: "project", id: c.projectId, revision: 1 } } });
    throw new Error(`private-error-marker ${JSON.stringify(c.payload)}`);
  } } });
  const c = command();
  const response = await f.post(c);
  const body = failure(response, 500, "internal");
  assert.equal(body.error.message, "Internal server error.");
  assert.equal(response.body.includes("private-error-marker"), false);
  assert.equal(response.body.includes(c.payload.workspace.root), false);
  assert.deepEqual(counts(f.raw), empty);
  f.replaceHandlers({ "projects.create": projectsCreateHandler });
  success(await f.post(c));
  assert.deepEqual(counts(f.raw), created);
});

test("CommandError rolls back handler rows and streams but stores a durable rejection", async (t) => {
  const f = await fixture(t, { handlers: { "projects.create": (ctx, c) => {
    projectsCreateHandler(ctx, c);
    throw new CommandError("conflict", "Revision changed.", "refresh", { currentRevision: 3 });
  } } });
  const c = command();
  const response = await f.post(c);
  const body = failure(response, 409, "conflict");
  assert.equal(body.error.currentRevision, 3);
  assert.equal(body.error.nextAction, "refresh");
  assert.deepEqual(counts(f.raw), { ...empty, receipts: 1 });
  assert.equal(getProject(f.raw, c.projectId), undefined);
  f.replaceHandlers({ "projects.create": projectsCreateHandler });
  const replay = await f.post(c);
  failure(replay, 409, "conflict");
  assert.equal(replay.body, response.body);
  assert.equal(f.results.at(-1).replayed, true);
});

test("failure on the second append rolls back project, receipt, stream, events and outbox", async (t) => {
  const seen = [];
  const f = await fixture(t, { configureHub(hub) {
    const append = hub.append.bind(hub);
    let calls = 0;
    hub.append = (input) => { if (++calls === 2) throw new Error("second-append-marker"); return append(input); };
  } });
  const c = command();
  f.hub.subscribe(c.projectId, (cursor) => seen.push(cursor));
  const body = failure(await f.post(c), 500, "internal");
  assert.equal(body.error.message, "Internal server error.");
  assert.deepEqual(counts(f.raw), empty);
  assert.deepEqual(seen, []);
  assert.equal(f.hub.currentCursor(c.projectId), null);
});

test("20 concurrent injects produce exactly one project and byte-identical responses", async (t) => {
  const f = await fixture(t);
  const c = command();
  const responses = await Promise.all(Array.from({ length: 20 }, () => f.post(c)));
  for (const response of responses) { success(response); assert.equal(response.body, responses[0].body); }
  assert.equal(f.results.filter((r) => !r.replayed).length, 1);
  assert.equal(f.results.filter((r) => r.replayed).length, 19);
  assert.deepEqual(counts(f.raw), created);
});

test("projects, receipts and events persist and replay identically after reopening storage", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "factory-commands-"));
  assert.equal(resolve(dir).startsWith(resolve(tmpdir()) + "\\factory-commands-") ||
    resolve(dir).startsWith(resolve(tmpdir()) + "/factory-commands-"), true);
  const file = join(dir, "host.db");
  let first;
  let second;
  try {
    first = await fixture(t, { file });
    const c = command();
    const response = await first.post(c);
    success(response);
    const before = events(first.raw);
    const cursor = first.hub.currentCursor(c.projectId);
    await first.close();
    second = await fixture(t, { file });
    const replay = await second.post(c);
    success(replay);
    assert.equal(replay.body, response.body);
    assert.equal(second.results.at(-1).replayed, true);
    assert.deepEqual(counts(second.raw), created);
    assert.deepEqual(events(second.raw), before);
    assert.deepEqual(second.hub.currentCursor(c.projectId), cursor);
    assert.equal(getProject(second.raw, c.projectId).name, c.payload.name);
  } finally {
    await second?.close();
    await first?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const [label, headers, status, code] of [
  ["session", { cookie: undefined }, 401, "needs-auth"],
  ["Origin", { origin: undefined }, 403, "forbidden"],
  ["CSRF", { "x-csrf-token": undefined }, 403, "forbidden"],
  ["valid Origin", { origin: "http://evil.example" }, 403, "forbidden"],
  ["valid CSRF", { "x-csrf-token": "invalid-test-csrf" }, 403, "forbidden"],
]) {
  test(`/commands requires ${label}`, async (t) => {
    const f = await fixture(t);
    failure(await f.post(command(), headers), status, code);
    assert.deepEqual(counts(f.raw), empty);
    assert.equal(f.results.length, 0);
  });
}

test("/commands accepts a bootstrapped session with correct Origin and CSRF", async (t) => {
  const f = await fixture(t);
  success(await f.post(command()));
  assert.deepEqual(counts(f.raw), created);
});

test("GET /projects requires a session", async (t) => {
  const f = await fixture(t);
  failure(await f.app.inject({ method: "GET", url: "/projects", headers: { host } }), 401, "needs-auth");
  assert.deepEqual(counts(f.raw), empty);
});

test("GET /projects lists valid projects ordered by id using only session authentication", async (t) => {
  const f = await fixture(t);
  const ids = ["ffffffff-ffff-4fff-8fff-ffffffffffff", "11111111-1111-4111-8111-111111111111"];
  for (const id of ids) success(await f.post(command({ projectId: id })));
  const response = await f.get();
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(Object.keys(body).sort(), ["apiVersion", "ok", "projects"]);
  assert.equal(body.apiVersion, API_VERSION);
  assert.equal(body.ok, true);
  assert.deepEqual(body.projects.map((p) => p.id), [...ids].sort());
  for (const p of body.projects) assert.deepEqual(projectSchema.parse(p), p);
  assert.deepEqual(body.projects, listProjects(f.raw));
});

test("GET /projects returns an empty list for a fresh database", async (t) => {
  const f = await fixture(t);
  const response = await f.get();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { apiVersion: API_VERSION, ok: true, projects: [] });
});

for (const [label, payload] of [
  ["huge name", { name: "private-huge-name-marker".repeat(1000), workspace: { kind: "directory", root: "/safe" } }],
  ["traversal", { name: "private-traversal-marker", workspace: { kind: "git", root: "/safe/../private-root-marker" } }],
  ["backslashes", { name: "private-backslash-marker", workspace: { kind: "directory", root: "/safe\\private-root-marker" } }],
]) {
  test(`malicious ${label} is rejected before any handler or database write`, async (t) => {
    let called = false;
    const f = await fixture(t, { handlers: { "projects.create": () => { called = true; throw new Error("must not run"); } } });
    const response = await f.post(command({ payload }));
    const body = failure(response, 400, "validation");
    assert.ok(body.error.fields.length > 0);
    assert.equal(called, false);
    assert.equal(response.body.includes("private-"), false);
    assert.deepEqual(counts(f.raw), empty);
  });
}

test("invalid and rejected responses never echo payloads, unknown keys or stack traces", async (t) => {
  const f = await fixture(t);
  const c = command();
  success(await f.post(c));
  const marker = "private-payload-marker";
  const rejected = await f.post(command({ projectId: c.projectId,
    payload: { name: marker, workspace: { kind: "directory", root: `/${marker}` } } }));
  failure(rejected, 409, "conflict");
  const invalid = await f.post(command({ payload: { name: marker, workspace: { kind: "directory", root: `/${marker}` }, [marker]: marker } }));
  failure(invalid, 400, "validation");
  for (const response of [rejected, invalid]) {
    assert.equal(response.body.includes(marker), false);
    assert.equal(Object.hasOwn(response.json(), "payload"), false);
    assert.equal(response.body.includes("Error:"), false);
    assert.equal(response.body.includes(".ts:"), false);
  }
});

test("field error count and lengths are bounded", async (t) => {
  const f = await fixture(t);
  const c = chat();
  c.payload.context = Array.from({ length: 60 }, () => ({ id: "invalid", revision: 0 }));
  const body = failure(await f.post(c), 400, "validation");
  assert.equal(body.error.fields.length, 50);
  assert.ok(body.error.fields.every((field) => field.message.length <= 500 && field.path.length <= 256));
  assert.deepEqual(counts(f.raw), empty);
});

test("custom handlers receive injected clock and id generator and actorId is durable", async (t) => {
  const f = await fixture(t);
  const correlationId = randomUUID();
  const pipeline = createCommandPipeline({ storage: f.storage, hub: f.hub, clock, newId: () => correlationId,
    handlers: { "projects.create": (ctx) => {
      assert.equal(ctx.clock().toISOString(), clock().toISOString());
      assert.equal(ctx.newId(), correlationId);
      throw new CommandError("not-found", "Missing prerequisite.", "refresh");
    } },
  });
  const c = command();
  const result = pipeline.execute(c, "test-operator");
  assert.equal(result.status, 404);
  assert.deepEqual(commandResponseSchema.parse(result.body), result.body);
  assert.equal(result.body.error.correlationId, correlationId);
  assert.equal(receiptRow(f.raw, c.commandId).actor_id, "test-operator");
  assert.deepEqual(counts(f.raw), { ...empty, receipts: 1 });
});
