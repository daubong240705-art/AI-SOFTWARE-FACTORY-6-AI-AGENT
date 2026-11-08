import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadPackRegistry, registryPack, loadPack } from "../dist/org/index.js";
import { pack, temp, writePack } from "./org-fixture.mjs";

test("registry discovers the default repository pack", () => {
  const registry = loadPackRegistry(fileURLToPath(new URL("../../../packs/", import.meta.url)));
  const entry = registry.find((entry) => entry.key === "software-team");
  assert.equal(entry.isDefault, true); assert.equal(entry.seats.length, 7);
  assert.deepEqual(registryPack(entry), pack);
  assert.deepEqual(Object.keys(entry).sort(), ["key", "version", "name", "description", "seats", "isDefault"].sort());
});
test("empty registry is valid", (t) => assert.deepEqual(loadPackRegistry(temp(t)), []));
test("registry loads multiple valid packs in key order", (t) => {
  const dir = temp(t); writePack(dir, "zeta-team"); writePack(dir, "alpha-team");
  const entries = loadPackRegistry(dir); assert.deepEqual(entries.map((p) => p.key), ["alpha-team", "zeta-team"]);
  assert.ok(entries.every((p) => !p.isDefault)); assert.equal(entries[0].seats[1].slots, 2);
});
test("registry ignores ordinary files", (t) => {
  const dir = temp(t); writeFileSync(join(dir, "note.txt"), "unrelated"); assert.deepEqual(loadPackRegistry(dir), []);
});
test("registry refuses duplicate keys across versions", (t) => {
  const dir = temp(t); writePack(dir, "first-team", (m) => { m.key = "duplicate-team"; });
  writePack(dir, "second-team", (m) => { m.key = "duplicate-team"; m.version = "2.0.0"; });
  assert.throws(() => loadPackRegistry(dir), { message: "Duplicate pack key" });
});
test("custom default pack replaces its discovered counterpart", (t) => {
  const dir = temp(t); writePack(dir, "example-team");
  const custom = loadPack(writePack(temp(t), "example-team", (m) => { m.version = "2.0.0"; }));
  const entries = loadPackRegistry(dir, { defaultPack: custom });
  assert.equal(entries.length, 1); assert.equal(entries[0].version, "2.0.0"); assert.equal(entries[0].isDefault, true);
});
test("custom default pack works with an empty registry", (t) => {
  const entries = loadPackRegistry(temp(t), { defaultPack: pack }); assert.equal(entries.length, 1); assert.equal(entries[0].isDefault, true);
});
test("unavailable registry reports only a fixed message", (t) => {
  const messages = []; assert.deepEqual(loadPackRegistry(join(temp(t), "absent"), { onError: (m) => messages.push(m) }), []);
  assert.deepEqual(messages, ["Pack skipped: invalid pack"]);
});
for (const [label, change] of [
  ["no Lead", (m) => { m.seats[0].isLead = false; }],
  ["two Leads", (m) => { m.seats[1].isLead = true; }],
  ["duplicate seats", (m) => { m.seats[1].name = "Lead"; }],
  ["invalid runtime", (m) => { m.seats[1].runtime = "invalid"; }],
  ["zero slots", (m) => { m.seats[1].slots = 0; }],
  ["excess slots", (m) => { m.seats[1].slots = 9; }],
  ["invalid key", (m) => { m.key = "INVALID"; }],
  ["invalid version", (m) => { m.version = "v1"; }],
  ["missing profile", (m) => { m.seats[0].profile = "missing.md"; }],
  ["traversal profile", (m) => { m.seats[0].profile = "../outside.md"; }],
  ["missing skill", (m) => { m.skills = ["missing-skill"]; }],
  ["unknown field", (m) => { m.unknown = true; }],
  ["empty seats", (m) => { m.seats = []; }],
]) test(`registry skips a pack with ${label} and keeps valid packs`, (t) => {
  const dir = temp(t); writePack(dir, "good-team"); writePack(dir, "broken-team", change);
  const messages = []; const entries = loadPackRegistry(dir, { onError: (message) => messages.push(message) });
  assert.deepEqual(entries.map((entry) => entry.key), ["good-team"]);
  assert.deepEqual(messages, ["Pack skipped: invalid pack"]);
  assert.equal(JSON.stringify(messages).includes(dir), false);
});
test("malformed JSON is skipped even when the observer throws", (t) => {
  const dir = temp(t); const broken = writePack(dir); writeFileSync(join(broken, "pack.json"), "{");
  assert.deepEqual(loadPackRegistry(dir, { onError() { throw new Error("observer failed"); } }), []);
});
test("directory without a manifest is skipped", (t) => {
  const dir = temp(t); mkdirSync(join(dir, "empty")); const messages = [];
  assert.deepEqual(loadPackRegistry(dir, { onError: (m) => messages.push(m) }), []); assert.equal(messages.length, 1);
});
test("profile must be a file", (t) => {
  const dir = temp(t); const example = writePack(dir); rmSync(join(example, "lead.md")); mkdirSync(join(example, "lead.md"));
  assert.deepEqual(loadPackRegistry(dir), []);
});
