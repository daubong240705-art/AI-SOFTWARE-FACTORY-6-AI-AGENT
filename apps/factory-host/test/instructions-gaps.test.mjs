// Closes mutation survivors of the P2 review: skill order, byte boundaries of skill text and pack files.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { pumped } from "./org-fixture.mjs";
import { instructionsFixture, diskPack } from "./instructions-fixture.mjs";
import { getSeatInstructions } from "../dist/instructions/snapshot.js";
import { createSkillsMcp } from "../dist/instructions/mcp.js";
import { loadPack } from "../dist/org/pack.js";

test("the skill catalog is ordered by path", (t) => {
  const f = instructionsFixture(t);
  const disk = diskPack(t, { key: "ordered-team", skills: ["zeta", "alpha", "mid"], content: "---\nname: x\ndescription: Ordered skill.\n---\nText" });
  const team = f.create(disk.load());
  const seat = f.raw.prepare("SELECT id FROM seats WHERE team_id = ? AND name = 'BE'").get(team.teamId);
  assert.deepEqual(getSeatInstructions(f.raw, { seatId: seat.id }).skills.map((skill) => skill.name), ["alpha", "mid", "zeta"]);
});
for (const [size, truncated] of [[32767, false], [32768, false], [32769, true]]) test(`a skill of ${size} bytes is ${truncated ? "truncated" : "returned whole"}`, async (t) => {
  const f = instructionsFixture(t); const body = "x".repeat(size);
  f.raw.prepare("UPDATE pack_files SET content = ? WHERE digest = ? AND kind = 'skill'").run(body, f.pack.digest);
  const a = f.enqueueInstructions(); await pumped();
  f.raw.prepare("UPDATE attempts SET state='running',lease_id=?,lease_expires_at='2099-01-01T00:00:00.000Z' WHERE id=?").run(randomUUID(), a.id);
  const grant = { projectId: f.projectId, taskId: f.taskId, attemptId: a.id, epoch: a.epoch, allowedModels: ["approved"] };
  const result = createSkillsMcp({ raw: f.raw, now: f.clock }).call(grant, "skill.get", { name: "verify" });
  assert.equal(result.isError, false, result.content[0].text);
  const text = result.content[0].text;
  assert.equal(text.endsWith("[truncated]"), truncated);
  assert.ok(Buffer.byteLength(text) <= 32768);
  if (!truncated) assert.equal(text.length, size);
});
for (const [size, ok] of [[65536, true], [65537, false]]) test(`a profile of ${size} bytes ${ok ? "loads" : "is rejected"}`, (t) => {
  const disk = diskPack(t, { key: "size-team", profile: "p".repeat(size) });
  if (ok) assert.equal(loadPack(disk.dir).files.profiles.find((profile) => profile.path === "worker.md").content.length, size);
  else assert.throws(() => loadPack(disk.dir));
});
test("a skill of exactly 65536 bytes loads and one byte more is rejected", (t) => {
  const edge = diskPack(t, { key: "skill-edge", content: "s".repeat(65536) });
  assert.equal(loadPack(edge.dir).files.skills[0].content.length, 65536);
  const over = diskPack(t, { key: "skill-over", content: "s".repeat(65537) });
  assert.throws(() => loadPack(over.dir));
});
void mkdirSync; void writeFileSync; void join;
test("the skills handler refuses any other tool name", async (t) => {
  const f = instructionsFixture(t); const a = f.enqueueInstructions(); await pumped();
  f.raw.prepare("UPDATE attempts SET state='running',lease_id=?,lease_expires_at='2099-01-01T00:00:00.000Z' WHERE id=?").run(randomUUID(), a.id);
  const grant = { projectId: f.projectId, taskId: f.taskId, attemptId: a.id, epoch: a.epoch, allowedModels: ["approved"] };
  const result = createSkillsMcp({ raw: f.raw, now: f.clock }).call(grant, "knowledge.get", { name: "verify" });
  assert.equal(result.isError, true); assert.equal(result.content[0].text, "invalid tool input");
});
test("the team view exposes pinned capabilities and tools for a v2 pack", async (t) => {
  const { teamViews } = await import("../dist/org/views.js");
  const f = instructionsFixture(t);
  const disk = diskPack(t, { key: "v2-view-team", skills: ["verify"] });
  const manifestPath = join(disk.dir, "pack.json");
  const manifest = JSON.parse((await import("node:fs")).readFileSync(manifestPath, "utf8"));
  manifest.seats[1].capabilities = ["research.evidence"]; manifest.seats[1].tools = ["knowledge.*"];
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const team = f.create(disk.load());
  const view = teamViews(f.raw).find((entry) => entry.id === team.teamId);
  const worker = view.seats.find((seat) => seat.name === manifest.seats[1].name);
  assert.deepEqual(worker.capabilities, ["research.evidence"]); assert.deepEqual(worker.tools, ["knowledge.*"]);
  assert.equal("capabilities" in view.seats.find((seat) => seat.isLead), false);
});
