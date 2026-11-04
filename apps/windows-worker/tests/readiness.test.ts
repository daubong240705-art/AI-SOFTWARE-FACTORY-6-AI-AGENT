import { test } from "node:test";
import assert from "node:assert/strict";
import { readinessResult } from "../shared/readiness";
import { defaultSettings } from "../shared/defaults";
import { workTemplates, applyWorkTemplate } from "../shared/templates";
import {
  inferWorkType,
  loadSkillCatalog,
  selectSkills,
} from "../electron/team/skills";
import { createBoardItemSchema } from "../shared/board";

function input() {
  const settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.find((a) => a.role === "lead")!.model = "fixture";
  return {
    projectId: crypto.randomUUID(),
    settings,
    tools: [
      {
        name: "OpenCode",
        available: true,
        version: "1.19.5",
        path: "opencode.exe",
      },
    ],
    git: null,
    folder: true,
    ca: true,
    credential: "available" as "available" | "none" | "unreadable",
    busy: false,
  };
}
test("local readiness separates required configuration, recommendations and occupied slot without mutating settings", () => {
  const x = input(),
    saved = structuredClone(x.settings);
  const result = readinessResult(x);
  assert.equal(result.ready, true);
  assert.equal(result.slot, "available");
  assert.equal(result.checks.find((c) => c.id === "git")?.status, "unknown");
  assert.match(
    result.checks.find((c) => c.id === "gateway")!.detail,
    /chưa kiểm tra kết nối/,
  );
  assert.equal(readinessResult({ ...x, busy: true }).ready, true);
  assert.equal(readinessResult({ ...x, busy: true }).slot, "occupied");
  assert.equal(readinessResult({ ...x, credential: "none" }).ready, true);
  assert.deepEqual(x.settings, saved);
});
test("missing runtime, unreadable key, CA, folder and missing gateway/model fail local readiness", () => {
  const x = input();
  for (const patch of [
    { folder: false },
    { ca: false },
    { credential: "unreadable" as const },
    { tools: [] },
    { tools: [{ ...x.tools[0], version: "different" }] },
  ]) {
    assert.equal(readinessResult({ ...x, ...patch }).ready, false);
  }
  x.settings.gatewayUrl = "";
  assert.equal(readinessResult(x).ready, false);
  x.settings.gatewayUrl = "https://unused.example/v1";
  x.settings.agents.find((a) => a.role === "lead")!.model = "";
  assert.equal(readinessResult(x).ready, false);
});
test("isolated-pair requires a clean committed Git repository while sequential mode keeps Git optional", () => {
  const x = input();
  x.settings.teamExecution = "isolated-pair";
  assert.equal(readinessResult(x).ready, false);
  const git = { gitRoot: "source", branch: "main", changedFiles: 0 };
  assert.equal(readinessResult({ ...x, git }).ready, true);
  assert.equal(
    readinessResult({ ...x, git: { ...git, changedFiles: 1 } }).ready,
    false,
  );
  assert.equal(
    readinessResult({ ...x, git: { ...git, branch: null } }).ready,
    false,
  );
  x.settings.teamExecution = "sequential";
  assert.equal(
    readinessResult({ ...x, git: { ...git, changedFiles: 1 } }).ready,
    true,
  );
});
test("four templates produce editable bounded work drafts and refer only to compatible packaged skills", () => {
  assert.deepEqual(
    workTemplates.map((t) => t.id),
    ["feature", "bug", "review", "docs"],
  );
  const catalog = loadSkillCatalog();
  for (const template of workTemplates) {
    const draft = applyWorkTemplate(template.id);
    assert.equal(draft.body, template.body);
    assert.ok(
      createBoardItemSchema.safeParse({
        projectId: crypto.randomUUID(),
        title: template.label,
        ...draft,
        criteria: draft.criteria.split("\n"),
        suggestedRole: null,
        priority: 0,
        planningState: "backlog",
      }).success,
    );
    const selection = selectSkills(
      catalog,
      "be",
      template.workType,
      template.skills,
    );
    assert.ok(selection.skills.every((s) => s.source === "asf-internal"));
    if (template.id === "bug")
      assert.equal(inferWorkType("be", draft.body), "bugfix");
  }
  assert.throws(() => applyWorkTemplate("remote-template"), /không hợp lệ/);
});
