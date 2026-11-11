import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { checkPackDirectory } from "../dist/org/pack-check.js";
import { temp, writePack } from "./org-fixture.mjs";

const packsDir = fileURLToPath(new URL("../../../packs/", import.meta.url));
const cli = fileURLToPath(new URL("../scripts/pack-check.mjs", import.meta.url));
function make(t, change = () => {}) {
  const dir = writePack(temp(t), "check-team", (m) => {
    m.produces = ["other"]; m.seats[0].capabilities = ["delivery.write"]; m.seats[1].capabilities = ["delivery.write"];
    m.skills = ["skills/example"]; change(m);
  });
  mkdirSync(join(dir, "skills/example"), { recursive: true });
  writeFileSync(join(dir, "skills/example/SKILL.md"), "---\nname: example\ndescription: Write a useful result.\nversion: 1.0.0\nsource: Original\n---\n\nWrite the deliverable with evidence.\n");
  return dir;
}
const run = (...dirs) => spawnSync(process.execPath, [cli, ...dirs], { encoding: "utf8", timeout: 10000 });
test("valid pack returns metadata, digest and no diagnostics", (t) => {
  const result = checkPackDirectory(make(t)); assert.equal(result.ok, true); assert.deepEqual(result.errors, []); assert.deepEqual(result.warnings, []);
  assert.equal(result.summary.key, "check-team"); assert.equal(result.summary.seats, 2); assert.equal(result.summary.skills, 1);
  assert.equal(result.summary.capabilities, 1); assert.equal(result.summary.tools, 0); assert.match(result.summary.digest, /^[a-f0-9]{64}$/);
});
for (const key of ["_template", "software-team", "research-team", "architecture-team", "design-team"]) test(`${key} passes the validator`, () => {
  const result = checkPackDirectory(join(packsDir, key)); assert.equal(result.ok, true); assert.deepEqual(result.errors, []);
  if (key !== "software-team") assert.deepEqual(result.warnings, []);
});
for (const [name, change, expected] of [
  ["unknown tool", (m) => { m.seats[1].tools = ["unknown.tool"]; }, "seats.1.tools.0: unknown tool"],
  ["unmatched prefix", (m) => { m.seats[1].tools = ["unknown.*"]; }, "seats.1.tools.0: unknown tool"],
  ["capability pattern", (m) => { m.seats[1].capabilities = ["INVALID"]; }, "seats.1.capabilities.0: invalid value"],
  ["duplicate capability", (m) => { m.seats[1].capabilities = ["a", "a"]; }, "seats.1.capabilities: duplicate value"],
  ["invalid artifact", (m) => { m.produces = ["invalid"]; }, "produces.0: invalid value"],
  ["duplicate produces", (m) => { m.produces = ["other", "other"]; }, "produces: duplicate value"],
  ["two leads", (m) => { m.seats[1].isLead = true; }, "seats: invalid value"],
  ["profile traversal", (m) => { m.seats[1].profile = "../private-content.md"; }, "seats.1.profile: invalid value"],
  ["unknown fields", (m) => { m["private content"] = "secret text"; }, "manifest: invalid value"],
]) test(`validator rejects ${name}`, (t) => { const result = checkPackDirectory(make(t, change)); assert.equal(result.ok, false); assert.ok(result.errors.includes(expected)); });
test("missing pack directory has a fixed error", (t) => { const r = checkPackDirectory(join(temp(t), "missing")); assert.deepEqual(r.errors, ["pack directory: unavailable"]); });
test("missing manifest has a fixed error", (t) => { assert.deepEqual(checkPackDirectory(temp(t)).errors, ["pack.json: missing or invalid JSON"]); });
test("invalid JSON never echoes bytes", (t) => { const dir = make(t); writeFileSync(join(dir, "pack.json"), "private invalid JSON"); assert.deepEqual(checkPackDirectory(dir).errors, ["pack.json: missing or invalid JSON"]); });
test("missing profile identifies only the relative file", (t) => {
  const dir = make(t); rmSync(join(dir, "worker.md")); const r = checkPackDirectory(dir); assert.ok(r.errors.includes("profile worker.md: missing or invalid"));
});
test("missing skill identifies only its relative directory", (t) => {
  const dir = make(t); rmSync(join(dir, "skills/example/SKILL.md")); assert.ok(checkPackDirectory(dir).errors.includes("skill skills/example: SKILL.md missing or invalid"));
});
test("oversized profile is invalid", (t) => { const dir = make(t); writeFileSync(join(dir, "worker.md"), "x".repeat(65537)); assert.equal(checkPackDirectory(dir).ok, false); });
test("NUL profile is invalid", (t) => { const dir = make(t); writeFileSync(join(dir, "worker.md"), "text\0text"); assert.equal(checkPackDirectory(dir).ok, false); });
for (const text of ["# No frontmatter", "---\nname: example\n---\nText", "---\ndescription: ''\n---\nText"]) test(`missing skill description case ${text.length}`, (t) => {
  const dir = make(t); writeFileSync(join(dir, "skills/example/SKILL.md"), text);
  assert.ok(checkPackDirectory(dir).errors.includes("skill skills/example: SKILL.md has no description"));
});
for (const [count, warning] of [[450, false], [451, true]]) test(`profile word boundary ${count}`, (t) => {
  const dir = make(t); writeFileSync(join(dir, "worker.md"), Array(count).fill("word").join(" ")); const r = checkPackDirectory(dir);
  assert.equal(r.ok, true); assert.equal(r.warnings.some((w) => w.includes("above 450")), warning);
});
test("long skill warns without failing", (t) => {
  const dir = make(t); const path = join(dir, "skills/example/SKILL.md"); writeFileSync(path, readFileSync(path, "utf8") + Array(701).fill("word").join(" "));
  const r = checkPackDirectory(dir); assert.equal(r.ok, true); assert.ok(r.warnings.includes("skill skills/example: above 700 words"));
});
for (const [count, warning] of [[250, false], [251, true]]) test(`description character boundary ${count}`, (t) => {
  const dir = make(t); writeFileSync(join(dir, "skills/example/SKILL.md"), `---\ndescription: ${"x".repeat(count)}\n---\nText`);
  const r = checkPackDirectory(dir); assert.equal(r.ok, true); assert.equal(r.warnings.some((w) => w.includes("description above")), warning);
});
for (const [name, change, expected] of [
  ["missing produces", (m) => { delete m.produces; }, "produces: missing"],
  ["missing capabilities", (m) => { delete m.seats[1].capabilities; }, "seats.1.capabilities: missing"],
  ["duplicate tools", (m) => { m.seats[1].tools = ["knowledge.get", "knowledge.get"]; }, "seats.1.tools: duplicate tool"],
  ["unsupported lead capability", (m) => { m.seats[0].capabilities = ["lead.coordinate"]; }, "seats.0.capabilities: lead capability has no worker"],
]) test(`validator warns for ${name}`, (t) => { const r = checkPackDirectory(make(t, change)); assert.equal(r.ok, true); assert.ok(r.warnings.includes(expected)); });
test("diagnostics never contain content or absolute paths", (t) => {
  const dir = make(t, (m) => { m.seats[1].tools = ["private-content-value"]; }); const r = checkPackDirectory(dir); const text = JSON.stringify(r);
  assert.equal(text.includes(dir), false); assert.equal(text.includes("private-content-value"), false); assert.equal(/[A-Za-z]:[\\/]/.test(text), false);
});
for (const args of [[], ["--help"], ["--invalid"]]) test(`CLI usage error case ${args.join("") || "empty"}`, () => { const r = run(...args); assert.equal(r.status, 2); assert.match(r.stderr, /^Usage:/); assert.equal(r.stdout, ""); });
test("CLI succeeds for multiple valid packs", (t) => { const r = run(make(t), join(packsDir, "_template")); assert.equal(r.status, 0); assert.match(r.stdout, /Pack 1: OK/); assert.match(r.stdout, /Pack 2: OK/); assert.equal(r.stderr, ""); });
test("CLI continues after an invalid pack and returns one", (t) => { const dir = temp(t); const r = run(dir, make(t)); assert.equal(r.status, 1); assert.match(r.stdout, /Pack 1: INVALID/); assert.match(r.stdout, /Pack 2: OK/); assert.equal(r.stdout.includes(dir), false); assert.equal(r.stderr, ""); });
