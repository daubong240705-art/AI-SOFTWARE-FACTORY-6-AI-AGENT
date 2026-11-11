import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { standingFixture } from "./standing-fixture.mjs";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
import { DEFAULT_BUDGET_CONFIG } from "../dist/policy/budget.js";

async function api(t, options = {}) {
  const f = standingFixture(t, options), host = "127.0.0.1:8787", origin = `http://${host}`, gate = createBootstrapGate({ clock: f.clock });
  const app = createApiServer({ origins: [origin], clock: f.clock, gate, sessions: createSessionStore({ clock: f.clock }),
    register: createRoutes({ storage: f.storage, hub: f.hub, pipeline: f.pipeline, clock: f.clock,
      budgetConfig: { ...DEFAULT_BUDGET_CONFIG, utcOffsetMinutes: options.utcOffsetMinutes ?? 420 } }) });
  t.after(() => app.close());
  const auth = await app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host, origin, "content-type": "application/json" }, payload: { token: gate.token } });
  assert.equal(auth.statusCode, 200); const headers = { host, cookie: auth.headers["set-cookie"].split(";")[0] };
  return { ...f, app, root: `/projects/${f.projectId}/standing-approvals`, get: url => app.inject({ url, headers }), anonymous: url => app.inject({ url, headers: { host } }) };
}
test("standing route requires a session", async t => { const f = await api(t); assert.equal((await f.anonymous(f.root)).statusCode, 401); });
test("standing route unknown project is 404", async t => { const f = await api(t); assert.equal((await f.get(`/projects/${randomUUID()}/standing-approvals`)).statusCode, 404); });
test("standing route empty defaults include L3 default source", async t => { const f = await api(t); assert.deepEqual((await f.get(f.root)).json(), { items: [], level: { level: 3, source: "default" } }); });
test("standing route explicit L4 source", async t => { const f = await api(t); f.level(); assert.deepEqual((await f.get(f.root)).json().level, { level: 4, source: "explicit" }); });
test("standing route returns only public approval fields", async t => { const f = await api(t), id = f.create(); const response = await f.get(f.root); assert.equal(response.statusCode, 200); const item = response.json().items[0]; assert.deepEqual(Object.keys(item).sort(), ["actionKind", "createdAt", "expiresAt", "id", "limitPerDay", "maxTokensPerUse", "remainingToday", "revokedAt", "scope", "state", "usedToday"]); assert.equal(item.id, id); assert.equal(item.maxTokensPerUse, null); assert.equal(item.revokedAt, null); });
test("standing route exposes token cap and team scope", async t => { const f = await api(t); f.create({ maxTokensPerUse: 50000, scope: { kind: "team", ref: f.teamId } }); const item = (await f.get(f.root)).json().items[0]; assert.equal(item.maxTokensPerUse, 50000); assert.deepEqual(item.scope, { kind: "team", ref: f.teamId }); });
test("standing route counts usage and remaining today", async t => { const f = await api(t); f.level(); f.create({ limitPerDay: 2 }); f.use(); const item = (await f.get(f.root)).json().items[0]; assert.equal(item.usedToday, 1); assert.equal(item.remainingToday, 1); });
test("standing route remaining reaches zero", async t => { const f = await api(t); f.level(); f.create({ limitPerDay: 1 }); f.use(); f.use(); const item = (await f.get(f.root)).json().items[0]; assert.equal(item.usedToday, 1); assert.equal(item.remainingToday, 0); });
test("standing route counts reset on local midnight", async t => { const f = await api(t, { at: "2026-11-10T16:59:59.999Z" }); f.level(); f.create({ limitPerDay: 1 }); f.use(); f.advance(1); const item = (await f.get(f.root)).json().items[0]; assert.equal(item.usedToday, 0); assert.equal(item.remainingToday, 1); });
test("standing route uses configured offset", async t => { const f = await api(t, { at: "2026-11-10T16:59:59.999Z", utcOffsetMinutes: 0 }); f.level(); f.create({ limitPerDay: 1 }); f.use({ utcOffsetMinutes: 0 }); f.advance(1); assert.equal((await f.get(f.root)).json().items[0].usedToday, 1); });
test("standing route returns revoked approval state", async t => { const f = await api(t), id = f.create(); f.revoke(id); const item = (await f.get(f.root)).json().items[0]; assert.equal(item.state, "revoked"); assert.equal(item.revokedAt, f.clock().toISOString()); });
test("standing route includes expired rows", async t => { const f = await api(t); f.create({ expiresAt: new Date(f.clock().getTime() + 1).toISOString() }); f.advance(1); assert.equal((await f.get(f.root)).json().items.length, 1); });
test("standing route orders newest first with stable timestamp ties and max 100", async t => { const f = await api(t), ids = []; for (let i = 0; i < 105; i++) { const id = f.create(); ids.push(id); f.revoke(id); } const items = (await f.get(f.root)).json().items; assert.equal(items.length, 100); assert.deepEqual(items.map(x => x.id), ids.reverse().slice(0, 100)); });
test("standing route isolates projects and use counts", async t => { const f = await api(t); f.level(); const id = f.create(); f.use(); const other = f.project(); f.create({ standingId: id, scope: { kind: "project", ref: other } }, other); const body = (await f.get(`/projects/${other}/standing-approvals`)).json(); assert.equal(body.items.length, 1); assert.equal(body.items[0].usedToday, 0); assert.deepEqual(body.level, { level: 3, source: "default" }); });
test("per-item uses are not exposed", async t => { const f = await api(t), id = f.create(); assert.equal((await f.get(`${f.root}/${id}/uses`)).statusCode, 404); });
