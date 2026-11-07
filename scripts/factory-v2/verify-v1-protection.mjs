#!/usr/bin/env node
// V1 Protection Guard (RM-04). One command that proves the running products were not changed:
//   - Windows Worker V1 (apps/windows-worker)
//   - the legacy Python platform (apps/api, apps/dashboard, orchestrator, workers, ...)
// Source and configuration are compared with a recorded baseline commit. Markdown is not protected,
// so documentation can move. A change to a protected file needs an entry in
// v1-protection.exceptions.json (path, reason, approvedAt) that the user approved.
//
//   node scripts/factory-v2/verify-v1-protection.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROTECTED_PREFIXES = [
  "apps/windows-worker/",
  "apps/api/",
  "apps/dashboard/",
  "orchestrator/",
  "workers/",
  "agents/",
  "integrations/",
  "shared/",
  "infrastructure/",
  "tests/",
  "spikes/",
];
export const PROTECTED_FILES = [".gitlab-ci.yml", "pyproject.toml", "alembic.ini", "uv.lock", ".python-version", ".dockerignore"];

export function isProtected(path) {
  if (path.endsWith(".md")) return false; // documentation may move or change
  return PROTECTED_FILES.includes(path) || PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// Pure function, unit-tested: which changed files break the guard?
export function findViolations(changed, exceptions = []) {
  const allowed = new Map(exceptions.map((e) => [e.path, e]));
  const violations = [];
  const used = [];
  for (const path of changed) {
    if (!isProtected(path)) continue;
    const exception = allowed.get(path);
    if (exception && exception.reason && exception.approvedAt) used.push(exception);
    else violations.push(path);
  }
  return { violations: violations.sort(), exceptionsUsed: used };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const here = (name) => resolve(root, "scripts/factory-v2", name);
  const baseline = JSON.parse(readFileSync(here("v1-protection.baseline.json"), "utf8"));
  const exceptions = existsSync(here("v1-protection.exceptions.json"))
    ? JSON.parse(readFileSync(here("v1-protection.exceptions.json"), "utf8")).exceptions ?? []
    : [];

  const problems = [];
  const commit = git("rev-parse", "--verify", `${baseline.commit}^{commit}`);
  try {
    git("merge-base", "--is-ancestor", commit, "HEAD");
  } catch {
    problems.push(`baseline ${baseline.commit} is not an ancestor of HEAD`);
  }
  if (existsSync(resolve(root, "package.json"))) problems.push("a root package.json exists (no root npm workspace is allowed, ADR-T11)");

  // Committed changes since the baseline plus uncommitted tracked and untracked files.
  const names = new Set();
  for (const list of [
    git("diff", "--name-only", commit, "HEAD"),
    git("diff", "--name-only", "HEAD"),
    git("ls-files", "--others", "--exclude-standard"),
  ]) {
    for (const line of list.split("\n").filter(Boolean)) names.add(line);
  }
  const { violations, exceptionsUsed } = findViolations([...names], exceptions);

  const report = {
    baseline: commit.slice(0, 7),
    head: git("rev-parse", "--short", "HEAD"),
    changedFiles: names.size,
    protectedViolations: violations,
    exceptionsUsed,
    problems,
    ok: violations.length === 0 && problems.length === 0,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
