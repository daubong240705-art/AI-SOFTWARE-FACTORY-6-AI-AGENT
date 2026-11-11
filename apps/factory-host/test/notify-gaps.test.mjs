import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { notifyFixture } from "./notify-fixture.mjs";

test("only stalled workflow instances produce notifications", async t => {
  const f = notifyFixture(t), id = randomUUID();
  assert.equal(f.workflowPipeline.execute({ apiVersion: 1, commandId: randomUUID(), projectId: f.projectId, type: "workflows.create",
    payload: { instanceId: id, definitionKey: "software-delivery", packKey: "software-team" } }).status, 200);
  await f.tick();
  assert.equal(f.rows().filter(row => row.entity_kind === "workflow-instance").length, 0);
  f.raw.prepare("UPDATE workflow_instances SET state='stalled',last_progress_at=? WHERE id=?").run(f.clock().toISOString(), id);
  await f.tick();
  assert.equal(f.rows().filter(row => row.entity_kind === "workflow-instance").length, 1);
});

test("an approval requested today is activity for the digest even when it is no longer pending", async t => {
  const f = notifyFixture(t, { at: "2026-11-10T11:00:00.000Z" });
  f.approval({ state: "withdrawn" });
  await f.tick();
  assert.equal(f.rows().filter(row => row.category === "digest").length, 1);
});
