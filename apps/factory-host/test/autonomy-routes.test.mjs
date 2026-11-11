import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { policyFixture } from "./policy-fixture.mjs";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";

async function api(t) {
  const f = policyFixture(t), host = "127.0.0.1:8787", origin = `http://${host}`;
  const gate = createBootstrapGate({ clock: f.clock });
  const app = createApiServer({ origins: [origin], clock: f.clock, gate, sessions: createSessionStore({ clock: f.clock }),
    register: createRoutes({ storage: f.storage, hub: f.hub, pipeline: f.pipeline, clock: f.clock }) });
  t.after(() => app.close());
  const auth = await app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host, origin, "content-type": "application/json" },
    payload: { token: gate.token } }); assert.equal(auth.statusCode, 200);
  const headers = { host, cookie: auth.headers["set-cookie"].split(";")[0] };
  return { ...f, get: (url, session = true) => app.inject({ url, headers: session ? headers : { host } }),
    root: `/projects/${f.projectId}` };
}
for (const route of ["autonomy", "budget"]) test(`${route} requires session`, async t => {
  const f = await api(t); assert.equal((await f.get(`${f.root}/${route}`, false)).statusCode, 401);
});
for (const route of ["autonomy", "budget"]) test(`${route} returns 404 for unknown project`, async t => {
  const f = await api(t); assert.equal((await f.get(`/projects/${randomUUID()}/${route}`)).statusCode, 404);
});
test("autonomy returns 404 for malformed unknown project", async t => {
  const f = await api(t); assert.equal((await f.get("/projects/unknown/autonomy")).statusCode, 404);
});
test("autonomy route includes defaults and nullable revision", async t => {
  const f = await api(t), response = await f.get(`${f.root}/autonomy`); assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { apiVersion: 1, ok: true, project: { level: 3, source: "default", revision: null },
    teams: [{ teamId: f.teamId, level: 2, effectiveLevel: 2, source: "default" }], defaults: { project: 3, team: 2 } });
});
test("autonomy route shows explicit settings and effective team authority", async t => {
  const f = await api(t); f.set("project", f.projectId, 1); f.set("team", f.teamId, 4);
  const response = (await f.get(`${f.root}/autonomy`)).json();
  assert.deepEqual(response.project, { level: 1, source: "explicit", revision: 1 });
  assert.deepEqual(response.teams, [{ teamId: f.teamId, level: 4, effectiveLevel: 1, source: "explicit" }]);
});
test("autonomy route excludes teams engaged only in other projects", async t => {
  const f = await api(t), team = f.secondTeam(), other = f.project(); f.engage(team, other);
  assert.deepEqual((await f.get(`${f.root}/autonomy`)).json().teams.map(x => x.teamId), [f.teamId]);
});
test("autonomy route includes all project engagement teams", async t => {
  const f = await api(t), team = f.secondTeam(); f.engage(team);
  assert.deepEqual((await f.get(`${f.root}/autonomy`)).json().teams.map(x => x.teamId), [f.teamId, team].sort());
});
test("budget route includes unlimited project and empty explicit engagements", async t => {
  const f = await api(t); f.usage(15); const response = await f.get(`${f.root}/budget`); assert.equal(response.statusCode, 200);
  const { budget } = response.json(); assert.deepEqual(budget.project, { used: 15, limit: null, verdict: "ok", source: "default" });
  assert.deepEqual(budget.engagements, []); assert.equal(budget.day.limit, 1_000_000); assert.deepEqual(budget.tasks, []);
});
test("budget route exposes explicit project and engagement token warnings", async t => {
  const f = await api(t), taskId = f.task({ engagementId: f.primary.id }); f.usage(80, taskId);
  f.mustBudget("project", f.projectId); f.mustBudget("engagement", f.primary.id);
  const { budget } = (await f.get(`${f.root}/budget`)).json();
  assert.deepEqual(budget.project, { used: 80, limit: 100, verdict: "warn", source: "explicit" });
  assert.deepEqual(budget.engagements, [{ engagementId: f.primary.id, used: 80, limit: 100, verdict: "warn" }]);
  assert.equal(budget.day.used, 80); assert.equal(budget.tasks[0].used, 80);
});
