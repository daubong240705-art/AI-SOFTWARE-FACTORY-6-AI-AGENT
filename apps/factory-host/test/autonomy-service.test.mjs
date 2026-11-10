import assert from "node:assert/strict";
import { test } from "node:test";
import { policyFixture } from "./policy-fixture.mjs";
import { autonomyLevel, autonomyStatus, effectiveTeamLevel } from "../dist/policy/autonomy.js";

test("project defaults to L3 without creating a setting", t => {
  const f = policyFixture(t); assert.deepEqual(autonomyLevel(f.raw, f.projectId, "project", f.projectId), { level: 3, source: "default" });
  assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM autonomy_settings").get().n, 0);
});
test("team defaults to L2 and effective L2", t => {
  const f = policyFixture(t); assert.deepEqual(autonomyLevel(f.raw, f.projectId, "team", f.teamId), { level: 2, source: "default" });
  assert.equal(effectiveTeamLevel(f.raw, f.projectId, f.teamId), 2);
});
for (const project of [0, 1, 2, 3, 4]) for (const team of [0, 1, 2, 3, 4])
  test(`effective team min with project L${project} and team L${team}`, t => {
    const f = policyFixture(t); assert.equal(f.set("project", f.projectId, project).status, 200);
    assert.equal(f.set("team", f.teamId, team).status, 200);
    assert.equal(effectiveTeamLevel(f.raw, f.projectId, f.teamId), Math.min(project, team));
    assert.deepEqual(autonomyLevel(f.raw, f.projectId, "team", f.teamId), { level: team, source: "explicit" });
  });
test("lower project caps a default team", t => {
  const f = policyFixture(t); f.set("project", f.projectId, 1); assert.equal(effectiveTeamLevel(f.raw, f.projectId, f.teamId), 1);
  assert.deepEqual(autonomyStatus(f.raw, f.projectId).teams[0], { teamId: f.teamId, level: 2, effectiveLevel: 1, source: "default" });
});
test("team setting is scoped to project even when the team is shared", t => {
  const f = policyFixture(t), other = f.project(); f.set("team", f.teamId, 0);
  assert.deepEqual(autonomyLevel(f.raw, other, "team", f.teamId), { level: 2, source: "default" });
});
test("project setting does not affect another project", t => {
  const f = policyFixture(t), other = f.project(); f.set("project", f.projectId, 0);
  assert.deepEqual(autonomyLevel(f.raw, other, "project", other), { level: 3, source: "default" });
});
test("read status includes defaults and nullable project revision", t => {
  const f = policyFixture(t); assert.deepEqual(autonomyStatus(f.raw, f.projectId), {
    project: { level: 3, source: "default", revision: null },
    teams: [{ teamId: f.teamId, level: 2, source: "default", effectiveLevel: 2 }], defaults: { project: 3, team: 2 },
  });
});
test("status includes engaged teams once and excludes unengaged teams", t => {
  const f = policyFixture(t), second = f.secondTeam(); f.set("team", second, 4);
  assert.deepEqual(autonomyStatus(f.raw, f.projectId).teams.map(x => x.teamId), [f.teamId]);
  f.engage(second); f.updateEngagement(f.primary.id, { state: "ended" }); f.engage(f.teamId);
  assert.deepEqual(autonomyStatus(f.raw, f.projectId).teams.map(x => x.teamId), [second, f.teamId].sort());
});
test("status uses explicit revisions without changing entity revisions", t => {
  const f = policyFixture(t), before = f.raw.prepare("SELECT revision FROM projects WHERE id=?").get(f.projectId).revision;
  f.set("project", f.projectId, 1); f.set("project", f.projectId, 4, 1);
  assert.deepEqual(autonomyStatus(f.raw, f.projectId).project, { level: 4, source: "explicit", revision: 2 });
  assert.equal(f.raw.prepare("SELECT revision FROM projects WHERE id=?").get(f.projectId).revision, before);
});
