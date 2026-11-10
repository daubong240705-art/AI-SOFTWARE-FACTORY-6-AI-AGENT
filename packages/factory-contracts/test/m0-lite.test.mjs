// M0-lite contracts (0.2.0): Team/Seat/Engagement, Task and Attempt lifecycles, Artifact versions,
// Approval, Effect records, usage/budget, nodes and the agent tool surface.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import fc from "fast-check";
import * as c from "@factory/contracts";

// ---- helpers --------------------------------------------------------------------------------------
function uuidv7() {
  const bytes = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i += 1) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const sha = (s = "x") => createHash("sha256").update(s).digest("hex");
const at = (offsetMs = 0) => new Date(Date.parse("2026-11-07T00:00:00.000Z") + offsetMs).toISOString();
const reach = (table, from) => {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) for (const next of table[queue.shift()]) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  return seen;
};
const edges = (table) => Object.entries(table).flatMap(([from, tos]) => tos.map((to) => [from, to]));
const walk = (table, start, choices) => {
  let state = start;
  const path = [state];
  for (const pick of choices) {
    const options = table[state];
    if (!options.length) break;
    state = options[pick % options.length];
    path.push(state);
  }
  return path;
};

// ---- ids ------------------------------------------------------------------------------------------
test("UUIDv7 ids are accepted by the id schema and recognised as v7", () => {
  for (let i = 0; i < 50; i += 1) {
    const id = uuidv7();
    assert.equal(c.idSchema.safeParse(id).success, true, id);
    assert.equal(c.uuidV7Schema.safeParse(id).success, true, id);
  }
  const v4 = randomUUID();
  assert.equal(c.idSchema.safeParse(v4).success, true);
  assert.equal(c.uuidV7Schema.safeParse(v4).success, false);
});

test("UUIDv7 ids sort by creation time", async () => {
  const a = uuidv7();
  await new Promise((r) => setTimeout(r, 3));
  assert.ok(a < uuidv7());
});

// ---- Task lifecycle ---------------------------------------------------------------------------------
test("the task transition table is closed and exhaustive over the state enum", () => {
  const states = c.taskStateSchema.options;
  assert.deepEqual(Object.keys(c.TASK_TRANSITIONS).sort(), [...states].sort());
  for (const [, to] of edges(c.TASK_TRANSITIONS)) assert.ok(states.includes(to));
  for (const from of states) for (const to of states)
    assert.equal(c.canTransitionTask(from, to), c.TASK_TRANSITIONS[from].includes(to));
});

test("cancelled, declined and superseded are terminal; done only becomes superseded", () => {
  for (const s of ["cancelled", "declined", "superseded"]) assert.deepEqual(c.TASK_TRANSITIONS[s], []);
  assert.deepEqual(c.TASK_TRANSITIONS.done, ["superseded"]);
});

test("every task state is reachable from draft, and done is unreachable without review", () => {
  assert.deepEqual([...reach(c.TASK_TRANSITIONS, "draft")].sort(), [...c.taskStateSchema.options].sort());
  const withoutReview = Object.fromEntries(
    Object.entries(c.TASK_TRANSITIONS).map(([k, v]) => [k, v.filter((t) => t !== "in-review")]),
  );
  assert.equal(reach(withoutReview, "draft").has("done"), false);
});

test("property: any random walk over allowed task transitions stays valid", () => {
  fc.assert(
    fc.property(fc.array(fc.nat(50), { maxLength: 60 }), (choices) => {
      const path = walk(c.TASK_TRANSITIONS, "draft", choices);
      for (let i = 1; i < path.length; i += 1) assert.ok(c.canTransitionTask(path[i - 1], path[i]));
    }),
    { numRuns: 500 },
  );
});

test("the Execution Gate cannot be skipped by accident: awaiting-go needs requiresGo", () => {
  const base = taskExample();
  assert.equal(c.taskSchema.safeParse({ ...base, state: "awaiting-go" }).success, true);
  assert.equal(c.taskSchema.safeParse({ ...base, state: "awaiting-go", gate: { requiresGo: false } }).success, false);
});

function taskExample(over = {}) {
  return {
    id: uuidv7(), projectId: uuidv7(), revision: 1, code: "DEV-0042", title: "Add parser", goal: "Parse durations",
    brief: "See README", parentTaskId: null, engagementId: uuidv7(), ownerSeatId: uuidv7(),
    origin: { kind: "operator" }, state: "ready", holds: [], disposition: "active",
    requiredCapabilities: ["code.typescript"], placement: "repo-bound", sideEffect: "artifact",
    reviewPolicy: "human-final", gate: { requiresGo: true }, acceptance: ["tests pass"], inputs: [], dependsOn: [],
    ...over,
  };
}

test("task schema rejects self parent, self dependency, duplicates, done with holds", () => {
  const id = uuidv7();
  const t = taskExample({ id });
  assert.equal(c.taskSchema.safeParse(t).success, true);
  assert.equal(c.taskSchema.safeParse({ ...t, parentTaskId: id }).success, false);
  assert.equal(c.taskSchema.safeParse({ ...t, dependsOn: [id] }).success, false);
  const d = uuidv7();
  assert.equal(c.taskSchema.safeParse({ ...t, dependsOn: [d, d] }).success, false);
  const hold = { kind: "input", reason: "waiting", ref: null, since: at(), needsAction: false };
  assert.equal(c.taskSchema.safeParse({ ...t, state: "done", holds: [hold] }).success, false);
  assert.equal(c.taskSchema.safeParse({ ...t, code: "bad code" }).success, false);
  assert.equal(c.taskSchema.safeParse({ ...t, unknownKey: 1 }).success, false);
});

test("a cross-team request is a Task with origin, kind and hop limit", () => {
  const ok = taskExample({ origin: { kind: "cross-team", requesterTaskId: uuidv7(), requestKind: "consult", hop: 1 } });
  assert.equal(c.taskSchema.safeParse(ok).success, true);
  assert.equal(c.taskSchema.safeParse({ ...ok, origin: { ...ok.origin, hop: 4 } }).success, false);
  assert.equal(c.taskSchema.safeParse({ ...ok, ownerSeatId: null }).success, false);
  assert.equal(c.taskSchema.safeParse({ ...ok, ownerSeatId: null, state: "proposed" }).success, true);
});

test("unspecified placement and side effect default to the most restrictive values", () => {
  assert.equal(c.DEFAULT_PLACEMENT, "node-bound");
  assert.equal(c.DEFAULT_SIDE_EFFECT, "external-irreversible");
});

// ---- display status (W-06) --------------------------------------------------------------------------
const display = (over) =>
  c.deriveDisplayStatus({ state: "active", holds: [], disposition: "active", reviewPolicy: "human-final", liveAttempt: null, ...over });
const hold = (kind, needsAction = false) => ({ kind, needsAction });

test("display status follows the five-state projection", () => {
  assert.equal(display({ state: "done" }).status, "completed");
  assert.equal(display({ state: "cancelled" }).status, "closed");
  assert.equal(display({ state: "failed" }).status, "blocked");
  assert.equal(display({ state: "awaiting-go" }).status, "approval-required");
  assert.equal(display({ state: "in-review" }).status, "approval-required");
  assert.equal(display({ state: "in-review", reviewPolicy: "automatic" }).status, "waiting");
  assert.equal(display({ liveAttempt: "running" }).status, "running");
  assert.equal(display({ liveAttempt: "waiting-input" }).status, "running");
  assert.equal(display({ liveAttempt: "unknown" }).status, "blocked");
  assert.equal(display({ liveAttempt: "reconciling" }).status, "blocked");
  assert.equal(display({}).status, "waiting");
  assert.equal(display({ holds: [hold("dependency")] }).status, "waiting");
  assert.equal(display({ holds: [hold("capacity", true)] }).status, "blocked");
  assert.equal(display({ holds: [hold("permission", true)] }).status, "blocked");
  assert.equal(display({ holds: [hold("decision")] }).status, "approval-required");
  assert.equal(display({ disposition: "parked" }).status, "blocked");
});

test("property: display status is total and respects terminal states and blocking holds", () => {
  const holdArb = fc.record({ kind: fc.constantFrom(...c.holdKindSchema.options), needsAction: fc.boolean() });
  fc.assert(
    fc.property(
      fc.constantFrom(...c.taskStateSchema.options),
      fc.array(holdArb, { maxLength: 4 }),
      fc.constantFrom("active", "parked", "archived"),
      fc.constantFrom(...c.reviewPolicySchema.options),
      fc.constantFrom(null, ...c.attemptStateSchema.options),
      (state, holds, disposition, reviewPolicy, liveAttempt) => {
        const r = c.deriveDisplayStatus({ state, holds, disposition, reviewPolicy, liveAttempt });
        assert.ok(["waiting", "running", "blocked", "approval-required", "completed", "closed"].includes(r.status));
        assert.equal(r.status === "completed", state === "done");
        assert.equal(r.status === "closed", ["cancelled", "declined", "superseded"].includes(state));
        if (state === "active" && disposition === "active" && holds.some((h) => h.needsAction))
          assert.equal(r.status, "blocked");
      },
    ),
    { numRuns: 1000 },
  );
});

// ---- Attempt lifecycle ------------------------------------------------------------------------------
test("attempt states split cleanly into terminal and live", () => {
  const all = c.attemptStateSchema.options;
  for (const s of all) assert.notEqual(c.TERMINAL_ATTEMPT_STATES.has(s), c.LIVE_ATTEMPT_STATES.has(s));
  assert.equal(c.TERMINAL_ATTEMPT_STATES.size + c.LIVE_ATTEMPT_STATES.size, all.length);
  for (const s of ["lease-expired", "unknown", "reconciling"]) assert.equal(c.isLiveAttempt(s), true, s);
  for (const s of ["succeeded", "failed", "stopped", "parked", "requeued"]) assert.equal(c.isLiveAttempt(s), false, s);
});

test("every attempt state is reachable from queued and terminal states have no exits", () => {
  assert.deepEqual([...reach(c.ATTEMPT_TRANSITIONS, "queued")].sort(), [...c.attemptStateSchema.options].sort());
  for (const s of c.TERMINAL_ATTEMPT_STATES) assert.deepEqual(c.ATTEMPT_TRANSITIONS[s], []);
});

test("an uncertain outcome can only be resolved through reconciliation", () => {
  assert.deepEqual(c.ATTEMPT_TRANSITIONS.unknown, ["reconciling"]);
  assert.equal(c.canTransitionAttempt("unknown", "requeued"), false);
  assert.equal(c.canTransitionAttempt("unknown", "running"), false);
  const withoutReconcile = { ...c.ATTEMPT_TRANSITIONS, reconciling: [] };
  assert.equal(reach(withoutReconcile, "queued").has("requeued"), true); // via lease-expired only
  assert.deepEqual(c.ATTEMPT_TRANSITIONS["lease-expired"], ["unknown", "requeued"]);
});

test("property: random walks over attempt transitions never leave the table and always end", () => {
  fc.assert(
    fc.property(fc.array(fc.nat(50), { minLength: 40, maxLength: 120 }), (choices) => {
      const path = walk(c.ATTEMPT_TRANSITIONS, "queued", choices);
      for (let i = 1; i < path.length; i += 1) assert.ok(c.canTransitionAttempt(path[i - 1], path[i]));
    }),
    { numRuns: 500 },
  );
});

test("the attempt graph has no cycle except running <-> waiting-input", () => {
  const cyc = [];
  const color = new Map();
  const visit = (node, stack) => {
    color.set(node, 1);
    for (const next of c.ATTEMPT_TRANSITIONS[node]) {
      if (color.get(next) === 1) cyc.push([...stack, node, next].join(">"));
      else if (!color.has(next)) visit(next, [...stack, node]);
    }
    color.set(node, 2);
  };
  visit("queued", []);
  assert.ok(cyc.every((p) => p.includes("running") && p.includes("waiting-input")), cyc.join("; "));
  assert.ok(cyc.length > 0);
});

test("property: requeue after lease expiry is allowed only for portable/repo-bound work without outside effects", () => {
  fc.assert(
    fc.property(fc.constantFrom(...c.placementSchema.options), fc.constantFrom(...c.sideEffectSchema.options), (placement, sideEffect) => {
      const expected = ["portable", "repo-bound"].includes(placement) && ["none", "artifact"].includes(sideEffect);
      assert.equal(c.canRequeueAfterLeaseExpiry({ placement, sideEffect }), expected);
    }),
  );
  assert.equal(c.canRequeueAfterLeaseExpiry({ placement: c.DEFAULT_PLACEMENT, sideEffect: c.DEFAULT_SIDE_EFFECT }), false);
});

function attemptExample(over = {}) {
  const projectId = uuidv7();
  const runId = uuidv7();
  return {
    id: uuidv7(),
    identity: { projectId, runId, assignmentId: uuidv7(), epoch: 1, leaseId: uuidv7() },
    taskId: uuidv7(), revision: 1, state: "running", outcome: "known", nodeId: uuidv7(), runtime: "native-opencode",
    provider: "9router", model: "gpt-6.1-sol", effort: "medium", leaseExpiresAt: at(60_000), startedAt: at(), endedAt: null,
    ...over,
  };
}

test("attempt schema enforces lease, node and outcome consistency", () => {
  assert.equal(c.attemptSchema.safeParse(attemptExample()).success, true);
  assert.equal(c.attemptSchema.safeParse(attemptExample({ leaseExpiresAt: null })).success, false);
  assert.equal(c.attemptSchema.safeParse(attemptExample({ state: "queued", nodeId: uuidv7(), leaseExpiresAt: null })).success, false);
  assert.equal(c.attemptSchema.safeParse(attemptExample({ state: "queued", nodeId: null, leaseExpiresAt: null })).success, true);
  assert.equal(c.attemptSchema.safeParse(attemptExample({ state: "unknown", leaseExpiresAt: null })).success, false);
  assert.equal(c.attemptSchema.safeParse(attemptExample({ state: "unknown", outcome: "unknown", leaseExpiresAt: null })).success, true);
  assert.equal(c.attemptSchema.safeParse(attemptExample({ state: "succeeded", leaseExpiresAt: null })).success, false);
  assert.equal(c.attemptSchema.safeParse(attemptExample({ state: "succeeded", leaseExpiresAt: null, endedAt: at(5) })).success, true);
});

test("reasoning effort max and ultra cannot be represented", () => {
  for (const effort of ["max", "ultra"]) assert.equal(c.reasoningEffortSchema.safeParse(effort).success, false);
  for (const effort of ["low", "medium", "high", "xhigh"]) assert.equal(c.reasoningEffortSchema.safeParse(effort).success, true);
});

// ---- Artifact versions ------------------------------------------------------------------------------
function artifactExample(over = {}) {
  const artifactId = uuidv7();
  return {
    projectId: uuidv7(), artifactId, version: 2, kind: "data-model", title: "ERD", mediaType: "text/markdown",
    contentHash: sha("erd"), sizeBytes: 1200, status: "draft", abstract: { l0: "ERD v2", l1: null },
    producedBy: null, inputs: [], supersedes: { artifactId, version: 1 }, visibility: "team-draft", createdAt: at(),
    ...over,
  };
}

test("document status moves forward only; approved can only be superseded", () => {
  assert.equal(c.canTransitionArtifact("draft", "in-review"), true);
  assert.equal(c.canTransitionArtifact("reviewed", "approved"), true);
  assert.equal(c.canTransitionArtifact("approved", "draft"), false);
  assert.equal(c.canTransitionArtifact("approved", "rejected"), false);
  assert.deepEqual(c.ARTIFACT_TRANSITIONS.approved, ["superseded"]);
  for (const s of ["superseded", "rejected", "withdrawn"]) assert.deepEqual(c.ARTIFACT_TRANSITIONS[s], []);
  assert.deepEqual([...reach(c.ARTIFACT_TRANSITIONS, "draft")].sort(), [...c.artifactStatusSchema.options].sort());
});

test("only approved versions are execution grade", () => {
  for (const s of c.artifactStatusSchema.options) assert.equal(c.isExecutionGrade(s), s === "approved");
});

test("artifact version schema guards supersession, hashes and visibility", () => {
  const ok = artifactExample();
  assert.equal(c.artifactVersionSchema.safeParse(ok).success, true);
  assert.equal(c.artifactVersionSchema.safeParse({ ...ok, contentHash: "abc" }).success, false);
  assert.equal(c.artifactVersionSchema.safeParse({ ...ok, supersedes: { artifactId: uuidv7(), version: 1 } }).success, false);
  assert.equal(c.artifactVersionSchema.safeParse({ ...ok, supersedes: { artifactId: ok.artifactId, version: 2 } }).success, false);
  assert.equal(c.artifactVersionSchema.safeParse({ ...ok, status: "approved", visibility: "team-draft" }).success, false);
  assert.equal(c.artifactVersionSchema.safeParse({ ...ok, status: "approved", visibility: "project" }).success, true);
});

test("a superseded version marks exactly its dependants stale", () => {
  const sup = { artifactId: uuidv7(), version: 2 };
  const other = { artifactId: uuidv7(), version: 2 };
  const stale = c.staleDependants(sup, [
    { taskId: "b", inputs: [sup] },
    { taskId: "a", inputs: [sup, other] },
    { taskId: "c", inputs: [other] },
    { taskId: "d", inputs: [{ artifactId: sup.artifactId, version: 1 }] },
  ]);
  assert.deepEqual(stale, ["a", "b"]);
});

// ---- Approval -------------------------------------------------------------------------------------
function approvalExample(over = {}) {
  return {
    id: uuidv7(), projectId: uuidv7(), revision: 1, kind: "question", taskId: null, subject: "Retention period",
    summary: "How long should audit rows be kept?",
    options: [{ id: "1y", label: "1 year", consequence: "less storage" }, { id: "2y", label: "2 years", consequence: "more storage" }],
    recommendation: "1y", impactIfWaiting: "DEV-0010 waits", context: { refs: [], digest: sha("ctx") },
    approver: "operator", requestedAt: at(), expiresAt: at(3 * 86_400_000), state: "pending", outcome: null, appliedByCommandId: null,
    ...over,
  };
}
const decided = (state, extra = {}) =>
  approvalExample({ state, outcome: { optionId: "1y", actorId: uuidv7(), decidedAt: at(10), comment: "ok" }, ...extra });

test("approval invariants: outcome, recommendation, expiry, exactly-once application", () => {
  assert.equal(c.approvalSchema.safeParse(approvalExample()).success, true);
  assert.equal(c.approvalSchema.safeParse(decided("approved")).success, true);
  assert.equal(c.approvalSchema.safeParse(approvalExample({ state: "approved" })).success, false); // decided without outcome
  assert.equal(c.approvalSchema.safeParse(decided("pending")).success, false); // outcome while pending
  assert.equal(c.approvalSchema.safeParse(approvalExample({ recommendation: "5y" })).success, false);
  assert.equal(c.approvalSchema.safeParse(approvalExample({ expiresAt: at(-1) })).success, false);
  assert.equal(c.approvalSchema.safeParse(decided("applied")).success, false); // applied needs the command id
  assert.equal(c.approvalSchema.safeParse(decided("applied", { appliedByCommandId: uuidv7() })).success, true);
  assert.equal(c.approvalSchema.safeParse(decided("approved", { appliedByCommandId: uuidv7() })).success, false);
  assert.equal(c.approvalSchema.safeParse(approvalExample({ kind: "start-gate" })).success, false); // gate needs a task
  assert.equal(c.approvalSchema.safeParse(approvalExample({ kind: "start-gate", taskId: uuidv7() })).success, true);
  assert.equal(c.approvalSchema.safeParse(approvalExample({ kind: "budget" })).success, false); // not in M0-lite
});

test("an approval never resurrects: decided, expired and withdrawn states are final", () => {
  for (const s of ["rejected", "changes-requested", "superseded", "expired", "withdrawn", "applied"])
    assert.deepEqual(c.APPROVAL_TRANSITIONS[s], [], s);
  assert.equal(c.canTransitionApproval("rejected", "approved"), false);
  assert.equal(c.canTransitionApproval("approved", "applied"), true);
  assert.equal(c.canTransitionApproval("pending", "applied"), false); // must be approved first
  assert.deepEqual([...reach(c.APPROVAL_TRANSITIONS, "requested")].sort(), [...c.approvalStateSchema.options].sort());
});

test("expiry never approves and context changes make an approval stale", () => {
  const p = approvalExample();
  assert.equal(c.isExpired(p, new Date(at(1000))), false);
  assert.equal(c.isExpired(p, new Date(at(4 * 86_400_000))), true);
  assert.equal(c.isExpired(decided("approved"), new Date(at(40 * 86_400_000))), false); // decided stays decided
  assert.equal(c.isContextStale(p, sha("ctx")), false);
  assert.equal(c.isContextStale(p, sha("changed")), true);
});

// ---- Effects --------------------------------------------------------------------------------------
function effectExample(over = {}) {
  return {
    id: uuidv7(), projectId: uuidv7(),
    attempt: { projectId: uuidv7(), runId: uuidv7(), assignmentId: uuidv7(), epoch: 1, leaseId: uuidv7() },
    kind: "git.push-branch", idempotencyKey: "attempt-1:push:factory/dev-0042-1", target: { remote: "origin", branch: "factory/dev-0042-1" },
    state: "pending", error: null, createdAt: at(), completedAt: null, ...over,
  };
}

test("effect records: unknown is never retried automatically and main is never pushed", () => {
  assert.equal(c.effectRecordSchema.safeParse(effectExample()).success, true);
  assert.equal(c.effectRecordSchema.safeParse(effectExample({ target: { remote: "origin", branch: "main" } })).success, false);
  assert.equal(c.effectRecordSchema.safeParse(effectExample({ target: { remote: "origin", branch: "refs/heads/master" } })).success, false);
  assert.equal(c.effectRecordSchema.safeParse(effectExample({ state: "failed", completedAt: at(5) })).success, false); // needs error
  assert.equal(c.effectRecordSchema.safeParse(effectExample({ state: "failed", completedAt: at(5), error: "rejected" })).success, true);
  assert.equal(c.effectRecordSchema.safeParse(effectExample({ state: "done" })).success, false); // needs completedAt
  assert.equal(c.mayAutoRetryEffect("unknown"), false);
  assert.equal(c.mayAutoRetryEffect("pending"), false);
  assert.equal(c.mayAutoRetryEffect("failed"), true);
  assert.deepEqual(c.EFFECT_TRANSITIONS.unknown, ["done", "failed"]);
  assert.equal(c.canTransitionEffect("unknown", "pending"), false);
});

// ---- Usage and budget -----------------------------------------------------------------------------
test("usage may be absent and cost is never silently zero", () => {
  const base = {
    id: uuidv7(), projectId: uuidv7(), taskId: uuidv7(), conversationId: null,
    attempt: { projectId: uuidv7(), runId: uuidv7(), assignmentId: uuidv7(), epoch: 1, leaseId: uuidv7() },
    provider: "9router", model: "gpt-6-luna", effort: "low", recordedAt: at(),
  };
  const usage = { inputTokens: 55176, cachedInputTokens: 39040, outputTokens: 537, reasoningOutputTokens: 0 };
  assert.equal(c.usageRecordSchema.safeParse({ ...base, usage, cost: { kind: "unknown", reason: "no price list" } }).success, true);
  assert.equal(c.usageRecordSchema.safeParse({ ...base, usage: null, cost: { kind: "unknown", reason: "not reported" } }).success, true);
  assert.equal(c.usageRecordSchema.safeParse({ ...base, usage, cost: { kind: "known", amount: 0.12, currency: "USD" } }).success, true);
  assert.equal(c.usageRecordSchema.safeParse({ ...base, usage, cost: 0 }).success, false);
  assert.equal(c.usageRecordSchema.safeParse({ ...base, effort: "ultra", usage, cost: { kind: "unknown", reason: "x" } }).success, false);
  assert.equal(c.billableTokens(usage), 55713);
});

test("budget scopes validate their reference and verdicts are monotonic", () => {
  const taskId = uuidv7();
  const mk = (over) => ({ id: uuidv7(), projectId: uuidv7(), scope: "task", scopeRef: taskId, limitTokens: 100_000, warnAtPercent: 80, ...over });
  assert.equal(c.budgetSchema.safeParse(mk()).success, true);
  assert.equal(c.budgetSchema.safeParse(mk({ scope: "day", scopeRef: "2026-11-07" })).success, true);
  assert.equal(c.budgetSchema.safeParse(mk({ scope: "day", scopeRef: "today" })).success, false);
  assert.equal(c.budgetSchema.safeParse(mk({ scopeRef: "2026-11-07" })).success, false);
  assert.equal(c.budgetSchema.safeParse(mk({ limitTokens: 0 })).success, false);
  const b = { limitTokens: 1000, warnAtPercent: 80 };
  assert.deepEqual([c.evaluateBudget(b, 0), c.evaluateBudget(b, 799), c.evaluateBudget(b, 800), c.evaluateBudget(b, 999), c.evaluateBudget(b, 1000), c.evaluateBudget(b, 5000)], ["ok", "ok", "warn", "warn", "exceeded", "exceeded"]);
  const rank = { ok: 0, warn: 1, exceeded: 2 };
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 1e9 }), fc.integer({ min: 1, max: 99 }), fc.nat(2e9), fc.nat(2e9), (limitTokens, warnAtPercent, x, y) => {
      const [lo, hi] = x <= y ? [x, y] : [y, x];
      assert.ok(rank[c.evaluateBudget({ limitTokens, warnAtPercent }, lo)] <= rank[c.evaluateBudget({ limitTokens, warnAtPercent }, hi)]);
    }),
    { numRuns: 1000 },
  );
  assert.equal(c.canReserve({ limitTokens: 1000 }, 900, 100), true);
  assert.equal(c.canReserve({ limitTokens: 1000 }, 900, 101), false);
});

// ---- Nodes ------------------------------------------------------------------------------------------
function nodeExample(over = {}) {
  const now = at();
  return {
    id: uuidv7(), revision: 1, name: "wsl-local", platform: "linux", trust: "server-sandboxed", state: "online",
    slots: { total: 2, used: 0 }, runtimes: ["native-opencode", "api-agent"],
    capabilities: [
      { id: "code.typescript", level: "verified", freshness: { observedAt: now, staleAfter: at(3_600_000) } },
      { id: "runtime.opencode", level: "observed", freshness: { observedAt: now, staleAfter: at(3_600_000) } },
      { id: "media.ffmpeg", level: "declared", freshness: null },
    ],
    lastHeartbeatAt: now, ...over,
  };
}
const NOW = new Date(at(1000));

test("a node only offers capabilities that are verified AND fresh", () => {
  const node = nodeExample();
  assert.equal(c.nodeSchema.safeParse(node).success, true);
  assert.deepEqual([...c.usableCapabilities(node, NOW)].sort(), ["code.typescript", "runtime.opencode"]);
  assert.deepEqual([...c.usableCapabilities(node, new Date(at(2 * 3_600_000)))], []); // everything went stale
  assert.deepEqual(c.nodeCanTake(node, ["code.typescript"], NOW), { ok: true });
  assert.equal(c.nodeCanTake(node, ["media.ffmpeg"], NOW).ok, false); // declared is not enough
  assert.match(c.nodeCanTake(node, ["db.schema"], NOW).reason, /missing verified capability/);
});

test("nodes refuse work when draining, offline, quarantined or full", () => {
  for (const state of ["draining", "offline", "lost", "quarantined"])
    assert.equal(c.nodeCanTake(nodeExample({ state }), [], NOW).ok, false, state);
  assert.equal(c.nodeCanTake(nodeExample({ slots: { total: 2, used: 2 } }), [], NOW).ok, false);
  assert.equal(c.nodeCanTake(nodeExample({ state: "busy", slots: { total: 2, used: 1 } }), [], NOW).ok, true);
});

test("node schema rejects impossible nodes", () => {
  assert.equal(c.nodeSchema.safeParse(nodeExample({ slots: { total: 1, used: 2 } })).success, false);
  assert.equal(c.nodeSchema.safeParse(nodeExample({ trust: "quarantined", state: "online" })).success, false);
  const dup = nodeExample().capabilities[0];
  assert.equal(c.nodeSchema.safeParse(nodeExample({ capabilities: [dup, dup] })).success, false);
  assert.equal(c.nodeSchema.safeParse(nodeExample({ capabilities: [{ id: "code.typescript", level: "verified", freshness: null }] })).success, false);
  for (const bad of ["Code.TS", "code", "code..x", "code.", "9code.x"]) assert.equal(c.capabilityIdSchema.safeParse(bad).success, false, bad);
  for (const good of ["code.typescript", "node.os.linux", "runtime.opencode", "model.context-128k"]) assert.equal(c.capabilityIdSchema.safeParse(good).success, true, good);
});

test("property: more verified capabilities never make a node less able to take work", () => {
  const ids = ["code.a", "code.b", "code.c", "code.d"];
  const cap = (id) => ({ id, level: "verified", freshness: { observedAt: at(), staleAfter: at(3_600_000) } });
  fc.assert(
    fc.property(fc.subarray(ids), fc.subarray(ids), fc.subarray(ids), (have, extra, need) => {
      const small = nodeExample({ capabilities: have.map(cap) });
      const union = [...new Set([...have, ...extra])];
      const big = nodeExample({ capabilities: union.map(cap) });
      if (c.nodeCanTake(small, need, NOW).ok) assert.ok(c.nodeCanTake(big, need, NOW).ok);
    }),
    { numRuns: 500 },
  );
});

// ---- Org --------------------------------------------------------------------------------------------
test("seats and engagements", () => {
  const seat = { id: uuidv7(), teamId: uuidv7(), revision: 1, name: "Developer", role: "Backend developer", profile: { id: uuidv7(), revision: 1 }, runtime: "native-opencode", slots: 1, nodePolicy: "elastic", dedicatedNodeId: null, isLead: false };
  assert.equal(c.seatSchema.safeParse(seat).success, true);
  assert.equal(c.seatSchema.safeParse({ ...seat, nodePolicy: "dedicated" }).success, false);
  assert.equal(c.seatSchema.safeParse({ ...seat, nodePolicy: "dedicated", dedicatedNodeId: uuidv7() }).success, true);
  assert.equal(c.seatSchema.safeParse({ ...seat, dedicatedNodeId: uuidv7() }).success, false);
  assert.equal(c.seatSchema.safeParse({ ...seat, slots: 0 }).success, false);
  const engagement = { id: uuidv7(), projectId: uuidv7(), teamId: uuidv7(), revision: 1, priority: 50, maxConcurrent: 2, state: "active", createdAt: at() };
  assert.equal(c.engagementSchema.safeParse(engagement).success, true);
  assert.equal(c.engagementSchema.safeParse({ ...engagement, maxConcurrent: 0 }).success, false);
  const team = { id: uuidv7(), revision: 1, name: "Software", charter: "Build features", pack: { key: "software-team", version: "1.0.0" }, lifecycle: "active" };
  assert.equal(c.teamSchema.safeParse(team).success, true);
  assert.equal(c.teamSchema.safeParse({ ...team, pack: null }).success, true);
});

// ---- Agent tool surface -------------------------------------------------------------------------------
const proposed = (over = {}) => ({
  title: "Implement parser", goal: "Parse durations", acceptance: ["tests pass"], expectedFiles: 2,
  requiredCapabilities: ["code.typescript"], placement: "repo-bound", sideEffect: "artifact", reviewPolicy: "human-final", dependsOn: [], ...over,
});

test("the tool surface is the agreed M0-lite set", () => {
  assert.deepEqual([...c.MCP_TOOL_NAMES].sort(), ["decision.request", "handoff.submit", "knowledge.get", "knowledge.search", "output.register", "project.briefing", "request.create", "request.get", "request.reply", "skill.get", "task.progress", "task.propose"]);
});

test("task.propose keeps the V1 plan rules: at most 10 tasks, dependencies point backwards", () => {
  const plan = (tasks, extra = {}) => ({ tasks, ...extra });
  assert.equal(c.taskProposeInputSchema.safeParse(plan([proposed(), proposed({ dependsOn: [0] })])).success, true);
  assert.equal(c.taskProposeInputSchema.safeParse(plan([proposed({ dependsOn: [0] })])).success, false); // itself
  assert.equal(c.taskProposeInputSchema.safeParse(plan([proposed({ dependsOn: [1] }), proposed()])).success, false); // forward
  assert.equal(c.taskProposeInputSchema.safeParse(plan([proposed(), proposed({ dependsOn: [0, 0] })])).success, false);
  assert.equal(c.taskProposeInputSchema.safeParse(plan(Array.from({ length: 10 }, () => proposed()))).success, true);
  assert.equal(c.taskProposeInputSchema.safeParse(plan(Array.from({ length: 11 }, () => proposed()))).success, false);
  assert.equal(c.taskProposeInputSchema.safeParse(plan([])).success, false);
  assert.equal(c.taskProposeInputSchema.safeParse(plan([proposed({ acceptance: [] })])).success, false);
});

test("property: any accepted plan has only backward dependencies", () => {
  const taskArb = (index) =>
    fc.record({ dependsOn: fc.uniqueArray(fc.integer({ min: 0, max: 9 }), { maxLength: 4 }) }).map(({ dependsOn }) => proposed({ dependsOn }));
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 10 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => taskArb(i)))), (tasks) => {
      const r = c.taskProposeInputSchema.safeParse({ tasks });
      const backward = tasks.every((t, i) => t.dependsOn.every((d) => d < i));
      assert.equal(r.success, backward);
    }),
    { numRuns: 1000 },
  );
});

test("agent tool inputs cannot name their own identity or smuggle extra keys", () => {
  const withId = { ...proposed(), attemptId: uuidv7() };
  assert.equal(c.taskProposeInputSchema.safeParse({ tasks: [withId] }).success, false);
  assert.equal(c.taskProgressInputSchema.safeParse({ summary: "x", projectId: uuidv7() }).success, false);
  assert.equal(c.taskProgressInputSchema.safeParse({ summary: "x", percent: 101 }).success, false);
  assert.equal(c.taskProgressInputSchema.safeParse({ summary: "x", percent: 40 }).success, true);
});

test("output.register names bytes by hash; decision.request needs real options", () => {
  const out = { title: "Report", kind: "research-report", mediaType: "text/markdown", contentHash: sha("r"), sizeBytes: 10, abstractL0: "short", inputs: [] };
  assert.equal(c.outputRegisterInputSchema.safeParse(out).success, true);
  assert.equal(c.outputRegisterInputSchema.safeParse({ ...out, contentHash: "nothash" }).success, false);
  assert.equal(c.outputRegisterInputSchema.safeParse({ ...out, kind: "movie" }).success, false);
  const q = { subject: "Retention", summary: "How long?", options: [{ id: "a", label: "A", consequence: "x" }, { id: "b", label: "B", consequence: "y" }], impactIfWaiting: "waits" };
  assert.equal(c.decisionRequestInputSchema.safeParse(q).success, true);
  assert.equal(c.decisionRequestInputSchema.safeParse({ ...q, options: [q.options[0]] }).success, false);
  assert.equal(c.decisionRequestInputSchema.safeParse({ ...q, recommendation: "z" }).success, false);
  assert.equal(c.handoffSubmitInputSchema.safeParse({ done: "d", remaining: "", checks: [{ name: "tests", result: "pass" }] }).success, true);
});

test("a plan without a test capability must explain why (V1 rule)", () => {
  const noTest = { tasks: [proposed()] };
  assert.equal(c.planNeedsTestingReason(noTest), true);
  assert.equal(c.planNeedsTestingReason({ ...noTest, testingReason: "docs only" }), false);
  assert.equal(c.planNeedsTestingReason({ tasks: [proposed({ requiredCapabilities: ["test.unit"] })] }), false);
});

// ---- Commands and events (wire compatibility) -----------------------------------------------------
const cmd = (type, payload) => ({ apiVersion: 1, commandId: uuidv7(), projectId: uuidv7(), type, payload });

test("the original 14 commands remain and 6 are added without removing any", () => {
  const original = ["projects.create", "projects.update", "agents.configure", "conversations.create", "chat.send", "drafts.save", "work.create", "work.assign", "work.transition", "decisions.answer", "reviews.submit", "runs.cancel", "runs.reconcile", "outputs.register"];
  const added = ["engagements.create", "tasks.create", "tasks.transition", "tasks.release", "approvals.decide", "budgets.set"];
  for (const t of [...original, ...added]) assert.ok(c.FOUNDATION_COMMANDS.includes(t), t);
  for (const t of ["artifacts.transition", "artifacts.share", "artifacts.clear-stale"]) assert.ok(c.FOUNDATION_COMMANDS.includes(t), t);
  assert.ok(c.FOUNDATION_COMMANDS.includes("dossier.refresh"));
  for (const t of ["workflows.create", "workflows.start", "workflows.pause", "workflows.resume", "workflows.cancel"]) assert.ok(c.FOUNDATION_COMMANDS.includes(t), t);
  assert.equal(c.FOUNDATION_COMMANDS.length, 36);
  assert.equal(new Set(c.FOUNDATION_COMMANDS).size, 36);
});

test("tasks.create applies the restrictive defaults and keeps the gate on", () => {
  const parsed = c.commandSchema.parse(
    cmd("tasks.create", {
      taskId: uuidv7(), code: "DEV-0001", title: "T", goal: "G", brief: "B", parentTaskId: null, engagementId: null, ownerSeatId: null,
      requiredCapabilities: [], acceptance: ["x"], inputs: [], dependsOn: [],
    }),
  );
  assert.equal(parsed.payload.placement, "node-bound");
  assert.equal(parsed.payload.sideEffect, "external-irreversible");
  assert.equal(parsed.payload.reviewPolicy, "human-final");
  assert.equal(parsed.payload.requiresGo, true);
});

test("new commands never accept an actor, grant or identity from the browser", () => {
  const release = cmd("tasks.release", { expectedRevision: 1, taskId: uuidv7() });
  assert.equal(c.commandSchema.safeParse(release).success, true);
  assert.equal(c.commandSchema.safeParse({ ...release, payload: { ...release.payload, actorId: uuidv7() } }).success, false);
  const decide = cmd("approvals.decide", { expectedRevision: 1, approvalId: uuidv7(), contextDigest: sha("c"), optionId: "1y", comment: "" });
  assert.equal(c.commandSchema.safeParse(decide).success, true);
  assert.equal(c.commandSchema.safeParse({ ...decide, payload: { ...decide.payload, contextDigest: "short" } }).success, false);
  assert.equal(c.commandSchema.safeParse(cmd("engagements.create", { engagementId: uuidv7(), teamId: uuidv7(), priority: 101, maxConcurrent: 1 })).success, false);
  assert.equal(c.commandSchema.safeParse(cmd("budgets.set", { budgetId: uuidv7(), expectedRevision: null, scope: "day", scopeRef: "2026-11-07", limitTokens: 200000, warnAtPercent: 80 })).success, true);
  assert.equal(c.commandSchema.safeParse(cmd("tasks.transition", { expectedRevision: 1, taskId: uuidv7(), to: "waiting" })).success, false); // not a task state
  assert.equal(c.commandSchema.safeParse(cmd("tasks.transition", { expectedRevision: 1, taskId: uuidv7(), to: "in-review" })).success, true);
});

test("host capabilities accept new command types and events can announce the new entities", () => {
  assert.equal(c.hostCapabilitiesSchema.safeParse({ apiVersion: 1, hostId: uuidv7(), commands: ["tasks.create", "chat.send"] }).success, true);
  const projectId = uuidv7();
  const cursor = (n) => ({ epoch: uuidv7(), sequence: String(n) });
  const epoch = uuidv7();
  const event = {
    apiVersion: 1, eventId: uuidv7(), projectId, occurredAt: at(), cursor: { epoch, sequence: "6" }, previousCursor: { epoch, sequence: "5" },
    causationId: uuidv7(), rootCausationId: uuidv7(),
    payload: { type: "entity.changed", entity: { kind: "task", id: uuidv7(), revision: 2 } },
  };
  assert.equal(c.eventSchema.safeParse(event).success, true);
  for (const kind of ["team", "seat", "engagement", "attempt", "approval", "artifact-version", "effect", "budget", "node"])
    assert.equal(c.eventSchema.safeParse({ ...event, payload: { type: "entity.changed", entity: { kind, id: uuidv7(), revision: 1 } } }).success, true, kind);
  assert.equal(cursor(1).sequence, "1");
});

test("usage may come from a conversation turn, but never from nothing", () => {
  const unknownCost = { kind: "unknown", reason: "no price list" };
  const chat = { id: uuidv7(), projectId: uuidv7(), taskId: null, attempt: null, conversationId: uuidv7(), provider: "9router", model: "gpt-6.1-sol", effort: null, usage: null, cost: unknownCost, recordedAt: at() };
  assert.equal(c.usageRecordSchema.safeParse(chat).success, true);
  assert.equal(c.usageRecordSchema.safeParse({ ...chat, conversationId: null }).success, false); // no attempt, no conversation
  const attempt = { projectId: uuidv7(), runId: uuidv7(), assignmentId: uuidv7(), epoch: 1, leaseId: uuidv7() };
  assert.equal(c.usageRecordSchema.safeParse({ ...chat, conversationId: null, attempt }).success, false); // attempt usage needs its task
  assert.equal(c.usageRecordSchema.safeParse({ ...chat, conversationId: null, attempt, taskId: uuidv7() }).success, true);
});
