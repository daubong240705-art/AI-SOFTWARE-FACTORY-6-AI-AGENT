import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { standingFixture } from "./standing-fixture.mjs";
import { temp, migrationsDir } from "./org-fixture.mjs";
import { openStorage } from "../dist/storage/database.js";

for (const limitPerDay of [1, 2, 5, 50]) test(`daily limit boundary ${limitPerDay}`, t => { const f = standingFixture(t); f.level(); f.create({ limitPerDay }); for (let i = 0; i < limitPerDay; i++) assert.equal(f.use().allowed, true); assert.deepEqual(f.use(), { allowed: false, reason: "limit" }); assert.equal(f.uses().length, limitPerDay); });
test("next UTC+7 local midnight resets count", t => { const f = standingFixture(t, { at: "2026-11-10T16:59:59.999Z" }); f.level(); f.create({ limitPerDay: 1 }); f.use(); assert.equal(f.use().reason, "limit"); f.advance(1); assert.equal(f.use().allowed, true); assert.deepEqual(f.uses().map(r => r.local_day), ["2026-11-10", "2026-11-11"]); });
for (const [offset, at] of [[0, "2026-11-10T23:59:59.999Z"], [-300, "2026-11-11T04:59:59.999Z"], [330, "2026-11-10T18:29:59.999Z"]]) test(`configured offset ${offset} resets at midnight`, t => { const f = standingFixture(t, { at }); f.level(); f.create({ limitPerDay: 1 }); f.use({ utcOffsetMinutes: offset }); assert.equal(f.use({ utcOffsetMinutes: offset }).reason, "limit"); f.advance(1); assert.equal(f.use({ utcOffsetMinutes: offset }).allowed, true); });
for (const [tokens, allowed] of [[0, true], [99, true], [100, true], [101, false]]) test(`token cap boundary ${tokens}`, t => { const f = standingFixture(t); f.level(); f.create({ maxTokensPerUse: 100 }); const r = f.use({ tokens }); assert.equal(r.allowed, allowed); if (!allowed) assert.equal(r.reason, "tokens"); assert.equal(f.uses().length, Number(allowed)); if (allowed) assert.equal(f.uses()[0].tokens, tokens); });
for (const tokens of [-1, 1.5, NaN, Infinity]) test(`invalid token use ${tokens} cannot consume allowance`, t => { const f = standingFixture(t); f.level(); f.create(); assert.deepEqual(f.use({ tokens }), { allowed: false, reason: "tokens" }); assert.equal(f.uses().length, 0); });
test("unspecified tokens allow notification under token cap", t => { const f = standingFixture(t); f.level(); f.create({ maxTokensPerUse: 1 }); assert.equal(f.use().allowed, true); });
test("uncapped row accepts high token count", t => { const f = standingFixture(t); f.level(); f.create(); assert.equal(f.use({ tokens: 1000000000 }).allowed, true); });
test("full earliest row falls back to next eligible", t => { const f = standingFixture(t); f.level(); const early = f.create({ limitPerDay: 1, expiresAt: new Date(f.clock().getTime() + 1000).toISOString() }), later = f.create(); assert.equal(f.use().standingId, early); assert.equal(f.use().standingId, later); });
test("token capped earliest row falls back to next eligible", t => { const f = standingFixture(t); f.level(); f.create({ maxTokensPerUse: 10, expiresAt: new Date(f.clock().getTime() + 1000).toISOString() }); const later = f.create({ maxTokensPerUse: 100 }); assert.equal(f.use({ tokens: 50 }).standingId, later); });
test("limit refusal precedes tokens when all rows full", t => { const f = standingFixture(t); f.level(); f.create({ maxTokensPerUse: 1, limitPerDay: 1 }); f.use(); assert.deepEqual(f.use({ tokens: 2 }), { allowed: false, reason: "limit" }); });
test("tokens refusal after excluding full rows", t => { const f = standingFixture(t); f.level(); f.create({ limitPerDay: 1, expiresAt: new Date(f.clock().getTime() + 1000).toISOString() }); f.use(); f.create({ maxTokensPerUse: 1 }); assert.deepEqual(f.use({ tokens: 2 }), { allowed: false, reason: "tokens" }); });
test("same use id retries at limit without consuming another slot", t => { const f = standingFixture(t); f.level(); const id = f.create({ limitPerDay: 1 }), useId = randomUUID(); assert.deepEqual(f.use({ useId }), { allowed: true, standingId: id }); assert.deepEqual(f.use({ useId }), { allowed: true, standingId: id }); assert.equal(f.uses().length, 1); assert.equal(f.use().reason, "limit"); });
test("same use id remains counted once across local days", t => { const f = standingFixture(t); f.level(); f.create(); const useId = randomUUID(); f.use({ useId }); f.advance(86400000); f.use({ useId }); assert.equal(f.uses().length, 1); });
test("revoked use id does not reauthorize or consume another approval", t => { const f = standingFixture(t); f.level(); const id = f.create(), useId = randomUUID(); f.use({ useId }); f.revoke(id); f.create(); assert.equal(f.use({ useId }).allowed, false); assert.equal(f.uses().length, 1); });
test("same use id cannot switch action kinds", t => { const f = standingFixture(t); f.level(); f.create(); f.create({ actionKind: "deploy.staging" }); const useId = randomUUID(); f.use({ useId }); assert.equal(f.use({ useId, actionKind: "deploy.staging" }).allowed, false); assert.equal(f.uses().length, 1); });
test("same use id cannot switch team scope", t => { const f = standingFixture(t); f.level(); const teamId = f.secondTeam(); f.create({ scope: { kind: "team", ref: f.teamId } }); f.create({ scope: { kind: "team", ref: teamId } }); const useId = randomUUID(); f.use({ useId, teamId: f.teamId }); assert.equal(f.use({ useId, teamId }).allowed, false); assert.equal(f.uses().length, 1); });
test("same use id is isolated by project", t => { const f = standingFixture(t); f.level(); f.create(); const other = f.project(); f.level(4, other); f.create({ scope: { kind: "project", ref: other } }, other); const useId = randomUUID(); assert.equal(f.use({ useId }).allowed, true); assert.equal(f.use({ useId, projectId: other }).allowed, true); assert.equal(f.uses(other).length, 1); });

test("concurrent independent SQLite connections never exceed daily limit", async t => {
  let storage;
  const workers = [];
  const root = temp(t, async () => { await Promise.all(workers.map(w => w.terminate())); storage?.close(); });
  const file = join(root, "standing.db"); storage = openStorage(file);
  storage.migrate({ migrationsDir, backupDir: null });
  const projectId = randomUUID(), standingId = randomUUID();
  storage.raw.prepare("INSERT INTO projects VALUES (?,1,'Concurrency','artifact','synthetic','active')").run(projectId);
  storage.raw.prepare("INSERT INTO autonomy_settings VALUES (?,'project',?,1,4,'2026-11-10T00:00:00.000Z')").run(projectId, projectId);
  storage.raw.prepare("INSERT INTO standing_approvals VALUES (?,?,1,'notify.send-internal','project',?,5,NULL,'active','2026-11-10T00:00:00.000Z','2026-11-20T00:00:00.000Z',NULL)").run(projectId, standingId, projectId);
  const source = `const { parentPort, workerData } = require('node:worker_threads');
    const { pathToFileURL } = require('node:url');
    (async () => { const { openStorage } = await import(workerData.database); const { useStandingApproval } = await import(workerData.service);
      const { randomUUID } = require('node:crypto'); const s = openStorage(workerData.file); parentPort.postMessage('ready');
      parentPort.once('message', () => { try { const results = Array.from({length: 12}, () => useStandingApproval(s.raw, {
        projectId: workerData.projectId, actionKind: 'notify.send-internal', now: new Date('2026-11-10T01:00:00.000Z'), useId: randomUUID() }));
        s.close(); parentPort.postMessage(results); } catch (e) { s.close(); throw e; } }); })();`;
  workers.push(...Array.from({ length: 2 }, () => new Worker(source, { eval: true, workerData: { file, projectId,
    database: new URL("../dist/storage/database.js", import.meta.url).href, service: new URL("../dist/standing/service.js", import.meta.url).href } })));
  await Promise.all(workers.map(w => new Promise((resolve, reject) => { w.once("message", msg => { assert.equal(msg, "ready"); resolve(); }); w.once("error", reject); })));
  const pending = workers.map(w => new Promise((resolve, reject) => { w.once("message", resolve); w.once("error", reject); }));
  workers.forEach(w => w.postMessage("go"));
  const results = (await Promise.all(pending)).flat(); assert.equal(results.filter(r => r.allowed).length, 5);
  assert.equal(results.filter(r => !r.allowed && r.reason === "limit").length, 19);
  assert.equal(storage.raw.prepare("SELECT count(*) AS n FROM standing_approval_uses").get().n, 5);
});
