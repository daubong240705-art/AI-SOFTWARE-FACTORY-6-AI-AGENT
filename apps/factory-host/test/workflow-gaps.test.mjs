// Closes mutation survivors of the W1a review: ordering operators on non-numeric parameters and fact conditions that name unknown stages.
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateWorkflowDefinition as validate } from "../dist/workflow/validate.js";
import { definition } from "./workflow-fixture.mjs";

for (const op of ["lt", "lte", "gt", "gte"]) test(`ordering operator ${op} on a boolean parameter is a type mismatch`, () => {
  const d = definition(); d.stages[0].skipIf = { param: "hasUI", op, value: true };
  assert.equal(validate(d).ok, false);
});
test("ordering operators are fine on number parameters", () => {
  const d = definition(); d.parameters.push({ name: "size", type: "number", default: 3 });
  d.stages[0].skipIf = { param: "size", op: "gte", value: 5 }; assert.equal(validate(d).ok, true);
});
for (const location of ["includeIf", "skipIf"]) test(`a fact condition naming an unknown stage is refused in ${location}`, () => {
  const d = definition(); d.stages[0][location] = { fact: "review.verdict", stage: "missing", op: "eq", value: "changes-requested" };
  const result = validate(d); assert.equal(result.ok, false); assert.match(result.errors.join("\n"), new RegExp(`stages.0.${location}: unknown stage`));
});
test("a fact condition naming a real stage is accepted", () => {
  const d = definition(); d.stages[0].skipIf = { fact: "review.verdict", stage: d.stages[1].key, op: "eq", value: "changes-requested" };
  assert.equal(validate(d).ok, true);
});
test("nested conditions are checked at every level", () => {
  const d = definition(); d.stages[0].includeIf = { all: [{ any: [{ not: { param: "missing", op: "eq", value: true } }] }] };
  assert.match(validate(d).errors.join("\n"), /unknown parameter/);
});
