import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = resolve(root, "packages/factory-contracts");
const reportPath = resolve(root, "research/factory-v2/f0-03-validation.json");
const baseline = "864b22b";
const checkpoint = "checkpoint/factory-v2-f0-03-20261106";
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const packageJson = JSON.parse(read("packages/factory-contracts/package.json"));
const lock = JSON.parse(read("packages/factory-contracts/package-lock.json"));
assert.equal(git("rev-parse", checkpoint), git("rev-parse", baseline));
// Every file already tracked at the checkpoint is protected unless it is a V2 doc/check.
// Markdown documentation may move or change (docs archive 07/11/2026); source and config stay protected.
const tracked = new Set(
  git("ls-tree", "-r", "--name-only", baseline).split("\n"),
);
const changed = git("diff", "--name-only", baseline)
  .split("\n")
  .filter(Boolean);
const allowed = [
  "plan/factory-v2/",
  "research/factory-v2/",
  "scripts/factory-v2/",
];
assert.deepEqual(
  changed.filter(
    (path) =>
      tracked.has(path) &&
      !path.endsWith(".md") &&
      !path.startsWith("plan/experience-loops/") &&
      !allowed.some((prefix) => path.startsWith(prefix)),
  ),
  [],
  "Legacy tracked source/config must remain unchanged",
);
assert(
  !existsSync(resolve(root, "package.json")),
  "Do not introduce root npm workspace",
);
assert.deepEqual(Object.keys(packageJson.dependencies), ["zod"]);
assert.equal(
  packageJson.dependencies.zod,
  lock.packages["node_modules/zod"].version,
);
assert.equal(
  packageJson.devDependencies.typescript,
  lock.packages["node_modules/typescript"].version,
);
const sourceFiles = readdirSync(resolve(pkg, "src")).filter((path) =>
  path.endsWith(".ts"),
);
for (const file of sourceFiles) {
  const source = read("packages/factory-contracts/src/" + file);
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g))
    assert(
      match[1] === "zod" || /^\.\/[^/]+\.js$/.test(match[1]),
      "Unexpected dependency in " + file,
    );
  assert(
    !/\b(?:require|eval)\s*\(|\bimport\s*\(/.test(source),
    "No dynamic execution/import in contracts",
  );
}
let checkedLinks = 0;
for (const path of [
  "packages/factory-contracts/README.md",
  "plan/factory-v2/f0-03-contracts.md",
  "plan/factory-v2/README.md",
  "plan/factory-v2/delivery-plan.md",
  "scripts/factory-v2/README.md",
]) {
  for (const match of read(path).matchAll(/\]\((<[^>]+>|[^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, "").split("#")[0];
    if (!target || /^[a-z]+:\/\//i.test(target)) continue;
    const absoluteTarget = resolve(
      root,
      dirname(path),
      decodeURIComponent(target),
    );
    // This verifier creates its own evidence file only after all checks pass.
    assert(
      absoluteTarget === reportPath || existsSync(absoluteTarget),
      "Broken link: " + path + " -> " + target,
    );
    checkedLinks++;
  }
}
const tsc = resolve(pkg, "node_modules/typescript/bin/tsc");
assert(
  existsSync(tsc),
  "First run npm ci --ignore-scripts in packages/factory-contracts",
);
execFileSync(process.execPath, [tsc, "--noEmit"], { cwd: pkg, stdio: "pipe" });
execFileSync(process.execPath, [tsc], { cwd: pkg, stdio: "pipe" });
const { FOUNDATION_COMMANDS } = await import(
  pathToFileURL(resolve(pkg, "dist/index.js")).href
);
const contractTests = execFileSync(
  process.execPath,
  ["--test", "test/contracts.test.mjs"],
  { cwd: pkg, encoding: "utf8" },
);
assert(contractTests.includes("# fail 0"));
// Capture unittest output in stdout so failure evidence is preserved across platforms.
const sqlTests = execFileSync(
  "python",
  [
    "-c",
    "import runpy,sys; sys.stderr=sys.stdout; runpy.run_path('scripts/factory-v2/schema.test.py',run_name='__main__')",
  ],
  { cwd: root, encoding: "utf8" },
);
assert(/Ran \d+ tests/.test(sqlTests) && /\nOK\s*$/.test(sqlTests));
const files = [
  ...sourceFiles.map((file) => "packages/factory-contracts/src/" + file),
  "packages/factory-contracts/test/contracts.test.mjs",
  "packages/factory-contracts/package.json",
  "packages/factory-contracts/package-lock.json",
  "packages/factory-contracts/tsconfig.json",
  "schema/factory-v2/001-core.reference.sql",
  "scripts/factory-v2/schema.test.py",
  "scripts/factory-v2/verify-contracts.mjs",
];
const report = {
  schemaVersion: 1,
  userFacingDate: "2026-11-06",
  ticket: "F0-03",
  baseline: git("rev-parse", baseline),
  checkpoint,
  scope:
    "Shared contracts, ADR, and temporary SQLite reference invariants; no live Host/runtime/data migration",
  tools: {
    node: process.version,
    typescript: packageJson.devDependencies.typescript,
    zod: packageJson.dependencies.zod,
    sqlite: execFileSync(
      "python",
      ["-c", "import sqlite3; print(sqlite3.sqlite_version)"],
      { encoding: "utf8" },
    ).trim(),
  },
  counts: {
    commands: FOUNDATION_COMMANDS.length,
    sourceModules: sourceFiles.length,
    contractTests: Number(contractTests.match(/# tests (\d+)/)[1]),
    sqliteMemoryTests: Number(sqlTests.match(/Ran (\d+) tests/)[1]),
    checkedLocalDocLinks: checkedLinks,
  },
  checks: {
    typecheck: true,
    buildDeclarationsAndEsm: true,
    boundaryTests: true,
    sqliteMemoryTests: true,
    packageDependencyBoundary: true,
    lockfilePinned: true,
    docLinks: true,
    trackedLegacyUnchanged: true,
    noRootWorkspace: true,
    checkpointVerified: true,
  },
  files: files.map((path) => ({
    path,
    sha256: createHash("sha256")
      .update(read(path).replace(/\r\n/g, "\n"))
      .digest("hex"),
  })),
  hashEncoding: "UTF-8 source normalized to LF",
  notImplemented: [
    "HTTP server, auth/session/CSRF/origin enforcement and command handlers",
    "Production SQLite migrations, coordinator/recovery and cross-process concurrency",
    "Real runtime adapters, effective permission enforcement and owned Linux process stop",
    "Browser UI, durable draft/window store, multi-tab and real reconnect tests",
    "Future domain document/output/review/automation/job tables and services",
  ],
};
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      counts: report.counts,
      checks: report.checks,
      notImplemented: report.notImplemented,
    },
    null,
    2,
  ),
);
