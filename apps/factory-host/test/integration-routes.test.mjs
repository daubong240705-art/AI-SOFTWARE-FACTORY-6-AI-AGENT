import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { tickNotifications, notificationKey } from "../dist/notify/index.js";
import { integrationApi, integrationFixture } from "./integration-fixture.mjs";

test("integration read has exact empty shape", async t => { const f = await integrationApi(t); const r = await f.get(`/projects/${f.projectId}/integration`); assert.equal(r.statusCode, 200); assert.deepEqual(r.json(), { branch: "factory/integration", items: [] }); });
test("integration read requires session", async t => { const f = await integrationApi(t); assert.equal((await f.get(`/projects/${f.projectId}/integration`, false)).statusCode, 401); });
test("integration read unknown project is 404", async t => { const f = await integrationApi(t); assert.equal((await f.get(`/projects/${randomUUID()}/integration`)).statusCode, 404); });
test("integration read includes all specified item fields", async t => {
  const f = await integrationApi(t), id = f.merge(undefined, { state: "conflict", errorKind: "conflict" }), task = f.getTask(id);
  const r = await f.get(`/projects/${f.projectId}/integration`); assert.deepEqual(r.json().items, [{ taskId: id, code: task.code, title: task.title, state: "conflict", branch: "factory/org-001-e1", mergeSha: null, errorKind: "conflict", createdAt: f.clock().toISOString(), resolvedAt: null }]);
});
test("integration read is newest first", async t => {
  const f = await integrationApi(t), old = f.merge(undefined, { createdAt: "2026-11-07T00:00:00.000Z" }), recent = f.merge(undefined, { createdAt: "2026-11-09T00:00:00.000Z" });
  assert.deepEqual((await f.get(`/projects/${f.projectId}/integration`)).json().items.map(x => x.taskId), [recent, old]);
});
test("integration read limits results to 100", async t => {
  const f = await integrationApi(t); for (let i = 0; i < 103; i++) f.merge(); assert.equal((await f.get(`/projects/${f.projectId}/integration`)).json().items.length, 100);
});
test("integration read is project scoped", async t => {
  const f = await integrationApi(t); f.merge(); assert.deepEqual((await f.get(`/projects/${f.project()}/integration`)).json().items, []);
});
for (const path of ["global", "project"]) test(`${path} inbox adds conflicts and counts them`, async t => {
  const f = await integrationApi(t), id = f.merge(undefined, { state: "conflict" }), task = f.getTask(id);
  const r = (await f.get(path === "global" ? "/inbox" : `/projects/${f.projectId}/inbox`)).json();
  assert.deepEqual(r.integrationConflicts, [{ projectId: f.projectId, taskId: id, code: task.code, title: task.title, branch: "factory/org-001-e1" }]);
  assert.equal(r.counts.integrationConflicts, 1); assert.equal(r.counts.total, 1);
});
test("empty inbox has additive array without a zero count", async t => {
  const f = await integrationApi(t), r = (await f.get("/inbox")).json(); assert.deepEqual(r.integrationConflicts, []); assert.equal("integrationConflicts" in r.counts, false); assert.equal(r.counts.total, 0);
});
for (const state of ["pending", "merged", "skipped"]) test(`inbox excludes ${state}`, async t => {
  const f = await integrationApi(t); f.merge(undefined, { state }); const r = (await f.get("/inbox")).json(); assert.deepEqual(r.integrationConflicts, []); assert.equal(r.counts.total, 0);
});
test("project inbox omits another project's conflicts", async t => {
  const f = await integrationApi(t); f.merge(undefined, { state: "conflict" }); assert.deepEqual((await f.get(`/projects/${f.project()}/inbox`)).json().integrationConflicts, []);
});
test("inbox count adds integration to existing start gates", async t => {
  const f = await integrationApi(t); f.merge(undefined, { state: "conflict" }); f.task({ state: "awaiting-go" }); const r = (await f.get("/inbox")).json(); assert.equal(r.counts.total, 2); assert.equal(r.counts.startGates, 1);
});
test("read views redact host paths from task titles", async t => {
  const f = await integrationApi(t), id = f.task({ state: "done", title: "Changes in /private/example" }); f.merge(id, { state: "conflict" });
  assert.equal(JSON.stringify((await f.get(`/projects/${f.projectId}/integration`)).json()).includes("/private/example"), false);
  assert.equal(JSON.stringify((await f.get("/inbox")).json()).includes("/private/example"), false);
});
test("conflict creates one normal action notification with exact text and key", async t => {
  const f = integrationFixture(t), id = f.merge(undefined, { state: "conflict" }); await tickNotifications({ raw: f.raw, hub: f.hub }, f.clock());
  const rows = f.raw.prepare("SELECT * FROM notifications WHERE category='action'").all(); assert.equal(rows.length, 1); const n = rows[0];
  assert.equal(n.dedup_key, notificationKey("integration", id, "conflict")); assert.equal(n.urgency, "normal"); assert.equal(n.title, `Integration conflict: ${f.getTask(id).code}`);
  assert.equal(n.body, "The accepted work conflicts with the integration branch. Retry or skip it."); assert.equal(n.entity_kind, "task"); assert.equal(n.entity_id, id);
});
test("conflict notification deduplicates repeated ticks", async t => {
  const f = integrationFixture(t); f.merge(undefined, { state: "conflict" }); for (let i = 0; i < 3; i++) await tickNotifications({ raw: f.raw, hub: f.hub }, f.clock());
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM notifications WHERE category='action'").get().n, 1);
});
for (const state of ["pending", "merged", "skipped"]) test(`notifications exclude ${state}`, async t => {
  const f = integrationFixture(t); f.merge(undefined, { state }); await tickNotifications({ raw: f.raw, hub: f.hub }, f.clock()); assert.equal(f.raw.prepare("SELECT count(*) AS n FROM notifications WHERE category='action'").get().n, 0);
});
test("git-failed conflict also notifies with fixed public text", async t => {
  const f = integrationFixture(t); f.merge(undefined, { state: "conflict", errorKind: "git-failed", attempts: 3 }); await tickNotifications({ raw: f.raw, hub: f.hub }, f.clock()); assert.equal(f.raw.prepare("SELECT count(*) AS n FROM notifications WHERE category='action'").get().n, 1);
});
