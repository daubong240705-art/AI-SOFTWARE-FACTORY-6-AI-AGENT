import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { startHost } from "../dist/host.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { temp } from "./org-fixture.mjs";

async function launch(t, extra = {}) {
  let host, bootstrap, time = Date.parse("2026-11-10T00:00:00Z"), serial = 0;
  const intervals = new Map(), clock = () => new Date(time);
  const timers = { setTimeout, clearTimeout, setInterval(fn, ms) { const id = ++serial; intervals.set(id, { fn, ms }); return id; }, clearInterval(id) { intervals.delete(id); } };
  const stateDir = extra.stateDir ?? join(temp(t, () => host?.close()), "state");
  host = await startHost({ stateDir, port: 0, dispatch: null, clock, timers, monitorStatfs: async () => ({ bavail: 2 ** 30, bsize: 1 }), onBootstrapToken(token) { bootstrap = token; }, ...extra });
  t.after(() => host.close());
  const pipeline = createCommandPipeline({ storage: host.storage, hub: host.hub, clock }), projectId = randomUUID();
  const create = () => assert.equal(pipeline.execute({ apiVersion: 1, commandId: randomUUID(), projectId, type: "projects.create", payload: { name: "Notify project", workspace: { kind: "directory", root: "/workspace/notify" } } }).status, 200);
  const authority = `127.0.0.1:${host.port}`, origin = `http://${authority}`;
  const auth = await host.app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host: authority, origin, "content-type": "application/json" }, payload: { token: bootstrap } });
  assert.equal(auth.statusCode, 200);
  const headers = { host: authority, origin, cookie: auth.headers["set-cookie"].split(";")[0], "x-csrf-token": auth.json().csrfToken, "content-type": "application/json" };
  const get = url => host.app.inject({ url, headers });
  const post = (type, id) => host.app.inject({ method: "POST", url: "/commands", headers, payload: { apiVersion: 1, commandId: randomUUID(), projectId, type: `notifications.${type}`, payload: { notificationId: id } } });
  const approval = () => { const id = randomUUID(); host.storage.raw.prepare(`INSERT INTO approvals (project_id,id,revision,kind,subject,summary,options_json,impact_if_waiting,context_digest,approver,requested_at,expires_at,state)
    VALUES (?,?,1,'question','Review','Summary','[{"id":"yes"},{"id":"no"}]','Waiting',?,'operator',?,?,'pending')`).run(projectId, id, "a".repeat(64), clock().toISOString(), new Date(time + 7 * 86400000).toISOString()); return id; };
  const rows = () => host.storage.raw.prepare("SELECT * FROM notifications ORDER BY rowid").all();
  return { host, stateDir, projectId, create, approval, rows, intervals, get, post,
    advance: ms => { time += ms; }, async sweep() { [...intervals.values()].find(x => x.ms === 60000).fn(); for (let i = 0; i < 60; i++) await Promise.resolve(); } };
}
for (const multiTeam of [false, true]) test(`notifications always wired with multiTeam=${multiTeam}`, async t => { const f = await launch(t, { multiTeam }); f.create(); f.approval(); await f.sweep(); await f.sweep(); assert.equal(f.rows().length, 1); const response = await f.get(`/projects/${f.projectId}/notifications`); assert.equal(response.statusCode, 200); assert.equal(response.json().unread, 1); });
test("startup collects persisted pending approvals and dedups restart", async t => { const f = await launch(t); f.create(); f.approval(); await f.host.close(); const next = await launch(t, { stateDir: f.stateDir }); assert.equal(next.rows().length, 1); await next.sweep(); assert.equal(next.rows().length, 1); await next.host.close(); });
test("notification commands are advertised and usable through host", async t => { const f = await launch(t); f.create(); f.approval(); await f.sweep(); const capabilities = (await f.get("/system/capabilities")).json(); assert.ok(capabilities.commands.includes("notifications.mark-read")); assert.ok(capabilities.commands.includes("notifications.dismiss")); const id = f.rows()[0].id; assert.equal((await f.post("mark-read", id)).statusCode, 200); assert.equal((await f.post("dismiss", id)).statusCode, 200); assert.equal(f.rows()[0].state, "dismissed"); });
test("default host creates no delivery rows", async t => { const f = await launch(t); f.create(); f.approval(); await f.sweep(); assert.equal(f.host.storage.raw.prepare("SELECT count(*) AS n FROM notification_deliveries").get().n, 0); });
test("optional push channel is passed into sweep", async t => { const sent = [], f = await launch(t, { pushChannel: { name: "fake", async send(p) { sent.push(p); } } }); f.create(); f.approval(); await f.sweep(); assert.equal(sent.length, 1); assert.equal(sent[0].link, "/inbox"); });
test("host sweep uses budget offset for digest boundary", async t => { const f = await launch(t, { budgetConfig: { defaultTaskTokens: 200000, defaultDayTokens: 1000000, warnAtPercent: 80, utcOffsetMinutes: 0 } }); f.create(); f.approval(); f.advance(17 * 3600000 + 59 * 60000); await f.sweep(); assert.equal(f.rows().filter(x => x.category === "digest").length, 0); f.advance(60000); await f.sweep(); assert.equal(f.rows().filter(x => x.category === "digest").length, 1); });
test("closing host clears injected sweep timers", async t => { const f = await launch(t); await f.host.close(); assert.equal(f.intervals.size, 0); });
