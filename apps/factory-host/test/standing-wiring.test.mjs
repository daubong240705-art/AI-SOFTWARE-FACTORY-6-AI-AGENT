import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { startHost } from "../dist/host.js";
import { temp } from "./org-fixture.mjs";

async function launch(t, options = {}) {
  let host, bootstrap, time = Date.parse("2026-11-10T00:00:00.000Z"), serial = 0;
  const intervals = new Map(), clock = () => new Date(time);
  const timers = { setTimeout, clearTimeout, setInterval(fn, ms) { const id = ++serial; intervals.set(id, { fn, ms }); return id; }, clearInterval(id) { intervals.delete(id); } };
  const stateDir = options.stateDir ?? join(temp(t, () => host?.close()), "state");
  host = await startHost({ stateDir, port: 0, dispatch: null, clock, timers, monitorStatfs: async () => ({ bavail: 2 ** 30, bsize: 1 }), onBootstrapToken(token) { bootstrap = token; }, ...options });
  t.after(() => host.close());
  const authority = `127.0.0.1:${host.port}`, origin = `http://${authority}`;
  const auth = await host.app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host: authority, origin, "content-type": "application/json" }, payload: { token: bootstrap } });
  assert.equal(auth.statusCode, 200);
  const headers = { host: authority, origin, cookie: auth.headers["set-cookie"].split(";")[0], "x-csrf-token": auth.json().csrfToken, "content-type": "application/json" };
  const projectId = randomUUID();
  const post = (type, payload, project = projectId) => host.app.inject({ method: "POST", url: "/commands", headers, payload: { apiVersion: 1, commandId: randomUUID(), projectId: project, type, payload } });
  const get = url => host.app.inject({ url, headers });
  const createProject = () => post("projects.create", { name: "Standing project", workspace: { kind: "artifact", root: "/workspace/standing" } });
  const create = (patch = {}) => post("standing-approvals.create", { standingId: randomUUID(), actionKind: "notify.send-internal", scope: { kind: "project", ref: projectId }, expiresAt: new Date(time + 86400000).toISOString(), ...patch });
  return { host, stateDir, clock, intervals, projectId, post, get, createProject, create,
    async sweep() { [...intervals.values()].find(x => x.ms === 60000).fn(); for (let i = 0; i < 60; i++) await Promise.resolve(); } };
}
for (const multiTeam of [false, true]) test(`standing commands always registered multiTeam=${multiTeam}`, async t => { const f = await launch(t, { multiTeam }); assert.equal((await f.createProject()).statusCode, 200); const r = await f.create(); assert.equal(r.statusCode, 200); const id = r.json().receipt.effects[0].id; assert.equal((await f.post("standing-approvals.revoke", { standingId: id, expectedRevision: 1 })).statusCode, 200); assert.equal((await f.get(`/projects/${f.projectId}/standing-approvals`)).json().items[0].state, "revoked"); });
test("host advertises both standing commands", async t => { const f = await launch(t), commands = (await f.get("/system/capabilities")).json().commands; for (const name of ["standing-approvals.create", "standing-approvals.revoke"]) assert.equal(commands.filter(x => x === name).length, 1); });
test("existing host sweep collects standing expiry warnings once", async t => { const f = await launch(t); await f.createProject(); await f.create(); await f.sweep(); await f.sweep(); const items = (await f.get(`/projects/${f.projectId}/notifications`)).json().items; assert.equal(items.length, 1); assert.equal(items[0].title, "Standing approval expires soon"); });
test("startup warns for persisted standing approval without duplicating on restart", async t => { const f = await launch(t); await f.createProject(); await f.create(); await f.host.close(); const next = await launch(t, { stateDir: f.stateDir }); assert.equal(next.host.storage.raw.prepare("SELECT count(*) AS n FROM notifications").get().n, 1); await next.sweep(); assert.equal(next.host.storage.raw.prepare("SELECT count(*) AS n FROM notifications").get().n, 1); await next.host.close(); });
test("standing approvals add no timer", async t => { const f = await launch(t); const before = [...f.intervals.values()].map(x => x.ms).sort(); await f.createProject(); await f.create(); assert.deepEqual([...f.intervals.values()].map(x => x.ms).sort(), before); assert.equal(before.filter(x => x === 60000).length, 1); });
test("host rejects forbidden standing kind with validation rule", async t => { const f = await launch(t); await f.createProject(); const r = await f.create({ actionKind: "deploy.production" }); assert.equal(r.statusCode, 400); assert.match(JSON.stringify(r.json()), /STANDING_FORBIDDEN/); });
