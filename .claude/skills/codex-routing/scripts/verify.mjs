// Mechanical acceptance checks. They prove what a machine can prove; Claude still reviews meaning.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";


// ---- workspace snapshot: detects any file Codex touched, inside or outside its scope -------------
export function snapshot(repoRoot) {
  const out = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "-z"], { cwd: repoRoot, encoding: "utf8" });
  const map = {};
  for (const entry of out.split("\0").filter(Boolean)) {
    const file = entry.slice(3).replaceAll("\\", "/");
    const abs = path.join(repoRoot, file);
    map[file] = existsSync(abs) ? createHash("sha1").update(readFileSync(abs)).digest("hex") : "deleted";
  }
  return map;
}

export function diffSnapshots(before, after) {
  const changed = [];
  for (const file of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[file] !== after[file]) changed.push(file);
  }
  return changed.sort();
}

export function checkScope(changed, allowedPrefixes = []) {
  const outside = changed.filter((f) => !allowedPrefixes.some((p) => f.startsWith(p)));
  return { id: "scope", pass: outside.length === 0, detail: outside.length ? `outside scope: ${outside.join(", ")}` : `changed ${changed.length} file(s), all in scope` };
}

// ---- answer content checks ------------------------------------------------------------------------
export function checkAnswerRules(text, rules = []) {
  return rules.map((rule) => {
    const hit = rule.anyOf.some((src) => new RegExp(src, "i").test(text));
    return { id: `answer:${rule.id}`, pass: hit, detail: hit ? "matched" : `none of ${rule.anyOf.join(" | ")}` };
  });
}

// Backticked identifiers in the answer should exist in the real source (hallucination guard).
export function checkIdentifiers(text, sourceFile, { minRatio = 0.7, minCount = 5 } = {}) {
  const source = readFileSync(sourceFile, "utf8");
  const found = new Set();
  for (const m of text.matchAll(/`([A-Za-z_$][\w$]*)(?:\(\))?`/g)) {
    const id = m[1];
    const camel = /[a-z][A-Z]/.test(id) || id.includes("_");
    if (id.length >= 5 && camel) found.add(id);
  }
  const real = [...found].filter((id) => new RegExp(`\\b${id.replace(/\$/g, "\\$")}\\b`).test(source));
  const missing = [...found].filter((id) => !real.includes(id));
  const ratio = found.size ? real.length / found.size : 0;
  const pass = found.size >= minCount && ratio >= minRatio;
  return { id: "identifiers", pass, detail: `${real.length}/${found.size} identifiers exist in source (ratio ${ratio.toFixed(2)}, need >= ${minRatio} and >= ${minCount} cited)${missing.length ? `; not found: ${missing.slice(0, 8).join(", ")}` : ""}` };
}

// ---- command checks: only `node --test ...`, no shell --------------------------------------------
// Test files are resolved relative to the command's own cwd (the way node resolves them).
function assertAllowedArgv(argv, repoRoot, cwdRel) {
  for (const arg of argv) {
    if (arg.startsWith("--test")) continue;
    const normalized = arg.replaceAll("\\", "/");
    if (normalized.includes("..") || path.isAbsolute(normalized) || !normalized.endsWith(".mjs")) throw new Error(`argv not allowed: ${arg}`);
    if (!existsSync(path.join(repoRoot, cwdRel, normalized))) throw new Error(`test file not found: ${arg} (in ${cwdRel})`);
  }
}

export function parseTap(output) {
  const num = (name) => Number((output.match(new RegExp(`^# ${name} (\\d+)`, "m")) ?? [])[1] ?? NaN);
  return { tests: num("tests"), pass: num("pass"), fail: num("fail") };
}

export function runNodeTest(spec, repoRoot) {
  assertAllowedArgv(spec.argv, repoRoot, spec.cwd);
  const cwd = path.join(repoRoot, spec.cwd);
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP };
  for (const [k, v] of Object.entries(spec.env ?? {})) env[k] = path.join(repoRoot, v);
  const r = spawnSync(process.execPath, spec.argv, { cwd, env, encoding: "utf8", timeout: 120_000 });
  const tap = parseTap(`${r.stdout ?? ""}`);
  const enough = spec.minTests ? tap.tests >= spec.minTests : true;
  const pass = r.status === 0 && tap.fail === 0 && enough;
  return { id: `command:${spec.id}`, pass, detail: `exit=${r.status} tests=${tap.tests} pass=${tap.pass} fail=${tap.fail}${spec.minTests ? ` (need >= ${spec.minTests} tests)` : ""}` };
}

// ---- npm script checks: only these scripts, run through npm's own JS entry (no shell) --------------
const NPM_ALLOWED = new Set(["test", "run check", "run build"]);
export function runNpmCheck(spec, repoRoot) {
  const script = spec.npm.join(" ");
  if (!NPM_ALLOWED.has(script)) throw new Error(`npm script not allowed: ${script}`);
  const cwd = path.join(repoRoot, spec.cwd);
  const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(cli)) throw new Error(`npm-cli.js not found next to node (${cli})`);
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, APPDATA: process.env.APPDATA, USERPROFILE: process.env.USERPROFILE };
  const r = spawnSync(process.execPath, [cli, ...spec.npm], { cwd, env, encoding: "utf8", timeout: 300_000 });
  const tap = parseTap(`${r.stdout ?? ""}`);
  const enough = spec.minTests ? tap.tests >= spec.minTests : true;
  const pass = r.status === 0 && (Number.isNaN(tap.fail) || tap.fail === 0) && enough;
  return { id: `npm:${spec.id}`, pass, detail: `exit=${r.status} npm ${script}${Number.isNaN(tap.tests) ? "" : ` tests=${tap.tests} pass=${tap.pass} fail=${tap.fail}`}` };
}
