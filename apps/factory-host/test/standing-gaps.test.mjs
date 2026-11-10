import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { standingFixture, standingMcpFixture } from "./standing-fixture.mjs";

test("a retried use id cannot reuse an approval that has since expired", t => {
  const f = standingFixture(t); f.level();
  f.create({ expiresAt: new Date(f.clock().getTime() + 1000).toISOString() });
  f.create({ expiresAt: new Date(f.clock().getTime() + 86400000).toISOString() });
  const useId = randomUUID();
  assert.equal(f.use({ useId }).allowed, true);
  f.advance(2000);
  assert.deepEqual(f.use({ useId }), { allowed: false, reason: "none" });
});

for (const text of ["password: hunter2", "secret=abc123", "api_key: sk-demo", "Authorization: Basic abcdef", "token = xyz"]) test(`labelled credential is redacted: ${text}`, t => {
  const f = standingFixture(t); f.level(); f.create();
  assert.equal(f.send({ title: `Report ${text}`, body: `Details ${text}` }).allowed, true);
  const [row] = f.rows();
  assert.doesNotMatch(row.title + row.body, /hunter2|abc123|sk-demo|abcdef|xyz/);
});

test("the tool handler itself refuses a seat that does not list the tool, even when called directly", t => {
  const f = standingMcpFixture(t, []); f.level(); f.create();
  const result = f.mcpDeps.standing.call(f.grant, "notify.send-internal", { title: "Report", body: "Summary" });
  assert.equal(result.isError, true);
  assert.equal(f.rows().length, 0);
  assert.equal(f.uses().length, 0);
});
