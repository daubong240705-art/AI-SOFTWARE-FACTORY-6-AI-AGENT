import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createKnowledgeMcp, knowledgeScopeForGrant } from "../dist/knowledge/mcp.js";
import { visibleToScope } from "../dist/knowledge/permissions.js";
import { fixture } from "./requests-fixture.mjs";

function permissionFixture(t) {
  const f = fixture(t); const ref = f.artifact(); const { requestId } = f.create({ contextRefs: [ref] }); f.triage(requestId);
  f.raw.prepare("UPDATE tasks SET state = 'active' WHERE id = ?").run(requestId);
  const target = f.seed(requestId, f.getTask(requestId).ownerSeatId);
  const knowledge = createKnowledgeMcp({ raw: f.raw, knowledge: f.knowledge, now: f.clock });
  const read = (input = ref, by = target) => knowledge.call(by, "knowledge.get", { ...input, level: "l1" });
  return { ...f, ref, requestId, target, read, kmcp: knowledge };
}
test("an accepted CTR reads exactly its granted foreign team draft", (t) => {
  const f = permissionFixture(t); const result = f.read(); assert.equal(result.isError, false);
  assert.equal(JSON.parse(result.content[0].text).text, "Context detail");
  assert.deepEqual(knowledgeScopeForGrant(f.raw, f.target).grants, [f.ref]);
});
for (const version of [2,3,10]) test(`context permission never widens to version ${version}`, (t) => {
  const f = permissionFixture(t); const other = f.artifact({ artifactId: f.ref.artifactId, version });
  assert.equal(f.read(other).isError, true); assert.equal(f.read().isError, false);
});
test("context permission never widens to other artifacts", (t) => {
  const f = permissionFixture(t); const other = f.artifact(); assert.equal(f.read(other).isError, true);
});
for (const status of ["withdrawn","rejected"]) test(`context grants never expose ${status} content`, (t) => {
  const f = permissionFixture(t); f.raw.prepare("UPDATE artifact_versions SET status = ? WHERE artifact_id = ?").run(status, f.ref.artifactId);
  assert.equal(f.read().isError, true); assert.equal(f.read().content[0].text, "not found");
});
for (const state of ["done","cancelled","declined","superseded"]) test(`context access disappears immediately at ${state}`, (t) => {
  const f = permissionFixture(t); assert.equal(f.read().isError, false);
  f.raw.prepare("UPDATE tasks SET state = ? WHERE id = ?").run(state, f.requestId);
  assert.deepEqual(knowledgeScopeForGrant(f.raw, f.target).grants, []); assert.equal(f.read().isError, true);
});
for (const state of ["submitted","need-info","declined","redirected","merged"]) test(`triage ${state} never grants context`, (t) => {
  const f = permissionFixture(t); f.raw.prepare("UPDATE ctr_meta SET triage_state = ? WHERE task_id = ?").run(state, f.requestId);
  assert.deepEqual(knowledgeScopeForGrant(f.raw, f.target).grants, []); assert.equal(f.read().isError, true);
});
test("a non-CTR task receives no context grant", (t) => {
  const f = permissionFixture(t); const engagementId = f.getTask(f.requestId).engagementId; const seatId = f.getTask(f.requestId).ownerSeatId;
  const grant = f.seed(f.task({ engagementId, seatId }), seatId);
  assert.deepEqual(knowledgeScopeForGrant(f.raw, grant).grants, []); assert.equal(f.read(f.ref, grant).isError, true);
});
test("metadata attached to a normal task cannot forge context permissions", (t) => {
  const f = permissionFixture(t); const engagementId = f.getTask(f.requestId).engagementId; const seatId = f.getTask(f.requestId).ownerSeatId;
  const grant = f.seed(f.task({ engagementId, seatId }), seatId);
  f.raw.prepare(`INSERT INTO ctr_meta (project_id,task_id,root_task_id,dedup_key,target_team_id,response_mode,expected_response_json,context_refs_json,triage_state)
    VALUES (?,?,?,?,?,'async','{}',?,'accepted')`).run(f.projectId, grant.taskId, f.grant.taskId, "forged", f.team, JSON.stringify([f.ref]));
  assert.deepEqual(knowledgeScopeForGrant(f.raw, grant).grants, []); assert.equal(f.read(f.ref, grant).isError, true);
});
test("a forged requestId in knowledge arguments cannot grant access", (t) => {
  const f = permissionFixture(t); const other = f.artifact();
  const result = f.kmcp.call(f.target, "knowledge.get", { ...other, requestId: f.requestId });
  assert.equal(result.isError, true); assert.equal(result.content[0].text, "invalid tool input"); assert.equal(f.read(other).isError, true);
});
test("request.get cannot alter the viewer context scope", (t) => {
  const f = permissionFixture(t); f.view(f.requestId, f.target);
  const other = f.artifact(); assert.equal(f.read(other).isError, true);
});
test("an exact context pair does not grant the same pair in another project", (t) => {
  const f = permissionFixture(t); const projectId = f.project();
  f.artifact({ projectId, artifactId: f.ref.artifactId, producer: null });
  const predicate = visibleToScope(knowledgeScopeForGrant(f.raw, f.target));
  const rows = f.raw.prepare(`SELECT project_id FROM artifact_versions v WHERE v.artifact_id = ? AND ${predicate.sql}`)
    .all(f.ref.artifactId, ...predicate.params);
  assert.deepEqual(rows, [{ project_id: f.projectId }]);
});
test("an organization-approved foreign artifact remains normally readable", (t) => {
  const f = permissionFixture(t); const projectId = f.project();
  const ref = f.artifact({ projectId, producer: null, visibility: "organization", status: "approved" }); assert.equal(f.read(ref).isError, false);
});
test("a project-visible artifact needs no context grant", (t) => {
  const f = permissionFixture(t); const ref = f.artifact({ visibility: "project" }); assert.equal(f.read(ref).isError, false);
});
test("an older granted version stays readable when a newer version exists", (t) => {
  const f = permissionFixture(t); f.artifact({ artifactId: f.ref.artifactId, version: 2 });
  assert.equal(f.read().isError, false);
  const result = f.kmcp.call(f.target, "knowledge.get", { artifactId: f.ref.artifactId });
  assert.equal(JSON.parse(result.content[0].text).version, 1);
});
test("search returns the granted version without exposing newer private content", (t) => {
  const f = permissionFixture(t); f.artifact({ artifactId: f.ref.artifactId, version: 2 });
  const result = f.kmcp.call(f.target, "knowledge.search", { query: "Context marker" }); assert.equal(result.isError, false);
  assert.deepEqual(JSON.parse(result.content[0].text).results.map((r) => [r.artifactId,r.version]), [[f.ref.artifactId,1]]);
});
test("cross-project grant forgery is fenced by the attempt identity", (t) => {
  const f = permissionFixture(t); const result = f.read(f.ref, { ...f.target, projectId: randomUUID() });
  assert.equal(result.isError, true); assert.equal(result.content[0].text, "attempt is not active");
});
test("requester sees only readable deliverables", (t) => {
  const f = permissionFixture(t); const privateRef = f.artifact({ producer: f.target.attemptId });
  const visibleRef = f.artifact({ producer: f.target.attemptId, visibility: "project" });
  const view = f.view(f.requestId); assert.deepEqual(view.deliverables.map((r) => r.artifactId), [visibleRef.artifactId]);
  const operator = f.view(f.requestId, { projectId: f.projectId, operator: true });
  assert.deepEqual(operator.deliverables.map((r) => r.artifactId), [visibleRef.artifactId,privateRef.artifactId]);
});
