// Closes mutation survivors of the V2b review: id matching, 404 without a session, schema size boundary,
// pagination loops and calling a tool that the server never listed.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ensureTeamFromPack, listSeats, loadPack } from "../dist/org/index.js";
import { createExternalTools } from "../dist/mcp-external/index.js";
import { createToolPolicy } from "../dist/mcp/policy.js";
import { parseMcpServers } from "../dist/mcp-external/config.js";
import { createMcpClient } from "../dist/mcp-external/client.js";
import { fixture, temp, writePack } from "./org-fixture.mjs";
import { remote } from "./mcp-external-fixture.mjs";

test("a response whose id does not match the request is rejected", async (t) => {
  const f = await remote(t, { respond: ({ message, res }) => {
    if (message.method !== "tools/list") return false;
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: 987654, result: { tools: [{ name: "lookup", inputSchema: {} }] } })); return true;
  } });
  await assert.rejects(() => f.client().listTools(), (error) => error.message === "external tool unavailable");
});
test("a 404 without any session is a refusal, not a session loss", async (t) => {
  const server = createServer((req, res) => { req.resume(); res.writeHead(404); res.end(); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const config = parseMcpServers({ servers: [{ name: "sample", url: `http://127.0.0.1:${server.address().port}/mcp` }] }).servers[0];
  const client = createMcpClient(config); t.after(() => client.close());
  const result = await client.callTool("lookup", {});
  assert.equal(result.isError, true); assert.equal(result.content[0].text, "external tool refused");
});
for (const [extra, kept] of [[0, true], [1, false]]) test(`a tool schema ${extra ? "one byte over" : "exactly at"} 16384 bytes is ${kept ? "kept" : "skipped"}`, async (t) => {
  const base = JSON.stringify({ description: "" }).length;
  const schema = { description: "x".repeat(16384 - base + extra) };
  assert.equal(JSON.stringify(schema).length, 16384 + extra);
  const f = await remote(t, { tools: [{ name: "lookup", inputSchema: schema }] });
  assert.equal((await f.client().listTools()).length, kept ? 1 : 0);
});
test("a server that repeats its pagination cursor is refused", async (t) => {
  const f = await remote(t, { respond: ({ message, reply }) => {
    if (message.method !== "tools/list") return false;
    reply({ tools: [{ name: "lookup", inputSchema: {} }], nextCursor: "same" }); return true;
  } });
  await assert.rejects(() => f.client().listTools(), (error) => error.message === "external tool unavailable");
});
test("a tool the server never listed is not called even when the seat allows the whole server", async (t) => {
  const f = fixture(t); const r = await remote(t);
  const dir = writePack(temp(t), "gaps-team", (manifest) => { manifest.seats[1].tools = ["ext.sample.*"]; });
  const team = ensureTeamFromPack(f.raw, loadPack(dir), { newId: randomUUID, clock: f.clock });
  const seat = listSeats(f.raw, team.teamId).find((s) => !s.isLead); const engagementId = f.engage(team.teamId);
  const taskId = f.task({ engagementId, seatId: seat.id }); const attempt = f.enqueue(taskId, f.projectId, seat.id);
  f.raw.prepare("INSERT OR IGNORE INTO nodes (id,revision,name,platform,trust,state,slots_total,slots_used,last_heartbeat_at) VALUES ('local',1,'Local','windows','trusted-workstation','online',2,0,?)").run(f.clock().toISOString());
  f.raw.prepare("UPDATE attempts SET state = 'running',node_id = 'local',lease_id = ?,lease_expires_at = ? WHERE id = ?")
    .run(randomUUID(), new Date(f.clock().getTime() + 600000).toISOString(), attempt.id);
  const grant = { projectId: f.projectId, taskId, attemptId: attempt.id, epoch: attempt.epoch, workspacePath: "C:\synthetic\workspace", allowedModels: [] };
  const external = createExternalTools({ servers: [r.config()] }, { raw: f.raw, now: () => f.clock().getTime(), env: {} });
  t.after(() => external.close());
  const result = await external.call(grant, "ext.sample.unlisted", {});
  assert.deepEqual(result, { content: [{ type: "text", text: "tool is not available" }], isError: true });
  assert.equal(r.received.filter((entry) => entry.message.method === "tools/call").length, 0);
  assert.equal(createToolPolicy(f.raw)(grant).allows("ext.sample.unlisted"), true);
  void readFileSync;
});
