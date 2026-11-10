import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { stage } from "./workflow-engine-fixture.mjs";
import { reworkFixture, reworkFlow, reworkEdge, stageRow } from "./rework-fixture.mjs";
import { createWorkflowHandlers } from "../dist/workflow/commands.js";

function stalled(t, { loops = 3, extra = 0, reason = "rework limit reached", definition = reworkFlow() } = {}) {
  const f = reworkFixture(t, definition);
  f.raw.prepare("UPDATE workflow_instances SET state='stalled',state_reason=? WHERE id=?").run(reason, f.id);
  f.raw.prepare("UPDATE workflow_stages SET state='done' WHERE instance_id=?").run(f.id);
  f.raw.prepare("UPDATE workflow_stages SET loop_count=?,extra_loops=? WHERE instance_id=? AND stage_key='author'").run(loops, extra, f.id);
  f.raw.prepare("UPDATE workflow_stages SET state='blocked',blocked_reason=? WHERE instance_id=? AND stage_key='review'").run(reason, f.id);
  return f;
}

// Isolate the command's extension cap from the SQL loop_count ceiling, which the
// real engine regression below exercises without a substitute database read.
function resumeAtLogicalCounts(f, counts) {
  const raw = new Proxy(f.raw, { get(target, key) {
    if (key === "prepare") return sql => {
      const statement = target.prepare(sql);
      if (!sql.startsWith("SELECT loop_count, extra_loops FROM workflow_stages")) return statement;
      return { get(...args) {
        const row = statement.get(...args);
        return row ? { ...row, loop_count: counts[args[2]] ?? row.loop_count } : row;
      } };
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const handler = createWorkflowHandlers({ packs: [], engine: f.deps })["workflows.resume"];
  return f.hub.transaction(() => handler({ raw, hub: f.hub, clock: f.clock, newId: randomUUID, actorId: "operator" }, {
    apiVersion: 1, commandId: randomUUID(), projectId: f.projectId, type: "workflows.resume",
    payload: { instanceId: f.id, expectedRevision: f.view().revision },
  }));
}

test("resume grants exactly one extension to an exhausted destination and clears the source reason", t => {
  const f = stalled(t); assert.equal(f.command("resume").status, 200);
  assert.equal(stageRow(f, "author").extra_loops, 1); assert.equal(stageRow(f, "author").loop_count, 3);
  assert.equal(stageRow(f, "review").state, "done"); assert.equal(stageRow(f, "review").blocked_reason, null);
  assert.equal(f.view().stalledReason, null);
});

test("resume with no exhausted stage leaves extension allowances unchanged", t => {
  const f = stalled(t, { loops: 2 }); assert.equal(f.command("resume").status, 200);
  assert.equal(stageRow(f, "author").extra_loops, 0);
});

test("a progress timeout resume never grants a rework extension", t => {
  const f = stalled(t, { reason: "no progress for 60 minutes" });
  assert.equal(f.command("resume").status, 200); assert.equal(stageRow(f, "author").extra_loops, 0);
});

test("a paused instance does not grant extensions even with an exhausted edge", t => {
  const f = stalled(t); f.raw.prepare("UPDATE workflow_instances SET state='paused' WHERE id=?").run(f.id);
  assert.equal(f.command("resume").status, 200); assert.equal(stageRow(f, "author").extra_loops, 0);
});

test("resume compares exhaustion with maxLoops plus the previous allowance", t => {
  const f = stalled(t, { loops: 3, extra: 1 }); assert.equal(f.command("resume").status, 200);
  assert.equal(stageRow(f, "author").extra_loops, 1);
});

test("resume extends at the combined limit exactly", t => {
  const f = stalled(t, { loops: 4, extra: 1 }); assert.equal(f.command("resume").status, 200);
  assert.equal(stageRow(f, "author").extra_loops, 2);
});

test("the last extension that keeps maxLoops + extra_loops within the schema ceiling of 10 is allowed", t => {
  const f = stalled(t, { loops: 9, extra: 8, definition: reworkFlow([reworkEdge("review", "author", 1)]) }); assert.equal(f.command("resume").status, 200);
  assert.equal(stageRow(f, "author").extra_loops, 9);
});

test("an extension beyond the schema ceiling conflicts and rolls back the workflow transition", t => {
  const f = stalled(t, { loops: 10, extra: 10 }); const before = f.view();
  assert.throws(() => resumeAtLogicalCounts(f, { author: 13 }), error =>
    error.code === "conflict" && error.message === "rework extension limit reached");
  assert.deepEqual(f.view(), before); assert.equal(stageRow(f, "author").extra_loops, 10);
  assert.equal(stageRow(f, "review").blocked_reason, "rework limit reached");
});

test("an unexhausted destination at ten extensions may still resume", t => {
  const f = stalled(t, { loops: 10, extra: 10 }); assert.equal(f.command("resume").status, 200);
  assert.equal(stageRow(f, "author").extra_loops, 10);
});

const twoDestinations = () => reworkFlow([reworkEdge(), reworkEdge("review", "other", 1)], [stage("author"), stage("review"), stage("other")]);

test("extension is per destination stage with its own definition limit", t => {
  const f = stalled(t, { definition: twoDestinations() });
  f.raw.prepare("UPDATE workflow_stages SET loop_count=1 WHERE instance_id=? AND stage_key='other'").run(f.id);
  assert.equal(f.command("resume").status, 200);
  assert.equal(stageRow(f, "author").extra_loops, 1); assert.equal(stageRow(f, "other").extra_loops, 1);
  assert.equal(stageRow(f, "review").extra_loops, 0);
});

test("resume only extends exhausted destinations of the blocked source", t => {
  const f = stalled(t, { definition: twoDestinations() }); assert.equal(f.command("resume").status, 200);
  assert.equal(stageRow(f, "author").extra_loops, 1); assert.equal(stageRow(f, "other").extra_loops, 0);
});

test("an edge from an unblocked source cannot grant an extension", t => {
  const definition = reworkFlow([reworkEdge("audit", "author")], [stage("author"), stage("review"), stage("audit")]);
  const f = stalled(t, { definition }); assert.equal(f.command("resume").status, 200);
  assert.equal(stageRow(f, "author").extra_loops, 0);
});

test("a capped destination rolls back extensions already granted to sibling destinations", t => {
  const f = stalled(t, { definition: twoDestinations() });
  f.raw.prepare("UPDATE workflow_stages SET loop_count=10,extra_loops=10 WHERE instance_id=? AND stage_key='other'").run(f.id);
  assert.throws(() => resumeAtLogicalCounts(f, { other: 11 }), /rework extension limit reached/);
  assert.equal(stageRow(f, "author").extra_loops, 0); assert.equal(stageRow(f, "other").extra_loops, 10);
  assert.equal(f.view().state, "stalled");
});

test("stale resume revision cannot grant an extension", t => {
  const f = stalled(t); assert.equal(f.command("resume", { expectedRevision: f.view().revision + 1 }).status, 409);
  assert.equal(stageRow(f, "author").extra_loops, 0); assert.equal(f.view().state, "stalled");
});

test("a second real stall requires a second resume and retains every task iteration", t => {
  const f = reworkFixture(t, reworkFlow([reworkEdge("review", "author", 1)])); f.start();
  f.cycle(); f.cycle(); assert.equal(f.view().state, "stalled");
  assert.equal(f.command("resume").status, 200); f.run();
  assert.equal(stageRow(f, "author").extra_loops, 1); assert.equal(stageRow(f, "author").loop_count, 2);
  f.cycle(); assert.equal(f.view().state, "stalled");
  assert.equal(f.command("resume").status, 200); f.run();
  assert.equal(stageRow(f, "author").extra_loops, 2); assert.equal(stageRow(f, "author").loop_count, 3);
  assert.equal(f.tasks("author").length, 4); assert.equal(f.tasks("review").length, 3);
  f.cycle("accept"); assert.equal(f.view().state, "completed");
});

// loop_count is limited to 10 by the schema, so maxLoops (1) + extra_loops can be at most 10.
for (const extra of [0, 1, 2, 9]) test(`engine enforces maxLoops + extra_loops exactly with allowance ${extra}`, t => {
  const f = reworkFixture(t, reworkFlow([reworkEdge("review", "author", 1)]));
  f.raw.prepare("UPDATE workflow_stages SET extra_loops=? WHERE instance_id=? AND stage_key='author'").run(extra, f.id);
  f.start();
  for (let loop = 1; loop <= 1 + extra; loop++) {
    f.cycle(); assert.equal(stageRow(f, "author").loop_count, loop); assert.notEqual(f.view().state, "stalled");
  }
  f.cycle(); assert.equal(f.view().state, "stalled");
  assert.equal(stageRow(f, "author").loop_count, 1 + extra); assert.equal(f.tasks("author").length, 2 + extra);
  f.run(); assert.equal(stageRow(f, "author").loop_count, 1 + extra);
});

test("the extension that would make maxLoops + extra_loops reach the schema ceiling of 10 is refused", t => {
  const f = stalled(t, { loops: 10, extra: 9, definition: reworkFlow([reworkEdge("review", "author", 1)]) });
  const before = f.view();
  assert.equal(f.command("resume").status, 409);
  assert.deepEqual(f.view(), before); assert.equal(stageRow(f, "author").extra_loops, 9);
});
