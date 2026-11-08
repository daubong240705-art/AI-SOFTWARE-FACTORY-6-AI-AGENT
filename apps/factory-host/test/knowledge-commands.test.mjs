import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { openStorage } from "../dist/storage/database.js";
import { EventHub } from "../dist/events/hub.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { knowledgeHandlers, withKnowledgeEffects } from "../dist/knowledge/commands.js";
import { createApprovalsDecideHandler, requestTaskReview, getApprovalView } from "../dist/approvals/service.js";
import { createDispatchHandlers, createDispatcher, createFakeRuntime, RuntimeRegistry } from "../dist/dispatch/index.js";
import { getTask } from "../dist/work/service.js";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
function fixture(t) {
  const storage = openStorage(":memory:"); storage.migrate({ migrationsDir, backupDir: null });
  const raw = storage.raw; const projectId = randomUUID(); const actorId = randomUUID();
  const clock = () => new Date("2026-11-08T00:00:00.000Z"); const hub = new EventHub(raw, { clock });
  raw.prepare("INSERT INTO projects VALUES (?,1,'Lifecycle','artifact','unused','active')").run(projectId); hub.ensureStream(projectId);
  const dispatcher = createDispatcher({ storage, hub, clock, registry: new RuntimeRegistry([createFakeRuntime({ stepMs: 0 })]) });
  const dispatchHandlers = createDispatchHandlers({ dispatcher });
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
    ...knowledgeHandlers, ...dispatchHandlers,
    "tasks.transition": withKnowledgeEffects(dispatchHandlers["tasks.transition"]),
    "approvals.decide": withKnowledgeEffects(createApprovalsDecideHandler({ dispatcher })),
  } });
  t.after(async () => { await dispatcher.stop(); storage.close(); });
  const command = (type, payload, extra = {}) => ({ apiVersion: 1, commandId: randomUUID(), projectId, type, payload, ...extra });
  const execute = (type, payload, extra) => pipeline.execute(command(type, payload, extra), actorId);
  let code = 0;
  const task = (state = "active", inputs = []) => {
    const id = randomUUID(); raw.prepare(`INSERT INTO tasks (project_id,id,revision,code,title,goal,brief,origin_kind,state,
      required_capabilities_json,acceptance_json,inputs_json) VALUES (?,?,1,?,'Task','Goal','Brief','operator',?,'[]','[]',?)`)
      .run(projectId, id, `KN-${String(++code).padStart(3,"0")}`, state, JSON.stringify(inputs)); return id;
  };
  const attempt = (taskId) => {
    const id = randomUUID(); raw.prepare(`INSERT INTO attempts (project_id,id,task_id,revision,epoch,state,outcome,runtime,provider,model,effort,ended_at)
      VALUES (?,?,?,1,1,'succeeded','known','fake','fake','fake','medium',?)`).run(projectId, id, taskId, clock().toISOString()); return id;
  };
  const add = (extra = {}) => {
    const row = { artifactId: randomUUID(), version: 1, status: "draft", producedBy: null, ...extra };
    raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,
      size_bytes,status,abstract_l0,visibility,created_at,produced_by_attempt_id) VALUES (?,?,?,'other','Document','text/plain',?,1,?,'Abstract','project',?,?)`)
      .run(projectId, row.artifactId, row.version, "a".repeat(64), row.status, clock().toISOString(), row.producedBy); return row;
  };
  const depend = (row, input) => raw.prepare("INSERT INTO artifact_inputs VALUES (?,?,?,?,?)")
    .run(projectId, row.artifactId, row.version, input.artifactId, input.version);
  const events = () => raw.prepare("SELECT body_json FROM event_log ORDER BY sequence").all().map((r) => JSON.parse(r.body_json));
  const snapshot = () => Object.fromEntries(["artifact_versions", "knowledge_stale", "tasks", "task_holds", "attempts", "approvals", "command_receipts", "event_log"]
    .map((table) => [table, raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const seeded = () => {
    const old = add({ status: "approved" }); const latest = add({ artifactId: old.artifactId, version: 2, status: "reviewed" });
    const dependant = add(); depend(dependant, old); const taskId = task("active", [{ artifactId: old.artifactId, version: 1 }]);
    return { old, latest, dependant, taskId };
  };
  const transitionPayload = (row) => ({ artifactId: row.artifactId, version: row.version, to: "approved", comment: "Accepted" });
  return { raw, storage, projectId, actorId, hub, clock, pipeline, command, execute, task, attempt, add, depend, events, snapshot, seeded, transitionPayload };
}
for (const type of ["artifacts.transition", "artifacts.share", "artifacts.clear-stale"]) {
  const payload = (f, row) => type === "artifacts.transition" ? f.transitionPayload(row)
    : type === "artifacts.share" ? { artifactId: row.artifactId, version: row.version, visibility: "shared" }
      : { artifactId: row.artifactId, version: row.version, becauseArtifactId: randomUUID(), becauseVersion: 1 };
  test(`${type} rejects an unknown project`, (t) => {
    const f = fixture(t); const row = f.add(); const response = f.execute(type, payload(f, row), { projectId: randomUUID() });
    assert.equal(response.status, 404); assert.equal(response.body.error.code, "not-found");
  });
  test(`${type} rejects an unknown artifact version`, (t) => {
    const f = fixture(t); const response = f.execute(type, payload(f, { artifactId: randomUUID(), version: 1 }));
    assert.equal(response.status, 404); assert.equal(response.body.error.code, "not-found");
  });
  test(`${type} validation rejects a zero version before mutation`, (t) => {
    const f = fixture(t); const row = f.add(); const before = f.snapshot(); const response = f.execute(type, payload(f, { ...row, version: 0 }));
    assert.equal(response.status, 400); assert.equal(response.body.error.code, "validation"); assert.deepEqual(f.snapshot(), before);
  });
}
test("approval effects and events cover the new version superseded version stale dependant and task", (t) => {
  const f = fixture(t); const { old, latest, dependant, taskId } = f.seeded();
  const response = f.execute("artifacts.transition", f.transitionPayload(latest)); assert.equal(response.status, 200);
  const expected = [old, latest, dependant].map((row) => ({ kind: "artifact-version", id: row.artifactId, revision: row.version }));
  expected.push({ kind: "task", id: taskId, revision: 2 });
  assert.deepEqual(new Set(response.body.receipt.effects.map(JSON.stringify)), new Set(expected.map(JSON.stringify)));
  assert.deepEqual(f.events().filter((event) => event.payload.type === "entity.changed").map((event) => event.payload.entity), response.body.receipt.effects);
  assert.equal(f.events().at(-1).payload.type, "command.receipted");
  assert.equal(f.raw.prepare("SELECT actor_id FROM command_receipts").get().actor_id, f.actorId);
});
test("approval replay returns the receipt without repeating stale analysis revisions or events", (t) => {
  const f = fixture(t); const { latest } = f.seeded(); const command = f.command("artifacts.transition", f.transitionPayload(latest));
  const first = f.pipeline.execute(command, f.actorId); assert.equal(first.status, 200); const before = f.snapshot();
  const second = f.pipeline.execute(command, f.actorId); assert.deepEqual(second.body, first.body); assert.equal(second.replayed, true);
  assert.deepEqual(f.snapshot(), before);
});
for (const type of ["artifacts.share", "artifacts.clear-stale"]) test(`${type} replay is exactly once`, (t) => {
  const f = fixture(t); const { latest, dependant } = f.seeded(); f.execute("artifacts.transition", f.transitionPayload(latest));
  const payload = type === "artifacts.share" ? { artifactId: latest.artifactId, version: 2, visibility: "shared" }
    : { artifactId: dependant.artifactId, version: 1, becauseArtifactId: latest.artifactId, becauseVersion: 2 };
  const command = f.command(type, payload); const first = f.pipeline.execute(command); assert.equal(first.status, 200);
  const before = f.snapshot(); const second = f.pipeline.execute(command); assert.equal(second.replayed, true); assert.deepEqual(second.body, first.body);
  assert.deepEqual(f.snapshot(), before);
});
test("a different command cannot clear an already acknowledged mark", (t) => {
  const f = fixture(t); const { latest, dependant } = f.seeded(); f.execute("artifacts.transition", f.transitionPayload(latest));
  const payload = { artifactId: dependant.artifactId, version: 1, becauseArtifactId: latest.artifactId, becauseVersion: 2 };
  assert.equal(f.execute("artifacts.clear-stale", payload).status, 200); assert.equal(f.execute("artifacts.clear-stale", payload).status, 404);
});
test("an event failure rolls back approval supersession stale rows and holds together", (t) => {
  const f = fixture(t); const { latest } = f.seeded(); const before = f.snapshot();
  f.raw.exec("CREATE TRIGGER reject_events BEFORE INSERT ON event_log BEGIN SELECT RAISE(ABORT,'event failure'); END");
  assert.throws(() => f.execute("artifacts.transition", f.transitionPayload(latest)), /event failure/); assert.deepEqual(f.snapshot(), before);
});
test("large stale impact sets publish every entity within the receipt effect budget", (t) => {
  const f = fixture(t); const { latest, old } = f.seeded();
  for (let i = 0; i < 101; i++) f.depend(f.add(), old);
  const command = f.command("artifacts.transition", f.transitionPayload(latest));
  const response = f.pipeline.execute(command); assert.equal(response.status, 200);
  assert.equal(response.body.receipt.effects.length, 100);
  const changes = f.events().filter((e) => e.payload.type === "entity.changed").map((e) => e.payload.entity);
  assert.equal(changes.length, 105); assert.equal(new Set(changes.map(JSON.stringify)).size, 105);
  const before = f.snapshot(); assert.equal(f.pipeline.execute(command).replayed, true); assert.deepEqual(f.snapshot(), before);
});
test("review acceptance supersedes an approved version and emits stale dependants in the same command", (t) => {
  const f = fixture(t); const taskId = f.task("in-review"); const attemptId = f.attempt(taskId);
  const old = f.add({ status: "approved" }); const latest = f.add({ artifactId: old.artifactId, version: 2, status: "in-review", producedBy: attemptId });
  const dependant = f.add(); f.depend(dependant, old); const dependentTask = f.task("active", [{ artifactId: old.artifactId, version: 1 }]);
  const approvalId = f.hub.transaction(() => requestTaskReview({ raw: f.raw, hub: f.hub, now: f.clock, newId: randomUUID },
    { projectId: f.projectId, taskId, attemptId }));
  const approval = getApprovalView(f.raw, f.projectId, approvalId);
  const command = f.command("approvals.decide", { approvalId, expectedRevision: approval.revision, contextDigest: approval.context.digest, optionId: "accept", comment: "Accepted" });
  const response = f.pipeline.execute(command); assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(f.raw.prepare("SELECT status FROM artifact_versions WHERE artifact_id=? AND version=1").get(old.artifactId).status, "superseded");
  assert.equal(f.raw.prepare("SELECT status FROM artifact_versions WHERE artifact_id=? AND version=2").get(old.artifactId).status, "approved");
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM knowledge_stale").get().n, 1);
  for (const expected of [{ kind: "artifact-version", id: old.artifactId, revision: 1 },
    { kind: "artifact-version", id: latest.artifactId, revision: 2 }, { kind: "artifact-version", id: dependant.artifactId, revision: 1 },
    { kind: "task", id: dependentTask, revision: 2 }]) assert.ok(response.body.receipt.effects.some((e) => JSON.stringify(e) === JSON.stringify(expected)));
  const before = f.snapshot(); assert.equal(f.pipeline.execute(command).replayed, true); assert.deepEqual(f.snapshot(), before);
});
for (const completion of ["tasks.transition", "approvals.decide"]) test(`${completion} can complete a task with a stale input hold`, (t) => {
  const f = fixture(t); const taskId = f.task("in-review"); const attemptId = f.attempt(taskId);
  f.raw.prepare("INSERT INTO task_holds VALUES (?,?,'input','Superseded input',NULL,NULL,?,1)").run(f.projectId, taskId, f.clock().toISOString());
  let response;
  if (completion === "tasks.transition") response = f.execute(completion, { taskId, expectedRevision: 1, to: "done" });
  else {
    const approvalId = f.hub.transaction(() => requestTaskReview({ raw: f.raw, hub: f.hub, now: f.clock, newId: randomUUID }, { projectId: f.projectId, taskId, attemptId }));
    const approval = getApprovalView(f.raw, f.projectId, approvalId);
    response = f.execute(completion, { approvalId, expectedRevision: 1, contextDigest: approval.context.digest, optionId: "accept", comment: "Accepted" });
  }
  assert.equal(response.status, 200, JSON.stringify(response.body)); assert.equal(getTask(f.raw, f.projectId, taskId).state, "done");
  assert.deepEqual(getTask(f.raw, f.projectId, taskId).holds, []);
});
test("failed completion retains the advisory input hold", (t) => {
  const f = fixture(t); const taskId = f.task("in-review");
  f.raw.prepare("INSERT INTO task_holds VALUES (?,?,'input','Superseded input',NULL,NULL,?,1)").run(f.projectId, taskId, f.clock().toISOString());
  const response = f.execute("tasks.transition", { taskId, expectedRevision: 99, to: "done" });
  assert.equal(response.status, 409); assert.equal(getTask(f.raw, f.projectId, taskId).holds.length, 1);
});

// --- added by the lead after mutation testing (K1b) ---------------------------------------------------------------
function reviewWithInputHold(f) {
  const taskId = f.task("in-review"); const attemptId = f.attempt(taskId);
  // A seat is needed so that "request changes" can start the next attempt exactly like in production.
  const teamId = randomUUID(); const seatId = randomUUID(); const engagementId = randomUUID();
  f.raw.prepare("INSERT INTO teams (id,revision,name,charter,pack_key,pack_version,lifecycle) VALUES (?,1,'T','c',NULL,NULL,'active')").run(teamId);
  f.raw.prepare(`INSERT INTO seats (id,team_id,revision,name,role,profile_id,profile_revision,runtime,slots,node_policy,dedicated_node_id,is_lead)
    VALUES (?,?,1,'BE','dev',?,1,'fake',1,'elastic',NULL,0)`).run(seatId, teamId, randomUUID());
  f.raw.prepare("INSERT INTO engagements (project_id,id,team_id,revision,priority,max_concurrent,state,created_at) VALUES (?,?,?,1,50,2,'active',?)").run(f.projectId, engagementId, teamId, f.clock().toISOString());
  f.raw.prepare("UPDATE tasks SET engagement_id = ?, owner_seat_id = ? WHERE project_id = ? AND id = ?").run(engagementId, seatId, f.projectId, taskId);
  f.raw.prepare("INSERT INTO attempt_seats VALUES (?,?,?)").run(f.projectId, attemptId, seatId);
  f.raw.prepare(`INSERT INTO task_holds (project_id,task_id,kind,reason,ref_kind,ref_id,since,needs_action)
    VALUES (?,?,'input','Input X v1 was superseded by v2','artifact-version',?,?,1)`).run(f.projectId, taskId, randomUUID(), f.clock().toISOString());
  const approvalId = f.hub.transaction(() => requestTaskReview({ raw: f.raw, hub: f.hub, now: f.clock, newId: randomUUID },
    { projectId: f.projectId, taskId, attemptId }));
  const approval = getApprovalView(f.raw, f.projectId, approvalId);
  const decide = (optionId, comment) => f.pipeline.execute(f.command("approvals.decide", { approvalId, expectedRevision: approval.revision,
    contextDigest: approval.context.digest, optionId, comment }));
  const holds = () => f.raw.prepare("SELECT COUNT(*) AS n FROM task_holds WHERE project_id = ? AND task_id = ? AND kind = 'input'").get(f.projectId, taskId).n;
  return { taskId, decide, holds };
}
test("accepting a review retires the advisory stale-input hold, so the done task carries no holds", (t) => {
  const f = fixture(t); const r = reviewWithInputHold(f); assert.equal(r.holds(), 1);
  assert.equal(r.decide("accept", "Fine").status, 200); assert.equal(r.holds(), 0);
});
test("requesting changes keeps the stale-input hold: the input problem is not resolved", (t) => {
  const f = fixture(t); const r = reviewWithInputHold(f);
  assert.equal(r.decide("request-changes", "Redo with the new input").status, 200); assert.equal(r.holds(), 1);
});
