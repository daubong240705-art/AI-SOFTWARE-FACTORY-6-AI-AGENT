import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { contextPackSchema } from "@factory/contracts";
import { renderContextPack, storeContextPack } from "../dist/context/pack.js";
import { createAttempt } from "../dist/dispatch/index.js";
import { listSeats } from "../dist/org/service.js";
import { fixture } from "./context-fixture.mjs";

function link(f, dependencyId, taskId = f.taskId) {
  f.raw.prepare("INSERT INTO task_dependencies (project_id,task_id,depends_on_task_id) VALUES (?,?,?)")
    .run(f.projectId, taskId, dependencyId);
}

function finish(f, attempt) {
  f.raw.prepare("UPDATE attempts SET state='succeeded',ended_at=? WHERE project_id=? AND id=?")
    .run(f.clock().toISOString(), f.projectId, attempt.id);
}

function dependency(f, { code = "TSK-001", state = "done", seatId = f.seat.id, ...patch } = {}) {
  const taskId = f.task({ code, seatId, ...patch });
  const attempt = f.attempt(taskId, seatId);
  finish(f, attempt);
  f.raw.prepare("UPDATE tasks SET state=? WHERE project_id=? AND id=?").run(state, f.projectId, taskId);
  link(f, taskId);
  return { taskId, attempt, output: (patch = {}) => f.artifact({ producer: attempt.id, ...patch }) };
}

const dependencyItems = (pack) => pack.sections.inputs.filter((item) => item.why === "dependency output");

// Exercise defensive reads of legacy/malformed rows that current CHECKs forbid.
function legacyArtifact(f, patch) {
  f.raw.pragma("ignore_check_constraints = ON");
  try { return f.artifact(patch); }
  finally { f.raw.pragma("ignore_check_constraints = OFF"); }
}

test("an approved output of a done dependency is an input with its producing Task code", (t) => {
  const f = fixture(t);
  const ref = dependency(f).output({ title: "Library API" });
  assert.deepEqual(f.build().sections.inputs, [{
    ref, tier: "L1", title: "TSK-001: Library API", kind: "requirements", status: "approved",
    stale: false, why: "dependency output", text: "Detailed summary",
  }]);
});

for (const [l1, tier, text] of [
  ["Detailed dependency summary", "L1", "Detailed dependency summary"],
  [null, "L0", "Short summary"], ["", "L0", "Short summary"], [" \n ", "L0", "Short summary"],
]) test(`dependency L1 ${JSON.stringify(l1)} selects ${tier}`, (t) => {
  const f = fixture(t);
  dependency(f).output({ l1 });
  const [item] = dependencyItems(f.build());
  assert.equal(item.tier, tier);
  assert.equal(item.text, text);
});

for (const state of ["draft", "proposed", "accepted", "ready", "awaiting-go", "active", "in-review", "failed", "cancelled", "declined", "superseded"])
  test(`a dependency in state ${state} contributes nothing`, (t) => {
    const f = fixture(t);
    const before = f.build();
    dependency(f, { state }).output({ title: "Excluded dependency" });
    assert.deepEqual(f.build(), before);
  });

for (const status of ["draft", "in-review", "reviewed", "rejected", "superseded", "withdrawn"])
  test(`a dependency output in status ${status} contributes nothing`, (t) => {
    const f = fixture(t);
    const before = f.build();
    dependency(f).output({ status, title: "Unapproved output" });
    assert.deepEqual(f.build(), before);
  });

test("a done dependency without artifacts contributes nothing", (t) => {
  const f = fixture(t);
  const before = f.build();
  dependency(f);
  assert.deepEqual(f.build(), before);
});

test("the highest approved version wins regardless of insertion time and unapproved newer versions", (t) => {
  const f = fixture(t);
  const d = dependency(f);
  const latest = d.output({ version: 3, title: "Latest approved" });
  d.output({ artifactId: latest.artifactId, version: 1, title: "Older approved" });
  d.output({ artifactId: latest.artifactId, version: 4, status: "draft" });
  d.output({ artifactId: latest.artifactId, version: 5, status: "superseded" });
  assert.deepEqual(dependencyItems(f.build()).map((item) => item.ref), [latest]);
});

test("version selection spans all attempts of the dependency Task", (t) => {
  const f = fixture(t);
  const taskId = f.task({ seatId: f.seat.id, code: "TSK-001" });
  const first = f.attempt(taskId);
  finish(f, first);
  const old = f.artifact({ producer: first.id, version: 1 });
  const second = f.attempt(taskId);
  finish(f, second);
  const latest = f.artifact({ producer: second.id, artifactId: old.artifactId, version: 2 });
  const earlierOnly = f.artifact({ producer: first.id, title: "Earlier attempt's other output" });
  f.raw.prepare("UPDATE tasks SET state='done' WHERE id=?").run(taskId);
  link(f, taskId);
  assert.deepEqual(dependencyItems(f.build()).map((item) => item.ref), [earlierOnly, latest]);
});

test("latest approved is selected independently for each dependency and artifact", (t) => {
  const f = fixture(t);
  const a = dependency(f);
  const b = dependency(f, { code: "TSK-002" });
  const first = a.output({ version: 1 });
  const second = b.output({ artifactId: first.artifactId, version: 2 });
  a.output({ artifactId: first.artifactId, version: 3, status: "rejected" });
  assert.deepEqual(dependencyItems(f.build()).map((item) => item.ref), [first, second]);
});

test("two dependencies are ordered by Task code rather than creation or link order", (t) => {
  const f = fixture(t);
  const later = dependency(f, { code: "TSK-020" }).output({ title: "A summary" });
  const earlier = dependency(f, { code: "TSK-002" }).output({ title: "Z summary" });
  assert.deepEqual(dependencyItems(f.build()).map((item) => item.ref), [earlier, later]);
});

test("artifact titles sort within a dependency and artifact IDs break title ties", (t) => {
  const f = fixture(t);
  const d = dependency(f);
  const later = d.output({ artifactId: "ffffffff-ffff-4fff-8fff-ffffffffffff", title: "Same" });
  const earlier = d.output({ artifactId: "00000000-0000-4000-8000-000000000001", title: "Same" });
  const first = d.output({ title: "Alpha" });
  assert.deepEqual(dependencyItems(f.build()).map((item) => item.ref), [first, earlier, later]);
});

test("at most ten outputs are added across the whole pack in sorted order", (t) => {
  const f = fixture(t);
  const b = dependency(f, { code: "TSK-002" });
  const a = dependency(f);
  const refsB = Array.from({ length: 7 }, (_, i) => b.output({ title: `B ${i}` }));
  const refsA = Array.from({ length: 7 }, (_, i) => a.output({ title: `A ${i}` }));
  const p = f.build({ maxTokens: 32000 });
  assert.deepEqual(dependencyItems(p).map((item) => item.ref), [...refsA, ...refsB.slice(0, 3)]);
  assert.deepEqual(p.omitted, []);
  assert.doesNotMatch(JSON.stringify(p), new RegExp(refsB[3].artifactId));
});

test("exact references already declared are not repeated or relabeled", (t) => {
  const f = fixture(t);
  const ref = dependency(f).output();
  f.inputs([ref]);
  const p = f.build();
  assert.equal(p.sections.inputs.length, 1);
  assert.equal(p.sections.inputs[0].why, "declared input");
  assert.equal(p.sections.inputs[0].title, "Input document");
});

test("a declared older version does not prevent the latest dependency version", (t) => {
  const f = fixture(t);
  const d = dependency(f);
  const old = d.output();
  const latest = d.output({ artifactId: old.artifactId, version: 2 });
  f.inputs([old]);
  assert.deepEqual(f.build().sections.inputs.map((item) => item.ref), [old, latest]);
});

test("a declared latest version does not fall back to older dependency versions", (t) => {
  const f = fixture(t);
  const d = dependency(f);
  const old = d.output();
  const latest = d.output({ artifactId: old.artifactId, version: 2 });
  f.inputs([latest]);
  assert.deepEqual(f.build().sections.inputs.map((item) => item.ref), [latest]);
});

test("duplicates and skipped artifacts do not consume the ten-output allowance", (t) => {
  const f = fixture(t);
  const d = dependency(f);
  const duplicate = d.output({ title: "A declared" });
  const diff = d.output({ title: "B patch", kind: "code-ref" });
  f.raw.prepare("UPDATE artifact_versions SET media_type='text/x-diff' WHERE artifact_id=?").run(diff.artifactId);
  f.inputs([duplicate]);
  const refs = Array.from({ length: 10 }, (_, i) => d.output({ title: `Summary ${i}` }));
  assert.deepEqual(dependencyItems(f.build({ maxTokens: 32000 })).map((item) => item.ref), refs);
});

test("patch artifacts are skipped even when they have L0 and L1 summaries", (t) => {
  const f = fixture(t);
  const before = f.build();
  const ref = dependency(f).output({ kind: "code-ref", title: "Raw patch" });
  f.raw.prepare("UPDATE artifact_versions SET media_type='text/x-diff' WHERE artifact_id=?").run(ref.artifactId);
  assert.deepEqual(f.build(), before);
});

for (const l0 of ["", "   ", "\n\t "]) test(`empty L0 ${JSON.stringify(l0)} is skipped even when L1 exists`, (t) => {
  const f = fixture(t);
  const before = f.build();
  const d = dependency(f);
  legacyArtifact(f, { producer: d.attempt.id, l0, l1: "Available detailed summary" });
  assert.deepEqual(f.build(), before);
});

test("a code-ref summary with a non-diff media type is eligible", (t) => {
  const f = fixture(t);
  const ref = dependency(f).output({ kind: "code-ref", title: "API references" });
  assert.deepEqual(dependencyItems(f.build()).map((item) => item.ref), [ref]);
});

test("a latest approved patch does not fall back to an older summary", (t) => {
  const f = fixture(t);
  const d = dependency(f);
  const old = d.output();
  const latest = d.output({ artifactId: old.artifactId, version: 2, kind: "code-ref" });
  f.raw.prepare("UPDATE artifact_versions SET media_type='text/x-diff' WHERE artifact_id=? AND version=?")
    .run(latest.artifactId, latest.version);
  assert.deepEqual(dependencyItems(f.build()), []);
});

for (const withAttempt of [false, true]) test(`another team's team-draft leaves no trace (attempt scope: ${withAttempt})`, (t) => {
  const f = fixture(t);
  const team = f.secondTeam();
  const seat = listSeats(f.raw, team)[0];
  const d = dependency(f, { seatId: seat.id, engagementId: f.engage(team) });
  const viewer = withAttempt ? f.attempt() : null;
  const build = () => f.build(viewer ? { attemptId: viewer.id } : {});
  const before = build();
  const hidden = d.output({ visibility: "team-draft", title: "Private draft marker" });
  assert.deepEqual(build(), before);
  // Also prove visibility, rather than only status, excludes legacy approved drafts.
  const legacy = legacyArtifact(f, { producer: d.attempt.id, visibility: "team-draft", status: "approved", title: "Hidden approved marker" });
  const p = build();
  assert.deepEqual(p, before);
  for (const ref of [hidden, legacy]) assert.equal(JSON.stringify(p).includes(ref.artifactId), false);
  assert.doesNotMatch(renderContextPack(p), /Private draft marker|Hidden approved marker/);
});

for (const visibility of ["project", "organization"]) test(`another project's ${visibility} version cannot join on a matching attempt ID`, (t) => {
  const f = fixture(t);
  const d = dependency(f);
  const before = f.build();
  const projectId = f.project();
  const taskId = f.task({ scope: projectId, code: "TSK-001" });
  const seat = f.raw.prepare(`SELECT s.id FROM seats s JOIN engagements e ON e.team_id=s.team_id
    WHERE e.project_id=? ORDER BY s.id LIMIT 1`).get(projectId);
  const attempt = createAttempt(f.raw, { projectId, taskId, seatId: seat.id, id: d.attempt.id,
    runtime: "fake", provider: "fake", model: "fake", effort: "medium", now: f.clock().toISOString() });
  const ref = f.artifact({ projectId, producer: attempt.id, visibility, title: "Foreign project marker" });
  const p = f.build();
  assert.deepEqual(p, before);
  assert.equal(JSON.stringify(p).includes(ref.artifactId), false);
  assert.doesNotMatch(renderContextPack(p), /Foreign project marker/);
});

test("unreadable outputs neither use the cap nor hide an older readable approved version", (t) => {
  const f = fixture(t);
  const team = f.secondTeam();
  const seat = listSeats(f.raw, team)[0];
  const d = dependency(f, { seatId: seat.id, engagementId: f.engage(team) });
  const visible = d.output({ title: "Readable" });
  legacyArtifact(f, { artifactId: visible.artifactId, version: 2, producer: d.attempt.id,
    visibility: "team-draft", status: "approved", title: "Hidden newer title" });
  for (let i = 0; i < 11; i++) legacyArtifact(f, { producer: d.attempt.id, visibility: "team-draft", status: "approved", title: `A hidden ${i}` });
  const p = f.build();
  assert.deepEqual(dependencyItems(p).map((item) => item.ref), [visible]);
  assert.deepEqual(p.omitted, []);
  assert.doesNotMatch(JSON.stringify(p), /hidden/i);
});

test("stale dependency versions show the same stale flag and rendered marker", (t) => {
  const f = fixture(t);
  const ref = dependency(f).output();
  const cause = f.artifact();
  f.raw.prepare("INSERT INTO knowledge_stale VALUES (?,?,1,?,1,?)")
    .run(f.projectId, ref.artifactId, cause.artifactId, f.clock().toISOString());
  const p = f.build();
  assert.equal(dependencyItems(p)[0].stale, true);
  assert.match(renderContextPack(p), /STALE/);
});

test("staleness of an older version does not mark the selected latest version", (t) => {
  const f = fixture(t);
  const d = dependency(f);
  const old = d.output();
  d.output({ artifactId: old.artifactId, version: 2 });
  const cause = f.artifact();
  f.raw.prepare("INSERT INTO knowledge_stale VALUES (?,?,1,?,1,?)")
    .run(f.projectId, old.artifactId, cause.artifactId, f.clock().toISOString());
  assert.equal(dependencyItems(f.build())[0].stale, false);
});

test("budget drops dependency outputs before degrading declared L1 and records retrieval hints", (t) => {
  const f = fixture(t);
  const declared = f.artifact({ l1: "Declared detail ".repeat(70) });
  f.inputs([declared]);
  const before = f.build();
  const ref = dependency(f).output({ l0: "Large summary ".repeat(25), l1: "Dependency detail ".repeat(200) });
  const p = f.build({ maxTokens: Math.max(500, before.tokens + 70) });
  assert.deepEqual(p.sections.inputs, before.sections.inputs);
  assert.deepEqual(p.omitted, [{ ref, reason: "over-budget" }]);
  assert.deepEqual(p.sections.retrievalHints, [`knowledge.get artifactId=${ref.artifactId} version=${ref.version}`]);
  assert.ok(p.tokens <= p.budget.maxTokens);
});

test("dependency L1 degrades to its cleaned L0 before omission", (t) => {
  const f = fixture(t);
  dependency(f).output({ l0: "Small safe summary {discard}", l1: "Long detail ".repeat(800) });
  const p = f.build({ maxTokens: 500 });
  assert.equal(dependencyItems(p)[0].tier, "L0");
  assert.equal(dependencyItems(p)[0].text, "Small safe summary");
  assert.deepEqual(p.omitted, []);
  assert.ok(p.tokens <= 500);
});

test("budget handles later dependencies first and preserves deterministic omitted order", (t) => {
  const f = fixture(t);
  const a = dependency(f);
  const b = dependency(f, { code: "TSK-002" });
  const first = a.output({ l0: "A".repeat(400), l1: "A".repeat(8000) });
  const second = b.output({ l0: "B".repeat(400), l1: "B".repeat(8000) });
  const third = b.output({ title: "Z", l0: "C".repeat(400), l1: "C".repeat(8000) });
  const p = f.build({ maxTokens: 500 });
  assert.deepEqual(dependencyItems(p).map((item) => item.ref), [first]);
  assert.deepEqual(p.omitted, [second, third].map((ref) => ({ ref, reason: "over-budget" })));
  assert.deepEqual(p.sections.retrievalHints.slice(0, 2), [second, third].map((ref) => `knowledge.get artifactId=${ref.artifactId} version=${ref.version}`));
});

test("all ten dependency omissions precede any changes to declared inputs", (t) => {
  const f = fixture(t);
  f.inputs([f.artifact({ l1: "Declared detail ".repeat(300) })]);
  const d = dependency(f);
  const refs = Array.from({ length: 10 }, (_, i) => d.output({ title: `Output ${i}`, l0: "X".repeat(400), l1: "Y".repeat(8000) }));
  const p = f.build({ maxTokens: 500 });
  assert.equal(dependencyItems(p).length, 0);
  assert.deepEqual(p.omitted.filter((item) => refs.some((ref) => ref.artifactId === item.ref.artifactId)).map((item) => item.ref), refs);
  assert.ok(p.sections.inputs.every((item) => item.why === "declared input"));
});

test("the contract and persisted pack support 100 declared inputs plus ten dependency outputs", (t) => {
  const f = fixture(t);
  const refs = Array.from({ length: 100 }, () => f.artifact({ l1: null }));
  f.inputs(refs);
  const d = dependency(f);
  const outputs = Array.from({ length: 10 }, (_, i) => d.output({ title: `Output ${i}`, l1: null }));
  const p = f.build({ maxTokens: 32000 });
  assert.deepEqual(p.sections.inputs.map((item) => item.ref), [...refs, ...outputs]);
  const attempt = f.attempt();
  storeContextPack(f.raw, f.projectId, attempt.id, p);
  const stored = f.raw.prepare("SELECT pack_json FROM context_packs WHERE attempt_id=?").get(attempt.id);
  assert.deepEqual(contextPackSchema.parse(JSON.parse(stored.pack_json)), p);
});

test("the contract supports 100 declared omissions plus ten dependency budget omissions", (t) => {
  const f = fixture(t, { task: { brief: "Mandatory context ".repeat(500) } });
  const refs = Array.from({ length: 100 }, () => ({ artifactId: randomUUID(), version: 1 }));
  f.inputs(refs);
  const d = dependency(f);
  const outputs = Array.from({ length: 10 }, (_, i) => d.output({ title: `Output ${i}` }));
  const p = f.build({ maxTokens: 500 });
  assert.equal(p.sections.inputs.length, 0);
  assert.deepEqual(p.omitted, [...refs.map((ref) => ({ ref, reason: "not-found" })), ...outputs.map((ref) => ({ ref, reason: "over-budget" }))]);
  assert.equal(p.sections.retrievalHints.length, 110);
});

test("identical dependency data produces identical packs including budget omissions", (t) => {
  const f = fixture(t);
  const d = dependency(f);
  for (let i = 0; i < 6; i++) d.output({ title: `Output ${i}`, l0: "L".repeat(400), l1: "Detail ".repeat(1000) });
  assert.deepEqual(f.build({ maxTokens: 500 }), f.build({ maxTokens: 500 }));
});

test("a Task without dependencies retains its pack when unrelated done Tasks produce outputs", (t) => {
  const f = fixture(t);
  f.inputs([f.artifact()]);
  const before = f.build();
  const d = dependency(f);
  d.output();
  f.raw.prepare("DELETE FROM task_dependencies WHERE project_id=? AND task_id=?").run(f.projectId, f.taskId);
  const after = f.build();
  assert.deepEqual(after, before);
  assert.deepEqual(dependencyItems(after), []);
});

test("only direct dependencies contribute outputs", (t) => {
  const f = fixture(t);
  const direct = dependency(f);
  const transitive = dependency(f, { code: "TSK-002" });
  f.raw.prepare("DELETE FROM task_dependencies WHERE task_id=? AND depends_on_task_id=?").run(f.taskId, transitive.taskId);
  link(f, transitive.taskId, direct.taskId);
  transitive.output({ title: "Transitive output" });
  const ref = direct.output({ title: "Direct output" });
  assert.deepEqual(dependencyItems(f.build()).map((item) => item.ref), [ref]);
});

test("operator uploads without a producing attempt are not dependency outputs", (t) => {
  const f = fixture(t);
  dependency(f);
  const before = f.build();
  f.artifact({ title: "Operator upload" });
  assert.deepEqual(f.build(), before);
});

for (const field of ["title", "l1", "l0"]) test(`dependency ${field} uses the existing redaction policy`, (t) => {
  const f = fixture(t);
  const foreignId = randomUUID();
  const text = `Safe reference /private/fixture C:\\private\\fixture fpx_fixture_value sk-fixture_value Bearer synthetic-value password=synthetic-password ${foreignId} {hidden} [hidden]`;
  dependency(f).output({ [field]: text, ...(field === "l0" ? { l1: null } : {}) });
  const p = f.build();
  const [item] = dependencyItems(p);
  assert.ok(item);
  assert.match(field === "title" ? item.title : item.text, /Safe reference/);
  assert.match(item.title, /^TSK-001: /);
  const rendered = renderContextPack(p);
  assert.doesNotMatch(rendered, /private|fixture_value|synthetic-value|synthetic-password|hidden|[{}]/);
  assert.equal(rendered.includes(foreignId), false);
});
