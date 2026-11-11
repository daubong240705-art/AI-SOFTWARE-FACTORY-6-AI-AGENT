import assert from "node:assert/strict";
import { test } from "node:test";
import { findViolations, isProtected } from "./verify-v1-protection.mjs";

test("V1 and legacy platform source and config are protected", () => {
  for (const path of [
    "apps/windows-worker/electron/controller/runs.ts",
    "apps/windows-worker/package.json",
    "apps/api/src/asf_api/main.py",
    "orchestrator/graph.py",
    "infrastructure/docker/compose.dev.yml",
    ".gitlab-ci.yml",
    "uv.lock",
  ]) {
    assert.equal(isProtected(path), true, path);
  }
});

test("markdown and new V2 areas are not protected", () => {
  for (const path of [
    "apps/windows-worker/README.md",
    "docs/architecture/05-target-architecture.md",
    "packages/factory-contracts/src/models.ts",
    "apps/factory-host/src/main.ts",
    "scripts/factory-v2/verify-v1-protection.mjs",
    "poc/model-routing/src/router.mjs",
  ]) {
    assert.equal(isProtected(path), false, path);
  }
});

test("a changed protected file is a violation", () => {
  const r = findViolations(["docs/a.md", "apps/windows-worker/shared/team.ts", "apps/factory-host/x.ts"]);
  assert.deepEqual(r.violations, ["apps/windows-worker/shared/team.ts"]);
});

test("an approved exception with reason and date is accepted and reported", () => {
  const exceptions = [{ path: "apps/windows-worker/shared/team.ts", reason: "security fix", approvedAt: "2026-11-08" }];
  const r = findViolations(["apps/windows-worker/shared/team.ts"], exceptions);
  assert.deepEqual(r.violations, []);
  assert.equal(r.exceptionsUsed.length, 1);
});

test("an exception without a reason or approval date does not count", () => {
  const r = findViolations(["apps/api/x.py"], [{ path: "apps/api/x.py" }]);
  assert.deepEqual(r.violations, ["apps/api/x.py"]);
});
