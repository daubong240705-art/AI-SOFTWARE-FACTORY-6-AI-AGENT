import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { test as nodeTest } from "node:test";
import { createMcpHandler } from "../dist/mcp/rpc.js";
import { McpToolError, assertActiveGrant } from "../dist/mcp/security.js";
import { registerAgentOutput, registerAttemptResults, getArtifactVersion } from "../dist/artifacts/service.js";
import { createContentStore } from "../dist/artifacts/content-store.js";
import { createModelProxy, createTokenRegistry } from "../dist/proxy/index.js";
import { openStorage } from "../dist/storage/database.js";
import { EventHub } from "../dist/events/hub.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { tasksCreateHandler } from "../dist/work/service.js";
import { loadPack, findLeadSeat, getActiveEngagement } from "../dist/org/index.js";
import { createAttempt, moveTask, createDispatcher, RuntimeRegistry } from "../dist/dispatch/index.js";
import { DEFAULT_BUDGET_CONFIG } from "../dist/policy/index.js";
import { startHost } from "../dist/host.js";

const test = (name, fn) => nodeTest(name, { timeout: 15000 }, fn);
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const pack = loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)));
const address = "127.0.0.1:18787";
const rpc = (method, params, id = 1) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
const init = (protocolVersion) => ({ protocolVersion, capabilities: {}, clientInfo: { name: "fixture", version: "1" } });
const output = (extra = {}) => ({ title: "Deliverable", kind: "other", mediaType: "text/markdown", path: "result.md", abstractL0: "A deliverable.", ...extra });
const fakeGrant = Object.freeze({ projectId: randomUUID(), taskId: randomUUID(), attemptId: randomUUID(), epoch: 1, allowedModels: [], expiresAt: Infinity });
function fake(extra = {}) {
  const calls = [];
  const handler = createMcpHandler({ progress: (...args) => calls.push(args),
    requestDecision: (...args) => { calls.push(args); return { approvalId: fakeGrant.taskId }; },
    registerOutput: (...args) => { calls.push(args); return { artifactId: fakeGrant.taskId, version: 1 }; }, ...extra }, "test-version");
  return { calls, handle: (body) => handler.handle(fakeGrant, body), call: (name, args) => handler.handle(fakeGrant, rpc("tools/call", { name, arguments: args })) };
}
function temp(t, beforeRemove = async () => {}) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "factory-mcp-")));
  t.after(async () => {
    await beforeRemove();
    assert.ok(resolve(root).startsWith(fs.realpathSync(tmpdir()) + sep + "factory-mcp-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function seed(storage, hub, workspacePath, clock) {
  const raw = storage.raw;
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
    "projects.create": createProjectsCreateHandler({ pack }), "tasks.create": tasksCreateHandler,
  } });
  const projectId = randomUUID(); const taskId = randomUUID(); const attemptId = randomUUID();
  const execute = (type, payload) => assert.equal(pipeline.execute({ apiVersion: 1, commandId: randomUUID(), projectId, type, payload }).status, 200);
  execute("projects.create", { name: "MCP fixture", workspace: { kind: "directory", root: "/workspace/fixture" } });
  execute("tasks.create", { taskId, code: "MCP-001", title: "Deliver", goal: "Deliver", brief: "Brief", parentTaskId: null,
    engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] });
  for (const state of ["accepted", "ready", "active"]) moveTask(raw, projectId, taskId, state);
  const seatId = findLeadSeat(raw, getActiveEngagement(raw, projectId).teamId).id;
  createAttempt(raw, { projectId, taskId, id: attemptId, seatId, runtime: "fake", provider: "fake", model: "fake", effort: "medium", now: clock().toISOString() });
  raw.prepare("INSERT OR IGNORE INTO nodes (id,revision,name,platform,trust,state,slots_total,slots_used,last_heartbeat_at) VALUES ('local',1,'Local','windows','trusted-workstation','online',2,0,?)").run(clock().toISOString());
  raw.prepare(`UPDATE attempts SET state = 'running', node_id = 'local', lease_id = ?, lease_expires_at = ? WHERE id = ?`)
    .run(randomUUID(), new Date(clock().getTime() + 600000).toISOString(), attemptId);
  return { projectId, taskId, attemptId, epoch: 1, allowedModels: ["approved"], workspacePath };
}
async function fixture(t, extra = {}) {
  const root = temp(t); const workspacePath = join(root, "workspace"); fs.mkdirSync(workspacePath);
  fs.writeFileSync(join(workspacePath, "result.md"), "# Deliverable\nExact bytes.\n");
  const storage = openStorage(":memory:"); storage.migrate({ migrationsDir, backupDir: null });
  let time = Date.now(); const clock = () => new Date(time); const raw = storage.raw; const hub = new EventHub(raw, { clock });
  const grantInput = seed(storage, hub, workspacePath, clock);
  const tokens = createTokenRegistry({ clock, maxLifetimeMs: 600000 }); const token = tokens.issue(grantInput).token;
  const grant = tokens.resolve(token); const store = createContentStore({ dir: join(root, "content") });
  const dispatcher = createDispatcher({ storage, hub, registry: new RuntimeRegistry(), clock });
  let progressCalls = 0; let upstreamCalls = 0;
  const deps = { raw, store, now: clock, newId: randomUUID };
  const mcp = createMcpHandler({
    progress(g, input) {
      assertActiveGrant(raw, g);
      if (progressCalls >= 500) throw new McpToolError("tool limit reached");
      if (!dispatcher.recordAgentProgress(g, input.summary, input.percent)) throw new McpToolError("attempt is not active");
      progressCalls++;
    },
    registerOutput(g, input) {
      return hub.transaction(() => {
        const ref = registerAgentOutput(deps, { ...input, grant: g });
        hub.append({ projectId: g.projectId, causationId: g.attemptId, payload: { type: "entity.changed",
          entity: { kind: "artifact-version", id: ref.artifactId, revision: ref.version } } });
        return ref;
      });
    },
  });
  const upstream = { providerId: "fixture", chatCompletions: async () => { upstreamCalls++; throw new Error("not expected"); } };
  const proxy = createModelProxy({ upstream, tokens, raw, clock, newId: randomUUID, budget: DEFAULT_BUDGET_CONFIG, allowedHosts: [address], mcp, ...extra });
  t.after(async () => { tokens.revokeAll(); await proxy.close(); await dispatcher.stop(); storage.close(); });
  const headers = { host: address, authorization: `Bearer ${token}`, "content-type": "application/json" };
  const inject = async (payload = rpc("ping"), overrides = {}) => {
    const response = await proxy.app.inject({ method: "POST", url: "/mcp", headers, payload, ...overrides });
    assert.equal(response.body.includes(workspacePath), false); assert.equal(response.body.includes(token), false);
    assert.ok(Buffer.byteLength(response.body) <= 65536);
    return response;
  };
  const call = async (name, args) => (await inject(rpc("tools/call", { name, arguments: args, _meta: { progressToken: 1 } }))).json().result;
  const rows = () => raw.prepare("SELECT * FROM artifact_versions").all();
  const events = () => raw.prepare("SELECT kind,body_json FROM attempt_events WHERE attempt_id = ? ORDER BY seq").all(grant.attemptId);
  return { root, workspacePath, storage, raw, hub, grant, grantInput, token, tokens, store, dispatcher, deps, proxy, headers, inject, call, rows, events,
    advance: (ms) => { time += ms; }, upstreamCalls: () => upstreamCalls };
}
const toolError = (result, message) => { assert.equal(result.isError, true); assert.equal(result.content.length, 1); if (message) assert.equal(result.content[0].text, message); };

for (const version of ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "future", ""]) test(`initialize negotiation case ${version || "empty"}`, () => {
  const response = fake().handle(rpc("initialize", init(version))).body.result;
  assert.equal(response.protocolVersion, ["future", ""].includes(version) ? "2025-06-18" : version);
  assert.deepEqual(response.capabilities, { tools: {} }); assert.deepEqual(response.serverInfo, { name: "factory-host", version: "test-version" });
});
for (const method of ["notifications/initialized", "notifications/cancelled", "unknown", "ping", "tools/list"]) test(`notification has empty accepted response for ${method}`, () => {
  assert.deepEqual(fake().handle({ jsonrpc: "2.0", method }), { status: 202 });
});
test("ping returns an empty result", () => assert.deepEqual(fake().handle(rpc("ping")).body, { jsonrpc: "2.0", id: 1, result: {} }));
for (const [label, value] of [["array", []], ["batch", [rpc("ping")]], ["null", null], ["boolean", true], ["number", 1],
  ["wrong version", { jsonrpc: "1.0", method: "ping" }], ["absent version", { method: "ping" }],
  ["missing method", { jsonrpc: "2.0", id: 1 }], ["numeric method", { jsonrpc: "2.0", method: 1 }],
  ["extra envelope", { ...rpc("ping"), extra: true }]]) test(`protocol rejects ${label}`, () => {
  assert.equal(fake().handle(value).body.error.code, -32600);
});
for (const [label, body] of [["unfinished", "{"], ["empty", ""], ["trailing", "{}x"], ["utf8", Buffer.from([0xff])]]) test(`parse rejects ${label}`, () => {
  assert.equal(fake().handle(body).body.error.code, -32700);
});
for (const [label, id] of [["string", "request"], ["zero", 0], ["negative", -2], ["integer", 5]]) test(`echoes ${label} id`, () => {
  assert.equal(fake().handle(rpc("ping", {}, id)).body.id, id);
});
for (const [label, id] of [["null", null], ["fraction", 1.1], ["boolean", true], ["object", {}], ["array", []], ["unsafe integer", 1e20]]) test(`rejects ${label} id without echoing it`, () => {
  const response = fake().handle(rpc("ping", {}, id)).body; assert.equal(response.error.code, -32600); assert.equal(response.id, null);
});
test("unknown request method is a protocol error", () => assert.equal(fake().handle(rpc("unknown")).body.error.code, -32601));
for (const method of ["ping", "tools/list", "initialize", "tools/call"]) for (const [label, params] of [["array", []], ["null", null], ["scalar", 3]])
  test(`${method} refuses ${label} params`, () => assert.equal(fake().handle(rpc(method, params)).body.error.code, -32602));
for (const [label, params] of [["empty", {}], ["missing name", { arguments: {} }], ["bad name", { name: 2 }],
  ["array args", { name: "task.progress", arguments: [] }], ["foreign identity", { name: "task.progress", attemptId: randomUUID() }]])
  test(`tools call rejects ${label} params`, () => assert.equal(fake().handle(rpc("tools/call", params)).body.error.code, -32602));
test("tools list exposes exactly the three strict tool schemas", () => {
  const list = fake().handle(rpc("tools/list")).body.result.tools;
  assert.deepEqual(list.map((t) => t.name), ["task.progress", "output.register", "decision.request"]);
  for (const tool of list) assert.equal(tool.inputSchema.additionalProperties, false);
  assert.equal(list[1].inputSchema.properties.inputs.items.additionalProperties, false);
  assert.equal(list[0].inputSchema.properties.percent.type, "integer");
});
test("valid progress uses only the authenticated grant and returns text", () => {
  const f = fake(); const response = f.call("task.progress", { summary: "Milestone", percent: 25 }).body.result;
  assert.deepEqual(f.calls, [[fakeGrant, { summary: "Milestone", percent: 25 }]]);
  assert.deepEqual(response, { content: [{ type: "text", text: "progress recorded" }], isError: false });
});
for (const [label, input] of [["empty summary", { summary: "" }], ["long summary", { summary: "x".repeat(1001) }],
  ["missing summary", {}], ["numeric summary", { summary: 3 }], ["negative percent", { summary: "x", percent: -1 }],
  ["large percent", { summary: "x", percent: 101 }], ["fraction percent", { summary: "x", percent: 1.5 }],
  ["string percent", { summary: "x", percent: "20" }], ["null percent", { summary: "x", percent: null }],
  ["foreign task", { summary: "x", taskId: randomUUID() }]]) test(`progress rejects ${label} without calling dependencies`, () => {
  const f = fake(); toolError(f.call("task.progress", input).body.result, "invalid tool input"); assert.equal(f.calls.length, 0);
});
for (const percent of [0, 100]) test(`progress accepts boundary percent ${percent}`, () => assert.equal(fake().call("task.progress", { summary: "x", percent }).body.result.isError, false));
test("maximum summary is accepted", () => assert.equal(fake().call("task.progress", { summary: "x".repeat(1000) }).body.result.isError, false));
test("unknown tool fails without executing a dependency", () => { const f = fake(); toolError(f.call("unknown.tool", {}).body.result, "tool is not available"); assert.equal(f.calls.length, 0); });
test("dependency exceptions use a fixed tool failure", () => {
  const f = fake({ progress() { throw new Error("private exception details"); } });
  toolError(f.call("task.progress", { summary: "x" }).body.result, "tool could not be completed");
});
test("notification tool calls execute once without returning a body", () => {
  const f = fake(); assert.deepEqual(f.handle({ jsonrpc: "2.0", method: "tools/call", params: { name: "task.progress", arguments: { summary: "x" } } }), { status: 202 });
  assert.equal(f.calls.length, 1);
});
test("response bound also applies to large ids and dependency returns", () => {
  const f = fake({ registerOutput: () => ({ artifactId: "x".repeat(70000), version: 1 }) });
  for (const response of [f.handle(rpc("ping", {}, "x".repeat(70000))), f.handle(rpc("unknown", {}, "x".repeat(70000))), f.call("output.register", output())]) {
    assert.ok(Buffer.byteLength(JSON.stringify(response.body)) <= 65536); assert.equal(response.body.error.code, -32603 === response.body.error.code ? -32603 : -32601);
  }
});
for (const [label, change] of [["empty title", { title: " " }], ["long title", { title: "x".repeat(161) }], ["bad kind", { kind: "bad" }],
  ["bad media", { mediaType: "image/png" }], ["empty abstract", { abstractL0: "" }], ["long abstract", { abstractL0: "x".repeat(401) }],
  ["long detail", { abstractL1: "x".repeat(6001) }], ["missing path", { path: undefined }], ["empty path", { path: "" }],
  ["foreign attempt", { attemptId: randomUUID() }], ["hash upload", { contentHash: "a".repeat(64) }],
  ["bad ref", { inputs: [{ artifactId: "bad", version: 1 }] }], ["bad version", { inputs: [{ artifactId: randomUUID(), version: 0 }] }],
  ["too many refs", { inputs: Array.from({ length: 101 }, () => ({ artifactId: randomUUID(), version: 1 })) }]])
  test(`output schema rejects ${label}`, () => { const f = fake(); toolError(f.call("output.register", output(change)).body.result, "invalid tool input"); assert.equal(f.calls.length, 0); });
test("output defaults inputs and returns only a pinned reference", () => {
  const f = fake(); const response = f.call("output.register", output()).body.result;
  assert.deepEqual(f.calls[0][1].inputs, []); assert.deepEqual(JSON.parse(response.content[0].text), { artifactId: fakeGrant.taskId, version: 1 });
});

for (const method of ["GET", "DELETE"]) test(`MCP ${method} advertises POST`, async (t) => {
  const f = await fixture(t); const response = await f.inject(undefined, { method, payload: undefined });
  assert.equal(response.statusCode, 405); assert.equal(response.headers.allow, "POST"); assert.equal(f.upstreamCalls(), 0);
});
test("MCP never spends model budget or invokes upstream", async (t) => {
  const f = await fixture(t, { budget: { ...DEFAULT_BUDGET_CONFIG, defaultTaskTokens: 1, defaultDayTokens: 1 } });
  for (const method of ["initialize", "ping", "tools/list"]) assert.equal((await f.inject(rpc(method, method === "initialize" ? init("2025-11-25") : {}))).statusCode, 200);
  assert.equal((await f.call("task.progress", { summary: "Done" })).isError, false);
  assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM usage_records").get().n, 0); assert.equal(f.upstreamCalls(), 0); assert.equal(f.proxy.inflight(), 0);
});
test("MCP auth failures match the model listener generic response", async (t) => {
  const f = await fixture(t); const failures = [];
  for (const authorization of [undefined, "garbled", "Basic value", "Bearer bad", `Bearer fpx_${"A".repeat(43)}`]) {
    const headers = { ...f.headers }; if (authorization === undefined) delete headers.authorization; else headers.authorization = authorization;
    const mcp = await f.inject(rpc("ping"), { headers });
    const model = await f.inject({}, { url: "/v1/chat/completions", headers });
    assert.equal(mcp.statusCode, 401); assert.equal(mcp.body, model.body); failures.push(mcp.body);
  }
  f.tokens.revoke(f.grant.attemptId); failures.push((await f.inject()).body);
  const next = f.tokens.issue(f.grantInput).token; f.advance(600000);
  failures.push((await f.inject(rpc("ping"), { headers: { ...f.headers, authorization: `Bearer ${next}` } })).body);
  assert.ok(failures.every((value) => value === failures[0])); assert.equal(f.events().length, 0);
});
test("MCP checks Host before authentication", async (t) => { const f = await fixture(t); assert.equal((await f.inject({}, { headers: { host: "foreign.invalid" } })).statusCode, 403); });
for (const contentType of ["text/plain", "application/octet-stream", "application/json-patch+json"]) test(`MCP refuses content type ${contentType}`, async (t) => {
  const f = await fixture(t); assert.equal((await f.inject("{}", { headers: { ...f.headers, "content-type": contentType } })).statusCode, 415);
});
test("MCP accepts OpenCode accept headers and JSON charset", async (t) => {
  const f = await fixture(t); assert.equal((await f.inject(rpc("ping"), { headers: { ...f.headers, accept: "application/json, text/event-stream", "content-type": "application/json; charset=utf-8" } })).statusCode, 200);
});
test("MCP body limit is one MiB independently of model limit", async (t) => {
  const f = await fixture(t); assert.equal((await f.inject(JSON.stringify(rpc("ping", { padding: "x".repeat(1048576) })))).statusCode, 413); assert.equal(f.events().length, 0);
});
test("invalid JSON reaches the MCP parse error handler", async (t) => { const f = await fixture(t); assert.equal((await f.inject("{")).json().error.code, -32700); });
test("progress masks controls and absolute paths in persisted events", async (t) => {
  const f = await fixture(t); assert.equal((await f.call("task.progress", { summary: `Ready\0\r\n ${f.workspacePath} /private/marker C:\\private\\marker`, percent: 42 })).isError, false);
  const body = JSON.parse(f.events()[0].body_json); assert.equal(body.type, "progress"); assert.equal(body.percent, 42);
  assert.doesNotMatch(body.message, /[\p{Cc}\p{Cf}]/u); assert.doesNotMatch(body.message, /private|marker/);
  const event = f.raw.prepare("SELECT body_json FROM event_log ORDER BY rowid DESC LIMIT 1").get();
  assert.equal(JSON.parse(event.body_json).payload.entity.kind, "attempt"); assert.equal(event.body_json.includes(f.workspacePath), false);
});
test("progress limit accepts five hundred calls then refuses without a row", async (t) => {
  const f = await fixture(t); for (let i = 0; i < 500; i++) assert.equal((await f.call("task.progress", { summary: "Milestone" })).isError, false);
  toolError(await f.call("task.progress", { summary: "Excess" }), "tool limit reached"); assert.equal(f.events().length, 500);
});
for (const state of ["succeeded", "failed", "stopped", "stopping", "unknown", "lease-expired", "submitting", "preparing", "queued"])
  for (const name of ["task.progress", "output.register"]) test(`${name} fences state ${state}`, async (t) => {
    const f = await fixture(t);
    f.raw.prepare(`UPDATE attempts SET state = ?, outcome = ?, ended_at = ?, node_id = CASE WHEN ? = 'queued' THEN NULL ELSE node_id END,
      lease_id = CASE WHEN ? = 'queued' THEN NULL ELSE lease_id END WHERE id = ?`)
      .run(state, state === "unknown" ? "unknown" : "known", ["succeeded", "failed", "stopped"].includes(state) ? new Date().toISOString() : null, state, state, f.grant.attemptId);
    toolError(await f.call(name, name === "task.progress" ? { summary: "Late" } : output()), "attempt is not active");
    assert.equal(f.events().length, 0); assert.equal(f.rows().length, 0); assert.equal(fs.readdirSync(join(f.root, "content")).length, 0);
  });
for (const mismatch of ["projectId", "taskId", "attemptId", "epoch"]) test(`grant ${mismatch} mismatch has no effect`, async (t) => {
  const f = await fixture(t); const token = f.tokens.issue({ ...f.grantInput, [mismatch]: mismatch === "epoch" ? 2 : randomUUID() }).token;
  for (const [name, args] of [["task.progress", { summary: "Foreign" }], ["output.register", output()]]) {
    const response = await f.inject(rpc("tools/call", { name, arguments: args }), { headers: { ...f.headers, authorization: `Bearer ${token}` } });
    toolError(response.json().result, "attempt is not active");
  }
  assert.equal(f.events().length, 0); assert.equal(f.rows().length, 0);
});
test("tool arguments cannot select another attempt", async (t) => {
  const f = await fixture(t); toolError(await f.call("task.progress", { summary: "Foreign", attemptId: randomUUID() }), "invalid tool input"); assert.equal(f.events().length, 0);
});
test("waiting input attempts reject further tools after a decision", async (t) => {
  const f = await fixture(t); f.raw.prepare("UPDATE attempts SET state = 'waiting-input' WHERE id = ?").run(f.grant.attemptId);
  assert.equal((await f.call("task.progress", { summary: "Waiting" })).isError, true); assert.equal((await f.call("output.register", output())).isError, true);
});
test("markdown registration stores exact bytes and publishes draft version", async (t) => {
  const f = await fixture(t); const cursor = f.hub.currentCursor(f.grant.projectId);
  const response = await f.call("output.register", output()); assert.equal(response.isError, false); const ref = JSON.parse(response.content[0].text);
  const version = getArtifactVersion(f.raw, f.grant.projectId, ref.artifactId, ref.version);
  assert.equal(version.status, "draft"); assert.equal(version.producedByAttemptId, f.grant.attemptId);
  assert.deepEqual(f.store.get(version.contentHash), fs.readFileSync(join(f.workspacePath, "result.md")));
  assert.equal(f.rows()[0].visibility, "project");
  const events = f.hub.readAfter(f.grant.projectId, cursor).events; assert.equal(events.length, 1);
  assert.deepEqual(events[0].payload, { type: "entity.changed", entity: { kind: "artifact-version", id: ref.artifactId, revision: 1 } });
  assert.equal(JSON.stringify(events).includes(f.workspacePath), false);
});
test("same task kind and title reuses identity with a supersede chain", async (t) => {
  const f = await fixture(t); const first = JSON.parse((await f.call("output.register", output())).content[0].text);
  fs.writeFileSync(join(f.workspacePath, "result.md"), "new bytes"); const second = JSON.parse((await f.call("output.register", output())).content[0].text);
  assert.equal(second.artifactId, first.artifactId); assert.equal(second.version, 2);
  assert.equal(getArtifactVersion(f.raw, f.grant.projectId, first.artifactId, 1).status, "superseded");
  assert.equal(getArtifactVersion(f.raw, f.grant.projectId, second.artifactId, 2).supersedesVersion, 1);
});
for (const [label, path] of [["posix absolute", "/private/file"], ["drive absolute", "C:/private/file"], ["drive relative", "C:file"],
  ["traversal", "../file"], ["nested traversal", "nested/../result.md"], ["nul", "result.md\0"], ["backslash", "nested\\file"],
  ["git metadata", ".git/config"], ["nested git", "nested/.git/config"], ["git root", ".git"], ["dot", "./result.md"], ["double slash", "nested//file"],
  ["missing file", "missing.md"]]) test(`output rejects ${label} without storage effects`, async (t) => {
    const f = await fixture(t); toolError(await f.call("output.register", output({ path })), "output could not be registered");
    assert.equal(f.rows().length, 0); assert.equal(fs.readdirSync(join(f.root, "content")).length, 0);
  });
test("output rejects a directory", async (t) => { const f = await fixture(t); fs.mkdirSync(join(f.workspacePath, "directory")); toolError(await f.call("output.register", output({ path: "directory" }))); });
for (const target of ["inside", "outside", "directory"]) test(`output rejects ${target} symlink before reading`, async (t) => {
  const f = await fixture(t); const unique = `unread-${randomUUID()}`; const outside = join(f.root, "outside"); fs.writeFileSync(outside, unique);
  const file = join(f.workspacePath, "link");
  try { fs.symlinkSync(target === "inside" ? join(f.workspacePath, "result.md") : target === "outside" ? outside : f.root, file, target === "directory" ? "junction" : "file"); }
  catch (error) { if (["EPERM", "ENOTSUP", "EACCES"].includes(error.code)) return t.skip("File links unavailable"); throw error; }
  let reads = 0; const original = fs.readSync;
  fs.readSync = (...args) => { reads++; return original(...args); };
  try { toolError(await f.call("output.register", output({ path: target === "directory" ? "link/outside" : "link" }))); }
  finally { fs.readSync = original; }
  assert.equal(reads, 0); assert.equal(f.rows().length, 0); assert.equal(f.events().some((row) => row.body_json.includes(unique)), false);
});
test("output rejects special files before opening", async (t) => {
  if (process.platform !== "linux") return t.skip("Requires a FIFO creator");
  const f = await fixture(t); execFileSync("mkfifo", [join(f.workspacePath, "pipe")]); toolError(await f.call("output.register", output({ path: "pipe" })));
});
test("output rejects files above eight MiB", async (t) => {
  const f = await fixture(t); fs.writeFileSync(join(f.workspacePath, "result.md"), Buffer.alloc(8 * 1024 * 1024 + 1, 65)); toolError(await f.call("output.register", output())); assert.equal(f.rows().length, 0);
});
test("output accepts exactly eight MiB", async (t) => {
  const f = await fixture(t); fs.writeFileSync(join(f.workspacePath, "result.md"), Buffer.alloc(8 * 1024 * 1024, 65)); assert.equal((await f.call("output.register", output())).isError, false);
});
for (const mediaType of ["text/plain", "text/markdown", "application/json"]) test(`output rejects invalid UTF8 for ${mediaType}`, async (t) => {
  const f = await fixture(t); fs.writeFileSync(join(f.workspacePath, "result.md"), Buffer.from([0xc3, 0x28])); toolError(await f.call("output.register", output({ mediaType }))); assert.equal(f.rows().length, 0);
});
test("JSON output must parse", async (t) => { const f = await fixture(t); toolError(await f.call("output.register", output({ mediaType: "application/json" }))); assert.equal(f.rows().length, 0); });
test("valid JSON output preserves bytes", async (t) => {
  const f = await fixture(t); fs.writeFileSync(join(f.workspacePath, "result.md"), '{"answer":42}\n'); assert.equal((await f.call("output.register", output({ mediaType: "application/json" }))).isError, false);
  assert.equal(f.store.get(f.rows()[0].content_hash).toString(), '{"answer":42}\n');
});
test("unknown input reference fails before file read or content storage", async (t) => {
  const f = await fixture(t); toolError(await f.call("output.register", output({ path: "missing.md", inputs: [{ artifactId: randomUUID(), version: 1 }] })));
  assert.equal(f.rows().length, 0); assert.equal(fs.readdirSync(join(f.root, "content")).length, 0);
});
test("known project input references are pinned and deduplicated", async (t) => {
  const f = await fixture(t); const ref = JSON.parse((await f.call("output.register", output())).content[0].text);
  assert.equal((await f.call("output.register", output({ title: "Derived", inputs: [ref, ref] }))).isError, false);
  assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM artifact_inputs").get().n, 1);
});
test("output limit allows fifty versions then refuses the fifty first", async (t) => {
  const f = await fixture(t); for (let i = 0; i < 50; i++) assert.equal((await f.call("output.register", output())).isError, false);
  toolError(await f.call("output.register", output()), "tool limit reached"); assert.equal(f.rows().length, 50);
});
for (const outcome of ["completed", "failed"]) test(`attempt outcome ${outcome} handles agent drafts transactionally`, async (t) => {
  const f = await fixture(t); const ref = JSON.parse((await f.call("output.register", output())).content[0].text);
  const refs = registerAttemptResults(f.deps, { ...f.grant, outcome, summary: "Done", evidenceDir: join(f.root, "evidence") });
  assert.equal(getArtifactVersion(f.raw, f.grant.projectId, ref.artifactId, 1).status, outcome === "completed" ? "in-review" : "draft");
  assert.equal(refs.length, outcome === "completed" ? 1 : 0);
});
test("outer rollback restores promoted draft statuses", async (t) => {
  const f = await fixture(t); await f.call("output.register", output());
  assert.throws(() => f.raw.transaction(() => { registerAttemptResults(f.deps, { ...f.grant, outcome: "completed", summary: null, evidenceDir: f.root }); throw new Error("rollback"); })());
  assert.equal(f.rows()[0].status, "draft");
});
test("proxy without MCP dependency does not mount the endpoint", async (t) => {
  const f = await fixture(t, { mcp: undefined }); assert.equal((await f.inject()).statusCode, 404);
});

for (const enabled of [false, true]) test(`real Host MCP dispatcher wiring ${enabled ? "enabled" : "disabled"}`, async (t) => {
  let host;
  const root = temp(t, async () => host?.close()); host = await startHost({ stateDir: join(root, "state"), port: 0, onBootstrapToken() {},
    dispatch: enabled ? {} : null, modelProxy: { port: 0, approvedModels: ["approved"], upstream: { baseUrl: "http://127.0.0.1:1/v1", apiKey: "synthetic-mcp-fixture" } } });
  t.after(() => host.close());
  const clock = () => new Date(); const workspace = join(root, "workspace"); fs.mkdirSync(workspace); fs.writeFileSync(join(workspace, "result.md"), "Host deliverable\n");
  const grant = seed(host.storage, host.hub, workspace, clock); const token = host.proxy.tokens.issue(grant).token;
  const url = `http://127.0.0.1:${host.proxy.port}/mcp`;
  const send = async (value) => { const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(value) }); return { status: response.status, body: await response.json() }; };
  const ping = await send(rpc("ping")); assert.equal(ping.status, enabled ? 200 : 404);
  if (enabled) {
    assert.equal((await send(rpc("tools/call", { name: "task.progress", arguments: { summary: "Host milestone" } }))).body.result.isError, false);
    assert.equal((await send(rpc("tools/call", { name: "output.register", arguments: output() }))).body.result.isError, false);
    assert.equal(host.storage.raw.prepare("SELECT status FROM artifact_versions").get().status, "draft");
    assert.equal(host.storage.raw.prepare("SELECT COUNT(*) AS n FROM usage_records").get().n, 0);
    assert.equal(host.storage.raw.prepare("SELECT kind FROM attempt_events").get().kind, "progress");
    const ordinary = await host.app.inject({ method: "POST", url: "/mcp", headers: { host: `127.0.0.1:${host.port}`, "content-type": "application/json" }, payload: rpc("ping") }); assert.notEqual(ordinary.statusCode, 200);
    host.proxy.tokens.revoke(grant.attemptId); assert.equal((await send(rpc("ping"))).status, 401);
  }
});
// --- added by the lead after mutation testing -------------------------------------------------------------------
function plainHandler(options) {
  const progress = []; const grantOf = (attemptId) => ({ attemptId, projectId: "p", taskId: "t", epoch: 1, allowedModels: [] });
  const handler = createMcpHandler({ progress(grant, input) { progress.push({ attemptId: grant.attemptId, ...input }); if (input.summary === "boom") throw new Error("x"); },
    registerOutput() { throw new Error("unused"); } }, "test", options);
  const call = (attemptId, summary = "step") => handler.handle(grantOf(attemptId), rpc("tools/call", { name: "task.progress", arguments: { summary } })).body.result;
  return { progress, call };
}
test("progress calls are limited per attempt, counted only on success, and independently for each attempt", () => {
  const { progress, call } = plainHandler({ maxProgressPerAttempt: 3 });
  for (let i = 0; i < 3; i++) assert.equal(call("a1").isError, false);
  assert.deepEqual([call("a1").isError, call("a1").content[0].text], [true, "tool limit reached"]);
  assert.equal(call("a2").isError, false); assert.equal(progress.length, 4);
  const failing = plainHandler({ maxProgressPerAttempt: 1 }); assert.equal(failing.call("a1", "boom").isError, true);
  assert.equal(failing.call("a1", "fine").isError, false);
});
test("the default progress limit is five hundred calls per attempt", () => {
  const { call } = plainHandler(); for (let i = 0; i < 500; i++) assert.equal(call("a1").isError, false);
  assert.equal(call("a1").isError, true);
});
test("agent credentials and token patterns are redacted from progress text before it is stored", () => {
  const { progress, call } = plainHandler();
  call("a1", "used fpx_ABCDEFGHIJKLMNOPQRSTUV and sk-abcdefghijklmnop123 today");
  assert.equal(progress[0].summary, "used [redacted] and [redacted] today");
});
for (const path of [".git/config", "nested/.git/config", ".GIT/config"]) test(`output refuses an EXISTING git metadata file ${path} without reading it`, async (t) => {
  const f = await fixture(t); const unique = `git-secret-${randomUUID()}`; const file = join(f.workspacePath, ...path.split("/"));
  fs.mkdirSync(join(file, ".."), { recursive: true }); fs.writeFileSync(file, unique);
  toolError(await f.call("output.register", output({ path })), "output could not be registered");
  assert.equal(f.rows().length, 0); assert.equal(f.events().some((row) => row.body_json.includes(unique)), false);
  assert.equal(fs.readdirSync(join(f.root, "content")).length, 0);
});
