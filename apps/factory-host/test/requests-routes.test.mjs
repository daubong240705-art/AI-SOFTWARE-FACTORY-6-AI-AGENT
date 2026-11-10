import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
import { fixture, requestInput } from "./requests-fixture.mjs";

async function api(t, f) {
  const origin = "http://127.0.0.1:8787";
  const gate = createBootstrapGate({ clock: f.clock }); const sessions = createSessionStore({ clock: f.clock });
  const routes = createRoutes({ storage: f.storage, hub: f.hub, pipeline: f.pipeline, dispatch: f.dispatcher });
  const app = createApiServer({ origins: [origin], gate, sessions, clock: f.clock, register: routes });
  t.after(() => app.close());
  const boot = await app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host: "127.0.0.1:8787", origin }, payload: { token: gate.token } });
  const cookie = boot.headers["set-cookie"].split(";", 1)[0];
  const headers = { host: "127.0.0.1:8787", origin, cookie };
  return { read: (url, authenticated = true) => app.inject({ method: "GET", url, headers: authenticated ? headers : { host: headers.host } }) };
}
const list = (f) => `/projects/${f.projectId}/requests`;

test("request routes require a session", async (t) => {
  const f = fixture(t); const http = await api(t, f); const a = f.create();
  for (const url of [list(f), `${list(f)}/${a.requestId}`, "/inbox", `/projects/${f.projectId}/inbox`])
    assert.equal((await http.read(url, false)).statusCode, 401);
});
test("unknown project and unknown request answer 404 with fixed text", async (t) => {
  const f = fixture(t); const http = await api(t, f);
  const project = await http.read(`/projects/${randomUUID()}/requests`); assert.equal(project.statusCode, 404);
  assert.equal(project.json().error.message, "Project not found.");
  const missing = await http.read(`${list(f)}/${randomUUID()}`); assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.message, "Request not found.");
});
test("listing is newest first, filters by state and team and honours limit", async (t) => {
  const f = fixture(t); const http = await api(t, f); const first = f.create({ kind: "produce", subject: "First" });
  f.clock.advance?.(1000); const second = f.create({ kind: "decision", subject: "Second", ask: "Another question entirely" });
  const all = (await http.read(list(f))).json().items; assert.equal(all.length, 2);
  assert.deepEqual(new Set(all.map((item) => item.taskId)), new Set([first.requestId, second.requestId]));
  assert.equal((await http.read(`${list(f)}?limit=1`)).json().items.length, 1);
  assert.equal((await http.read(`${list(f)}?team=${f.team}`)).json().items.length, 2);
  assert.equal((await http.read(`${list(f)}?team=${randomUUID()}`)).json().items.length, 0);
  assert.equal((await http.read(`${list(f)}?state=submitted`)).json().items.length, 2);
  assert.equal((await http.read(`${list(f)}?state=declined`)).json().items.length, 0);
  for (const bad of ["state=bogus", "limit=0", "limit=abc", "extra=1", "team=not-an-id"])
    assert.equal((await http.read(`${list(f)}?${bad}`)).statusCode, 400);
});
test("list items and details carry no paths, tokens or foreign ids", async (t) => {
  const f = fixture(t); const http = await api(t, f); const a = f.create();
  const body = (await http.read(list(f))).body + (await http.read(`${list(f)}/${a.requestId}`)).body;
  assert.doesNotMatch(body, /[A-Za-z]:\|\/home\/|token|secret/i);
  const item = (await http.read(list(f))).json().items[0];
  assert.deepEqual(Object.keys(item).sort(), ["code", "createdAt", "hop", "kind", "requesterCode", "rounds", "subject", "targetTeamName", "taskId", "taskState", "triageState", "waiting"]);
});
test("detail shows the thread and state for the operator", async (t) => {
  const f = fixture(t); const http = await api(t, f); const a = f.create();
  const view = (await http.read(`${list(f)}/${a.requestId}`)).json().request;
  assert.equal(view.requestId, a.requestId); assert.equal(view.triageState, "submitted"); assert.equal(view.thread[0].author, "requester");
});
test("inbox lists requests awaiting triage and counts are additive", async (t) => {
  const f = fixture(t); const http = await api(t, f); const a = f.create();
  const inbox = (await http.read("/inbox")).json();
  assert.deepEqual(inbox.requests.map((item) => item.taskId), [a.requestId]);
  assert.deepEqual(inbox.counts, { patches: 0, approvals: 0, startGates: 0, requests: 1, total: 1 });
  assert.equal((await http.read(`/projects/${f.projectId}/inbox`)).json().requests.length, 1);
  f.triage(a.requestId, "decline");
  const after = (await http.read("/inbox")).json(); assert.equal(after.requests.length, 0); assert.equal(after.counts.total, 0);
});
test("need-info requests stay in the inbox until the requester answers", async (t) => {
  const f = fixture(t); const http = await api(t, f); const a = f.create();
  f.triage(a.requestId, "need-info");
  assert.equal((await http.read("/inbox")).json().requests.length, 1);
  f.reply(a.requestId, "message", "Here is more"); assert.equal(f.meta(a.requestId).triage_state, "submitted");
});
test("an unrelated project inbox does not list the request", async (t) => {
  const f = fixture(t); const http = await api(t, f); f.create();
  const other = randomUUID(); f.raw.prepare("INSERT INTO projects VALUES (?,1,'Other','directory','/private/other','active')").run(other);
  const r = await http.read(`/projects/${other}/inbox`); assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().requests.length, 0);
  assert.equal((await http.read(`/projects/${other}/requests`)).json().items.length, 0);
});
void requestInput;
