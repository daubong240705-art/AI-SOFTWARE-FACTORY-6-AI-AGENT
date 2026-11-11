import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ensureTeamFromPack, listSeats, loadPack } from "../dist/org/index.js";
import { createMcpHandler } from "../dist/mcp/rpc.js";
import { createToolPolicy } from "../dist/mcp/policy.js";
import { fixture, temp, writePack } from "./org-fixture.mjs";

const optional = ["knowledge.search", "knowledge.get", "request.create", "request.reply", "request.get", "project.briefing"];
const core = ["task.progress", "output.register", "decision.request", "skill.get"];
const rpc = (method, params = {}) => ({ jsonrpc: "2.0", id: 1, method, params });
const unavailable = { content: [{ type: "text", text: "tool is not available" }], isError: true };
function setup(t, tools = [], options = {}) {
  const f = fixture(t); const dir = writePack(temp(t), "policy-team", (m) => { if (tools !== undefined) m.seats[1].tools = tools; });
  const team = ensureTeamFromPack(f.raw, options.pack ?? loadPack(dir), { newId: randomUUID, clock: f.clock });
  const engagementId = f.engage(team.teamId); const seats = listSeats(f.raw, team.teamId);
  const seat = options.seatName ? seats.find((s) => s.name === options.seatName) : seats.find((s) => !s.isLead);
  const id = f.task({ engagementId, seatId: seat.id }); const attempt = f.enqueue(id, f.projectId, seat.id);
  const grant = { projectId: f.projectId, taskId: id, attemptId: attempt.id, epoch: attempt.epoch };
  const calls = [];
  const delegate = { call: (_grant, name) => { calls.push(name); return { content: [{ type: "text", text: "ok" }], isError: false }; } };
  const handler = createMcpHandler({ toolPolicy: createToolPolicy(f.raw), knowledge: delegate, requests: delegate, briefing: delegate, skills: delegate,
    progress: () => calls.push("task.progress"), registerOutput: () => { calls.push("output.register"); return { artifactId: randomUUID(), version: 1 }; },
    requestDecision: () => { calls.push("decision.request"); return { approvalId: randomUUID() }; }, ...options.deps }, "test", { maxProgressPerAttempt: 1 });
  return { ...f, dir, seat, grant, calls, handler,
    list: (g = grant) => handler.handle(g, rpc("tools/list")).body.result.tools.map((tool) => tool.name),
    call: (name, args = {}, g = grant) => handler.handle(g, rpc("tools/call", { name, arguments: args })).body.result };
}
for (const name of optional) test(`empty allowlist hides and denies ${name}`, (t) => {
  const f = setup(t); assert.equal(f.list().includes(name), false); assert.deepEqual(f.call(name, { arbitrary: "invalid" }), unavailable); assert.deepEqual(f.calls, []);
});
for (const name of optional) test(`exact allowlist admits ${name} only`, (t) => {
  const f = setup(t, [name]); assert.deepEqual(f.list().filter((n) => optional.includes(n)), [name]); assert.equal(f.call(name).isError, false); assert.deepEqual(f.calls, [name]);
});
for (const prefix of ["knowledge", "request"]) test(`prefix allowlist admits ${prefix} tools`, (t) => {
  const f = setup(t, [`${prefix}.*`]); assert.deepEqual(f.list().filter((n) => optional.includes(n)).sort(), optional.filter((n) => n.startsWith(`${prefix}.`)).sort());
});
test("core tools remain listed with an empty allowlist", (t) => { const f = setup(t); assert.deepEqual(f.list().sort(), [...core].sort()); });
test("core tools bypass optional denial before dispatch", (t) => {
  const f = setup(t, [], { deps: { toolPolicy: () => ({ allows: () => false }) } });
  const args = {
    "task.progress": { summary: "Progress" }, "skill.get": { name: "example" },
    "output.register": { title: "Result", kind: "other", mediaType: "text/plain", path: "result.txt", abstractL0: "A result." },
    "decision.request": { subject: "Choose", summary: "Select a direction", options: [{ id: "a", label: "A", consequence: "A result" }, { id: "b", label: "B", consequence: "B result" }], impactIfWaiting: "Work waits" },
  };
  for (const name of core) assert.equal(f.call(name, args[name]).isError, false);
  assert.deepEqual(f.calls.sort(), [...core].sort());
});
test("no tools declaration keeps v1 optional access", (t) => {
  // Passing undefined uses the default parameter; supply a v1 pack explicitly instead.
  const dir = writePack(temp(t), "v1-policy-team"); const f = setup(t, [], { pack: loadPack(dir) });
  for (const name of optional) { assert.ok(f.list().includes(name)); assert.equal(f.call(name).isError, false); }
});
test("denial is indistinguishable from unknown tools", (t) => { const f = setup(t); for (const args of [{}, { name: "other" }, { seatId: randomUUID() }]) assert.deepEqual(f.call("request.create", args), f.call("unknown.tool", args)); });
test("denied tools do not consume counters or call delegates", (t) => {
  const f = setup(t, ["request.reply"]);
  for (let i = 0; i < 501; i++) assert.deepEqual(f.call("request.create"), unavailable);
  assert.deepEqual(f.calls, []); assert.equal(f.call("request.reply").isError, false);
  assert.equal(f.call("task.progress", { summary: "Allowed" }).isError, false);
  assert.equal(f.call("task.progress", { summary: "Limit" }).content[0].text, "tool limit reached");
});
test("attempt identity cannot be supplied in arguments", (t) => {
  const f = setup(t); assert.deepEqual(f.call("request.create", { seatId: f.seat.id, attemptId: randomUUID(), teamId: f.teamId }), unavailable); assert.deepEqual(f.calls, []);
});
test("seatless grant fails closed when policy is present", (t) => {
  const f = setup(t); const grant = { ...f.grant, attemptId: randomUUID() };
  assert.deepEqual(f.list(grant).sort(), [...core].sort()); assert.deepEqual(f.call("knowledge.search", {}, grant), unavailable);
});
test("seatless grant preserves behavior when policy is absent", (t) => {
  const f = setup(t, [], { deps: { toolPolicy: undefined } }); const grant = { ...f.grant, attemptId: randomUUID() };
  assert.equal(f.list(grant).length, core.length + optional.length); assert.equal(f.call("knowledge.search", {}, grant).isError, false);
});
test("policy exceptions fail closed without leaking details", (t) => {
  const f = setup(t, [], { deps: { toolPolicy: () => { throw new Error("private diagnostic"); } } });
  assert.deepEqual(f.call("request.create"), unavailable); assert.deepEqual(f.list().sort(), [...core].sort());
});
test("disk edits do not alter pinned tool policy", (t) => {
  const f = setup(t); const m = JSON.parse(readFileSync(join(f.dir, "pack.json"), "utf8")); delete m.seats[1].tools;
  writeFileSync(join(f.dir, "pack.json"), JSON.stringify(m)); assert.deepEqual(f.call("request.create"), unavailable);
});
test("other team seats retain independent tool access", (t) => {
  const f = setup(t); const attempt = f.enqueue(); const grant = { ...f.grant, taskId: attempt.taskId, attemptId: attempt.id };
  assert.equal(f.call("request.create", {}, grant).isError, false); assert.deepEqual(f.call("request.create"), unavailable);
});
for (const [key, seatName] of [["research-team", "Fact Checker"], ["architecture-team", "Architecture Reviewer"], ["design-team", "Design Reviewer"]])
  test(`${key} reviewer allows replies and reads but cannot create requests`, (t) => {
    const pack = loadPack(fileURLToPath(new URL(`../../../packs/${key}/`, import.meta.url))); const f = setup(t, [], { pack, seatName });
    assert.deepEqual(f.call("request.create"), unavailable); assert.equal(f.list().includes("request.create"), false);
    for (const name of ["request.get", "request.reply", "knowledge.search", "knowledge.get", "project.briefing"]) assert.equal(f.call(name).isError, false);
  });
test("allowlist cannot expose absent Host tools", (t) => {
  const f = setup(t, ["knowledge.*"], { deps: { knowledge: undefined } }); assert.equal(f.list().includes("knowledge.search"), false); assert.deepEqual(f.call("knowledge.search"), unavailable);
  assert.deepEqual(f.call("knowledge.future"), unavailable);
});
