import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { artifactKindSchema, MCP_TOOL_NAMES } from "@factory/contracts";
import { loadPack, loadPackRegistry, packManifestSchema, registryEntry } from "../dist/org/index.js";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
import { fixture, pack, temp, writePack } from "./org-fixture.mjs";

const packsDir = fileURLToPath(new URL("../../../packs/", import.meta.url));
const base = () => structuredClone(pack.manifest);
for (const [index, value] of [[], ["a"], ["research.evidence"], ["a-b.c9"], ["x".repeat(40)], Array.from({ length: 12 }, (_, i) => `c${i}`)].entries())
  test(`capabilities valid case ${index}`, () => { const m = base(); m.seats[1].capabilities = value; assert.ok(packManifestSchema.safeParse(m).success); });
for (const [index, value] of [[""], ["A"], [".x"], ["-x"], ["a_b"], ["x y"], ["x/"], ["x".repeat(41)], ["a", "a"], Array.from({ length: 13 }, (_, i) => `c${i}`), "a", null, [1]].entries())
  test(`capabilities invalid case ${index}`, () => { const m = base(); m.seats[1].capabilities = value; assert.equal(packManifestSchema.safeParse(m).success, false); });
for (const name of MCP_TOOL_NAMES) test(`known tool declaration ${name}`, () => { const m = base(); m.seats[0].tools = [name]; assert.ok(packManifestSchema.safeParse(m).success); });
for (const [index, value] of [[], ["knowledge.*"], ["request.*"], Array(32).fill("knowledge.get")].entries())
  test(`tools valid boundary case ${index}`, () => { const m = base(); m.seats[1].tools = value; assert.ok(packManifestSchema.safeParse(m).success); });
for (const [index, value] of [["missing.tool"], ["ext.tool"], ["unknown.*"], ["*"], ["knowledge*"], ["knowledge.**"], ["Knowledge.*"], ["knowledge.get.*"], [""], Array(33).fill("skill.get"), null, "knowledge.get", [1]].entries())
  test(`tools invalid case ${index}`, () => { const m = base(); m.seats[0].tools = value; assert.equal(packManifestSchema.safeParse(m).success, false); });
for (const [index, value] of [[], ["other"], artifactKindSchema.options].entries())
  test(`produces valid case ${index}`, () => { const m = base(); m.produces = value; assert.ok(packManifestSchema.safeParse(m).success); });
for (const [index, value] of [["unknown"], ["other", "other"], [...artifactKindSchema.options, "other"], null, "other"].entries())
  test(`produces invalid case ${index}`, () => { const m = base(); m.produces = value; assert.equal(packManifestSchema.safeParse(m).success, false); });
test("software pack digest and v1 schema stay unchanged", () => {
  assert.equal(loadPack(join(packsDir, "software-team")).digest, "1071840e726289f5c65e9a67feed1a6f5721a716003fcb4809b9363f2f411305");
  assert.deepEqual(packManifestSchema.parse(pack.manifest), pack.manifest);
  assert.equal(Object.hasOwn(registryEntry(pack), "produces"), false);
  assert.equal(Object.hasOwn(registryEntry(pack).seats[0], "tools"), false);
});
test("capability edits change the content digest", (t) => {
  const dir = writePack(temp(t)); const before = loadPack(dir).digest;
  const m = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8")); m.seats[1].capabilities = ["delivery.write"];
  writeFileSync(join(dir, "pack.json"), JSON.stringify(m)); assert.notEqual(loadPack(dir).digest, before);
});
test("invalid pack errors never echo manifest content", (t) => {
  const dir = writePack(temp(t), "invalid-team", (m) => { m.seats[0].tools = ["private-invalid-value"]; });
  assert.throws(() => loadPack(dir), { message: "Invalid pack manifest" });
});
test("registry silently skips templates and hidden directories", (t) => {
  const root = temp(t); writePack(root); mkdirSync(join(root, "_broken")); mkdirSync(join(root, ".broken"));
  const errors = []; assert.equal(loadPackRegistry(root, { onError: (e) => errors.push(e) }).length, 1); assert.deepEqual(errors, []);
});
test("real registry has exactly the four public packs", () => {
  const errors = []; const entries = loadPackRegistry(packsDir, { onError: (e) => errors.push(e) });
  assert.deepEqual(entries.map((p) => p.key), ["architecture-team", "design-team", "research-team", "software-team"]); assert.deepEqual(errors, []);
});
test("packs route adds v2 metadata and preserves absent v1 fields", async (t) => {
  const f = fixture(t); const host = "127.0.0.1:8787"; const origin = `http://${host}`;
  const gate = createBootstrapGate({ clock: f.clock });
  const app = createApiServer({ origins: [origin], clock: f.clock, gate, sessions: createSessionStore({ clock: f.clock }),
    register: createRoutes({ storage: f.storage, hub: f.hub, pipeline: f.pipeline, packs: loadPackRegistry(packsDir) }) });
  t.after(() => app.close());
  const auth = await app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host, origin, "content-type": "application/json" }, payload: { token: gate.token } });
  assert.equal(auth.statusCode, 200);
  const response = await app.inject({ url: "/packs", headers: { host, cookie: auth.headers["set-cookie"].split(";")[0] } });
  assert.equal(response.statusCode, 200);
  for (const entry of response.json().packs) {
    const manifest = loadPack(join(packsDir, entry.key)).manifest;
    assert.deepEqual(entry.produces, manifest.produces);
    for (const seat of entry.seats) {
      const expected = manifest.seats.find((s) => s.name === seat.name);
      assert.deepEqual(seat.capabilities, expected.capabilities); assert.deepEqual(seat.tools, expected.tools);
      assert.equal(Object.hasOwn(seat, "profile"), false);
    }
  }
});
