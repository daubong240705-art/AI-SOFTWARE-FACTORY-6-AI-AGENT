import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { teamFixture, open } from "./breaker-fixture.mjs";
import { createRouteBreaker } from "../dist/policy/breaker.js";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";

async function api(t, withProxy = false) {
  const f = teamFixture(t), host = "127.0.0.1:8787", origin = `http://${host}`;
  const routeBreaker = createRouteBreaker({ clock: f.clock }); const gate = createBootstrapGate({ clock: f.clock });
  const app = createApiServer({ origins: [origin], clock: f.clock, gate, sessions: createSessionStore({ clock: f.clock }),
    register: createRoutes({ storage: f.storage, hub: f.hub, pipeline: f.pipeline, clock: f.clock, ...(withProxy ? { routeBreaker } : {}) }) });
  t.after(() => app.close());
  const auth = await app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host, origin, "content-type": "application/json" }, payload: { token: gate.token } });
  assert.equal(auth.statusCode, 200); const headers = { host, cookie: auth.headers["set-cookie"].split(";")[0] };
  return { ...f, routeBreaker, root: `/projects/${f.projectId}`, get: (url, session = true) => app.inject({ url, headers: session ? headers : { host } }) };
}
test("breakers read requires session", async t => { const f = await api(t); assert.equal((await f.get(`${f.root}/breakers`, false)).statusCode, 401); });
for (const id of ["unknown", randomUUID()]) test(`unknown project breaker read is 404 ${id}`, async t => { const f = await api(t); assert.equal((await f.get(`/projects/${id}/breakers`)).statusCode, 404); });
test("breakers return empty arrays without proxy and trips", async t => { const f = await api(t); const r = await f.get(`${f.root}/breakers`); assert.equal(r.statusCode, 200); assert.deepEqual(r.json(), { teams: [], routes: [] }); });
test("breakers return persisted team fields in camelCase", async t => {
  const f = await api(t); f.fail(); f.tick(); const r = (await f.get(`${f.root}/breakers`)).json();
  assert.deepEqual(r.teams, [{ teamId: f.teamId, state: "open", openedAt: f.clock().toISOString(), closedAt: null, failures: 5, reason: "5 tasks failed within 60 minutes" }]);
});
test("breakers show closed state after operator resume", async t => { const f = await api(t); f.fail(); f.tick(); f.lifecycle("active"); f.advance(60000); f.tick(); const row = (await f.get(`${f.root}/breakers`)).json().teams[0]; assert.equal(row.state, "closed"); assert.equal(row.openedAt, null); assert.equal(row.closedAt, f.clock().toISOString()); });
test("route read returns the shared breaker snapshot", async t => { const f = await api(t, true); open(f.routeBreaker); assert.deepEqual((await f.get(`${f.root}/breakers`)).json().routes, f.routeBreaker.snapshot()); });
test("route read never claims a half-open trial", async t => { const f = await api(t, true); open(f.routeBreaker); f.advance(300000); assert.equal((await f.get(`${f.root}/breakers`)).json().routes[0].state, "open"); assert.equal(f.routeBreaker.allow("approved").allowed, true); assert.equal((await f.get(`${f.root}/breakers`)).json().routes[0].state, "half-open"); });
test("project breaker reads are isolated", async t => { const f = await api(t), other = f.project(); f.fail(); f.tick(); assert.deepEqual((await f.get(`/projects/${other}/breakers`)).json().teams, []); });
for (const global of [false, true]) test(`${global ? "global" : "project"} inbox includes open team breaker and count`, async t => {
  const f = await api(t); f.fail(); f.tick(); const inbox = (await f.get(global ? "/inbox" : `${f.root}/inbox`)).json();
  assert.equal(inbox.teamBreakers.length, 1); assert.equal(inbox.teamBreakers[0].title, "team paused by circuit breaker"); assert.equal(inbox.teamBreakers[0].reason, "5 tasks failed within 60 minutes"); assert.equal(inbox.teamBreakers[0].projectId, f.projectId); assert.equal(inbox.counts.teamBreakers, 1); assert.equal(inbox.counts.total, 1);
});
test("closed breaker disappears from inbox", async t => { const f = await api(t); f.fail(); f.tick(); f.lifecycle("active"); f.tick(); const inbox = (await f.get("/inbox")).json(); assert.deepEqual(inbox.teamBreakers, []); assert.equal(inbox.counts.teamBreakers, undefined); });
test("project inbox excludes other projects' breakers", async t => { const f = await api(t), other = f.project(); f.fail(); f.tick(); assert.deepEqual((await f.get(`/projects/${other}/inbox`)).json().teamBreakers, []); });
