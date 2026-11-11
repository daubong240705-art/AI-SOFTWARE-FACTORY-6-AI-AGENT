import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { startHost } from "../dist/host.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { getActiveEngagement, findLeadSeat } from "../dist/org/index.js";
import { createAttempt, moveTask } from "../dist/dispatch/index.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { tasksCreateHandler } from "../dist/work/service.js";
import { temp, pack } from "./org-fixture.mjs";
import { body } from "./breaker-fixture.mjs";
async function launch(t, extra = {}) {
  let host, bootstrapToken, time = Date.parse("2026-11-08T00:00:00Z"), serial = 0; const intervals = new Map(); const clock = () => new Date(time);
  const timers = { setTimeout, clearTimeout, setInterval(fn, ms) { const id = ++serial; intervals.set(id, { fn, ms }); return id; }, clearInterval(id) { intervals.delete(id); } };
  const stateDir = extra.stateDir ?? join(temp(t, () => host?.close()), "state");
  host = await startHost({ stateDir, port: 0, dispatch: null, clock, timers, onBootstrapToken(token) { bootstrapToken = token; }, ...extra }); t.after(() => host.close());
  const pipeline = createCommandPipeline({ storage: host.storage, hub: host.hub, clock, handlers: {
    "projects.create": createProjectsCreateHandler({ pack, multiTeam: extra.multiTeam ?? false }), "tasks.create": tasksCreateHandler
  } }); const projectId = randomUUID();
  const execute = (type, payload) => { const result = pipeline.execute({ apiVersion: 1, commandId: randomUUID(), projectId, type, payload }); assert.equal(result.status, 200, JSON.stringify(result.body)); };
  const auth = await host.app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host: `127.0.0.1:${host.port}`, origin: `http://127.0.0.1:${host.port}`, "content-type": "application/json" }, payload: { token: bootstrapToken } });
  assert.equal(auth.statusCode, 200); const headers = { host: `127.0.0.1:${host.port}`, cookie: auth.headers["set-cookie"].split(";")[0] };
  return { host, stateDir, clock, projectId, execute, intervals, get: url => host.app.inject({ url, headers }),
    create() { execute("projects.create", { name: "Breaker project", workspace: { kind: "directory", root: "/workspace/breaker" } }); },
    fail() { const engagement = getActiveEngagement(host.storage.raw, projectId); for (let i = 0; i < 5; i++) {
      const id = randomUUID(); execute("tasks.create", { taskId: id, code: `BRK-00${i}`, title: "Task", goal: "Deliver", brief: "Brief", parentTaskId: null, engagementId: engagement.id, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] });
      host.hub.transaction(() => host.hub.append({ projectId, causationId: id, payload: { type: "task.status-changed", taskId: id, to: "failed" } }));
    } return engagement; },
    async sweep() { [...intervals.values()].find(x => x.ms === 60000).fn(); for (let i = 0; i < 30; i++) await Promise.resolve(); } };
}
for (const multiTeam of [false, true]) test(`team sweep always wired with multiTeam=${multiTeam}`, async t => {
  const f = await launch(t, { multiTeam }); f.create(); const engagement = f.fail(); await f.sweep();
  assert.equal(f.host.storage.raw.prepare("SELECT lifecycle FROM teams WHERE id=?").get(engagement.teamId).lifecycle, "paused");
  assert.equal((await f.get(`/projects/${f.projectId}/breakers`)).json().teams[0].state, "open");
});
test("startup trips persisted failures once", async t => {
  const f = await launch(t); f.create(); f.fail(); await f.host.close(); const next = await launch(t, { stateDir: f.stateDir });
  try {
  const row = next.host.storage.raw.prepare("SELECT * FROM team_breakers WHERE project_id=?").get(f.projectId); assert.equal(row.state, "open");
  const cursor = next.host.hub.currentCursor(f.projectId); await next.sweep(); assert.deepEqual(next.host.hub.currentCursor(f.projectId), cursor);
  } finally { await next.host.close(); }
});
test("no proxy returns empty route health and shutdown clears timers", async t => {
  const f = await launch(t); f.create(); assert.deepEqual((await f.get(`/projects/${f.projectId}/breakers`)).json().routes, []); await f.host.close(); assert.equal(f.intervals.size, 0);
});
test("proxy and read surface share route breaker state", async t => {
  let calls = 0; const f = await launch(t, { modelProxy: { port: 0, approvedModels: ["approved"], upstream: {
    baseUrl: "http://127.0.0.1:9999/v1", apiKey: "synthetic-test-key", fetchImpl: async () => { calls++; return new Response("", { status: 503 }); }
  } } }); f.create(); const engagement = getActiveEngagement(f.host.storage.raw, f.projectId), taskId = randomUUID();
  f.execute("tasks.create", { taskId, code: "BRK-001", title: "Task", goal: "Deliver", brief: "Brief", parentTaskId: null, engagementId: engagement.id, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] });
  for (const state of ["accepted", "ready", "active"]) moveTask(f.host.storage.raw, f.projectId, taskId, state);
  const attemptId = randomUUID(); createAttempt(f.host.storage.raw, { projectId: f.projectId, taskId, id: attemptId, seatId: findLeadSeat(f.host.storage.raw, engagement.teamId).id, runtime: "fake", provider: "fake", model: "approved", effort: "medium", now: f.clock().toISOString() });
  const { token } = f.host.proxy.tokens.issue({ projectId: f.projectId, taskId, attemptId, epoch: 1, allowedModels: ["approved"] });
  for (let i = 0; i < 6; i++) {
    const response = await fetch(`http://127.0.0.1:${f.host.proxy.port}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body()) });
    assert.equal(response.status, i < 5 ? 502 : 503); await response.arrayBuffer();
  }
  const rows = (await f.get(`/projects/${f.projectId}/breakers`)).json().routes; assert.equal(calls, 5); assert.equal(rows[0].state, "open"); assert.equal(rows[0].key, "approved"); assert.equal(rows[0].consecutiveFailures, 5);
});
