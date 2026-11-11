// Closes mutation survivors of the A2a review: how many stage keys a deadlock names, old non-pending approvals and a monitor changed while its probe is pending.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { automationFixture } from "./automation-fixture.mjs";
import { engineFixture, flow, stage } from "./workflow-engine-fixture.mjs";
import { runWatchdog } from "../dist/automation/watchdog.js";

test("a deadlock names at most five blocked stages", (t) => {
  const keys = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"];
  const f = engineFixture(t, flow(keys.map((key) => stage(key, { requiredCapabilities: ["missing.capability"] })), []));
  f.raw.prepare("UPDATE engagements SET state = 'paused' WHERE project_id = ?").run(f.projectId);
  f.start();
  runWatchdog({ ...f.deps, clock: () => f.clock() }, f.clock());
  const reason = f.view().stateReason ?? f.raw.prepare("SELECT state_reason FROM workflow_instances WHERE id = ?").get(f.id).state_reason;
  assert.match(reason, /^deadlock: /); assert.equal(reason.slice("deadlock: ".length).split(", ").length, 5);
});
test("only PENDING approvals older than the limit are counted by approval-overdue", async (t) => {
  const f = automationFixture(t);
  const id = f.create({ kind: "approval-overdue", params: { hours: 1 }, threshold: 0, tripAfter: 1 });
  const taskId = f.task({ seatId: f.seat.id });
  const old = new Date(f.clock().getTime() - 5 * 3600000).toISOString();
  for (const state of ["expired", "withdrawn"]) f.raw.prepare(`INSERT INTO approvals (project_id,id,revision,kind,task_id,subject,summary,options_json,impact_if_waiting,context_digest,approver,requested_at,expires_at,state)
    VALUES (?,?,1,'question',?,'Subject','Summary','[{"id":"a","label":"A","consequence":"a"},{"id":"b","label":"B","consequence":"b"}]','Wait',?,'operator',?,'2099-01-01T00:00:00.000Z',?)`).run(f.projectId, randomUUID(), taskId, "a".repeat(64), old, state);
  await f.tick();
  assert.equal(f.row(id).last_value, 0); assert.equal(f.row(id).status, "ok");
});
test("a monitor changed while its probe is pending is not overwritten by the tick", async (t) => {
  const f = automationFixture(t);
  const id = f.create({ kind: "disk-free", params: { path: "state" }, comparator: "lt", threshold: 100, tripAfter: 1 });
  const before = f.row(id);
  const slow = { ...f.deps, statfs: async () => { const paused = f.change("pause", id); assert.equal(paused.status, 200, JSON.stringify(paused.body)); return { bavail: 1, bsize: 1 }; } };
  const { tickMonitors } = await import("../dist/automation/monitors.js");
  await tickMonitors(slow, f.clock());
  const after = f.row(id);
  assert.equal(after.state, "paused"); assert.equal(after.status, before.status); assert.equal(after.last_value, null);
  assert.equal(f.events(id).length, 0);
});
test("a monitor edited while its probe is pending is checked again with the new settings instead of using a stale decision", async (t) => {
  const f = automationFixture(t);
  const id = f.create({ kind: "disk-free", params: { path: "state" }, comparator: "lt", threshold: 100, tripAfter: 1 });
  const edit = { ...f.deps, statfs: async () => { const r = f.change("update", id, { patch: { threshold: 0 } }); assert.equal(r.status, 200, JSON.stringify(r.body)); return { bavail: 1, bsize: 1 }; } };
  const { tickMonitors } = await import("../dist/automation/monitors.js");
  await tickMonitors(edit, f.clock());
  assert.equal(f.row(id).threshold, 0); assert.equal(f.row(id).status, "unknown"); assert.equal(f.events(id).length, 0);
});
