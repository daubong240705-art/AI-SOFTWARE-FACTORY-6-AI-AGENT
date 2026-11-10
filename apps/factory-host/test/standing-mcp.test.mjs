import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { standingMcpFixture } from "./standing-fixture.mjs";
import { createMcpHandler } from "../dist/mcp/rpc.js";
import { packManifestSchema } from "../dist/org/pack.js";

const unavailable = { content: [{ type: "text", text: "tool is not available" }], isError: true };
for (const [name, tools] of [["omitted", null], ["empty", []], ["other", ["workflow.patch"]], ["unrelated wildcard", ["knowledge.*"]]]) test(`notify default deny ${name}`, t => { const f = standingMcpFixture(t, tools); f.level(); f.create(); assert.equal(f.list().some(x => x.name === "notify.send-internal"), false); assert.deepEqual(f.call(), unavailable); assert.equal(f.rows().length, 0); assert.equal(f.uses().length, 0); });
for (const tools of [["notify.send-internal"], ["notify.*"], ["notify.send-internal", "knowledge.*"]]) test(`notify explicit allow ${tools.join()}`, t => { const f = standingMcpFixture(t, tools); f.level(); f.create(); assert.equal(f.list().some(x => x.name === "notify.send-internal"), true); assert.equal(f.call().isError, false); assert.equal(f.rows().length, 1); assert.equal(packManifestSchema.safeParse(f.manifest).success, true); });
test("no policy hides and denies tool even with dependency", t => { const f = standingMcpFixture(t); delete f.mcpDeps.toolPolicy; const h = createMcpHandler(f.mcpDeps), list = h.handle(f.grant, { jsonrpc: "2.0", id: 1, method: "tools/list" }).body.result.tools; assert.equal(list.some(x => x.name === "notify.send-internal"), false); assert.deepEqual(h.handle(f.grant, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "notify.send-internal", arguments: { title: "Report", body: "" } } }).body.result, unavailable); });
test("missing dependency is not advertised and cannot be called", t => { const f = standingMcpFixture(t); delete f.mcpDeps.standing; const h = createMcpHandler(f.mcpDeps); assert.equal(h.handle(f.grant, { jsonrpc: "2.0", id: 1, method: "tools/list" }).body.result.tools.some(x => x.name === "notify.send-internal"), false); assert.deepEqual(h.handle(f.grant, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "notify.send-internal", arguments: { title: "Report", body: "" } } }).body.result, unavailable); });
test("tool JSON schema forbids identity and extra fields", t => { const f = standingMcpFixture(t), tool = f.list().find(x => x.name === "notify.send-internal"); assert.equal(tool.inputSchema.additionalProperties, false); assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ["body", "title"]); });
for (const field of ["projectId", "teamId", "standingId", "id", "tokens"]) test(`tool rejects argument ${field}`, t => { const f = standingMcpFixture(t); f.level(); f.create(); assert.equal(f.call({ title: "Report", body: "", [field]: randomUUID() }).content[0].text, "invalid tool input"); assert.equal(f.uses().length, 0); assert.equal(f.rows().length, 0); });
for (const input of [{}, { title: "", body: "" }, { title: "x".repeat(201), body: "" }, { title: "Report", body: "x".repeat(1001) }]) test(`tool refuses malformed content ${JSON.stringify(input).length}`, t => { const f = standingMcpFixture(t); assert.equal(f.call(input).content[0].text, "invalid tool input"); assert.equal(f.rows().length, 0); });
test("team scope is derived from the granted attempt seat", t => { const f = standingMcpFixture(t); f.level(); const id = f.create({ scope: { kind: "team", ref: f.teamId } }); assert.equal(f.call().isError, false); assert.equal(f.uses()[0].standing_id, id); });
test("a different team approval cannot authorize the grant", t => { const f = standingMcpFixture(t); f.level(); f.create({ scope: { kind: "team", ref: f.secondTeam() } }); assert.equal(f.call().content[0].text, "standing approval refused: none"); assert.equal(f.rows().length, 0); });
test("another project's project scope cannot authorize the grant", t => { const f = standingMcpFixture(t); f.level(); const other = f.project(); f.level(4, other); f.create({ scope: { kind: "project", ref: other } }, other); assert.equal(f.call().content[0].text, "standing approval refused: none"); });
for (const mutation of ["project", "task", "epoch", "expired lease", "terminal"]) test(`notify grant fencing ${mutation}`, t => { const f = standingMcpFixture(t); f.level(); f.create(); let grant = f.grant;
  if (mutation === "project") grant = { ...grant, projectId: f.project() };
  if (mutation === "task") grant = { ...grant, taskId: f.task() };
  if (mutation === "epoch") grant = { ...grant, epoch: grant.epoch + 1 };
  if (mutation === "expired lease") f.raw.prepare("UPDATE attempts SET lease_expires_at=? WHERE id=?").run(f.clock().toISOString(), grant.attemptId);
  if (mutation === "terminal") f.raw.prepare("UPDATE attempts SET state='succeeded',outcome='known',ended_at=? WHERE id=?").run(f.clock().toISOString(), grant.attemptId);
  assert.equal(f.call(undefined, grant).isError, true); assert.equal(f.rows().length, 0); assert.equal(f.uses().length, 0);
});
for (const reason of ["autonomy", "none", "expired", "limit"]) test(`tool refusal is stable generic ${reason}`, t => { const f = standingMcpFixture(t);
  if (reason !== "autonomy") f.level();
  if (reason === "expired") { f.create({ expiresAt: new Date(f.clock().getTime() + 1).toISOString() }); f.advance(1); }
  if (reason === "limit") { f.create({ limitPerDay: 1 }); assert.equal(f.call().isError, false); }
  const before = f.rows().length, uses = f.uses().length; const r = f.call({ title: "private input never echoed", body: "private details" });
  assert.deepEqual(r, { content: [{ type: "text", text: `standing approval refused: ${reason}` }], isError: true }); assert.equal(f.rows().length, before); assert.equal(f.uses().length, uses);
});
test("notification tool fits a positive token cap without accepting a token argument", t => { const f = standingMcpFixture(t); f.level(); f.create({ maxTokensPerUse: 1 }); assert.equal(f.call().isError, false); assert.equal(f.uses()[0].tokens, null); });
test("success exposes no standing id or submitted content", t => { const f = standingMcpFixture(t); f.level(); f.create(); assert.deepEqual(f.call({ title: "private title", body: "private details" }), { content: [{ type: "text", text: "notification sent" }], isError: false }); });
test("each tool call has a fresh host-generated use id", t => { const f = standingMcpFixture(t); f.level(); f.create(); f.call(); f.call(); assert.equal(f.uses().length, 2); assert.equal(new Set(f.uses().map(x => x.id)).size, 2); assert.equal(f.rows().length, 2); });
test("direct standing delegate cannot answer other tool names", t => { const f = standingMcpFixture(t, ["notify.*", "knowledge.*"]); assert.deepEqual(f.mcpDeps.standing.call(f.grant, "knowledge.search", {}), unavailable); });
test("tool policy exceptions fail closed", t => { const f = standingMcpFixture(t); f.mcpDeps.toolPolicy = () => { throw Error("private failure"); }; assert.deepEqual(f.call(), unavailable); });
