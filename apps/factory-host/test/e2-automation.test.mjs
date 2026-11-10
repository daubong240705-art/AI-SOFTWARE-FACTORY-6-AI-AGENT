import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { e2Fixture, scenario, oneStage } from "./e2-fixture.mjs";
import { tickMonitors } from "../dist/automation/monitors.js";
import { tickRules } from "../dist/automation/rules.js";
import { runWatchdog } from "../dist/automation/watchdog.js";
import { ruleFireId } from "../dist/automation/rules.js";

test("E2 A1: disk monitor starts incident review once, replay and hop limits hold, failures quarantine", scenario, async t => {
  const f = e2Fixture(t, { definitions: [oneStage("incident-review")] }), monitorId = randomUUID(), ruleId = randomUUID();
  f.ok("monitors.create", { monitorId, name: "Disk free", kind: "disk-free", params: { path: "state" },
    comparator: "lt", threshold: 2, tripAfter: 1, recoverAfter: 1, intervalSeconds: 60 });
  const action = { kind: "start-workflow", definitionKey: "incident-review", packKey: "software-team" };
  f.ok("rules.create", { ruleId, name: "Review low disk", eventType: "monitor.changed",
    condition: { field: "to", op: "eq", value: "tripped" }, action, debounceSeconds: 0, maxFiresPerHour: 50 });
  let space = 1;
  const probe = () => tickMonitors({ raw: f.raw, hub: f.hub, stateDir: "state",
    statfs: async () => ({ bavail: space * 2 ** 30, bsize: 1 }) }, f.clock());
  const fires = id => f.raw.prepare("SELECT * FROM rule_fires WHERE rule_id=? ORDER BY event_sequence").all(id);
  await probe(); f.tickRules();
  assert.equal(f.raw.prepare("SELECT status FROM monitors WHERE id=?").get(monitorId).status, "tripped");
  assert.equal(fires(ruleId).length, 1); const first = fires(ruleId)[0];
  assert.equal(first.status, "started"); assert.equal(first.depth, 0);
  assert.equal(first.instance_id, ruleFireId(f.projectId, ruleId, first.event_sequence));
  assert.equal(f.view(first.instance_id).state, "active");
  assert.ok((await f.read("inbox")).monitors.some(m => m.monitorId === monitorId));
  // Replaying the same durable stream cannot create another instance or command receipt.
  const receipts = f.raw.prepare("SELECT count(*) n FROM command_receipts WHERE actor_id='rule-evaluator'").get().n;
  f.raw.prepare("UPDATE automation_cursors SET last_sequence=0 WHERE project_id=?").run(f.projectId);
  f.tickRules(); assert.equal(fires(ruleId).length, 1);
  assert.equal(f.raw.prepare("SELECT count(*) n FROM command_receipts WHERE actor_id='rule-evaluator'").get().n, receipts);
  // Follow the incident's own completion events through a second real rule to exercise causal depth.
  const follow = randomUUID();
  f.ok("rules.create", { ruleId: follow, name: "Incident follow-up", eventType: "workflow.state-changed",
    condition: { all: [{ field: "to", op: "eq", value: "completed" }, { field: "workflowKey", op: "eq", value: "incident-review" }] },
    action, debounceSeconds: 0, maxFiresPerHour: 50 });
  let id = first.instance_id;
  for (let depth = 1; depth <= 4; depth++) {
    await f.complete(id); f.tickRules();
    const fire = fires(follow).at(-1); assert.equal(fire.depth, depth);
    if (depth <= 3) { assert.equal(fire.status, "started"); id = fire.instance_id; }
    else { assert.equal(fire.status, "skipped"); assert.equal(fire.reason, "hop limit"); assert.equal(fire.instance_id, null); }
  }
  f.tickRules(); assert.equal(fires(follow).filter(r => r.status === "started").length, 3);
  assert.equal(f.runtime.started.length, 4, "only the fake runtime ran the bounded chain");
  // Recover/trip edges produce three distinct events. Fail only the workflow command dependency.
  for (let i = 0; i < 3; i++) {
    space = 3; f.advance(60000); await probe(); f.tickRules();
    space = 1; f.advance(60000); await probe();
    tickRules({ ...f.schedulerDeps, pipeline: { execute() { throw Error("Workflow unavailable"); } } }, f.clock());
  }
  const row = f.raw.prepare("SELECT * FROM automation_rules WHERE id=?").get(ruleId);
  assert.equal(row.state, "quarantined"); assert.equal(row.consecutive_failures, 3);
  assert.deepEqual(fires(ruleId).map(r => r.status), ["started", "failed", "failed", "failed"]);
  assert.ok((await f.read("inbox")).quarantinedRules.some(r => r.ruleId === ruleId));
  await f.notify(); await f.notify(); assert.equal(f.rows().filter(n => n.entity_id === ruleId).length, 1);
  assert.equal(f.rows().find(n => n.entity_id === ruleId).category, "action");
  const before = fires(ruleId).length; f.tickRules(); assert.equal(fires(ruleId).length, before);
  assert.equal(f.events().filter(e => e.payload.type === "monitor.changed" && e.payload.to === "tripped").length, 4);
});

test("E2 A2: watchdog stalls idle live work without a deadlock, notifies once, and resume completes", scenario, async t => {
  const definition = { ...oneStage("incident-review"), timeouts: { stallAfterMinutes: 10, maxDurationMinutes: 100 } };
  const f = e2Fixture(t, { definitions: [definition] }), id = f.create({}, "incident-review"); f.command("start", id);
  const grant = await f.live(id, "review");
  assert.equal(f.view(id).state, "active");
  f.advance(10 * 60000); assert.deepEqual(runWatchdog(f.deps, f.clock()), []);
  f.advance(1); assert.deepEqual(runWatchdog(f.deps, f.clock()), [id]);
  assert.equal(f.view(id).stalledReason, "no progress for 10 minutes");
  assert.doesNotMatch(f.view(id).stalledReason, /deadlock/);
  assert.equal(f.task(grant.taskId).state, "active");
  assert.ok((await f.read("inbox")).stalledWorkflows.some(w => w.instanceId === id));
  await f.notify(); f.advance(60000); await f.notify();
  assert.deepEqual(runWatchdog(f.deps, f.clock()), []);
  assert.equal(f.rows().filter(n => n.entity_id === id).length, 1);
  assert.equal(f.events().filter(e => e.payload.type === "workflow.state-changed" && e.payload.to === "stalled").length, 1);
  f.raw.prepare("UPDATE attempts SET lease_expires_at=? WHERE id=?").run(new Date(f.clock().getTime() + 600000).toISOString(), grant.attemptId);
  f.command("resume", id); assert.equal(f.view(id).state, "active"); assert.equal(f.view(id).stalledReason, null);
  assert.equal(f.view(id).lastProgressAt, f.clock().toISOString());
  assert.deepEqual(runWatchdog(f.deps, f.clock()), []);
  assert.equal((await f.read("inbox")).stalledWorkflows.length, 0);
  await f.complete(id); assert.equal(f.attempts(grant.taskId).length, 1);
  assert.equal(f.raw.prepare("SELECT state FROM approvals WHERE task_id=?").get(grant.taskId).state, "applied");
  assert.equal((await f.read("inbox")).counts.total, 0);
  await f.notify(); assert.equal(f.rows().filter(n => n.entity_id === id).length, 1);
});
