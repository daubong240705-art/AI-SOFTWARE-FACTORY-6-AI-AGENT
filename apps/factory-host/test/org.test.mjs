import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { idSchema, seatSchema, teamSchema, engagementSchema } from "@factory/contracts";
import { loadPack, packManifestSchema, ensureTeamFromPack, ensureEngagement, findLeadSeat, listSeats, getTeam, getActiveEngagement } from "../dist/org/index.js";
import { openStorage } from "../dist/storage/database.js";

const packDir = fileURLToPath(new URL("../../../packs/software-team/", import.meta.url));
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const deps = { newId: randomUUID, clock: () => new Date("2026-11-07T10:00:00.000Z") };

function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), "factory-org-"));
  t.after(() => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep + "factory-org-"));
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
function copy(t) {
  const dir = join(temp(t), "pack");
  cpSync(packDir, dir, { recursive: true });
  return dir;
}
function changeManifest(dir, change) {
  const file = join(dir, "pack.json");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  change(manifest);
  writeFileSync(file, JSON.stringify(manifest));
}
function fixture(t) {
  const storage = openStorage(":memory:");
  storage.migrate({ migrationsDir, backupDir: null });
  t.after(() => storage.close());
  return storage.raw;
}
function project(raw) {
  const id = randomUUID();
  raw.prepare("INSERT INTO projects (id, revision, name, workspace_kind, workspace_root) VALUES (?, ?, ?, ?, ?)")
    .run(id, 1, "Project", "directory", `/workspace/${id}`);
  return id;
}

test("real pack has seven seats, exactly one lead, and a stable content digest", (t) => {
  const first = loadPack(packDir);
  const second = loadPack(packDir);
  assert.deepEqual(first, second);
  assert.equal(first.manifest.seats.length, 7);
  assert.equal(first.manifest.seats.filter((seat) => seat.isLead).length, 1);
  assert.match(first.digest, /^[a-f0-9]{64}$/);
  const dir = copy(t);
  assert.equal(loadPack(dir).digest, first.digest);
  const profile = join(dir, first.manifest.seats[0].profile);
  writeFileSync(profile, Buffer.concat([readFileSync(profile), Buffer.from("\nChanged profile\n")]));
  assert.notEqual(loadPack(dir).digest, first.digest);
});

for (const [label, change] of [
  ["two leads", (m) => { m.seats[1].isLead = true; }],
  ["no lead", (m) => { m.seats[0].isLead = false; }],
  ["duplicate seat name", (m) => { m.seats[1].name = m.seats[0].name; }],
  ["profile traversal", (m) => { m.seats[0].profile = "profiles/../lead.md"; }],
  ["absolute POSIX profile", (m) => { m.seats[0].profile = "/outside/lead.md"; }],
  ["absolute Windows profile", (m) => { m.seats[0].profile = "C:\\outside\\lead.md"; }],
  ["drive relative profile", (m) => { m.seats[0].profile = "C:lead.md"; }],
  ["unknown manifest key", (m) => { m.unknown = true; }],
  ["unknown seat key", (m) => { m.seats[0].unknown = true; }],
  ["skill traversal", (m) => { m.skills = ["../outside"]; }],
  ["wrong extension", (m) => { m.seats[0].profile = "profiles/lead.txt"; }],
  ["invalid runtime", (m) => { m.seats[0].runtime = "other"; }],
  ["too many slots", (m) => { m.seats[0].slots = 9; }],
  ["invalid version", (m) => { m.version = "1.0"; }],
  ["invalid key", (m) => { m.key = "Bad key"; }],
  ["no seats", (m) => { m.seats = []; }],
  ["too many seats", (m) => { m.seats = Array.from({ length: 17 }, (_, i) => ({ ...m.seats[0], name: `Seat ${i}`, isLead: i === 0 })); }],
]) test(`loadPack rejects ${label}`, (t) => {
  const dir = copy(t);
  changeManifest(dir, change);
  assert.throws(() => loadPack(dir));
});

test("loadPack rejects a missing profile", (t) => {
  const dir = copy(t);
  rmSync(join(dir, "profiles/lead.md"));
  assert.throws(() => loadPack(dir), /ENOENT/);
});
test("loadPack rejects a skill directory without SKILL.md", (t) => {
  const dir = copy(t);
  rmSync(join(dir, "skills/fix-bug/SKILL.md"));
  assert.throws(() => loadPack(dir), /ENOENT/);
});

for (const target of ["profile", "skill", "skill file", "manifest"]) {
  test(`loadPack rejects an external ${target} symlink`, (t) => {
    const dir = copy(t);
    const outside = join(temp(t), target === "skill" ? "outside-skill" : "outside.md");
    const link = join(dir, target === "profile" ? "profiles/lead.md" : target === "skill" ? "skills/fix-bug"
      : target === "skill file" ? "skills/fix-bug/SKILL.md" : "pack.json");
    if (target === "skill") cpSync(join(packDir, "skills/fix-bug"), outside, { recursive: true });
    else writeFileSync(outside, readFileSync(link));
    assert.ok(resolve(link).startsWith(resolve(dir) + sep));
    rmSync(link, { recursive: target === "skill", force: true });
    try { symlinkSync(outside, link, target === "skill" ? "junction" : "file"); }
    catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) { t.skip(`OS refuses symlink creation: ${error.code}`); return; }
      throw error;
    }
    assert.throws(() => loadPack(dir), /escapes pack directory/);
  });
}

test("pack schema is strict, and deterministic profile UUIDs match the SHA-256 definition", (t) => {
  const raw = fixture(t);
  const pack = loadPack(packDir);
  assert.deepEqual(packManifestSchema.parse(pack.manifest), pack.manifest);
  const first = ensureTeamFromPack(raw, pack, deps);
  const second = ensureTeamFromPack(raw, pack, deps);
  assert.equal(first.created, true);
  assert.deepEqual(second, { ...first, created: false });
  const seats = listSeats(raw, first.teamId);
  assert.equal(seats.length, 7);
  assert.equal(seats.filter((seat) => seat.isLead).length, 1);
  assert.deepEqual(teamSchema.parse(getTeam(raw, first.teamId)), getTeam(raw, first.teamId));
  for (const seat of seats) {
    assert.deepEqual(seatSchema.parse(seat), seat);
    assert.equal(idSchema.parse(seat.profile.id), seat.profile.id);
    assert.match(seat.profile.id, /^[a-f0-9-]{14}8[a-f0-9]{3}-[89ab]/);
    const manifestSeat = pack.manifest.seats.find((item) => item.name === seat.name);
    const hash = createHash("sha256").update(`${pack.manifest.key}:${manifestSeat.profile}`).digest().subarray(0, 16);
    hash[6] = (hash[6] & 15) | 128;
    hash[8] = (hash[8] & 63) | 128;
    assert.equal(seat.profile.id.replaceAll("-", ""), hash.toString("hex"));
    assert.equal(seat.revision, 1);
    assert.equal(seat.nodePolicy, "elastic");
    assert.equal(seat.dedicatedNodeId, null);
  }
  const another = ensureTeamFromPack(raw, { ...pack, manifest: { ...pack.manifest, version: "2.0.0" } }, deps);
  assert.deepEqual(listSeats(raw, another.teamId).map((seat) => seat.profile), seats.map((seat) => seat.profile));
  const lead = findLeadSeat(raw, first.teamId);
  assert.equal(lead.isLead, true);
  assert.equal(findLeadSeat(raw, randomUUID()), undefined);
  const nonLead = seats.find((seat) => !seat.isLead);
  assert.throws(() => raw.prepare("UPDATE seats SET is_lead = ? WHERE id = ?").run(1, nonLead.id), /UNIQUE/);
});

test("engagements are idempotent and two projects share one team with separate engagements", (t) => {
  const raw = fixture(t);
  const pack = loadPack(packDir);
  const firstProject = project(raw);
  const secondProject = project(raw);
  const firstTeam = ensureTeamFromPack(raw, pack, deps);
  const secondTeam = ensureTeamFromPack(raw, pack, deps);
  assert.equal(firstTeam.teamId, secondTeam.teamId);
  const first = ensureEngagement(raw, { projectId: firstProject, teamId: firstTeam.teamId }, deps);
  assert.equal(first.created, true);
  assert.deepEqual(ensureEngagement(raw, { projectId: firstProject, teamId: firstTeam.teamId }, deps), { ...first, created: false });
  const second = ensureEngagement(raw, { projectId: secondProject, teamId: secondTeam.teamId }, deps);
  assert.equal(second.created, true);
  assert.notEqual(first.engagementId, second.engagementId);
  const engagement = getActiveEngagement(raw, firstProject);
  assert.deepEqual(engagementSchema.parse(engagement), engagement);
  assert.equal(engagement.priority, 50);
  assert.equal(engagement.maxConcurrent, 2);
  assert.equal(engagement.createdAt, deps.clock().toISOString());
  assert.equal(raw.prepare("SELECT count(*) AS n FROM teams").get().n, 1);
  assert.throws(() => raw.prepare(`INSERT INTO engagements (project_id, id, team_id, revision, priority, max_concurrent, state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(firstProject, randomUUID(), firstTeam.teamId, 1, 50, 2, "active", deps.clock().toISOString()), /UNIQUE/);
});
