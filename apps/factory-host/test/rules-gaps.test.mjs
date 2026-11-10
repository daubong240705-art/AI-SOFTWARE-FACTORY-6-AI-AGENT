import assert from "node:assert/strict";
import { test } from "node:test";
import { rulesFixture } from "./rules-fixture.mjs";
import { matchesRule, ruleFireId } from "../dist/automation/rules.js";


test("paused rules are never evaluated while another rule is active", t => {
  const f = rulesFixture(t), paused = f.create({ name: "Paused" }), active = f.create({ name: "Active" });
  assert.equal(f.change("pause", paused).status, 200);
  f.emit();
  f.tick();
  assert.equal(f.fires(paused).length, 0);
  assert.equal(f.fires(active).length, 1);
});

test("ne on a missing field does not match, in any nesting", () => {
  const ne = { field: "taskCode", op: "ne", value: "X" };
  assert.equal(matchesRule(ne, { to: "done" }), false);
  assert.equal(matchesRule(ne, { taskCode: "Y" }), true);
  assert.equal(matchesRule({ field: "taskCode", op: "in", value: ["X"] }, {}), false);
});

test("create and start receipts use distinct deterministic ids", () => {
  const create = ruleFireId("p", "r", 7), start = ruleFireId("p", "r", 7, "start");
  assert.notEqual(create, start);
  assert.equal(create, ruleFireId("p", "r", 7, "create"));
  assert.equal(start, ruleFireId("p", "r", 7, "start"));
  assert.notEqual(create, ruleFireId("p", "r", 8));
});

test("reprocessing the same event keeps a single instance", t => {
  const f = rulesFixture(t), id = f.create();
  f.emit();
  f.tick();
  const before = f.raw.prepare("SELECT COUNT(*) AS n FROM workflow_instances WHERE project_id=?").get(f.projectId).n;
  f.raw.prepare("UPDATE automation_cursors SET last_sequence=0 WHERE project_id=?").run(f.projectId);
  f.tick();
  const after = f.raw.prepare("SELECT COUNT(*) AS n FROM workflow_instances WHERE project_id=?").get(f.projectId).n;
  assert.equal(after, before);
  assert.equal(f.fires(id).filter(x => x.status === "started").length, 1);
});
