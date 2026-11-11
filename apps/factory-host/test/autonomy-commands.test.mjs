import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { policyFixture } from "./policy-fixture.mjs";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { setAutonomyHandler } from "../dist/policy/autonomy.js";

for (const subject of ["project", "team"]) for (const level of [0, 1, 2, 3, 4]) test(`set ${subject} L${level}`, t => {
  const f = policyFixture(t), ref = subject === "project" ? f.projectId : f.teamId;
  assert.equal(f.set(subject, ref, level).status, 200);
  assert.deepEqual(f.raw.prepare("SELECT project_id,subject,subject_ref,level,revision,updated_at FROM autonomy_settings").get(),
    { project_id: f.projectId, subject, subject_ref: ref, level, revision: 1, updated_at: f.clock().toISOString() });
});
for (const subject of ["project", "team"]) test(`${subject} updates require matching revision`, t => {
  const f = policyFixture(t), ref = subject === "project" ? f.projectId : f.teamId;
  f.set(subject, ref, 2);
  for (const expected of [null, 2]) {
    const r = f.set(subject, ref, 4, expected); assert.equal(r.status, 409); assert.equal(r.body.error.currentRevision, 1);
    assert.equal(f.raw.prepare("SELECT level FROM autonomy_settings").get().level, 2);
  }
  assert.equal(f.set(subject, ref, 3, 1).status, 200); assert.equal(f.raw.prepare("SELECT revision FROM autonomy_settings").get().revision, 2);
});
for (const subject of ["project", "team"]) test(`${subject} missing setting rejects an update revision`, t => {
  const f = policyFixture(t); assert.equal(f.set(subject, subject === "project" ? f.projectId : f.teamId, 2, 1).status, 409);
});
test("unknown project is not found", t => {
  const f = policyFixture(t), id = randomUUID(); assert.equal(f.set("project", id, 2, null, id).status, 404);
});
test("unknown team is not found", t => {
  const f = policyFixture(t); assert.equal(f.set("team", randomUUID(), 2).status, 404);
});
test("project subject must match command project", t => {
  const f = policyFixture(t); assert.equal(f.set("project", f.project(), 2).status, 400);
  assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM autonomy_settings").get().n, 0);
});
test("an existing team can be configured before engagement", t => {
  const f = policyFixture(t), team = f.secondTeam(); assert.equal(f.set("team", team, 4).status, 200);
});
test("replaying a command does not bump revision or timestamp", t => {
  const f = policyFixture(t); let now = f.clock();
  const pipeline = createCommandPipeline({ storage: f.storage, hub: f.hub, clock: () => now, handlers: { "autonomy.set": setAutonomyHandler } });
  const command = f.command("autonomy.set", { subject: "project", subjectRef: f.projectId, level: 1, expectedRevision: null });
  const first = pipeline.execute(command); now = new Date(now.getTime() + 1000);
  const replay = pipeline.execute(command); assert.equal(replay.replayed, true); assert.deepEqual(replay.body, first.body);
  assert.deepEqual(f.raw.prepare("SELECT revision,updated_at FROM autonomy_settings").get(), { revision: 1, updated_at: f.clock().toISOString() });
});
test("successful update uses injected clock", t => {
  const f = policyFixture(t); f.set("project", f.projectId, 1);
  const clock = () => new Date("2026-11-10T12:00:00.000Z");
  const pipeline = createCommandPipeline({ storage: f.storage, hub: f.hub, clock, handlers: { "autonomy.set": setAutonomyHandler } });
  assert.equal(pipeline.execute(f.command("autonomy.set", { subject: "project", subjectRef: f.projectId, level: 3, expectedRevision: 1 })).status, 200);
  assert.equal(f.raw.prepare("SELECT updated_at FROM autonomy_settings").get().updated_at, clock().toISOString());
});
for (const level of [-1, 5, 1.5, "2", null]) test(`command rejects invalid level ${level}`, t => {
  const f = policyFixture(t); assert.equal(f.set("project", f.projectId, level).status, 400);
});
