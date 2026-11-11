import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createMcpHandler } from "../dist/mcp/rpc.js";
import { createRequestsMcp } from "../dist/requests/mcp.js";
import { createModelProxy, createTokenRegistry } from "../dist/proxy/index.js";
import { DEFAULT_BUDGET_CONFIG } from "../dist/policy/index.js";
import { fixture, requestInput, snapshot } from "./requests-fixture.mjs";

const rpc = (method, params = {}) => ({ jsonrpc: "2.0", id: 1, method, params });
function mcpFixture(t, transport = "handler", enabled = true) {
  const f = fixture(t); const requests = createRequestsMcp(f.deps);
  const handler = createMcpHandler({ ...(enabled ? { requests } : {}), progress() {}, registerOutput() { throw new Error(); }, requestDecision() { throw new Error(); } });
  const tokens = createTokenRegistry({ clock: f.clock }); const token = tokens.issue({ ...f.grant, allowedModels: ["approved"] }).token;
  const proxy = transport === "proxy" ? createModelProxy({ raw: f.raw, tokens, clock: f.clock, newId: randomUUID,
    budget: DEFAULT_BUDGET_CONFIG, allowedHosts: ["127.0.0.1:18787"], mcp: handler,
    upstream: { providerId: "fixture", async chatCompletions() { throw new Error("unused"); } } }) : null;
  f.cleanup(async () => { await proxy?.close(); tokens.revokeAll(); });
  const send = async (method, params = {}, grant = f.grant) => {
    if (!proxy) return handler.handle(grant, rpc(method, params)).body.result;
    const response = await proxy.app.inject({ method: "POST", url: "/mcp", payload: rpc(method, params),
      headers: { host: "127.0.0.1:18787", authorization: `Bearer ${token}`, "content-type": "application/json" } });
    assert.equal(response.statusCode, 200); assert.equal(response.body.includes(token), false); return response.json().result;
  };
  return { ...f, send, call: (name, args, grant) => send("tools/call", { name, arguments: args }, grant) };
}
for (const transport of ["handler","proxy"]) {
  test(`${transport} lists strict request tools only when wired`, async (t) => {
    const f = mcpFixture(t, transport); const tools = (await f.send("tools/list")).tools;
    assert.deepEqual(tools.filter((x) => x.name.startsWith("request.")).map((x) => x.name), ["request.create","request.reply","request.get"]);
    for (const tool of tools) assert.equal(tool.inputSchema.additionalProperties, false);
  });
  test(`${transport} hides request tools when the flag is off`, async (t) => {
    const f = mcpFixture(t, transport, false); assert.equal((await f.send("tools/list")).tools.some((x) => x.name.startsWith("request.")), false);
    for (const name of ["request.create","request.reply","request.get"]) {
      const before = snapshot(f.raw); const result = await f.call(name, {}); assert.equal(result.isError, true);
      assert.equal(result.content[0].text, "multi-team is disabled"); assert.equal(snapshot(f.raw), before);
    }
  });
  test(`${transport} creates gets and replies through the real MCP handler`, async (t) => {
    const f = mcpFixture(t, transport); const result = await f.call("request.create", requestInput(f.team)); assert.equal(result.isError, false);
    const { requestId } = JSON.parse(result.content[0].text); const view = await f.call("request.get", { requestId });
    assert.equal(JSON.parse(view.content[0].text).state, "proposed");
    assert.equal((await f.call("request.reply", { requestId, action: "message", message: "Extra context" })).isError, false);
    assert.equal(f.view(requestId).thread.at(-1).text, "Extra context");
  });
  test(`${transport} returns the fixed notify-cannot-block refusal without writes`, async (t) => {
    const f = mcpFixture(t, transport); const before = snapshot(f.raw);
    const result = await f.call("request.create", requestInput(f.team, { kind: "notify", responseMode: "blocking" }));
    assert.equal(result.content[0].text, "notify cannot block"); assert.equal(result.isError, true); assert.equal(snapshot(f.raw), before);
  });
  for (const [name,args] of [["request.create",{}],["request.reply",{}],["request.get",{}],
    ["request.create",{ targetTeamId: randomUUID(), taskId: randomUUID() }],["request.get",{ requestId: randomUUID(), grant: {} }]])
    test(`${transport} validates ${name} with ${Object.keys(args).join(" ") || "empty input"}`, async (t) => {
      const f = mcpFixture(t, transport); const before = snapshot(f.raw); const result = await f.call(name,args);
      assert.equal(result.isError,true); assert.equal(result.content[0].text,"invalid tool input"); assert.equal(snapshot(f.raw), before);
    });
  test(`${transport} request reads never spend model usage`, async (t) => {
    const f = mcpFixture(t, transport); await f.call("request.get", { requestId: randomUUID() });
    assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM usage_records").get().n, 0);
  });
}
test("all request calls share a cap of one hundred per attempt", async (t) => {
  const f = mcpFixture(t); const { requestId } = f.create();
  for (let i = 0; i < 100; i++) assert.equal((await f.call("request.get", { requestId })).isError, false);
  const before = snapshot(f.raw); const result = await f.call("request.reply", { requestId, action: "message", message: "Over cap" });
  assert.equal(result.content[0].text, "tool limit reached"); assert.equal(snapshot(f.raw), before);
});
for (const name of ["request.create","request.reply","request.get"]) test(`${name} is fenced against stale grants`, async (t) => {
  const f = mcpFixture(t); const before = snapshot(f.raw); const result = await f.call(name, {}, { ...f.grant, epoch: 99 });
  assert.equal(result.content[0].text, "attempt is not active"); assert.equal(snapshot(f.raw), before);
});
test("long public threads fit the relay response budget", async (t) => {
  const f = mcpFixture(t); const { requestId } = f.create();
  for (let i = 0; i < 210; i++) f.executeCtr("requests.message", { requestTaskId: requestId, text: "Nội dung ".repeat(200) });
  const result = await f.call("request.get", { requestId }); assert.equal(result.isError, false); assert.ok(Buffer.byteLength(JSON.stringify(result)) < 65536);
  const view = JSON.parse(result.content[0].text); assert.ok(view.thread.length <= 200); assert.equal(view.thread.at(-1).seq, 212);
});
