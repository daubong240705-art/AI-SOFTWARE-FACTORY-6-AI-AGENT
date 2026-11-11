import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { policyFixture } from "./policy-fixture.mjs";
import { usedTokens, effectiveBudget, budgetStatus, DEFAULT_BUDGET_CONFIG } from "../dist/policy/budget.js";

test("AP-8 token defaults", () => assert.deepEqual(DEFAULT_BUDGET_CONFIG,
  { defaultDayTokens: 1_000_000, defaultTaskTokens: 200_000, warnAtPercent: 80, utcOffsetMinutes: 420 }));
for (const scope of ["project", "engagement"]) test(`${scope} has no implicit budget`, t => {
  const f = policyFixture(t); assert.equal(effectiveBudget(f.raw, f.projectId, scope, scope === "project" ? f.projectId : f.primary.id, f.config), null);
});
for (const [scope, limit] of [["day", 1_000_000], ["task", 200_000]]) test(`${scope} keeps default semantics`, t => {
  const f = policyFixture(t); assert.deepEqual(effectiveBudget(f.raw, f.projectId, scope, randomUUID(), f.config),
    { limitTokens: limit, warnAtPercent: 80, source: "default" });
});
for (const scope of ["project", "engagement"]) test(`${scope} explicit budget and source`, t => {
  const f = policyFixture(t), ref = scope === "project" ? f.projectId : f.primary.id;
  f.mustBudget(scope, ref, 123); assert.deepEqual(effectiveBudget(f.raw, f.projectId, scope, ref, f.config),
    { limitTokens: 123, warnAtPercent: 80, source: "explicit" });
});
test("project counts chat, assigned and unassigned tasks across dates", t => {
  const f = policyFixture(t), a = f.task({ engagementId: f.primary.id }), b = f.task();
  f.usage(11); f.usage(23, a, { recordedAt: "2025-01-01T00:00:00.000Z" }); f.usage(37, b);
  assert.equal(usedTokens(f.raw, f.projectId, "project", f.projectId, f.config), 71);
  assert.equal(usedTokens(f.raw, f.projectId, "day", "2026-11-08", f.config), 48);
});
test("engagement counts only usage on its tasks across dates", t => {
  const f = policyFixture(t), a = f.task({ engagementId: f.primary.id }), b = f.task(), other = f.engage(f.secondTeam());
  const c = f.task({ engagementId: other });
  f.raw.prepare("UPDATE tasks SET engagement_id=NULL WHERE id=?").run(b);
  f.usage(100); f.usage(11, a); f.usage(13, a, { recordedAt: "2020-01-01T00:00:00.000Z" }); f.usage(200, b); f.usage(300, c);
  assert.equal(usedTokens(f.raw, f.projectId, "engagement", f.primary.id, f.config), 24);
  assert.equal(usedTokens(f.raw, f.projectId, "engagement", other, f.config), 300);
});
for (const scope of ["project", "engagement"]) test(`${scope} isolates another project`, t => {
  const f = policyFixture(t), a = f.task({ engagementId: f.primary.id }); f.usage(70, a);
  assert.equal(usedTokens(f.raw, f.project(), scope, scope === "project" ? f.projectId : f.primary.id, f.config), 0);
});
test("reported tokens win over estimate and include cached input only once", t => {
  const f = policyFixture(t), a = f.task({ engagementId: f.primary.id });
  f.usage(999, a, { usage: { inputTokens: 20, cachedInputTokens: 10, outputTokens: 7, reasoningOutputTokens: 5 } });
  for (const [scope, ref] of [["project", f.projectId], ["engagement", f.primary.id], ["task", a]])
    assert.equal(usedTokens(f.raw, f.projectId, scope, ref, f.config), 27);
  const row = f.raw.prepare("SELECT cost_kind,cost_amount,cost_currency FROM usage_records").get();
  assert.deepEqual(row, { cost_kind: "unknown", cost_amount: null, cost_currency: null });
});
test("status exposes unlimited project and only explicit engagements", t => {
  const f = policyFixture(t), a = f.task({ engagementId: f.primary.id }); f.usage(80, a);
  let status = budgetStatus(f.raw, f.projectId, f.clock(), f.config);
  assert.deepEqual(status.project, { used: 80, limit: null, verdict: "ok", source: "default" }); assert.deepEqual(status.engagements, []);
  f.mustBudget("project", f.projectId); f.mustBudget("engagement", f.primary.id);
  status = budgetStatus(f.raw, f.projectId, f.clock(), f.config);
  assert.deepEqual(status.project, { used: 80, limit: 100, verdict: "warn", source: "explicit" });
  assert.deepEqual(status.engagements, [{ engagementId: f.primary.id, used: 80, limit: 100, verdict: "warn" }]);
  assert.equal(status.tasks[0].used, 80);
});
test("status includes explicit unused engagement", t => {
  const f = policyFixture(t); f.mustBudget("engagement", f.primary.id);
  assert.deepEqual(budgetStatus(f.raw, f.projectId, f.clock(), f.config).engagements,
    [{ engagementId: f.primary.id, used: 0, limit: 100, verdict: "ok" }]);
});
test("project scope refuses another project reference", t => {
  const f = policyFixture(t); assert.equal(f.budget("project", f.project()).status, 400);
});
for (const unknown of [true, false]) test(`engagement scope rejects ${unknown ? "unknown" : "foreign"} engagement`, t => {
  const f = policyFixture(t), ref = unknown ? randomUUID() : f.engage(f.secondTeam(), f.project());
  assert.equal(f.budget("engagement", ref).status, 404);
});
test("budgets require an existing project", t => {
  const f = policyFixture(t), projectId = randomUUID();
  assert.equal(f.execute("budgets.set", { budgetId: randomUUID(), expectedRevision: null, scope: "project", scopeRef: projectId,
    limitTokens: 100, warnAtPercent: 80 }, projectId).status, 404);
});
for (const scope of ["project", "engagement"]) test(`${scope} budget revision protects updates`, t => {
  const f = policyFixture(t), ref = scope === "project" ? f.projectId : f.primary.id, budgetId = randomUUID();
  f.mustBudget(scope, ref, 100, { budgetId });
  assert.equal(f.budget(scope, ref, 200, { budgetId, expectedRevision: null }).status, 409);
  assert.equal(f.budget(scope, ref, 200, { budgetId, expectedRevision: 1 }).status, 200);
  assert.equal(f.raw.prepare("SELECT revision FROM budgets").get().revision, 2);
});
