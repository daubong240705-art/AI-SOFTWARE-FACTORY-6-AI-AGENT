import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { test } from "node:test";
import { parseEnv, startHost } from "../dist/host.js";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
import { findLeadSeat, getPrimaryEngagement, getActiveEngagement, getTeam, listSeats, ORG_COMMANDS } from "../dist/org/index.js";
import { createLeadRunner } from "../dist/lead/index.js";
import { createFakeGateway } from "../dist/models/fake.js";
import { listTasks } from "../dist/work/service.js";
import { fixture, pack, otherPack, packs, temp, writePack, pumped } from "./org-fixture.mjs";

const samples = (f) => ({
  "teams.create-from-pack": { teamId: randomUUID(), packKey: otherPack.manifest.key, packVersion: otherPack.manifest.version },
  "teams.set-lifecycle": { teamId: f.teamId, expectedRevision: 1, lifecycle: "active" },
  "engagements.create": { engagementId: randomUUID(), teamId: f.teamId, priority: 70, maxConcurrent: 2 },
  "engagements.update": { engagementId: f.primary.id, expectedRevision: 1, priority: 70 },
  "seats.update": { seatId: f.seat.id, expectedRevision: 1, slots: 2 },
});
test("multi-team defaults off", () => assert.equal(parseEnv({}).multiTeam, false));
for (const value of ["0", "1"]) test(`multi-team accepts flag ${value}`, () => assert.equal(parseEnv({ FACTORY_MULTI_TEAM: value }).multiTeam, value === "1"));
for (const [i, value] of ["", "true", "false", "2", "-1", " 1", "1 ", "private-invalid-flag", "01"].entries())
  test(`multi-team rejects invalid flag case ${i} without echoing input`, () => {
    assert.throws(() => parseEnv({ FACTORY_MULTI_TEAM: value }), { message: "FACTORY_MULTI_TEAM must be 0 or 1" });
  });
test("main refuses invalid multi-team configuration before startup", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../dist/main.js", import.meta.url))], {
    encoding: "utf8", env: { FACTORY_MULTI_TEAM: "synthetic-invalid-flag" }, timeout: 10_000,
  });
  assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.equal(result.stderr.trim(), "FACTORY_MULTI_TEAM must be 0 or 1");
});
for (const type of ORG_COMMANDS) test(`flag off refuses ${type} without mutation`, (t) => {
  const f = fixture(t, { multiTeam: false });
  const snapshot = () => ["teams", "seats", "engagements"].map((table) => f.raw.prepare(`SELECT * FROM ${table}`).all());
  const before = snapshot();
  const result = f.execute(type, samples(f)[type]); assert.equal(result.status, 501);
  assert.equal(result.body.error.code, "unsupported"); assert.equal(result.body.error.message, "multi-team is disabled");
  assert.equal(result.body.error.nextAction, "contact-host");
  assert.deepEqual(snapshot(), before);
});
for (const type of ORG_COMMANDS) test(`flag on implements ${type} with entity effects`, (t) => {
  const f = fixture(t); const payload = samples(f)[type];
  if (type === "engagements.create") payload.teamId = f.secondTeam();
  const result = f.ok(type, payload); assert.ok(result.body.receipt.effects.length > 0);
  assert.ok(result.body.receipt.effects.every((effect) => ["team", "seat", "engagement"].includes(effect.kind)));
});
test("creating from a pack uses the client id and returns the existing team on repetition", (t) => {
  const f = fixture(t); const id = f.secondTeam(); const seats = listSeats(f.raw, id);
  const repeated = f.ok("teams.create-from-pack", { teamId: randomUUID(), packKey: otherPack.manifest.key, packVersion: otherPack.manifest.version });
  assert.deepEqual(repeated.body.receipt.effects, [{ kind: "team", id, revision: 1 }]);
  assert.deepEqual(listSeats(f.raw, id), seats); assert.equal(seats.length, 7);
  assert.ok(seats.every((seat) => seat.nodePolicy === "elastic" && seat.dedicatedNodeId === null));
});
test("creating the default pack returns the project team", (t) => {
  const f = fixture(t); const r = f.ok("teams.create-from-pack", { teamId: randomUUID(), packKey: pack.manifest.key, packVersion: pack.manifest.version });
  assert.deepEqual(r.body.receipt.effects, [{ kind: "team", id: f.teamId, revision: 1 }]);
});
for (const field of ["packKey", "packVersion"]) test(`team creation rejects unknown ${field}`, (t) => {
  const f = fixture(t); const payload = samples(f)["teams.create-from-pack"]; payload[field] = "unknown";
  assert.equal(f.execute("teams.create-from-pack", payload).status, 404);
});
test("team creation refuses an id already used for another pack", (t) => {
  const f = fixture(t); assert.equal(f.execute("teams.create-from-pack", { ...samples(f)["teams.create-from-pack"], teamId: f.teamId }).status, 409);
});
for (const type of ["teams.set-lifecycle", "engagements.update", "seats.update"]) {
  test(`${type} checks revision and returns currentRevision`, (t) => {
    const f = fixture(t); const payload = samples(f)[type]; f.ok(type, payload);
    const result = f.execute(type, payload); assert.equal(result.status, 409); assert.equal(result.body.error.currentRevision, 2);
  });
  test(`${type} rejects an unknown entity`, (t) => {
    const f = fixture(t); const payload = samples(f)[type]; const key = Object.keys(payload).find((key) => key.endsWith("Id")); payload[key] = randomUUID();
    assert.equal(f.execute(type, payload).status, 404);
  });
}
for (const lifecycle of ["active", "paused", "archived"]) test(`team lifecycle supports ${lifecycle}`, (t) => {
  const f = fixture(t); const r = f.lifecycle(lifecycle);
  assert.deepEqual(r.body.receipt.effects, [{ kind: "team", id: f.teamId, revision: 2 }]);
  assert.equal(getTeam(f.raw, f.teamId).lifecycle, lifecycle);
});
for (const lifecycle of ["paused", "archived"]) test(`project creation cannot engage a ${lifecycle} default team`, (t) => {
  const f = fixture(t); f.lifecycle(lifecycle); const id = randomUUID();
  const result = f.execute("projects.create", { name: "New", workspace: { kind: "directory", root: `/workspace/${id}` } }, id);
  assert.equal(result.status, 409); assert.equal(f.raw.prepare("SELECT id FROM projects WHERE id = ?").get(id), undefined);
  assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM engagements").get().n, 1);
});
for (const state of ["active", "paused", "ended"]) test(`engagement update supports ${state}`, (t) => {
  const f = fixture(t); const r = f.updateEngagement(f.primary.id, { state });
  assert.deepEqual(r.body.receipt.effects, [{ kind: "engagement", id: f.primary.id, revision: 2 }]);
  assert.equal(f.raw.prepare("SELECT state FROM engagements WHERE project_id = ? AND id = ?").get(f.projectId, f.primary.id).state, state);
});
for (const [type, field, values] of [
  ["engagements.create", "priority", [-1, 101, 1.5]], ["engagements.create", "maxConcurrent", [0, 33, 1.5]],
  ["engagements.update", "priority", [-1, 101, 1.5]], ["engagements.update", "maxConcurrent", [0, 33, 1.5]],
  ["seats.update", "slots", [0, 9, 1.5]],
]) for (const [i, value] of values.entries()) test(`${type} rejects ${field} boundary case ${i}`, (t) => {
  const f = fixture(t); assert.equal(f.execute(type, { ...samples(f)[type], [field]: value }).status, 400);
});
test("engagement creation validates an unknown team", (t) => {
  const f = fixture(t); assert.equal(f.execute("engagements.create", { ...samples(f)["engagements.create"], teamId: randomUUID() }).status, 404);
});
for (const lifecycle of ["paused", "archived"]) test(`engagement creation refuses a ${lifecycle} team`, (t) => {
  const f = fixture(t); const id = f.secondTeam(); f.lifecycle(lifecycle, id);
  assert.equal(f.execute("engagements.create", { ...samples(f)["engagements.create"], teamId: id }).status, 409);
});
test("engagement creation refuses duplicates and reused ids", (t) => {
  const f = fixture(t); assert.equal(f.execute("engagements.create", samples(f)["engagements.create"]).status, 409);
  const id = f.secondTeam(); const e = f.engage(id); f.updateEngagement(e, { state: "ended" });
  assert.equal(f.execute("engagements.create", { engagementId: e, teamId: id, priority: 80, maxConcurrent: 2 }).status, 409);
});
test("reactivating a paused engagement refuses a duplicate active engagement", (t) => {
  const f = fixture(t); f.updateEngagement(f.primary.id, { state: "paused" }); f.engage(f.teamId);
  assert.equal(f.execute("engagements.update", { engagementId: f.primary.id, expectedRevision: 2, state: "active" }).status, 409);
});
test("reactivating an engagement refuses an archived team", (t) => {
  const f = fixture(t); f.updateEngagement(f.primary.id, { state: "paused" }); f.lifecycle("archived");
  assert.equal(f.execute("engagements.update", { engagementId: f.primary.id, expectedRevision: 2, state: "active" }).status, 409);
});
test("engagement update cannot address another project's engagement", (t) => {
  const f = fixture(t); const second = f.project();
  assert.equal(f.execute("engagements.update", { engagementId: f.primary.id, expectedRevision: 1, priority: 99 }, second).status, 404);
  assert.equal(getPrimaryEngagement(f.raw, f.projectId).priority, 50);
});
test("first engagement can be created with the flag off when none is active", (t) => {
  const f = fixture(t, { multiTeam: false }); f.raw.prepare("UPDATE engagements SET state = 'ended'").run();
  f.ok("engagements.create", samples(f)["engagements.create"]);
  assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM engagements WHERE state = 'active'").get().n, 1);
});
test("primary selection uses creation time then id and ignores priority", (t) => {
  const f = fixture(t); const team = f.secondTeam(); const e = f.engage(team, f.projectId, 100);
  assert.equal(getPrimaryEngagement(f.raw, f.projectId).id, f.primary.id); assert.equal(getActiveEngagement(f.raw, f.projectId).id, e);
  f.raw.prepare("UPDATE engagements SET created_at = ? WHERE project_id = ?").run("2026-11-08T00:00:00.000Z", f.projectId);
  assert.equal(getPrimaryEngagement(f.raw, f.projectId).id, [e, f.primary.id].sort()[0]);
});
test("higher priority engagement does not change task defaults or Lead chat", (t) => {
  const f = fixture(t); const other = f.secondTeam(); f.engage(other, f.projectId, 100);
  assert.equal(f.getTask(f.task()).engagementId, f.primary.id);
  const lead = findLeadSeat(f.raw, f.teamId); const secondaryLead = findLeadSeat(f.raw, other);
  f.ok("conversations.create", { conversationId: randomUUID(), agentId: lead.id, title: "Discuss", workItemId: null });
  assert.equal(f.execute("conversations.create", { conversationId: randomUUID(), agentId: secondaryLead.id, title: "Discuss", workItemId: null }).status, 400);
});
test("Lead plan retains the primary engagement after a higher priority team joins", async (t) => {
  const f = fixture(t); const conversationId = randomUUID(); const lead = findLeadSeat(f.raw, f.teamId);
  f.ok("conversations.create", { conversationId, agentId: lead.id, title: "Plan", workItemId: null });
  f.engage(f.secondTeam(), f.projectId, 100);
  f.ok("chat.send", { conversationId, expectedRevision: 1, messageId: randomUUID(), text: "Plan the work", intent: "delegate",
    attachmentIds: [], context: [], draftRevision: null });
  const plan = { tasks: [{ title: "Test", goal: "Verify delivery", acceptance: ["Works"], expectedFiles: 1, requiredCapabilities: ["test.unit"],
    placement: "portable", sideEffect: "none", reviewPolicy: "human-final", dependsOn: [] }] };
  const runner = createLeadRunner({ storage: f.storage, hub: f.hub, clock: f.clock, profileText: "Test Lead",
    gateway: createFakeGateway([{ text: "Proposal\n```factory-plan\n" + JSON.stringify(plan) + "\n```",
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 0 } }]) });
  f.cleanup(() => runner.stop()); runner.kick(); await runner.idle();
  const tasks = listTasks(f.raw, f.projectId); assert.equal(tasks.length, 1); assert.equal(tasks[0].engagementId, f.primary.id);
});
test("task owner must belong to the selected engagement team", (t) => {
  const f = fixture(t); const team = f.secondTeam(); const e = f.engage(team);
  assert.throws(() => f.task({ engagementId: e, seatId: f.seat.id }), /owner seat must belong/);
});

async function api(t, options = {}) {
  const f = fixture(t, options); const host = "127.0.0.1:8787"; const origin = `http://${host}`;
  const gate = createBootstrapGate({ clock: f.clock }); const bootstrap = gate.token;
  const app = createApiServer({ origins: [origin], clock: f.clock, gate, sessions: createSessionStore({ clock: f.clock }),
    register: createRoutes({ storage: f.storage, hub: f.hub, pipeline: f.pipeline, packs, dispatch: f.dispatcher }) });
  t.after(() => app.close());
  const response = await app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host, origin, "content-type": "application/json" }, payload: { token: bootstrap } });
  assert.equal(response.statusCode, 200); const cookie = response.headers["set-cookie"].split(";")[0];
  return { ...f, app, get: (url, authenticated = true) => app.inject({ url, headers: authenticated ? { host, cookie } : { host } }) };
}
for (const route of ["/packs", "/teams", "/teams/queue", "/project/team"]) test(`org read route ${route} requires a session`, async (t) => {
  const f = await api(t); const url = route === "/teams/queue" ? `/teams/${f.teamId}/queue` : route === "/project/team" ? `/projects/${f.projectId}/team` : route;
  assert.equal((await f.get(url, false)).statusCode, 401);
});
for (const multiTeam of [false, true]) test(`org views remain available with flag ${multiTeam}`, async (t) => {
  const f = await api(t, { multiTeam });
  for (const url of ["/packs", "/teams", `/teams/${f.teamId}/queue`, `/projects/${f.projectId}/team`]) {
    const response = await f.get(url); assert.equal(response.statusCode, 200);
    const body = response.body; assert.equal(body.includes(pack.dir.replaceAll("\\", "\\\\")), false);
    for (const forbidden of ["profileText", "dedicatedNodeId\":\"", "workspace_root", "token", "apiKey"]) assert.equal(body.includes(forbidden), false);
  }
});
test("packs view exposes only seat metadata", async (t) => {
  const f = await api(t); const p = (await f.get("/packs")).json().packs[0];
  assert.equal(p.seatCount, 7); assert.deepEqual(Object.keys(p.seats[0]).sort(), ["name", "role", "runtime", "slots", "isLead"].sort());
  assert.equal(p.key, pack.manifest.key);
});
test("pack detail requires a session and answers 404 for an unknown key", async (t) => {
  const f = await api(t);
  assert.equal((await f.get(`/packs/${pack.manifest.key}`, false)).statusCode, 401);
  assert.equal((await f.get("/packs/no-such-pack")).statusCode, 404);
});
test("pack detail exposes profile and skill text but never the directory", async (t) => {
  const f = await api(t); const response = await f.get(`/packs/${pack.manifest.key}`); assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.digest, pack.digest); assert.equal(body.seats.length, pack.manifest.seats.length);
  assert.equal(body.seats[0].profile, pack.files.profiles[0].content);
  assert.equal(body.skills.length, pack.files.skills.length); assert.equal(body.skills[0].content, pack.files.skills[0].content);
  assert.equal(response.body.includes(pack.dir.replaceAll("\\", "\\\\")), false);
});
test("project team view retains the primary team and lists every engagement", async (t) => {
  const f = await api(t); const e = f.engage(f.secondTeam(), f.projectId, 100); const body = (await f.get(`/projects/${f.projectId}/team`)).json();
  assert.equal(body.team.id, f.teamId); assert.equal(body.engagement.id, f.primary.id);
  assert.deepEqual(body.engagements.map((entry) => entry.id), [f.primary.id, e]);
  assert.equal(body.engagements[1].teamName, "Specialists"); assert.equal(body.engagements[1].maxConcurrent, 2);
});
test("team view includes load across two projects sharing seats", async (t) => {
  const f = await api(t); const second = f.project(); f.slots(2);
  f.enqueue(); f.enqueue(f.task({ scope: second }), second); await pumped();
  const team = (await f.get("/teams")).json().teams.find((entry) => entry.id === f.teamId);
  assert.equal(team.seats.find((s) => s.id === f.seat.id).live, 2); assert.equal(team.engagements.length, 2);
  assert.deepEqual(team.engagements.map((e) => e.live), [1, 1]);
});
test("cross-project queue follows priority then FIFO and omits terminal work", async (t) => {
  const f = await api(t); const second = f.project(); f.lifecycle("paused");
  const secondEngagement = getPrimaryEngagement(f.raw, second); f.updateEngagement(secondEngagement.id, { priority: 90 }, second);
  const low = f.enqueue(); const high = f.enqueue(f.task({ scope: second }), second); const next = f.enqueue(f.task({ scope: second }), second);
  const done = f.task({ state: "done" });
  const body = (await f.get(`/teams/${f.teamId}/queue`)).json();
  assert.deepEqual(body.items.map((entry) => entry.taskId), [high.taskId, next.taskId, low.taskId]);
  assert.ok(body.items.every((entry) => entry.queuedAt && entry.seatName === "BE" && entry.liveAttemptState === "queued"));
  assert.ok(body.items.every((entry) => entry.taskId !== done));
});
test("queue reports work with no assigned seat or attempt", async (t) => {
  const f = await api(t); const id = f.task({ state: "draft" }); const item = (await f.get(`/teams/${f.teamId}/queue`)).json().items[0];
  assert.equal(item.taskId, id); assert.equal(item.queuedAt, null); assert.equal(item.seatName, null); assert.equal(item.liveAttemptState, null);
});
test("team queue limits results to 200", async (t) => {
  const f = await api(t); for (let i = 0; i < 205; i++) f.task({ state: "draft" });
  assert.equal((await f.get(`/teams/${f.teamId}/queue`)).json().items.length, 200);
});
for (const [label, id, status] of [["invalid", "invalid", 400], ["unknown", randomUUID(), 404]]) test(`team queue rejects ${label} team`, async (t) => {
  const f = await api(t); assert.equal((await f.get(`/teams/${id}/queue`)).statusCode, status);
});
for (const multiTeam of [false, true]) test(`host registers org commands and advertises flag ${multiTeam}`, async (t) => {
  let host; const dir = temp(t, () => host?.close()); const packsDir = join(dir, "registry");
  writePack(packsDir, otherPack.manifest.key, (m) => { m.version = otherPack.manifest.version; });
  let bootstrap; host = await startHost({ stateDir: join(dir, "state"), port: 0, multiTeam, packsDir, dispatch: { stepMs: 0 },
    onBootstrapToken(value) { bootstrap = value; } });
  const authority = `127.0.0.1:${host.port}`; const origin = `http://${authority}`;
  const auth = await host.app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host: authority, origin, "content-type": "application/json" }, payload: { token: bootstrap } });
  assert.equal(auth.statusCode, 200); const cookie = auth.headers["set-cookie"].split(";")[0];
  const capabilities = (await host.app.inject({ url: "/system/capabilities", headers: { host: authority, cookie } })).json();
  for (const type of ORG_COMMANDS) assert.equal(capabilities.commands.includes(type), multiTeam);
  assert.equal((await host.app.inject({ url: "/packs", headers: { host: authority, cookie } })).statusCode, 200);
  const headers = { host: authority, origin, cookie, "x-csrf-token": auth.json().csrfToken, "content-type": "application/json" };
  const projectId = randomUUID();
  const execute = (type, payload) => host.app.inject({ method: "POST", url: "/commands", headers,
    payload: { apiVersion: 1, commandId: randomUUID(), projectId, type, payload } });
  assert.equal((await execute("projects.create", { name: "Org", workspace: { kind: "directory", root: `/workspace/${projectId}` } })).statusCode, 200);
  const raw = host.storage.raw; const primary = getPrimaryEngagement(raw, projectId);
  const seat = listSeats(raw, primary.teamId).find((s) => s.name === "BE");
  const commands = samples({ teamId: primary.teamId, primary, seat });
  commands["engagements.create"].teamId = commands["teams.create-from-pack"].teamId;
  for (const type of ORG_COMMANDS) {
    const response = await execute(type, commands[type]); assert.equal(response.statusCode, multiTeam ? 200 : 501, response.body);
  }
  if (multiTeam) {
    const taskId = randomUUID();
    assert.equal((await execute("tasks.create", { taskId, code: "ORG-001", title: "Build", goal: "[fake:hang]", brief: "Brief",
      parentTaskId: null, engagementId: null, ownerSeatId: seat.id, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [],
      placement: "portable", sideEffect: "none" })).statusCode, 200);
    const { moveTask, getAttempt } = await import("../dist/dispatch/index.js");
    for (const state of ["accepted", "ready", "active"]) moveTask(raw, projectId, taskId, state);
    const lifecycle = (state) => execute("teams.set-lifecycle", { teamId: primary.teamId,
      expectedRevision: getTeam(raw, primary.teamId).revision, lifecycle: state });
    assert.equal((await lifecycle("paused")).statusCode, 200);
    const queued = host.dispatch.enqueue({ projectId, taskId, seatId: seat.id }); await pumped();
    assert.equal(getAttempt(raw, projectId, queued.id).state, "queued");
    assert.equal((await lifecycle("active")).statusCode, 200); await pumped();
    assert.equal(getAttempt(raw, projectId, queued.id).state, "running");
  }
});
test("host packDir override remains the default alongside discovered packs", async (t) => {
  let host; const dir = temp(t, () => host?.close()); const packDir = writePack(join(dir, "custom"));
  const packsDir = join(dir, "registry"); writePack(packsDir, "another-team"); let bootstrap;
  host = await startHost({ stateDir: join(dir, "state"), port: 0, multiTeam: true, packDir, packsDir, onBootstrapToken(value) { bootstrap = value; } });
  const authority = `127.0.0.1:${host.port}`; const origin = `http://${authority}`;
  const auth = await host.app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host: authority, origin, "content-type": "application/json" }, payload: { token: bootstrap } });
  assert.equal(auth.statusCode, 200); const cookie = auth.headers["set-cookie"].split(";")[0];
  const headers = { host: authority, origin, cookie, "x-csrf-token": auth.json().csrfToken, "content-type": "application/json" };
  const id = randomUUID(); const result = await host.app.inject({ method: "POST", url: "/commands", headers,
    payload: { apiVersion: 1, commandId: randomUUID(), projectId: id, type: "projects.create",
      payload: { name: "Custom", workspace: { kind: "directory", root: `/workspace/${id}` } } } });
  assert.equal(result.statusCode, 200);
  assert.equal(getTeam(host.storage.raw, getPrimaryEngagement(host.storage.raw, id).teamId).pack.key, "example-team");
  const registry = (await host.app.inject({ url: "/packs", headers: { host: authority, cookie } })).json();
  assert.deepEqual(registry.packs.map((p) => p.key), ["another-team", "example-team"]);
});

// --- added by the lead after mutation testing (O1) ----------------------------------------------------------------
test("engagements keep strict creation order even when the clock does not advance, so the primary team never changes", (t) => {
  const f = fixture(t); const first = f.primary.id; const created = [first];
  const team = f.secondTeam(); // one extra team: end each engagement before engaging it again (one ACTIVE engagement per team and project)
  for (let i = 0; i < 8; i++) { const id = f.engage(team, f.projectId, 90 + (i % 10), 2); created.push(id); f.updateEngagement(id, { state: "ended" }); }
  const times = created.map((id) => f.raw.prepare("SELECT created_at FROM engagements WHERE id = ?").get(id).created_at);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1], `created_at must strictly increase (${i})`);
  assert.equal(getPrimaryEngagement(f.raw, f.projectId).id, first);
});
test("engagements.update changes only the fields it is given", (t) => {
  const f = fixture(t); const id = f.primary.id;
  const read = () => f.raw.prepare("SELECT priority, max_concurrent AS maxConcurrent, state FROM engagements WHERE id = ?").get(id);
  f.updateEngagement(id, { priority: 70, maxConcurrent: 5 }); assert.deepEqual(read(), { priority: 70, maxConcurrent: 5, state: "active" });
  f.updateEngagement(id, { state: "paused" }); assert.deepEqual(read(), { priority: 70, maxConcurrent: 5, state: "paused" });
  f.updateEngagement(id, { maxConcurrent: 3 }); assert.deepEqual(read(), { priority: 70, maxConcurrent: 3, state: "paused" });
  f.updateEngagement(id, { priority: 20 }); assert.deepEqual(read(), { priority: 20, maxConcurrent: 3, state: "paused" });
  assert.equal(f.raw.prepare("SELECT revision FROM engagements WHERE id = ?").get(id).revision, 5);
});
test("seats.update without slots keeps the capacity and still bumps the revision", (t) => {
  const f = fixture(t); f.slots(3);
  const revision = f.raw.prepare("SELECT revision FROM seats WHERE id = ?").get(f.seat.id).revision;
  f.ok("seats.update", { seatId: f.seat.id, expectedRevision: revision });
  const row = f.raw.prepare("SELECT slots, revision FROM seats WHERE id = ?").get(f.seat.id);
  assert.deepEqual(row, { slots: 3, revision: revision + 1 });
});
test("team view carries the revisions and charter the operator commands need", async (t) => {
  const f = await api(t); const team = (await f.get("/teams")).json().teams.find((entry) => entry.id === f.teamId);
  assert.equal(typeof team.charter, "string"); assert.ok(team.charter.length > 0);
  const seatRow = f.raw.prepare("SELECT revision FROM seats WHERE id = ?").get(f.seat.id);
  assert.equal(team.seats.find((s) => s.id === f.seat.id).revision, seatRow.revision);
  const engagementRow = f.raw.prepare("SELECT revision FROM engagements WHERE id = ?").get(f.primary.id);
  assert.equal(team.engagements.find((e) => e.engagementId === f.primary.id).revision, engagementRow.revision);
});
test("team view revisions follow the commands that change them", async (t) => {
  const f = await api(t);
  f.slots(3); f.updateEngagement(f.primary.id, { priority: 77 });
  const team = (await f.get("/teams")).json().teams.find((entry) => entry.id === f.teamId);
  assert.equal(team.seats.find((s) => s.id === f.seat.id).slots, 3);
  assert.ok(team.seats.find((s) => s.id === f.seat.id).revision > 1);
  assert.ok(team.engagements.find((e) => e.engagementId === f.primary.id).revision > 1);
  assert.equal(team.engagements.find((e) => e.engagementId === f.primary.id).priority, 77);
});
test("team view omits capabilities and tools for v1 packs", async (t) => {
  const f = await api(t); const team = (await f.get("/teams")).json().teams.find((entry) => entry.id === f.teamId);
  for (const seat of team.seats) { assert.equal("capabilities" in seat, false); assert.equal("tools" in seat, false); }
});
