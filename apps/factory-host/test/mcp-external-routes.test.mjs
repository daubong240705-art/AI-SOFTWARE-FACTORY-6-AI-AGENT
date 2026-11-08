import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
import { createExternalTools } from "../dist/mcp-external/index.js";
import { createMcpClient } from "../dist/mcp-external/client.js";
import { startHost } from "../dist/host.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { tasksCreateHandler } from "../dist/work/service.js";
import { loadPack, findLeadSeat, getActiveEngagement } from "../dist/org/index.js";
import { createAttempt, moveTask } from "../dist/dispatch/index.js";
import { randomUUID } from "node:crypto";
import { fixture, temp, writePack } from "./org-fixture.mjs";
import { remote } from "./mcp-external-fixture.mjs";

async function api(t, external) {
  const f = fixture(t); const host = "127.0.0.1:8787"; const origin = `http://${host}`;
  const gate = createBootstrapGate({ clock: f.clock });
  const app = createApiServer({ origins: [origin], clock: f.clock, gate, sessions: createSessionStore({ clock: f.clock }),
    register: createRoutes({ storage: f.storage, hub: f.hub, pipeline: f.pipeline, ...(external === undefined ? {} : { external }) }) });
  t.after(() => app.close());
  const auth = await app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host, origin, "content-type": "application/json" }, payload: { token: gate.token } });
  const cookie = auth.headers["set-cookie"].split(";")[0];
  return { app, host, get: () => app.inject({ url: "/mcp-servers", headers: { host, cookie } }) };
}
test("operator registry route requires session", async (t) => { const f = await api(t); assert.equal((await f.app.inject({ url: "/mcp-servers", headers: { host: f.host } })).statusCode, 401); });
test("operator registry is empty with feature off", async (t) => { const f = await api(t); const response = await f.get(); assert.equal(response.statusCode, 200); assert.deepEqual(response.json(), { apiVersion: 1, ok: true, servers: [] }); });
for (const [index, state] of ["ready", "unreachable", "disabled", "circuit-open"].entries()) test(`operator registry represents state ${index}`, async (t) => { const status = { name: "sample", origin: "https://example.invalid", state, tools: 1, lastCheckedAt: null }; const f = await api(t, { status: () => [status] }); assert.deepEqual((await f.get()).json().servers, [status]); });
test("operator view exposes origin without endpoint query or headers", async (t) => { const f = fixture(t); const external = createExternalTools({ servers: [{ name: "sample", url: "https://example.invalid/private-endpoint?q=synthetic-placeholder", headers: { Authorization: "env:EXAMPLE_KEY" } }] }, { raw: f.raw, env: {} }); t.after(() => external.close()); const a = await api(t, external); const response = await a.get(); assert.deepEqual(response.json().servers, [{ name: "sample", origin: "https://example.invalid", state: "disabled", tools: 0, lastCheckedAt: null }]); assert.equal(response.body.includes("synthetic-placeholder"), false); assert.equal(response.body.includes("EXAMPLE_KEY"), false); assert.equal(response.body.includes("private-endpoint"), false); });
test("client operator status changes after discovery", async (t) => { const r = await remote(t); const c = createMcpClient(r.config(), { env: {} }); t.after(() => c.close()); assert.equal(c.status().state, "unreachable"); await c.listTools(); assert.equal(c.status().state, "ready"); assert.equal(c.status().tools, 1); assert.equal(typeof c.status().lastCheckedAt, "string"); });
for (const enabled of [false, true]) test(`Host wires external operator route variant ${enabled}`, async (t) => { let host; const root = temp(t, () => host?.close()); host = await startHost({ stateDir: join(root, "state"), port: 0, onBootstrapToken() {}, ...(enabled ? { mcpServers: { servers: [{ name: "sample", url: "https://example.invalid/mcp", timeoutMs: 15000, maxResultBytes: 32768, maxTools: 32 }] } } : {}) }); t.after(() => host.close()); const response = await host.app.inject({ url: "/mcp-servers", headers: { host: `127.0.0.1:${host.port}` } }); assert.equal(response.statusCode, 401); });
test("Host connects pinned permissions to remote MCP and operator status", async (t) => {
  let host; let bootstrap; const root = temp(t, () => host?.close()); const r = await remote(t);
  const packDir = writePack(root, "host-external", (manifest) => { manifest.seats[0].tools = ["ext.sample.*"]; });
  host = await startHost({ stateDir: join(root, "state"), packDir, port: 0, dispatch: {}, mcpServers: { servers: [r.config()] },
    modelProxy: { port: 0, approvedModels: ["approved"], upstream: { baseUrl: "http://127.0.0.1:1/v1", apiKey: "synthetic-placeholder" } }, onBootstrapToken(value) { bootstrap = value; } });
  t.after(() => host.close());
  const raw = host.storage.raw; const clock = () => new Date();
  const projectId = randomUUID(); const taskId = randomUUID(); const attemptId = randomUUID();
  const pipeline = createCommandPipeline({ storage: host.storage, hub: host.hub, clock, handlers: { "projects.create": createProjectsCreateHandler({ pack: loadPack(packDir) }), "tasks.create": tasksCreateHandler } });
  const execute = (type, payload) => assert.equal(pipeline.execute({ apiVersion: 1, commandId: randomUUID(), projectId, type, payload }).status, 200);
  execute("projects.create", { name: "External fixture", workspace: { kind: "directory", root: "/workspace/fixture" } });
  execute("tasks.create", { taskId, code: "EXT-001", title: "Reference", goal: "Read", brief: "Brief", parentTaskId: null, engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] });
  for (const state of ["accepted", "ready", "active"]) moveTask(raw, projectId, taskId, state);
  const seatId = findLeadSeat(raw, getActiveEngagement(raw, projectId).teamId).id;
  createAttempt(raw, { projectId, taskId, id: attemptId, seatId, runtime: "fake", provider: "fake", model: "approved", effort: "medium", now: clock().toISOString() });
  raw.prepare("INSERT OR IGNORE INTO nodes (id,revision,name,platform,trust,state,slots_total,slots_used,last_heartbeat_at) VALUES ('local',1,'Local','windows','trusted-workstation','online',2,0,?)").run(clock().toISOString());
  raw.prepare("UPDATE attempts SET state = 'running',node_id = 'local',lease_id = ?,lease_expires_at = ? WHERE id = ?").run(randomUUID(), new Date(Date.now() + 600000).toISOString(), attemptId);
  const token = host.proxy.tokens.issue({ projectId, taskId, attemptId, epoch: 1, allowedModels: ["approved"] }).token;
  const send = async (method, params = {}) => { const response = await fetch(`http://127.0.0.1:${host.proxy.port}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); return (await response.json()).result; };
  assert.ok((await send("tools/list")).tools.some((tool) => tool.name === "ext.sample.lookup"));
  assert.equal((await send("tools/call", { name: "ext.sample.lookup", arguments: { query: "public" } })).isError, false);
  for (const value of [token, projectId, taskId, attemptId]) assert.equal(JSON.stringify(r.received).includes(value), false);
  const address = `127.0.0.1:${host.port}`;
  const auth = await host.app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host: address, origin: `http://${address}`, "content-type": "application/json" }, payload: { token: bootstrap } });
  const view = await host.app.inject({ url: "/mcp-servers", headers: { host: address, cookie: auth.headers["set-cookie"].split(";")[0] } });
  assert.equal(view.json().servers[0].state, "ready"); assert.equal(view.json().servers[0].tools, 1);
});
