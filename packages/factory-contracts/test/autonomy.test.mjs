import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { AUTONOMY_LEVELS, AUTONOMY_LABELS, AUTONOMY_ACTIONS, ALWAYS_OPERATOR, DEFAULT_AUTONOMY_LEVELS,
  allows, requiredLevel, commandSchema, FOUNDATION_COMMANDS, budgetSchema } from "../dist/index.js";

const thresholds = { "task-work": 1, "team-plan-change": 2, "request-clarify-consult": 2,
  "request-produce": 3, "plan-patch-auto": 3, "consulting-engagement": 3, "external-action": 4 };
test("autonomy levels and labels follow section 18", () => {
  assert.deepEqual(AUTONOMY_LEVELS, [0, 1, 2, 3, 4]);
  assert.deepEqual(Object.values(AUTONOMY_LABELS), ["L0 suggest", "L1 in-task", "L2 in-team",
    "L3 cross-team-in-budget", "L4 external-under-standing-approval"]);
  assert.deepEqual(DEFAULT_AUTONOMY_LEVELS, { project: 3, team: 2 });
  assert.deepEqual(Object.keys(AUTONOMY_ACTIONS).sort(), Object.keys(thresholds).sort());
});
for (const [action, minimum] of Object.entries(thresholds)) {
  test(`required level for ${action}`, () => assert.equal(requiredLevel(action), minimum));
  for (const level of AUTONOMY_LEVELS) test(`${action} at L${level}`, () => assert.equal(allows(level, action), level >= minimum));
}
test("operator actions form the required closed list", () => assert.deepEqual(ALWAYS_OPERATOR,
  ["scope-or-criteria-change", "open-gate", "raise-budget", "spend-money", "publish-externally", "irreversible-action", "global-knowledge"]));
for (const action of ALWAYS_OPERATOR) for (const level of AUTONOMY_LEVELS)
  test(`operator action ${action} stays forbidden at L${level}`, () => assert.equal(allows(level, action), false));
const projectId = randomUUID();
const cmd = (patch = {}) => ({ apiVersion: 1, commandId: randomUUID(), projectId, type: "autonomy.set",
  payload: { subject: "project", subjectRef: projectId, level: 3, expectedRevision: null, ...patch } });
for (const subject of ["project", "team"]) for (const level of AUTONOMY_LEVELS)
  test(`autonomy command ${subject} L${level}`, () => assert.equal(commandSchema.safeParse(cmd({ subject, level })).success, true));
for (const [field, value] of [["subject", "seat"], ["subjectRef", "bad"], ["level", -1], ["level", 5], ["level", 2.5],
  ["level", "3"], ["expectedRevision", 0], ["expectedRevision", 1.5], ["extra", true]])
  test(`autonomy rejects ${field} ${value}`, () => assert.equal(commandSchema.safeParse(cmd({ [field]: value })).success, false));
for (const field of ["subject", "subjectRef", "level", "expectedRevision"])
  test(`autonomy requires ${field}`, () => { const c = cmd(); delete c.payload[field]; assert.equal(commandSchema.safeParse(c).success, false); });
test("autonomy command supports positive expected revision", () => assert.equal(commandSchema.safeParse(cmd({ expectedRevision: 2 })).success, true));
test("autonomy command is registered exactly once", () => assert.equal(FOUNDATION_COMMANDS.filter(x => x === "autonomy.set").length, 1));
for (const scope of ["project", "engagement"]) for (const valid of [true, false])
  test(`${scope} budget reference ${valid ? "valid" : "invalid"}`, () => assert.equal(budgetSchema.safeParse({ id: randomUUID(), projectId,
    scope, scopeRef: valid ? projectId : "invalid", limitTokens: 100, warnAtPercent: 80 }).success, valid));
test("project budget must name its own project", () => assert.equal(budgetSchema.safeParse({ id: randomUUID(), projectId,
  scope: "project", scopeRef: randomUUID(), limitTokens: 100, warnAtPercent: 80 }).success, false));
