import assert from "node:assert/strict";
import { inspect } from "node:util";
import { test } from "node:test";
import { createTokenRegistry } from "../dist/proxy/index.js";

const input = (extra = {}) => ({ attemptId: "attempt", projectId: "project", taskId: "task", epoch: 1,
  allowedModels: ["approved"], ...extra });
test("registry keeps the optional workspace only on its immutable private grant", () => {
  const { registry } = fixture(); const workspacePath = "synthetic-workspace-marker";
  const issued = registry.issue(input({ workspacePath })); const grant = registry.resolve(issued.token);
  assert.deepEqual(Object.keys(issued), ["token"]); assert.equal(grant.workspacePath, workspacePath);
  assert.ok(Object.isFrozen(grant)); assert.throws(() => { grant.workspacePath = "changed"; }, TypeError);
  assert.equal(inspect(registry, { showHidden: true, depth: null }).includes(workspacePath), false); registry.revokeAll();
});
function fixture(extra = {}) {
  let now = 1000;
  const registry = createTokenRegistry({ clock: () => new Date(now), ...extra });
  return { registry, advance: (ms) => { now += ms; } };
}
test("registry issues independent random credentials in the required format", () => {
  const { registry } = fixture();
  const first = registry.issue(input()).token;
  const second = registry.issue(input({ attemptId: "other" })).token;
  assert.match(first, /^fpx_[A-Za-z0-9_-]{43}$/); assert.notEqual(first, second);
  registry.revokeAll();
});
test("registry has no inspectable plaintext or credential properties", () => {
  const { registry } = fixture(); const { token } = registry.issue(input());
  assert.equal(inspect(registry, { showHidden: true, depth: null }).includes(token), false);
  assert.equal(JSON.stringify(registry.resolve(token)).includes(token), false);
  assert.deepEqual(Object.keys(registry).sort(), ["issue", "onRevoke", "resolve", "revoke", "revokeAll"]);
  registry.revokeAll();
});
test("registry expires at the exact lifetime boundary with a fake clock", () => {
  const { registry, advance } = fixture({ maxLifetimeMs: 100 }); const { token } = registry.issue(input());
  advance(99); assert.ok(registry.resolve(token)); advance(1); assert.equal(registry.resolve(token), null);
});
test("registry uses a six hour default lifetime", () => {
  const { registry, advance } = fixture(); const { token } = registry.issue(input());
  advance(6 * 60 * 60_000); assert.equal(registry.resolve(token), null);
});
test("registry replacement revokes the old grant and notifies listeners", () => {
  const { registry } = fixture(); const old = registry.issue(input()).token; let calls = 0;
  registry.onRevoke("attempt", () => calls++);
  const next = registry.issue(input()).token;
  assert.equal(calls, 1); assert.equal(registry.resolve(old), null); assert.ok(registry.resolve(next)); registry.revokeAll();
});
test("registry revoke affects every credential of the selected attempt only", () => {
  const { registry } = fixture(); const a = registry.issue(input()).token;
  const b = registry.issue(input({ attemptId: "other" })).token;
  registry.revoke("attempt"); registry.revoke("attempt");
  assert.equal(registry.resolve(a), null); assert.ok(registry.resolve(b)); registry.revokeAll();
});
test("registry revokeAll clears all grants and abort observers", () => {
  const { registry } = fixture(); const a = registry.issue(input()).token;
  const b = registry.issue(input({ attemptId: "other" })).token; let calls = 0;
  registry.onRevoke("attempt", () => calls++); registry.onRevoke("other", () => calls++);
  registry.revokeAll(); assert.equal(calls, 2); assert.equal(registry.resolve(a), null); assert.equal(registry.resolve(b), null);
});
test("registry observers can unsubscribe and cannot break revocation", () => {
  const { registry } = fixture(); const { token } = registry.issue(input()); let calls = 0;
  registry.onRevoke("attempt", () => { throw new Error("observer failed"); });
  registry.onRevoke("attempt", () => calls++);
  registry.onRevoke("attempt", () => calls++)(); registry.revoke("attempt");
  assert.equal(calls, 1); assert.equal(registry.resolve(token), null);
});
test("registry grants are copied and immutable", () => {
  const { registry } = fixture(); const data = input(); const { token } = registry.issue(data);
  data.allowedModels.push("other"); const grant = registry.resolve(token);
  assert.deepEqual(grant.allowedModels, ["approved"]); assert.ok(Object.isFrozen(grant));
  assert.ok(Object.isFrozen(grant.allowedModels)); registry.revokeAll();
});
for (const [label, value] of [["missing", undefined], ["null", null], ["number", 42], ["object", {}],
  ["symbol", Symbol()], ["empty", ""], ["wrong prefix", "bad"], ["short", "fpx_a"],
  ["whitespace", `fpx_${"a".repeat(42)} `], ["noncanonical", `fpx_${"a".repeat(43)}`], ["long", "a".repeat(10000)]])
  test(`registry malformed ${label} resolves without throwing`, () => { assert.equal(fixture().registry.resolve(value), null); });
test("registry deterministic randomness requests exactly 32 bytes", () => {
  let size; const { registry } = fixture({ randomBytes: (n) => { size = n; return Buffer.alloc(n, 1); } });
  const { token } = registry.issue(input()); assert.equal(size, 32); assert.ok(registry.resolve(token)); registry.revokeAll();
});
test("registry rejects entropy collisions without reviving old credentials", () => {
  const { registry } = fixture({ randomBytes: (n) => Buffer.alloc(n, 2) }); const { token } = registry.issue(input());
  assert.throws(() => registry.issue(input({ attemptId: "other" })), /Token generation failed/);
  assert.ok(registry.resolve(token)); registry.revokeAll();
});
