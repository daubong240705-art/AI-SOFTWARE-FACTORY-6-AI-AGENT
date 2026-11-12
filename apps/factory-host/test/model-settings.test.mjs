import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setImmediate as immediate } from "node:timers/promises";
import { test as nodeTest } from "node:test";
import { fileURLToPath } from "node:url";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { EventHub } from "../dist/events/hub.js";
import { startHost, parseEnv } from "../dist/host.js";
import { createFakeGateway, createChatCompletionsGateway } from "../dist/models/index.js";
import { modelsSetHandler, readModelSettings } from "../dist/models/settings.js";
import { openStorage, loadMigrations } from "../dist/storage/index.js";
import { createFakeRuntime, moveTask } from "../dist/dispatch/index.js";
import { findLeadSeat, getActiveEngagement } from "../dist/org/index.js";

const test = (name, fn) => nodeTest(name, { timeout: 15_000 }, fn);
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const seed = { leadModel: "env-lead", leadEffort: "medium", agentModels: ["env-agent", "env-other"] };
const values = { leadModel: "new-lead", leadEffort: "xhigh", agentModels: ["new-default", "new-other"], expectedRevision: null };
const command = (projectId, patch = {}) => ({ apiVersion: 1, commandId: randomUUID(), projectId, type: "models.set", payload: { ...values, ...patch } });
const key = "synthetic-model-list-private-marker";
const hostsByTest = new WeakMap();
function scratch(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "factory-model-settings-")));
  t.after(async () => {
    for (const host of hostsByTest.get(t) ?? []) await host.close();
    assert.ok(resolve(root).startsWith(realpathSync(tmpdir()) + sep + "factory-model-settings-")); rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function fixture(t) {
  const storage = openStorage(":memory:"); t.after(() => storage.close());
  storage.migrate({ migrationsDir, backupDir: null });
  const hub = new EventHub(storage.raw); const pipeline = createCommandPipeline({ storage, hub, handlers: { "models.set": modelsSetHandler } });
  const projectId = randomUUID();
  assert.equal(pipeline.execute({ apiVersion: 1, commandId: randomUUID(), projectId, type: "projects.create", payload: {
    name: "Settings", workspace: { kind: "directory", root: "/workspace/settings" },
  } }).status, 200);
  return { storage, raw: storage.raw, hub, pipeline, projectId };
}
async function launch(t, options = {}, stateDir = join(scratch(t), "state")) {
  let bootstrapToken;
  const host = await startHost({ stateDir, port: 0, onBootstrapToken(token) { bootstrapToken = token; },
    lead: { model: seed.leadModel, effort: seed.leadEffort }, agentModels: seed.agentModels, ...options });
  hostsByTest.set(t, [...(hostsByTest.get(t) ?? []), host]);
  t.after(() => host.close());
  const origin = `http://127.0.0.1:${host.port}`;
  const headers = { host: `127.0.0.1:${host.port}`, origin };
  const auth = await host.app.inject({ method: "POST", url: "/auth/bootstrap", headers, payload: { token: bootstrapToken } });
  assert.equal(auth.statusCode, 200);
  Object.assign(headers, { cookie: auth.headers["set-cookie"].split(";")[0], "x-csrf-token": auth.json().csrfToken });
  const post = (type, payload, projectId = randomUUID(), commandId = randomUUID()) => host.app.inject({ method: "POST", url: "/commands", headers,
    payload: { apiVersion: 1, commandId, projectId, type, payload } });
  const projectId = randomUUID();
  assert.equal((await post("projects.create", { name: "Settings", workspace: { kind: "directory", root: `/workspace/${projectId}` } }, projectId)).statusCode, 200);
  return { ...host, headers, projectId, post, read: () => host.app.inject({ url: "/system/models", headers }), stateDir };
}
async function upstream(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}/v1`;
}

test("0024 upgrades 0023 without a seed row, preserves data and is idempotent", t => {
  const root = scratch(t), old = join(root, "old"); mkdirSync(old);
  for (const name of readdirSync(migrationsDir).filter(n => n.endsWith(".sql") && Number(n.slice(0, 4)) <= 23))
    copyFileSync(join(migrationsDir, name), join(old, name));
  const storage = openStorage(":memory:"); t.after(() => storage.close());
  storage.migrate({ migrationsDir: old, backupDir: null });
  storage.raw.exec("INSERT INTO projects VALUES ('preserved',1,'Preserved','directory','/workspace/preserved','active')");
  const before = storage.raw.prepare("SELECT * FROM projects").all();
  const result = storage.migrate({ migrationsDir, backupDir: join(root, "backups") });
  assert.deepEqual(result.applied, [24]); assert.ok(result.backup);
  assert.equal(loadMigrations(migrationsDir).at(-1).name, "model_settings");
  assert.deepEqual(storage.raw.prepare("SELECT * FROM model_settings").all(), []);
  assert.deepEqual(readModelSettings(storage.raw, seed), { ...seed, revision: null, source: "environment" });
  assert.deepEqual(storage.raw.prepare("SELECT * FROM projects").all(), before);
  assert.equal(storage.raw.prepare("SELECT strict FROM pragma_table_list WHERE name='model_settings'").get().strict, 1);
  assert.deepEqual(storage.migrate({ migrationsDir, backupDir: null }).applied, []);
});

test("model settings database enforces singleton, effort, JSON array, uniqueness and bounds", t => {
  const f = fixture(t);
  const insert = f.raw.prepare("INSERT INTO model_settings VALUES (?, 'lead', ?, ?, 1, '2026-11-12T00:00:00Z')");
  for (const [id, effort, models] of [[2,"medium",'["a"]'], [1,"max",'["a"]'], [1,"low","bad"],
    [1,"low",'{}'], [1,"low",'[]'], [1,"low",'["a","a"]'], [1,"low",'[""]'], [1,"low",'[1]'],
    [1,"low",JSON.stringify(Array.from({ length: 9 }, (_, i) => `m${i}`))]]) assert.throws(() => insert.run(id, effort, models));
  insert.run(1,"high",'["a","b"]');
  assert.throws(() => f.raw.prepare("UPDATE model_settings SET agent_models='[\"a\",\"a\"]'").run());
  assert.deepEqual(f.raw.pragma("foreign_key_check"), []);
});

test("models.set upserts, replays, increments globally and emits the usual revision event", t => {
  const f = fixture(t);
  const absent = f.pipeline.execute(command(f.projectId, { expectedRevision: 1 })); assert.equal(absent.status, 409);
  const cmd = command(f.projectId); const created = f.pipeline.execute(cmd);
  assert.equal(created.status, 200); assert.deepEqual(created.body.receipt.effects, [{ kind: "model-settings", id: "00000000-0000-0000-0000-000000000000", revision: 1 }]);
  assert.equal(f.pipeline.execute(cmd).replayed, true);
  const stale = f.pipeline.execute(command(f.projectId)); assert.equal(stale.status, 409); assert.equal(stale.body.error.currentRevision, 1);
  const update = f.pipeline.execute(command(f.projectId, { expectedRevision: 1, leadModel: "next-lead", agentModels: ["next-default"] }));
  assert.equal(update.status, 200); assert.equal(update.body.receipt.effects[0].revision, 2);
  assert.deepEqual(readModelSettings(f.raw, seed), { leadModel: "next-lead", leadEffort: "xhigh", agentModels: ["next-default"], revision: 2, source: "database" });
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM model_settings").get().n, 1);
  const events = f.raw.prepare("SELECT body_json FROM event_log").all().map(r => JSON.parse(r.body_json));
  assert.ok(events.some(e => e.payload.type === "entity.changed" && e.payload.entity.kind === "model-settings" && e.payload.entity.revision === 2));
  assert.equal(f.pipeline.execute(command(f.projectId, { expectedRevision: 1 })).status, 409);
});

test("models.set rejects invalid payloads before persisting anything", t => {
  const f = fixture(t);
  for (const patch of [{ agentModels: [] }, { agentModels: [""] }, { agentModels: ["a","a"] }, { agentModels: ["a b"] },
    { agentModels: ["a\u0001b"] }, { agentModels: Array.from({ length: 9 }, (_, i) => `m${i}`) }, { leadEffort: "max" }, { leadModel: "" }]) {
    assert.equal(f.pipeline.execute(command(f.projectId, patch)).status, 400);
  }
  assert.deepEqual(f.raw.prepare("SELECT * FROM model_settings").all(), []);
  assert.equal(f.pipeline.execute(command(randomUUID())).status, 404);
});

test("GET /system/models requires session and reports environment, database and capabilities without credentials", async t => {
  const f = await launch(t);
  const denied = await f.app.inject({ url: "/system/models", headers: { host: f.headers.host } }); assert.equal(denied.statusCode, 401);
  const first = await f.read(); assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json(), { apiVersion: 1, ok: true, settings: { ...seed, revision: null, source: "environment" },
    gateway: { configured: false, keyPresent: false }, available: null, catalog: null, efforts: ["low","medium","high","xhigh"] });
  const changed = await f.post("models.set", values, f.projectId); assert.equal(changed.statusCode, 200);
  const response = await f.read();
  assert.deepEqual(response.json().settings, { leadModel: values.leadModel, leadEffort: values.leadEffort, agentModels: values.agentModels, revision: 1, source: "database" });
  const capabilities = await f.app.inject({ url: "/system/capabilities", headers: f.headers }); assert.ok(capabilities.json().commands.includes("models.set"));
  for (const res of [first, response, changed, capabilities, denied]) assert.equal(JSON.stringify({ body: res.body, headers: res.headers }).includes(key), false);
});

test("database settings persist across restart and override changed environment seeds", async t => {
  const root = scratch(t), stateDir = join(root,"state");
  const first = await launch(t, {}, stateDir);
  assert.equal((await first.post("models.set", values, first.projectId)).statusCode, 200); await first.close();
  const next = await launch(t, { lead: { model: "changed-env", effort: "low" }, agentModels: ["changed-env-agent"] }, stateDir);
  assert.equal((await next.read()).json().settings.leadModel, values.leadModel);
  assert.equal((await next.read()).json().settings.revision, 1);
});

test("GET models lists ids only through the gateway and caches for exactly 60 seconds", async t => {
  let now = new Date("2026-11-12T01:00:00Z"), calls = 0;
  const baseUrl = await upstream(t, (req, res) => {
    calls++; assert.equal(req.url, "/v1/models"); assert.equal(req.method, "GET"); assert.equal(req.headers.authorization, `Bearer ${key}`);
    res.setHeader("x-private-header", key);
    res.end(JSON.stringify({ data: [{ id: "available-one", name: "Available One", owned_by: "tester", supports_vision: true, capabilities: { reasoning: true }, secret: key, headers: { authorization: `Bearer ${key}` } },
      { id: key }, { id: "available-two" }, { id: "available-one" }, { id: "" }, { id: "white space" }, {}], apiKey: key }));
  });
  const f = await launch(t, { clock: () => now, modelGateway: createChatCompletionsGateway({ baseUrl, apiKey: key }) });
  const responses = await Promise.all([f.read(),f.read()]);
  for (const res of responses) {
    assert.deepEqual(res.json().available, ["available-one","available-two"]);
    assert.deepEqual(res.json().catalog, [{ id: "available-one", name: "Available One", provider: "tester", vision: true, reasoning: true }, { id: "available-two" }]);
    assert.deepEqual(res.json().gateway, { configured: true, keyPresent: true });
    assert.equal(JSON.stringify({ body: res.body, headers: res.headers }).includes(key), false);
    assert.equal(res.headers["x-private-header"], undefined); assert.equal(res.body.includes("authorization"), false);
  }
  assert.equal(calls, 1); now = new Date(now.getTime() + 59_999); await f.read(); assert.equal(calls, 1);
  now = new Date(now.getTime() + 1); await f.read(); assert.equal(calls, 2);
  assert.equal(f.storage.raw.serialize().includes(Buffer.from(key)), false);
});

test("GET models returns null and caches failures when the gateway is unreachable", async t => {
  let calls = 0;
  const gateway = createChatCompletionsGateway({ baseUrl: "https://example.test/v1", apiKey: key,
    fetchImpl: async () => { calls++; throw new Error(key); } });
  const f = await launch(t, { modelGateway: gateway });
  for (let i=0;i<2;i++) { const res = await f.read(); assert.equal(res.statusCode, 200); assert.equal(res.json().available, null); assert.equal(res.body.includes(key), false); }
  assert.equal(calls, 1);
});

test("Lead resolves updated settings on the next turn and records the requested effort", async t => {
  const gateway = createFakeGateway([{ text: "first reply" }, { text: "second reply" }]);
  const f = await launch(t, { modelGateway: gateway });
  const conversationId = randomUUID(), lead = findLeadSeat(f.storage.raw, getActiveEngagement(f.storage.raw, f.projectId).teamId);
  assert.equal((await f.post("conversations.create", { conversationId, agentId: lead.id, title: "Lead", workItemId: null }, f.projectId)).statusCode, 200);
  const send = async () => {
    const revision = f.storage.raw.prepare("SELECT revision FROM conversations WHERE id=? AND project_id=?").get(conversationId,f.projectId).revision;
    const res = await f.post("chat.send", { conversationId, messageId: randomUUID(), expectedRevision: revision, text: "Discuss models", attachmentIds: [],
      intent: "discuss", context: [], draftRevision: null }, f.projectId);
    assert.equal(res.statusCode, 200); await f.lead.idle();
  };
  await send(); assert.equal(gateway.calls[0].model, seed.leadModel); assert.equal(gateway.calls[0].effort, seed.leadEffort);
  assert.equal((await f.post("models.set", values, f.projectId)).statusCode, 200);
  await send(); assert.equal(gateway.calls[1].model, values.leadModel); assert.equal(gateway.calls[1].effort, values.leadEffort);
  assert.deepEqual(f.storage.raw.prepare("SELECT effort FROM usage_records ORDER BY rowid").all().map(r => r.effort), [seed.leadEffort, values.leadEffort]);
});

test("new attempts receive the new default while live tokens keep and enforce their original models", async t => {
  const runtime = createFakeRuntime({ stepMs: 0 }); let upstreamCalls = 0;
  const baseUrl = await upstream(t, (_req, res) => { upstreamCalls++; res.end('{}'); });
  const f = await launch(t, { dispatch: { nodeSlots: 2, adapters: [runtime] }, modelProxy: {
    port: 0, upstream: { baseUrl, apiKey: key }, approvedModels: seed.agentModels,
  } });
  f.storage.raw.prepare("UPDATE seats SET slots=2").run();
  f.storage.raw.prepare("UPDATE engagements SET max_concurrent=2").run();
  const start = async (code) => {
    const taskId = randomUUID();
    assert.equal((await f.post("tasks.create", { taskId, code, title: "Settings attempt", goal: "[fake:hang]", brief: "Wait", parentTaskId: null,
      engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] }, f.projectId)).statusCode, 200);
    for (const state of ["accepted","ready","active"]) moveTask(f.storage.raw,f.projectId,taskId,state);
    const seatId = findLeadSeat(f.storage.raw,getActiveEngagement(f.storage.raw,f.projectId).teamId).id;
    const length = runtime.started.length;
    f.dispatch.enqueue({ projectId: f.projectId, taskId, seatId });
    for (let i=0;i<200 && runtime.started.length === length;i++) await immediate();
    assert.equal(runtime.started.length, length+1); return runtime.started.at(-1).model;
  };
  const first = await start("MD-001"); assert.deepEqual(first.models, seed.agentModels);
  assert.equal((await f.post("models.set", values, f.projectId)).statusCode, 200);
  const second = await start("MD-002"); assert.equal(second.models[0], values.agentModels[0]);
  assert.deepEqual(f.proxy.tokens.resolve(first.token).allowedModels, seed.agentModels);
  assert.deepEqual(f.proxy.tokens.resolve(second.token).allowedModels, values.agentModels);
  for (const model of [first,second]) {
    const list = await fetch(`${model.baseUrl}/models`, { headers: { authorization: `Bearer ${model.token}` } });
    assert.deepEqual((await list.json()).data.map(m=>m.id), model.models);
  }
  const refused = await fetch(`${first.baseUrl}/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${first.token}`, "content-type": "application/json" },
    body: JSON.stringify({ model: values.agentModels[0], messages: [{ role: "user", content: "hello" }], max_tokens: 16 }) });
  assert.equal(refused.status,403); assert.equal((await refused.json()).error.code,"model_not_allowed"); assert.equal(upstreamCalls,0);
  assert.equal(f.storage.raw.serialize().includes(Buffer.from(key)),false);
});

test("environment agent models retain startup validation and new shape bounds", () => {
  for (const input of ["", "a,a", "a b", "a\u0001b", "a".repeat(257), Array.from({ length:9 },(_,i)=>`m${i}`).join(",")])
    assert.throws(() => parseEnv({ FACTORY_AGENT_MODELS: input }), /FACTORY_AGENT_MODELS/);
});
