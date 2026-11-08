// Closes mutation survivors of the X1a review: credential redaction, attempt/task binding, open-question scope,
// handoff epoch and cap, exact budget boundary, precise omitted reasons, ordering and the approval gate on blank L1.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fixture } from "./context-fixture.mjs";
import { renderContextPack } from "../dist/context/pack.js";
import { moveTask } from "../dist/dispatch/index.js";
import { transitionArtifactVersion } from "../dist/knowledge/lifecycle.js";

test("credential-looking text in the brief is redacted", (t) => {
  const f = fixture(t, { task: { brief: "Call with Bearer abcdef123456 and password: hunter2value then continue" } });
  const text = JSON.stringify(f.build().sections.brief);
  assert.doesNotMatch(text, /abcdef123456|hunter2value/);
});
test("a pack for an attempt that belongs to another task is refused", (t) => {
  const f = fixture(t); const other = f.task({ seatId: f.seat.id });
  const foreign = f.attempt(other);
  assert.throws(() => f.build({ attemptId: foreign.id }), /Context unavailable/);
});
test("open questions come only from this task and only while pending", (t) => {
  const f = fixture(t); const otherTask = f.task({ seatId: f.seat.id });
  const mine = f.approval({ state: "pending", subject: "Mine open", summary: "waiting" });
  f.approval({ state: "pending", taskId: otherTask, subject: "Theirs open", summary: "waiting" });
  f.approval({ state: "applied", subject: "Answered one", summary: "done" });
  f.approval({ state: "rejected", subject: "Rejected one", summary: "no" });
  const questions = f.build().sections.openQuestions;
  assert.deepEqual(questions.map((q) => q.approvalId), [mine]);
  assert.match(questions[0].text, /Mine open/);
});
test("the handoff section appears only from the second epoch and is capped at 2000 characters", (t) => {
  const f = fixture(t);
  const first = f.attempt(); f.raw.prepare("UPDATE attempts SET state = 'failed', ended_at = ? WHERE id = ?").run(f.clock().toISOString(), first.id);
  assert.equal(f.build({ attemptId: first.id }).sections.handoff, null);
  const second = f.attempt();
  f.raw.prepare("UPDATE attempts SET state = 'failed', ended_at = ? WHERE id = ?").run(f.clock().toISOString(), first.id);
  for (let n = 0; n < 12; n++) f.raw.prepare(`INSERT INTO attempt_events (project_id,attempt_id,seq,kind,at,body_json) VALUES (?,?,?,'progress',?,?)`)
    .run(f.projectId, first.id, 100 + n, f.clock().toISOString(), JSON.stringify({ message: `Finished step ${n} ${"detail ".repeat(40)}` }));
  const pack = f.build({ attemptId: second.id });
  assert.ok(pack.sections.handoff); assert.ok(pack.sections.handoff.text.length <= 2000); assert.ok(pack.sections.handoff.text.length > 100);
});
test("a pack that exactly fills the budget keeps every input at L1", (t) => {
  const f = fixture(t); const long = Array.from({ length: 8 }, (_, i) => `Line ${i} ${"summary ".repeat(30)}`).join("\n");
  f.inputs([f.artifact({ l1: long }), f.artifact({ l1: long })]);
  const roomy = f.build({ maxTokens: 32000 }); assert.equal(roomy.sections.inputs.every((i) => i.tier === "L1"), true);
  assert.ok(roomy.tokens >= 500);
  const exact = f.build({ maxTokens: roomy.tokens });
  assert.equal(exact.sections.inputs.every((i) => i.tier === "L1"), true); assert.equal(exact.omitted.length, 0);
  const tight = f.build({ maxTokens: roomy.tokens - 1 });
  assert.equal(tight.sections.inputs.some((i) => i.tier === "L0") || tight.omitted.length > 0, true);
});
test("stored packs keep the precise omitted reason while the rendered text does not", (t) => {
  const f = fixture(t); const hidden = f.artifact({ visibility: "team-draft", status: "draft", producer: null, projectId: f.projectId });
  f.raw.prepare("UPDATE artifact_versions SET produced_by_attempt_id = NULL WHERE artifact_id = ?").run(hidden.artifactId);
  const unknown = { artifactId: randomUUID(), version: 3 };
  f.inputs([hidden, unknown]);
  const pack = f.build();
  const reasons = Object.fromEntries(pack.omitted.map((o) => [o.ref.artifactId, o.reason]));
  assert.equal(reasons[unknown.artifactId], "not-found");
  assert.notEqual(reasons[hidden.artifactId], undefined);
  const text = renderContextPack(pack);
  assert.doesNotMatch(text, /not-found/);
});
test("omitted references are listed in the declared input order", (t) => {
  const f = fixture(t); const refs = [0, 1, 2, 3].map((n) => ({ artifactId: randomUUID(), version: n + 1 }));
  f.inputs(refs);
  assert.deepEqual(f.build().omitted.map((o) => o.ref.artifactId), refs.map((r) => r.artifactId));
});
test("approval treats a whitespace-only L1 as missing when multi-team is on", (t) => {
  const f = fixture(t); const ref = f.artifact({ status: "reviewed", visibility: "project", kind: "requirements", l1: "   " });
  assert.throws(() => transitionArtifactVersion(f.raw, { projectId: f.projectId, artifactId: ref.artifactId, version: 1, to: "approved",
    actorId: "operator", now: f.clock().toISOString(), multiTeam: true }), /summary \(L1\) is required before approval/);
  assert.equal(f.raw.prepare("SELECT status FROM artifact_versions WHERE artifact_id = ?").get(ref.artifactId).status, "reviewed");
});
void moveTask;
test("the rendered pack carries the prior-work section when a handoff exists", (t) => {
  const f = fixture(t);
  const first = f.attempt(); f.raw.prepare("UPDATE attempts SET state = 'failed', ended_at = ? WHERE id = ?").run(f.clock().toISOString(), first.id);
  f.raw.prepare("INSERT INTO attempt_events (project_id,attempt_id,seq,kind,at,body_json) VALUES (?,?,100,'progress',?,?)")
    .run(f.projectId, first.id, f.clock().toISOString(), JSON.stringify({ message: "Wrote the first half of the module" }));
  const second = f.attempt();
  const text = renderContextPack(f.build({ attemptId: second.id }));
  assert.match(text, /Prior work:/); assert.match(text, /first half of the module/);
});
