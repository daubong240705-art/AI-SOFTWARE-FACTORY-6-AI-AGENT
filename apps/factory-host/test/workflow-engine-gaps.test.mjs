// Closes mutation survivors of the W1b review: unknown skipIf facts, gate tasks waiting for Go, awaiting-approval round trip,
// the sweep waking waiting instances and lead-only teams.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { engineFixture, stage, flow } from "./workflow-engine-fixture.mjs";
import { ensureTeamFromPack } from "../dist/org/service.js";
import { loadPack } from "../dist/org/pack.js";
import { fixture, temp, writePack } from "./org-fixture.mjs";
import { selectWorkflowEngagement } from "../dist/workflow/teams.js";
import { moveTask } from "../dist/dispatch/tasks.js";

test("a skipIf that depends on an unavailable fact never skips the stage", (t) => {
  const f = engineFixture(t, flow([stage("author", { skipIf: { fact: "label", name: "skip-me", op: "eq", value: "yes" } })], []));
  f.start();
  assert.notEqual(f.view().stages[0].state, "skipped"); assert.equal(f.tasks("author").length, 1);
});
for (const kind of ["execution-gate", "irreversible-action"]) test(`a ${kind} gate leaves the generated task waiting for Go`, (t) => {
  const f = engineFixture(t, flow([stage("author")], [], { gates: [{ before: "author", kind, approver: "operator" }] }));
  f.start(); assert.equal(f.tasks("author")[0].state, "awaiting-go");
});
test("a review gate does not hold the task for Go", (t) => {
  const f = engineFixture(t, flow([stage("author")], [], { gates: [{ before: "author", kind: "review", approver: "operator" }] }));
  f.start(); assert.notEqual(f.tasks("author")[0].state, "awaiting-go");
});
test("an instance whose only work waits for Go is awaiting approval and returns to active when the Go is given", (t) => {
  const f = engineFixture(t, flow([stage("author")], [], { gates: [{ before: "author", kind: "execution-gate", approver: "operator" }] }));
  f.start(); assert.equal(f.view().state, "awaiting-approval");
  f.hub.transaction(() => moveTask(f.raw, f.projectId, f.tasks("author")[0].id, "active"));
  f.run(); assert.equal(f.view().state, "active");
});
test("the sweep wakes an instance that is awaiting approval after the Go arrived without a trigger", (t) => {
  const f = engineFixture(t, flow([stage("author")], [], { gates: [{ before: "author", kind: "execution-gate", approver: "operator" }] }));
  f.start(); assert.equal(f.view().state, "awaiting-approval");
  f.raw.prepare("UPDATE tasks SET state = 'active' WHERE id = ?").run(f.tasks("author")[0].id);
  f.sweep(); assert.equal(f.view().state, "active");
});
test("a team that has only a Lead seat is never selected for a stage", (t) => {
  const f = fixture(t);
  const dir = writePack(temp(t), "lead-only-team", (manifest) => { manifest.seats = [manifest.seats[0]]; });
  const team = ensureTeamFromPack(f.raw, loadPack(dir), { newId: randomUUID, clock: f.clock });
  f.raw.prepare("UPDATE engagements SET state = 'ended' WHERE project_id = ?").run(f.projectId);
  const engagement = f.engage(team.teamId);
  assert.equal(selectWorkflowEngagement(f.raw, f.projectId, { ...stage("author"), placement: "portable" }, null), undefined);
  assert.ok(engagement);
});
