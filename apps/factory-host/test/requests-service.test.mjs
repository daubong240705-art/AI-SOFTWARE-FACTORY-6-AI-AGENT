import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openStorage } from "../dist/storage/database.js";
import { requestDedupKey } from "../dist/requests/service.js";
import { requestCreateInputSchema } from "@factory/contracts";
import { migrationsDir } from "./org-fixture.mjs";
import { fixture, kinds, refused, requestInput, until } from "./requests-fixture.mjs";

for (const kind of kinds) test(`create ${kind} uses a cross-team task and the expected execution policy`, (t) => {
  const f = fixture(t); const result = f.create({ kind }); const task = f.getTask(result.requestId);
  assert.equal(task.origin.kind, "cross-team"); assert.equal(task.origin.requesterTaskId, f.grant.taskId);
  assert.equal(task.origin.requestKind, kind); assert.equal(task.origin.hop, 1); assert.match(result.code, /^REQ-001$/);
  assert.equal(task.reviewPolicy, "automatic"); assert.equal(task.placement, ["clarify", "consult"].includes(kind) ? "portable" : "node-bound");
  assert.equal(task.sideEffect, ["produce", "review"].includes(kind) ? "artifact" : "none");
  assert.equal(task.gate.requiresGo, ["produce", "review", "decision"].includes(kind));
  assert.deepEqual(task.acceptance, ["Explain the tradeoffs"]); assert.equal(task.brief, "Explain the design");
  assert.equal(f.meta(task.id).root_task_id, f.grant.taskId); assert.equal(f.meta(task.id).rounds, 0);
});
for (const kind of kinds) test(`auto-engagement follows the ${kind} rule`, (t) => {
  const f = fixture(t); const { requestId } = f.create({ kind }); const task = f.getTask(requestId);
  const automatic = ["clarify", "consult", "review"].includes(kind);
  assert.equal(task.engagementId !== null, automatic);
  if (automatic) {
    const row = f.raw.prepare("SELECT * FROM engagements WHERE id = ?").get(task.engagementId);
    assert.equal(row.priority, 30); assert.equal(row.max_concurrent, 1); assert.equal(row.state, "active");
  } else assert.equal(f.view(requestId).thread[1].text, "needs an engagement: operator triage required");
});
for (const kind of ["clarify", "consult"]) test(`${kind} runs through the fake runtime without Go`, async (t) => {
  const f = fixture(t); const id = await f.delivered({ kind });
  assert.equal(f.meta(id).triage_state, "accepted"); assert.equal(f.meta(id).triage_by, "system");
  assert.ok(f.meta(id).delivered_at); assert.equal(f.runtime.started.filter((entry) => entry.task.id === id).length, 1);
  assert.equal(f.review(id), null); assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM approvals WHERE task_id = ?").get(id).n, 0);
});
for (const kind of ["produce", "review", "decision", "notify"]) test(`${kind} waits in proposed for triage`, async (t) => {
  const f = fixture(t); const { requestId } = f.create({ kind }); await new Promise(setImmediate);
  assert.equal(f.getTask(requestId).state, "proposed"); assert.equal(f.meta(requestId).triage_state, "submitted");
  assert.equal(f.runtime.started.some((entry) => entry.task.id === requestId), false);
});
for (const [label, patch, message] of [
  ["notify cannot block", { kind: "notify", responseMode: "blocking" }, "notify cannot block"],
  ["unknown team", { targetTeamId: randomUUID() }, "team not found"],
  ["unknown kind", { kind: "invalid" }, "invalid tool input"],
  ["unknown mode", { responseMode: "invalid" }, "invalid tool input"],
  ["empty subject", { subject: "" }, "invalid tool input"],
  ["empty ask", { ask: "" }, "invalid tool input"],
  ["oversized ask", { ask: "a".repeat(2001) }, "invalid tool input"],
  ["unreadable context", { contextRefs: [{ artifactId: randomUUID(), version: 1 }] }, "context is not readable"],
  ["forged identity", { taskId: randomUUID() }, "invalid tool input"],
]) test(`refusal for ${label} leaves all tables unchanged`, (t) => { const f = fixture(t); refused(f, () => f.create(patch), message); });
test("disabled creation is atomic", (t) => { const f = fixture(t); refused(f, () => f.create({}, f.grant, { multiTeam: false }), "multi-team is disabled"); });
test("requesting the source engagement team is refused atomically", (t) => { const f = fixture(t); refused(f, () => f.create({ targetTeamId: f.teamId }), "ask another team"); });
for (const lifecycle of ["paused", "archived"]) test(`a ${lifecycle} target is refused atomically`, (t) => {
  const f = fixture(t); f.lifecycle(lifecycle, f.team); refused(f, () => f.create(), "team is not active");
});
for (const patch of [{ epoch: 99 }, { taskId: randomUUID() }, { attemptId: randomUUID() }, { projectId: randomUUID() }])
  test(`a fenced source ${Object.keys(patch)[0]} is refused atomically`, (t) => {
    const f = fixture(t); refused(f, () => f.create({}, { ...f.grant, ...patch }), "attempt is not active");
  });
test("an expired source lease is refused atomically", (t) => {
  const f = fixture(t); f.raw.prepare("UPDATE attempts SET lease_expires_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", f.grant.attemptId);
  refused(f, () => f.create(), "attempt is not active");
});
test("dedup adds a follower idempotently and preserves the original task", (t) => {
  const f = fixture(t); const original = f.create(); const other = f.seed();
  const a = f.create({}, other); const b = f.create({}, other);
  assert.deepEqual(a, { requestId: original.requestId, merged: true }); assert.deepEqual(a, b);
  assert.equal(f.view(original.requestId).followers, 1); assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM ctr_meta").get().n, 1);
});
test("dedup normalizes Vietnamese accents and whitespace", (t) => {
  const f = fixture(t); const a = f.create({ ask: "Đề xuất THIẾT kế!" }); const b = f.create({ ask: "de xuat thiet ke" });
  assert.equal(b.requestId, a.requestId); assert.equal(b.merged, true);
});
for (const dimension of ["kind", "team", "refs", "version", "ask"]) test(`dedup distinguishes ${dimension}`, (t) => {
  const f = fixture(t); const first = f.artifact(); const second = f.artifact({ artifactId: first.artifactId, version: 2 });
  const a = f.create({ contextRefs: [first] }); const patch = dimension === "kind" ? { kind: "review" }
    : dimension === "team" ? { targetTeamId: f.secondTeam() } : dimension === "refs" ? { contextRefs: [] }
      : dimension === "version" ? { contextRefs: [second] } : { ask: "Different question" };
  const b = f.create({ contextRefs: [first], ...patch }); assert.notEqual(b.requestId, a.requestId); assert.equal(b.merged, false);
});
test("dedup canonicalizes ref ordering", (t) => {
  const f = fixture(t); const refs = [f.artifact(), f.artifact()]; const a = f.create({ contextRefs: refs });
  assert.equal(f.create({ contextRefs: [...refs].reverse() }).requestId, a.requestId);
  assert.equal(requestDedupKey(requestCreateInputSchema.parse(requestInput(f.team, { contextRefs: refs }))).length, 64);
});
for (const state of ["done", "cancelled", "declined", "superseded"]) test(`dedup excludes ${state} requests`, (t) => {
  const f = fixture(t); const a = f.create(); f.triage(a.requestId);
  f.raw.prepare("UPDATE tasks SET state = ? WHERE id = ?").run(state, a.requestId);
  assert.notEqual(f.create().requestId, a.requestId);
});
test("hop 1, 2 and 3 are allowed and 4 is refused without writes", async (t) => {
  const f = fixture(t); let grant = f.grant; let target = f.team; let id;
  for (let hop = 1; hop <= 3; hop++) {
    const result = f.create({ targetTeamId: target, kind: "clarify", ask: `Question ${hop}` }, grant);
    id = result.requestId; assert.equal(f.getTask(id).origin.hop, hop); assert.equal(f.meta(id).root_task_id, f.grant.taskId);
    await until(() => f.getTask(id).state === "in-review");
    f.raw.prepare("UPDATE tasks SET state = 'active' WHERE id = ?").run(id);
    grant = f.seed(id, f.getTask(id).ownerSeatId); target = f.secondTeam();
  }
  refused(f, () => f.create({ targetTeamId: target }, grant), "request chain is too deep");
});
test("the open request cap is ten", (t) => {
  const f = fixture(t); for (let i = 0; i < 10; i++) f.create({ ask: `Question ${i}` });
  refused(f, () => f.create({ ask: "Eleventh question" }), "too many requests");
});
test("the durable attempt creation cap is twenty even after closing requests", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 20; i++) { const { requestId } = f.create({ ask: `Question ${i}` }, f.grant, { maxRequestsPerRoot: 100, maxAttemptsPerRoot: 1000 }); f.triage(requestId, "decline"); }
  refused(f, () => f.create({ ask: "Twenty first question" }, f.grant, { maxRequestsPerRoot: 100, maxAttemptsPerRoot: 1000 }), "too many requests");
});
test("unreadable foreign team drafts cannot become context", (t) => {
  const f = fixture(t); const other = f.secondTeam(); const engagement = f.engage(other);
  const seat = f.raw.prepare("SELECT id FROM seats WHERE team_id = ? LIMIT 1").get(other).id;
  const source = f.seed(f.task({ engagementId: engagement, seatId: seat }), seat);
  const ref = f.artifact({ producer: source.attemptId }); refused(f, () => f.create({ contextRefs: [ref] }), "context is not readable");
});
test("text fields and expected response are sanitized before storage", (t) => {
  const f = fixture(t); const id = randomUUID(); const marker = "sk-syntheticvalue";
  const { requestId } = f.create({ subject: `Advice ${id}`, ask: `Read C:\\synthetic\\file ${marker}`,
    excerpt: "/synthetic/file", expectedResponse: { form: "answer", format: marker, acceptance: [id] } });
  const stored = JSON.stringify([f.getTask(requestId), f.meta(requestId), f.view(requestId)]);
  assert.equal(stored.includes(marker), false); assert.equal(stored.includes(id), false); assert.equal(stored.includes("synthetic/file"), false);
});
for (const operation of ["UPDATE ctr_messages SET text = 'changed'", "DELETE FROM ctr_messages"])
  test(`thread rejects ${operation.startsWith("UPDATE") ? "edits" : "deletions"}`, (t) => {
    const f = fixture(t); f.create(); refused(f, () => f.raw.exec(operation), "request messages are immutable");
  });
test("fresh migration ledger reaches six", (t) => {
  const f = fixture(t); assert.deepEqual(f.raw.prepare("SELECT version FROM migration_ledger ORDER BY version").all().map((r) => r.version), [1,2,3,4,5,6,7]);
  assert.deepEqual(f.raw.pragma("foreign_key_check"), []);
});
test("migration six upgrades a five database without changing tasks", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctr-migration-")); const storage = openStorage(":memory:");
  try {
    cpSync(migrationsDir, dir, { recursive: true }); rmSync(join(dir, "0006_ctr.sql")); rmSync(join(dir, "0007_ctr_waits.sql"));
    storage.migrate({ migrationsDir: dir, backupDir: null }); storage.raw.prepare("INSERT INTO projects VALUES ('p',1,'Preserved','artifact','unused','active')").run();
    cpSync(join(migrationsDir, "0006_ctr.sql"), join(dir, "0006_ctr.sql"));
    cpSync(join(migrationsDir, "0007_ctr_waits.sql"), join(dir, "0007_ctr_waits.sql"));
    const result = storage.migrate({ migrationsDir: dir, backupDir: join(dir, "backup") });
    assert.deepEqual(result.applied, [6,7]); assert.equal(storage.raw.prepare("SELECT name FROM projects").get().name, "Preserved");
  } finally { storage.close(); rmSync(dir, { recursive: true, force: true }); }
});
