import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { e2Fixture, scenario } from "./e2-fixture.mjs";
import { createWorkflowPatchMcp } from "../dist/workflow/mcp.js";
import { getApprovalView } from "../dist/approvals/service.js";
import { tickTeamBreakers } from "../dist/automation/breakers.js";
import { createModelProxy, createTokenRegistry } from "../dist/proxy/index.js";
import { DEFAULT_BUDGET_CONFIG } from "../dist/policy/budget.js";
import { advanceTasks } from "../dist/dispatch/advance.js";

async function throughArchitecture(f, id) {
  if (f.stage(id, "research").state !== "skipped") await f.finish(id, "research");
  await f.finish(id, "ba"); await f.finish(id, "architecture");
}

test("E2 D1: no-UI staging delivery honours artifact approval and empties the Inbox", scenario, async t => {
  const f = e2Fixture(t), id = f.create({ hasUI: false }); f.command("start", id);
  assert.equal(f.stage(id, "design").state, "skipped"); assert.deepEqual(f.stage(id, "design").tasks, []);
  await f.finish(id, "research"); await f.finish(id, "ba");
  const ar = await f.review(id, "architecture");
  assert.equal(f.row(ar.outputs[0]).status, "in-review");
  assert.deepEqual(f.stage(id, "development").tasks, [], "artifact-approved edge blocks development");
  f.decide(ar.taskId);
  assert.equal(f.row(ar.outputs[0]).status, "approved");
  const dev = f.stageTask(id, "development"); assert.equal(dev.state, "awaiting-go");
  assert.ok((await f.read("inbox")).startGates.some(g => g.taskId === dev.id));
  await f.complete(id);
  const started = f.runtime.started.map(c => c.task.title);
  assert.deepEqual(started, ["research", "ba", "architecture", "development", "qa", "deploy"]);
  assert.ok(f.runtime.started.every(c => f.attempts(c.task.id).every(a => a.runtime === "fake")));
  const transitions = f.events().filter(e => e.payload.type === "workflow.state-changed" && e.payload.instanceId === id);
  assert.equal(transitions.at(-1).payload.to, "completed");
  const approvals = f.raw.prepare("SELECT state FROM approvals").all();
  assert.equal(approvals.length, 6); assert.ok(approvals.every(a => a.state === "applied"));
  assert.equal((await f.read("inbox")).counts.total, 0);
  await f.notify(); assert.equal(f.rows().length, 0);
});

test("E2 D2: design and architecture run together; development waits for both approvals", scenario, async t => {
  const f = e2Fixture(t), id = f.create({ hasUI: true }); f.command("start", id);
  await f.finish(id, "research"); await f.finish(id, "ba");
  const design = await f.live(id, "design"), ar = await f.live(id, "architecture");
  assert.equal(f.attempts(design.taskId).at(-1).state, "running");
  assert.equal(f.attempts(ar.taskId).at(-1).state, "running");
  await f.finish(id, "architecture");
  assert.deepEqual(f.stage(id, "development").tasks, []);
  await f.finish(id, "design");
  assert.equal(f.stageTask(id, "development").state, "awaiting-go");
  await f.complete(id);
  assert.equal(f.runtime.started.length, 7);
  assert.equal(f.raw.prepare("SELECT count(*) n FROM approvals WHERE state='applied'").get().n, 7);
  assert.equal((await f.read("inbox")).counts.total, 0);
});

test("E2 D3a: real QA changes decisions currently restart QA rather than rework development", scenario, async t => {
  const f = e2Fixture(t), id = f.create({ hasUI: false }); f.command("start", id);
  await throughArchitecture(f, id); await f.finish(id, "development");
  const decisions = [];
  for (let i = 0; i < 4; i++) {
    const qa = await f.review(id, "qa"); decisions.push(f.decide(qa.taskId, "request-changes"));
    // KNOWN DEFECT: approvals.decide makes QA active, but the rework edge reads only done QA.
    assert.equal(f.task(qa.taskId).state, "active");
    assert.equal(f.stage(id, "development").loopCount, 0);
    assert.equal(f.stage(id, "development").tasks.length, 1);
    assert.notEqual(f.view(id).state, "stalled");
  }
  assert.equal(new Set(decisions).size, 4);
  assert.equal(f.raw.prepare("SELECT count(*) n FROM approvals WHERE state='changes-requested'").get().n, 4);
  assert.deepEqual(f.stage(id, "deploy").tasks, []);
  await f.finish(id, "qa"); await f.finish(id, "deploy");
  assert.equal(f.view(id).state, "completed");
  assert.equal((await f.read("inbox")).counts.total, 0);
});

test("E2 D3b: bounded engine rework preserves history, stalls once, and exposes resume limitation", scenario, async t => {
  const f = e2Fixture(t, { triggers: false }), id = f.create({ hasUI: false }); f.command("start", id);
  await throughArchitecture(f, id);
  for (let loop = 0; loop < 4; loop++) {
    await f.finish(id, "development"); const qa = await f.review(id, "qa");
    const pending = f.raw.prepare("SELECT id FROM approvals WHERE task_id=? AND state='pending'").get(qa.taskId);
    const a = getApprovalView(f.raw, f.projectId, pending.id);
    f.workOk("approvals.decide", { approvalId: a.id, expectedRevision: a.revision, contextDigest: a.context.digest,
      optionId: "accept", comment: "Engine rework fact fixture" });
    // KNOWN DEFECT: D3a proves no command supplies done + changes-requested. Seed that
    // historical fact explicitly, as workflow-e2e does, to exercise the existing engine.
    f.raw.prepare(`INSERT INTO approvals (project_id,id,revision,kind,task_id,subject,summary,options_json,
      impact_if_waiting,context_digest,approver,requested_at,expires_at,state,outcome_option_id,outcome_actor_id,decided_at)
      SELECT project_id,?,1,kind,task_id,subject,summary,options_json,impact_if_waiting,context_digest,approver,
      requested_at,expires_at,'changes-requested','request-changes','operator',decided_at FROM approvals WHERE id=?`).run(randomUUID(), a.id);
    f.sweep();
    if (loop < 3) {
      assert.equal(f.stage(id, "development").loopCount, loop + 1); f.sweep();
      assert.match(f.stageTask(id, "development").brief, new RegExp(`Rework ${loop + 1} of 3`));
    }
  }
  assert.equal(f.view(id).state, "stalled"); assert.equal(f.view(id).stalledReason, "rework limit reached");
  assert.equal(f.stage(id, "development").tasks.length, 4); assert.equal(f.stage(id, "qa").tasks.length, 4);
  assert.equal(f.raw.prepare("SELECT count(*) n FROM attempts").get().n, 11);
  assert.ok((await f.read("inbox")).stalledWorkflows.some(w => w.instanceId === id && w.reason === "rework limit reached"));
  await f.notify(); await f.notify();
  assert.equal(f.rows().filter(n => n.entity_id === id).length, 1);
  f.command("resume", id); assert.equal(f.view(id).state, "active");
  // KNOWN DEFECT: resume changes state but leaves the exhausted edge blocked; no decision/reset command exists.
  f.sweep(); assert.equal(f.stage(id, "qa").blockedReason, "rework limit reached");
  assert.equal(f.stage(id, "development").tasks.length, 4); assert.deepEqual(f.stage(id, "deploy").tasks, []);
});

test("E2 D4: two production deliveries each require Operator Go and a fresh review; production cannot be standing", scenario, async t => {
  const f = e2Fixture(t), standing = { standingId: randomUUID(), actionKind: "deploy.production",
    scope: { kind: "project", ref: f.projectId }, expiresAt: "2026-11-15T00:00:00.000Z" };
  f.level(4);
  const refused = f.execute("standing-approvals.create", standing);
  assert.equal(refused.status, 400); assert.equal(refused.body.error.code, "validation");
  assert.match(JSON.stringify(refused.body.error), /STANDING_FORBIDDEN.*deploy.production/);
  f.ok("standing-approvals.create", { ...standing, actionKind: "deploy.staging" });
  const reviews = [];
  for (let run = 0; run < 2; run++) {
    const id = f.create({ hasUI: false, deployTarget: "production" }); f.command("start", id);
    await throughArchitecture(f, id); await f.finish(id, "development"); await f.finish(id, "qa");
    const deploy = f.stageTask(id, "deploy"); assert.equal(deploy.state, "awaiting-go");
    assert.equal(f.attempts(deploy.id).length, 0);
    assert.ok((await f.read("inbox")).startGates.some(g => g.taskId === deploy.id));
    // Known gap: the irreversible-action gate is Operator Go, with no pre-execution Approval row.
    assert.equal(f.raw.prepare("SELECT count(*) n FROM approvals WHERE task_id=?").get(deploy.id).n, 0);
    const grant = await f.review(id, "deploy");
    assert.ok((await f.read("inbox")).approvals.some(a => a.taskId === grant.taskId));
    reviews.push(f.decide(grant.taskId)); assert.equal(f.view(id).state, "completed");
  }
  assert.equal(new Set(reviews).size, 2);
  assert.equal(f.raw.prepare("SELECT count(*) n FROM standing_approval_uses").get().n, 0);
  assert.equal((await f.read("inbox")).counts.total, 0);
});

for (const [label, policy, level, expected] of [
  ["default policy at L3", undefined, 3, "pending"], ["auto at L3", "auto", 3, "applied"], ["auto at L2", "auto", 2, "pending"],
]) test(`E2 D5: Lead migration patch ${label} -> ${expected}, then runs`, scenario, async t => {
  const f = e2Fixture(t, { deferDispatch: true }), id = f.create({ hasUI: false });
  if (level === 2) f.level(2);
  if (policy) {
    const d = JSON.parse(f.raw.prepare("SELECT definition_json FROM workflow_instances WHERE id=?").get(id).definition_json);
    d.allowedPatches.addStage = policy;
    f.raw.prepare("UPDATE workflow_instances SET definition_json=? WHERE id=?").run(JSON.stringify(d), id);
  }
  // Assign the initial planning work to the software Lead through real commands before dispatch.
  const lead = f.seat("software", "Lead");
  f.command("assign-stage", id, { stageKey: "research", engagementId: f.primary.id });
  f.command("start", id);
  const planning = f.stageTask(id, "research");
  f.workOk("work.assign", { workItemId: planning.id, expectedRevision: planning.revision, agentId: lead.id });
  f.deps.dispatcher = f.dispatcher;
  const grant = await f.live(id, "research");
  assert.equal(f.attempts(grant.taskId).at(-1).seatId, lead.id);
  const pinned = f.raw.prepare("SELECT t.pack_digest digest,p.manifest_json FROM teams t JOIN pack_snapshots p ON p.digest=t.pack_digest WHERE t.id=?").get(f.teams.software.id);
  const manifest = JSON.parse(pinned.manifest_json); manifest.seats.find(s => s.name === "Lead").tools = ["workflow.patch"];
  f.raw.prepare("UPDATE pack_snapshots SET manifest_json=? WHERE digest=?").run(JSON.stringify(manifest), pinned.digest);
  const result = createWorkflowPatchMcp(f.deps).call(grant, "workflow.patch", { reason: "Migration required",
    ops: [{ op: "addStage", after: "architecture", before: "development", stage: { key: "migration", title: "migration", phase: "execution",
      requiredCapabilities: ["backend.api"], inputs: [], outputs: [] } }] });
  assert.equal(result.isError, false); assert.equal(JSON.parse(result.content[0].text).state, expected);
  const patch = f.view(id).patches[0]; assert.equal(patch.proposedBy, "lead");
  assert.equal(patch.policy, expected === "pending" ? "approval" : "auto");
  if (expected === "pending") {
    assert.ok((await f.read("inbox")).patches.some(p => p.id === patch.id));
    assert.equal(f.stage(id, "migration"), undefined);
    f.ok("workflows.decide-patch", { patchId: patch.id, decision: "approve", comment: "Migration reviewed" });
  }
  assert.equal(f.view(id).patches[0].state, "applied");
  await f.complete(id);
  assert.equal(f.stage(id, "migration").state, "done");
  const titles = f.runtime.started.map(c => c.task.title);
  assert.ok(titles.indexOf("architecture") < titles.indexOf("migration"));
  assert.ok(titles.indexOf("migration") < titles.indexOf("development"));
  assert.ok(f.events().some(e => e.payload.type === "entity.changed" && e.payload.entity.kind === "workflow-instance"));
  assert.equal((await f.read("inbox")).counts.total, 0);
});

test("E2 D6: exhausted budget refuses proxy calls; running work survives and team breaker resumes cleanly", scenario, async t => {
  const f = e2Fixture(t, { at: "2026-11-08T00:00:00.000Z" }), id = f.create({ hasUI: false }); f.command("start", id);
  const grant = await f.live(id, "research");
  f.ok("budgets.set", { budgetId: randomUUID(), expectedRevision: null, scope: "day", scopeRef: "2026-11-08", limitTokens: 100, warnAtPercent: 80 });
  f.usage(100);
  const tokens = createTokenRegistry({ clock: f.clock });
  const issued = tokens.issue({ ...grant, allowedModels: ["fake"] }); let upstream = 0;
  const proxy = createModelProxy({ tokens, raw: f.raw, clock: f.clock, newId: randomUUID, budget: DEFAULT_BUDGET_CONFIG,
    allowedHosts: ["127.0.0.1:8788"], upstream: { providerId: "fake", async chatCompletions() { upstream++; throw Error("Must not call"); } } });
  t.after(async () => { tokens.revokeAll(); await proxy.close(); });
  const response = await proxy.app.inject({ method: "POST", url: "/v1/chat/completions", headers: {
    host: "127.0.0.1:8788", authorization: `Bearer ${issued.token}`, "content-type": "application/json" },
    payload: { model: "fake", messages: [{ role: "user", content: "Next step" }], max_tokens: 16 } });
  assert.equal(response.statusCode, 429); assert.equal(response.json().error.code, "budget_exceeded"); assert.equal(upstream, 0);
  assert.equal(f.attempts(grant.taskId).at(-1).state, "running"); await f.finish(id, "research");
  assert.equal(f.task(grant.taskId).state, "done");
  const teamId = f.teams.software.id;
  const failures = [];
  for (let i = 0; i < 5; i++) {
    const taskId = f.createTask("software", { goal: "[fake:fail]", requiresGo: false, reviewPolicy: "automatic" });
    await f.until(() => f.task(taskId).state === "failed", "fake failed task");
    failures.push(taskId);
  }
  tickTeamBreakers(f.deps, f.clock());
  // KNOWN DEFECT: dispatcher writes entity.changed, while the breaker counts task.status-changed.
  assert.equal(f.raw.prepare("SELECT lifecycle FROM teams WHERE id=?").get(teamId).lifecycle, "active");
  assert.equal(f.events().filter(e => e.payload.type === "task.status-changed" && e.payload.to === "failed").length, 0);
  // Supply the missing recorded transitions explicitly (the breaker-fixture convention).
  for (const taskId of failures) f.hub.transaction(() => f.hub.append({ projectId: f.projectId, causationId: taskId,
    payload: { type: "task.status-changed", taskId, to: "failed" } }));
  tickTeamBreakers(f.deps, f.clock());
  assert.equal(f.raw.prepare("SELECT lifecycle FROM teams WHERE id=?").get(teamId).lifecycle, "paused");
  const queued = f.createTask("software", { goal: "[fake:hang]", requiresGo: false });
  f.dispatcher.kick(); await new Promise(setImmediate);
  assert.equal(f.attempts(queued).length, 0);
  assert.ok((await f.read("inbox")).teamBreakers.some(b => b.teamId === teamId));
  await f.notify(); await f.notify(); assert.equal(f.rows().filter(n => n.entity_id === teamId).length, 1);
  const revision = f.raw.prepare("SELECT revision FROM teams WHERE id=?").get(teamId).revision;
  f.workOk("teams.set-lifecycle", { teamId, expectedRevision: revision, lifecycle: "active" });
  tickTeamBreakers(f.deps, f.clock()); f.sweep();
  // Trigger the normal task-advance path after the lifecycle command.
  f.hub.transaction(() => advanceTasks(f.raw, f.projectId, { dispatcher: f.dispatcher }));
  await f.until(() => f.attempts(queued).some(a => a.state === "running"), "resumed team work");
  tickTeamBreakers(f.deps, f.clock());
  assert.equal(f.raw.prepare("SELECT state FROM team_breakers WHERE team_id=?").get(teamId).state, "closed");
  assert.equal((await f.read("inbox")).teamBreakers.length, 0);
  await f.notify(); assert.equal(f.rows().filter(n => n.entity_id === teamId).length, 1);
});
