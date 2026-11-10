import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture as requestFixture, refused } from "./requests-fixture.mjs";
import { engineFixture, flow, stage } from "./workflow-engine-fixture.mjs";
import { proposePatch, decidePatch } from "../dist/workflow/patch.js";

function setLevel(f, level) {
  f.raw.prepare("INSERT INTO autonomy_settings VALUES (?,'project',?,1,?,?)").run(f.projectId, f.projectId, level, f.clock().toISOString());
}
const extra = { op: "addTaskWithinStage", stage: "author", title: "Additional evidence" };
function patchFixture(t, policy = "auto") {
  return engineFixture(t, flow([stage("author", { limits: { maxTasks: 5, budgetShare: 1 } })], [], { allowedPatches: { addTaskWithinStage: policy } }));
}
const propose = (f, proposedBy = "lead") => proposePatch(f.deps, {
  projectId: f.projectId, instanceId: f.id, ops: [extra], proposedBy, reason: "Additional evidence needed",
});
for (const level of [0, 1, 2, 3, 4]) test(`automatic Lead patch at L${level}`, t => {
  const f = patchFixture(t); setLevel(f, level); const before = f.view().revision, patch = propose(f);
  assert.equal(patch.policy, level < 3 ? "approval" : "auto"); assert.equal(patch.state, level < 3 ? "pending" : "applied");
  assert.equal(f.view().revision, before + Number(level >= 3)); assert.equal(f.view().stages[0].extraTasks, Number(level >= 3));
});
for (const policy of ["approval", "operator"]) for (const level of [0, 2, 3, 4]) test(`${policy} Lead patch unchanged at L${level}`, t => {
  const f = patchFixture(t, policy); setLevel(f, level); const patch = propose(f);
  assert.equal(patch.policy, policy); assert.equal(patch.state, "pending");
});
test("default project autonomy preserves automatic patch behavior", t => {
  const f = patchFixture(t); assert.equal(propose(f).state, "applied");
});
test("operator can apply an automatic patch at low autonomy", t => {
  const f = patchFixture(t); setLevel(f, 0); const patch = propose(f, "operator");
  assert.equal(patch.policy, "approval"); assert.equal(patch.state, "applied");
});
test("operator approval applies a downgraded Lead patch", t => {
  const f = patchFixture(t); setLevel(f, 2); const patch = propose(f);
  assert.equal(decidePatch(f.deps, { projectId: f.projectId, patchId: patch.id, decision: "approve" }).state, "applied");
  assert.equal(f.view().stages[0].extraTasks, 1);
});
for (const kind of ["produce", "clarify", "consult"]) for (const level of [0, 1, 2, 3, 4])
  test(`${kind} request at L${level}`, t => {
    const f = requestFixture(t); setLevel(f, level); const minimum = kind === "produce" ? 3 : 2;
    if (level < minimum) refused(f, () => f.create({ kind }), `autonomy level too low for ${kind === "produce" ? "produce" : "clarify/consult"} requests`);
    else assert.ok(f.create({ kind }).requestId);
  });
for (const kind of ["produce", "clarify", "consult"]) test(`default project permits ${kind}`, t => {
  const f = requestFixture(t); assert.ok(f.create({ kind }).requestId);
});
for (const kind of ["review", "decision", "notify"]) test(`${kind} request retains behavior at L0`, t => {
  const f = requestFixture(t); setLevel(f, 0); assert.ok(f.create({ kind }).requestId);
});
test("a low team setting does not add a third enforcement point", t => {
  const f = requestFixture(t);
  f.raw.prepare("INSERT INTO autonomy_settings VALUES (?,'team',?,1,0,?)").run(f.projectId, f.teamId, f.clock().toISOString());
  assert.ok(f.create({ kind: "produce" }).requestId);
});
