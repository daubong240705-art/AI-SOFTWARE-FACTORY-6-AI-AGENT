import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { STANDING_ACTION_KINDS, STANDING_FORBIDDEN } from "@factory/contracts";
import { standingFixture } from "./standing-fixture.mjs";

test("create persists revision one and emits the standing entity", t => {
  const f = standingFixture(t), id = f.create(); assert.equal(f.row(id).revision, 1);
  assert.deepEqual(f.effects().filter(x => x.entity.id === id).map(x => x.entity), [{ kind: "standing-approval", id, revision: 1 }]);
  assert.equal(f.row(id).limit_per_day, 5); assert.equal(f.row(id).max_tokens_per_use, null); assert.equal(f.row(id).revoked_at, null);
});
for (const actionKind of STANDING_ACTION_KINDS) test(`create accepted action ${actionKind}`, t => { const f = standingFixture(t); assert.equal(f.row(f.create({ actionKind })).action_kind, actionKind); });
for (const actionKind of STANDING_FORBIDDEN) test(`command forbids ${actionKind}`, t => {
  const f = standingFixture(t), r = f.command("standing-approvals.create", f.input({ actionKind }));
  assert.equal(r.status, 400); assert.equal(r.body.error.code, "validation"); assert.match(JSON.stringify(r.body.error), /STANDING_FORBIDDEN/);
  assert.ok(JSON.stringify(r.body.error).includes(actionKind)); assert.equal(f.raw.prepare("SELECT count(*) AS n FROM standing_approvals").get().n, 0);
});
for (const [delta, status] of [[-1, 400], [0, 400], [1, 200], [30 * 86400000, 200], [30 * 86400000 + 1, 400]]) test(`expiry bound ${delta}ms`, t => {
  const f = standingFixture(t), payload = f.input({ expiresAt: new Date(f.clock().getTime() + delta).toISOString() });
  assert.equal(f.command("standing-approvals.create", payload).status, status); assert.equal(Boolean(f.row(payload.standingId)), status === 200);
});
test("create requires an existing project", t => { const f = standingFixture(t), projectId = randomUUID(); assert.equal(f.command("standing-approvals.create", f.input({ scope: { kind: "project", ref: projectId } }), projectId).status, 404); });
test("create project scope must match command project", t => { const f = standingFixture(t); assert.equal(f.command("standing-approvals.create", f.input({ scope: { kind: "project", ref: f.project() } })).status, 400); });
test("team scope requires existing team", t => { const f = standingFixture(t); assert.equal(f.command("standing-approvals.create", f.input({ scope: { kind: "team", ref: randomUUID() } })).status, 404); });
test("existing global team can be scoped before engagement", t => { const f = standingFixture(t), team = f.secondTeam(); assert.equal(f.row(f.create({ scope: { kind: "team", ref: team } })).scope_ref, team); });
test("duplicate id is a conflict without overwriting", t => { const f = standingFixture(t), payload = f.input(); assert.equal(f.command("standing-approvals.create", payload).status, 200); const before = f.row(payload.standingId); assert.equal(f.command("standing-approvals.create", { ...payload, limitPerDay: 9 }).status, 409); assert.deepEqual(f.row(payload.standingId), before); });
test("command replay returns same effect without another entity", t => { const f = standingFixture(t), payload = f.input(), commandId = randomUUID(); const first = f.command("standing-approvals.create", payload, f.projectId, commandId); const next = f.command("standing-approvals.create", payload, f.projectId, commandId); assert.deepEqual(next.body, first.body); assert.equal(next.replayed, true); assert.equal(f.effects().filter(x => x.entity.id === payload.standingId).length, 1); });
test("twentieth active approval allowed, twenty-first refused", t => { const f = standingFixture(t); for (let i = 0; i < 20; i++) f.create(); const r = f.command("standing-approvals.create", f.input()); assert.equal(r.status, 429); assert.equal(r.body.error.code, "resource-exhausted"); assert.equal(f.raw.prepare("SELECT count(*) AS n FROM standing_approvals").get().n, 20); });
test("revoking frees an active slot", t => { const f = standingFixture(t), id = f.create(); for (let i = 1; i < 20; i++) f.create(); assert.equal(f.revoke(id).status, 200); f.create(); assert.equal(f.raw.prepare("SELECT count(*) AS n FROM standing_approvals WHERE state='active'").get().n, 20); });
test("expired active rows still count at the active cap", t => { const f = standingFixture(t); for (let i = 0; i < 20; i++) f.create({ expiresAt: new Date(f.clock().getTime() + 1).toISOString() }); f.advance(2); assert.equal(f.command("standing-approvals.create", f.input()).status, 429); });
test("active cap is isolated per project", t => { const f = standingFixture(t); for (let i = 0; i < 20; i++) f.create(); const projectId = f.project(); f.create({ scope: { kind: "project", ref: projectId } }, projectId); });
test("revoke increments revision and emits effect", t => { const f = standingFixture(t), id = f.create(); const r = f.revoke(id); assert.equal(r.status, 200); assert.equal(f.row(id).state, "revoked"); assert.equal(f.row(id).revision, 2); assert.equal(f.row(id).revoked_at, f.clock().toISOString()); assert.deepEqual(r.body.receipt.effects, [{ kind: "standing-approval", id, revision: 2 }]); });
test("revoke is idempotent with current revision", t => { const f = standingFixture(t), id = f.create(); f.revoke(id); const before = f.row(id); f.advance(1000); const r = f.revoke(id); assert.deepEqual(r.body.receipt.effects, []); assert.deepEqual(f.row(id), before); });
test("revoke requires expected revision even if already revoked", t => { const f = standingFixture(t), id = f.create(); f.revoke(id); assert.equal(f.revoke(id, 1).status, 409); assert.equal(f.row(id).revision, 2); });
test("revoke conflict reports current revision", t => { const f = standingFixture(t), id = f.create(), r = f.revoke(id, 2); assert.equal(r.status, 409); assert.equal(r.body.error.currentRevision, 1); assert.equal(f.row(id).state, "active"); });
test("revoke unknown approval is 404", t => { const f = standingFixture(t); assert.equal(f.revoke(randomUUID(), 1).status, 404); });
test("revoke unknown project is 404", t => { const f = standingFixture(t); assert.equal(f.revoke(randomUUID(), 1, randomUUID()).status, 404); });
test("same standing id in separate projects is independent", t => { const f = standingFixture(t), id = f.create(), other = f.project(); f.create({ standingId: id, scope: { kind: "project", ref: other } }, other); f.revoke(id); assert.equal(f.row(id, other).state, "active"); });
test("cross-project revoke cannot reach another project's approval", t => { const f = standingFixture(t), id = f.create(); assert.equal(f.revoke(id, 1, f.project()).status, 404); assert.equal(f.row(id).state, "active"); });
