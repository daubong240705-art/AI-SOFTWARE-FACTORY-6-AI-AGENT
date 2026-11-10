import assert from "node:assert/strict";
import { test } from "node:test";
import { policyFixture } from "./policy-fixture.mjs";
import { checkAndReserve } from "../dist/policy/budget.js";

const scopes = ["day", "project", "engagement", "task"];
function setup(t) {
  const f = policyFixture(t), taskId = f.task({ engagementId: f.primary.id });
  const refs = { day: "2026-11-08", project: f.projectId, engagement: f.primary.id, task: taskId };
  const check = (estimateTokens = 1, selected = taskId) => checkAndReserve(f.raw, {
    projectId: f.projectId, taskId: selected, now: f.clock(), config: f.config, estimateTokens,
  });
  return { ...f, taskId, refs, check };
}
for (const scope of scopes) for (const used of [79, 80, 99, 100, 101]) test(`${scope} used ${used} boundary`, t => {
  const f = setup(t); f.mustBudget(scope, f.refs[scope]); f.usage(used, f.taskId);
  const result = f.check();
  if (used >= 100) assert.deepEqual(result, { ok: false, scope, verdict: "exceeded", used, limit: 100 });
  else assert.deepEqual(result, { ok: true, warnings: used >= 80 ? [{ scope, verdict: "warn" }] : [] });
});
for (const scope of scopes) for (const estimate of [20, 21]) test(`${scope} reservation ${estimate} with 80 used`, t => {
  const f = setup(t); f.mustBudget(scope, f.refs[scope]); f.usage(80, f.taskId);
  assert.deepEqual(f.check(estimate), estimate === 20 ? { ok: true, warnings: [{ scope, verdict: "warn" }] }
    : { ok: false, scope, verdict: "would-exceed", used: 80, limit: 100 });
});
for (let index = 0; index < scopes.length; index++) test(`first breached scope is ${scopes[index]}`, t => {
  const f = setup(t); for (let i = 0; i < scopes.length; i++) f.mustBudget(scopes[i], f.refs[scopes[i]], i < index ? 1000 : 100);
  f.usage(100, f.taskId); assert.equal(f.check().scope, scopes[index]);
});
test("warnings contain every configured scope in order", t => {
  const f = setup(t); for (const scope of scopes) f.mustBudget(scope, f.refs[scope]); f.usage(80, f.taskId);
  assert.deepEqual(f.check(0), { ok: true, warnings: scopes.map(scope => ({ scope, verdict: "warn" })) });
});
test("all warnings use each budget's own threshold", t => {
  const f = setup(t); for (const scope of scopes) f.mustBudget(scope, f.refs[scope], 100, { warnAtPercent: scope === "engagement" ? 70 : 90 });
  f.usage(80, f.taskId); assert.deepEqual(f.check(), { ok: true, warnings: [{ scope: "engagement", verdict: "warn" }] });
});
test("unlimited parent budgets skip checks even above task default", t => {
  const f = setup(t); f.config.defaultDayTokens = 10_000_000; f.mustBudget("task", f.taskId, 2_000_000); f.usage(1_000_001, f.taskId);
  assert.deepEqual(f.check(10), { ok: true, warnings: [] });
});
test("chat checks project without engagement or task", t => {
  const f = setup(t); f.mustBudget("project", f.projectId); f.mustBudget("engagement", f.primary.id, 1); f.usage(80, f.taskId);
  assert.deepEqual(f.check(10, null), { ok: true, warnings: [{ scope: "project", verdict: "warn" }] });
});
test("unassigned task ignores other engagement budgets", t => {
  const f = setup(t), taskId = f.task(); f.mustBudget("engagement", f.primary.id, 1); f.usage(80, f.taskId);
  f.raw.prepare("UPDATE tasks SET engagement_id=NULL WHERE id=?").run(taskId);
  assert.deepEqual(f.check(1, taskId), { ok: true, warnings: [] });
});
test("reservation checks do not insert usage or mutate budgets", t => {
  const f = setup(t); f.mustBudget("project", f.projectId); const before = f.raw.prepare("SELECT * FROM budgets").all();
  f.check(10); f.check(10); assert.deepEqual(f.raw.prepare("SELECT * FROM budgets").all(), before);
  assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM usage_records").get().n, 0);
});
for (const estimate of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) test(`reject invalid estimate ${estimate}`, t => {
  const f = setup(t); assert.throws(() => f.check(estimate), /nonnegative safe integer/);
});
