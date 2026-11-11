import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ensureTeamFromPack, listSeats, loadPack } from "../dist/org/index.js";
import { pickSeat, advanceTasks, LOCAL_NODE_ID } from "../dist/dispatch/index.js";
import { getSeatCapabilities, getSeatTools } from "../dist/instructions/snapshot.js";
import { fixture, temp, writePack, pumped } from "./org-fixture.mjs";

function setup(t, change = () => {}) {
  const f = fixture(t);
  const dir = writePack(temp(t), "capability-team", (m) => {
    m.seats[1].name = "Alpha"; m.seats[1].capabilities = ["research.evidence.sources", "review.facts"];
    m.seats.push({ ...m.seats[1], name: "Zulu", capabilities: ["research.evidence", "review.facts"] }); change(m);
  });
  const team = ensureTeamFromPack(f.raw, loadPack(dir), { newId: randomUUID, clock: f.clock });
  const engagementId = f.engage(team.teamId); const seats = listSeats(f.raw, team.teamId);
  const task = (requiredCapabilities = [], extra = {}) => ({ ...f.getTask(f.task({ engagementId, requiredCapabilities: requiredCapabilities.map((c) => c.toLowerCase()), state: "awaiting-go", ...extra })), requiredCapabilities });
  return { ...f, dir, seats, engagementId, task,
    enqueue: (id, scope, seatId) => { f.raw.prepare("UPDATE tasks SET state = 'active' WHERE project_id = ? AND id = ?").run(scope, id); return f.enqueue(id, scope, seatId); },
    select: (required = []) => pickSeat(f.raw, f.projectId, task(required)) };
}
for (const [index, required] of [["research.evidence.sources"], ["research.evidence"], ["review.facts", "research.evidence.sources"], ["RESEARCH.EVIDENCE"], ["review.facts"], ["research.evidence", "review.facts"], ["review.facts", "research.evidence"], []].entries())
  test(`capability matching case ${index}`, (t) => { const f = setup(t); const result = f.select(required); assert.equal(result.seatId, f.seats.find((s) => s.name === "Alpha").id); assert.equal(result.reason, required.length ? "capability match" : "least loaded"); });
for (const [index, required] of [["missing.skill"], ["research.evidence.sources.deep"], ["evidence.sources"], ["research.evid"], ["research.evidence", "missing.skill"], ["review.facts", "design.ui"]].entries())
  test(`unsatisfied capabilities fail closed case ${index}`, (t) => { const f = setup(t); assert.throws(() => f.select(required), (e) => e.code === "no-seat-for-capabilities"); });
test("requirements must all match on the same seat", (t) => { const f = setup(t, (m) => { m.seats[1].capabilities = ["research.evidence"]; m.seats[2].capabilities = ["review.facts"]; }); assert.throws(() => f.select(["research.evidence", "review.facts"]), (e) => e.code === "no-seat-for-capabilities"); });
for (const state of ["queued", "leased", "preparing", "running", "waiting-input", "parked"]) test(`least loaded counts ${state}`, (t) => {
  const f = setup(t); const a = f.enqueue(f.task().id, f.projectId, f.seats.find((s) => s.name === "Alpha").id);
  setAttemptState(f, a, state);
  assert.equal(f.select(["research.evidence"]).seatId, f.seats.find((s) => s.name === "Zulu").id);
});
for (const state of ["succeeded", "failed", "stopped", "unknown", "reconciling", "submitting", "stopping"]) test(`least loaded excludes ${state}`, (t) => {
  const f = setup(t); const alpha = f.seats.find((s) => s.name === "Alpha"); const a = f.enqueue(f.task().id, f.projectId, alpha.id);
  setAttemptState(f, a, state); assert.equal(f.select().seatId, alpha.id);
});
test("least loaded includes workers with no capability declaration when none required", (t) => {
  const f = setup(t, (m) => { delete m.seats[2].capabilities; });
  f.enqueue(f.task().id, f.projectId, f.seats.find((s) => s.name === "Alpha").id);
  assert.equal(f.select().seatId, f.seats.find((s) => s.name === "Zulu").id);
});
test("load from another project is ignored", (t) => {
  const f = setup(t); const other = f.project(); const e = f.engage(f.seats[0].teamId, other);
  const id = fixtureTask(f, other, e); f.enqueue(id, other, f.seats.find((s) => s.name === "Alpha").id);
  assert.equal(f.select().seatId, f.seats.find((s) => s.name === "Alpha").id);
});
function fixtureTask(f, scope, engagementId) {
  const id = randomUUID(); f.ok("tasks.create", { taskId: id, code: "CAP-999", title: "Other", goal: "[fake:hang]", brief: "Brief", parentTaskId: null,
    engagementId, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [], placement: "portable", sideEffect: "none", requiresGo: true }, scope);
  return id;
}
function setAttemptState(f, a, state) {
  const placed = ["leased", "preparing", "running", "waiting-input", "submitting", "stopping"].includes(state);
  f.raw.prepare("UPDATE attempts SET state = ?, node_id = ?, lease_id = ?, lease_expires_at = ?, ended_at = ?, outcome = ? WHERE id = ?")
    .run(state, placed ? LOCAL_NODE_ID : null, placed ? randomUUID() : null, placed ? "2027-01-01T00:00:00.000Z" : null,
      ["succeeded", "failed", "stopped"].includes(state) ? f.clock().toISOString() : null, state === "unknown" ? "unknown" : "known", a.id);
}
test("explicit owner bypasses capability requirements", (t) => { const f = setup(t); const lead = f.seats.find((s) => s.isLead); const task = f.task(["missing.skill"], { seatId: lead.id }); assert.deepEqual(pickSeat(f.raw, f.projectId, task), { seatId: lead.id, reason: "explicit owner" }); });
test("Lead-only team keeps its fallback", (t) => { const f = setup(t, (m) => { m.seats = [m.seats[0]]; m.seats[0].capabilities = ["lead.coordinate"]; }); assert.equal(f.select(["missing.skill"]).reason, "lead only team"); });
test("empty capability declaration enables fail closed selection", (t) => { const f = setup(t, (m) => { m.seats[1].capabilities = []; delete m.seats[2].capabilities; }); assert.throws(() => f.select(["research.evidence"]), (e) => e.code === "no-seat-for-capabilities"); });
for (const snapshot of [true, false]) for (const [requiredCapabilities, title, expected] of [[[], "Build", "BE"], [["test.unit"], "Build", "Test"], [["ui.web"], "Build", "FE"], [[], "docker deploy", "DevOps"], [[], "readme document", "BA"], [["plan.scope"], "Build", "PM"]])
  test(`legacy ${expected} rules with snapshot ${snapshot}`, (t) => {
    const f = fixture(t); if (!snapshot) f.raw.prepare("UPDATE teams SET pack_digest = NULL WHERE id = ?").run(f.teamId);
    const task = f.getTask(f.task({ requiredCapabilities, title })); const result = pickSeat(f.raw, f.projectId, task);
    assert.equal(f.seats.find((s) => s.id === result.seatId).name, expected);
  });
test("disk edits cannot alter pinned capabilities", (t) => {
  const f = setup(t); const before = f.select(["research.evidence"]).seatId; const m = JSON.parse(readFileSync(join(f.dir, "pack.json"), "utf8"));
  for (const seat of m.seats) seat.capabilities = ["changed.skill"]; writeFileSync(join(f.dir, "pack.json"), JSON.stringify(m));
  assert.equal(f.select(["research.evidence"]).seatId, before); assert.throws(() => f.select(["changed.skill"]), (e) => e.code === "no-seat-for-capabilities");
});
test("snapshot fields resolve by name and unknown seats return null", (t) => {
  const f = setup(t); const alpha = f.seats.find((s) => s.name === "Alpha"); assert.deepEqual(getSeatCapabilities(f.raw, { seatId: alpha.id }), ["research.evidence.sources", "review.facts"]);
  f.raw.prepare("UPDATE seats SET name = 'Renamed' WHERE id = ?").run(alpha.id);
  assert.equal(getSeatCapabilities(f.raw, { seatId: alpha.id }), null); assert.equal(getSeatTools(f.raw, { seatId: randomUUID() }), null);
});
test("release maps unsatisfied capabilities like no-seat without mutation", (t) => {
  const f = setup(t); const task = f.task(["missing.skill"]);
  const result = f.execute("tasks.release", { taskId: task.id, expectedRevision: task.revision });
  assert.equal(result.status, 400); assert.equal(result.body.error.code, "validation"); assert.equal(result.body.error.message, "no-seat-for-capabilities");
  assert.deepEqual(f.getTask(task.id), task); assert.equal(f.raw.prepare("SELECT count(*) AS n FROM attempts").get().n, 0);
});
test("automatic advance maps unsatisfied capabilities and rolls back", (t) => {
  const f = setup(t); const task = f.task(["missing.skill"], { state: "accepted", requiresGo: false });
  assert.throws(() => f.hub.transaction(() => advanceTasks(f.raw, f.projectId, { dispatcher: f.dispatcher })), (e) => e.code === "validation" && e.message === "no-seat-for-capabilities");
  assert.equal(f.getTask(task.id).state, "accepted");
});
test("release balances real fake-runtime attempts across matching workers", async (t) => {
  const f = setup(t); const tasks = [f.task(["research.evidence"]), f.task(["research.evidence"])];
  for (const task of tasks) f.ok("tasks.release", { taskId: task.id, expectedRevision: task.revision });
  assert.deepEqual(tasks.map((task) => f.seats.find((seat) => seat.id === f.getTask(task.id).ownerSeatId).name), ["Alpha", "Zulu"]);
  await pumped(); assert.equal(f.runtime.started.length, 2);
});
test("equal loads break ties by manifest order", (t) => {
  const f = setup(t); const alpha = f.seats.find((seat) => seat.name === "Alpha"); const zulu = f.seats.find((seat) => seat.name === "Zulu");
  const low = "00000000-0000-4000-8000-000000000001"; const high = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  f.raw.prepare("UPDATE seats SET id = ? WHERE id = ?").run(high, alpha.id); f.raw.prepare("UPDATE seats SET id = ? WHERE id = ?").run(low, zulu.id);
  assert.equal(f.select().seatId, high);
});
