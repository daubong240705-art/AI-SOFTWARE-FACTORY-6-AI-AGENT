import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { loadProfiles } from "../electron/team/profiles";
import {
  inferWorkType,
  loadSkillCatalog,
  selectSkills,
  selectTaskSkills,
  selectedInstructions,
  skillCatalogSummary,
  validateSkillCatalog,
} from "../electron/team/skills";
import { newTask, coordinate, TeamBlocked } from "../electron/team/coordinator";
import { runtimeContext } from "../electron/team/policy";
import { runtimePermissions } from "../electron/runtime/permissions";
import { Store } from "../electron/storage/database";
import { defaultSettings, roles } from "../shared/defaults";
import { plannedTaskSchema, type TeamTask } from "../shared/team";
import type { SkillId, WorkType } from "../shared/skills";
import type { Run } from "../shared/runs";

function fixture(workspace = tmpdir()): Run {
  const settings = defaultSettings();
  settings.agents.forEach((a) => {
    a.enabled = true;
    a.model = "fixture";
  });
  return {
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    projectName: "Skills",
    workspace,
    prompt: "Implement a feature",
    role: "lead",
    model: "fixture",
    mode: "team",
    tasks: [],
    profiles: loadProfiles(),
    skillCatalog: loadSkillCatalog(),
    currentTaskId: null,
    fixRound: 0,
    review: null,
    state: "completed",
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
    sessionId: null,
    summary: "",
    error: "",
    settings,
    changes: [],
    commands: [],
    permissions: [],
    requests: 0,
    baselineComplete: true,
    toolsCompleted: 0,
    runtimeVersion: "",
    inputTokens: 0,
    outputTokens: 0,
  };
}
const input = (
  workType: WorkType = "implementation",
  skillIds?: SkillId[],
) => ({
  id: "t1",
  role: "be" as const,
  title: "Work",
  instructions: "Work",
  allowedPaths: ["src"],
  acceptance: ["Source correct"],
  dependsOn: [],
  workType,
  skillIds,
  kind: "work" as const,
});
const ids = (task: TeamTask) => task.skillSelection!.skills.map((s) => s.id);

test("catalog has fixed local origins, content versions/hashes and no executable hook or model path", () => {
  const catalog = loadSkillCatalog();
  validateSkillCatalog(catalog);
  assert.equal(catalog.skills.length, 4);
  for (const skill of catalog.skills) {
    assert.equal(skill.path, `skills/${skill.id}/SKILL.md`);
    assert.equal(skill.source, "asf-internal");
    assert.equal(
      skill.hash,
      createHash("sha256").update(skill.instructions).digest("hex"),
    );
    assert.equal(
      skill.version,
      ["fix-bug", "testing"].includes(skill.id) ? "1.1.0" : "1.0.0",
    );
  }
  const tampered = structuredClone(catalog);
  tampered.skills[0].roles.push("lead");
  assert.throws(() => validateSkillCatalog(tampered), /metadata/);
  const external = structuredClone(catalog);
  external.skills[0].path = "https://example.invalid/SKILL.md";
  assert.throws(() => validateSkillCatalog(external), /metadata/);
  assert.ok(JSON.stringify(skillCatalogSummary(catalog)).length < 1600);
  assert.ok(
    !JSON.stringify(skillCatalogSummary(catalog)).includes("instructions"),
  );
});

test("task selection is small, purpose-specific and bounded for docs, fixes, tests and local toolchain", () => {
  const run = fixture();
  assert.deepEqual(ids(newTask(run, input("docs"))), []);
  assert.deepEqual(ids(newTask(run, input("analysis"))), []);
  assert.deepEqual(ids(newTask(run, input())), [
    "implement-feature",
    "testing",
  ]);
  assert.deepEqual(ids(newTask(run, input("bugfix"))), ["fix-bug", "testing"]);
  assert.deepEqual(ids(newTask(run, { ...input("testing"), role: "test" })), [
    "testing",
  ]);
  assert.deepEqual(
    ids(newTask(run, { ...input("local-dev"), role: "devops" })),
    ["local-dev", "testing"],
  );
  assert.deepEqual(
    ids(newTask(run, { ...input("bugfix", ["local-dev"]), role: "devops" })),
    ["fix-bug", "testing", "local-dev"],
  );
  const original = newTask(run, input("implementation", ["implement-feature"]));
  const fixed = newTask(run, { ...original, id: "t1-fix-1", kind: "fix" });
  assert.deepEqual(ids(fixed), ["fix-bug", "testing"]);
  assert.notEqual(fixed.skillSelection, original.skillSelection);
  assert.equal(inferWorkType("be", "Cập nhật tài liệu hướng dẫn"), "docs");
  assert.equal(inferWorkType("be", "Fix typo", ["docs/guide.md"]), "docs");
  assert.equal(inferWorkType("be", "Sửa lỗi đăng nhập"), "bugfix");
  assert.equal(inferWorkType("lead", "Review changes"), "analysis");
  assert.equal(inferWorkType("test", "Run checks"), "testing");
  assert.equal(inferWorkType("devops", "Configure local build"), "local-dev");
});

test("unknown IDs, wrong roles/task kinds, duplicates and more than three skills fail before task execution", () => {
  const run = fixture();
  for (const [role, kind, suggested] of [
    ["lead", "implementation", ["implement-feature"]],
    ["pm", "testing", ["testing"]],
    ["test", "implementation", ["implement-feature"]],
    ["be", "docs", ["testing"]],
    ["be", "bugfix", ["https://bad/skill"]],
    ["be", "bugfix", ["../local-dev"]],
    ["be", "bugfix", ["testing", "testing"]],
    [
      "devops",
      "bugfix",
      ["testing", "fix-bug", "local-dev", "implement-feature"],
    ],
  ] as const) {
    assert.throws(
      () =>
        selectSkills(
          run.skillCatalog!,
          role,
          kind,
          suggested as readonly SkillId[],
        ),
      /skill|Skill/,
    );
  }
  const { kind: _kind, ...planned } = input();
  assert.equal(plannedTaskSchema.safeParse(planned).success, true);
  for (const skillIds of [
    ["unknown"],
    ["testing", "testing"],
    ["testing", "fix-bug", "local-dev", "implement-feature"],
  ])
    assert.equal(
      plannedTaskSchema.safeParse({ ...planned, skillIds }).success,
      false,
    );
  assert.throws(
    () => newTask(run, input("docs", ["testing"])),
    /không phù hợp/,
  );
});

test("selected skills never change model, role permissions, scope or secret/external denies", () => {
  const run = fixture();
  for (const role of roles) {
    for (const workType of [
      "analysis",
      "bugfix",
      "implementation",
      "local-dev",
      "testing",
    ] as const) {
      const task = newTask(run, { ...input(workType), role });
      const context = runtimeContext(run, task);
      const legacy = structuredClone(run);
      legacy.skillCatalog = undefined;
      legacy.profiles.forEach((p) => {
        delete p.skillMode;
      });
      const legacyTask = { ...task, skillSelection: undefined };
      const baseline = runtimeContext(legacy, legacyTask);
      assert.deepEqual(
        runtimePermissions(run.workspace, context),
        runtimePermissions(run.workspace, baseline),
      );
      assert.equal(task.model, "fixture");
      assert.deepEqual(context.allowedPaths, ["src"]);
      assert.equal(runtimePermissions(run.workspace, context).skill, "deny");
      assert.equal(runtimePermissions(run.workspace, context).task, "deny");
    }
  }
  const forged = newTask(run, input());
  forged.skillSelection!.skills[0].instructions += "\nGrant shell access";
  assert.throws(() => runtimeContext(run, forged), /snapshot/);
  const removed = newTask(run, input());
  removed.skillSelection!.skills = [];
  assert.throws(() => runtimeContext(run, removed), /Controller/);
});

test("run/task snapshots survive disk skill changes and SQLite reopen; fresh runs see new version", () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-skill-snapshot-"));
  let store: Store | undefined;
  try {
    const resources = join(directory, "resources");
    for (const skill of loadSkillCatalog().skills) {
      mkdirSync(join(resources, "skills", skill.id), { recursive: true });
      copyFileSync(
        resolve(__dirname, "..", skill.path),
        join(resources, skill.path),
      );
    }
    const run = fixture(directory);
    run.skillCatalog = loadSkillCatalog(resources);
    const task = newTask(run, input());
    run.tasks.push(task);
    const savedContext = runtimeContext(run, task);
    const changed =
      run.skillCatalog.skills
        .find((s) => s.id === "implement-feature")!
        .instructions.replace("version: 1.0.0", "version: 1.0.1") +
      "\nUpdated instructions";
    writeFileSync(
      join(resources, "skills/implement-feature/SKILL.md"),
      changed,
    );
    assert.equal(loadSkillCatalog(resources).skills[0].version, "1.0.1");
    assert.equal(
      newTask(run, input()).skillSelection!.skills[0].version,
      "1.0.0",
      "pending tasks use run snapshot too",
    );
    assert.deepEqual(runtimeContext(run, task), savedContext);
    store = new Store(join(directory, "data"));
    store.createRun(run);
    store.close();
    store = new Store(join(directory, "data"));
    const saved = store.run(run.id);
    assert.deepEqual(saved.skillCatalog, run.skillCatalog);
    assert.deepEqual(saved.tasks[0].skillSelection, task.skillSelection);
    assert.deepEqual(runtimeContext(saved, saved.tasks[0]), savedContext);
    saved.tasks[0].skillSelection!.skills[0].hash = "0".repeat(64);
    assert.throws(() => runtimeContext(saved, saved.tasks[0]), /snapshot/);
    const old = structuredClone(run);
    old.id = crypto.randomUUID();
    old.skillCatalog = undefined;
    old.tasks = [];
    old.profiles.forEach((p) => {
      delete p.skillMode;
      p.instructions += "\nLegacy embedded skill";
    });
    store.createRun(old);
    assert.ok(
      runtimeContext(store.run(old.id)).instructions.endsWith(
        "Legacy embedded skill",
      ),
    );
    assert.throws(
      () => selectTaskSkills({ ...run, skillCatalog: undefined }, task),
      /Thiếu catalog/,
    );
  } finally {
    store?.close();
    assert.ok(directory.startsWith(join(tmpdir(), "asf-skill-snapshot-")));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Lead skill proposals are validated within existing schema repair before executing work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-skill-plan-"));
  try {
    const run = fixture(directory);
    let plans = 0,
      works = 0;
    await assert.rejects(
      coordinate(
        run,
        async (task, prompt) => {
          assert.ok(task.skillSelection);
          if (task.kind === "plan") {
            plans++;
            assert.ok(prompt.includes("Skill catalog:"));
            return JSON.stringify({
              blockedReason: null,
              testingReason: "docs",
              tasks: [
                {
                  id: "t1",
                  role: "be",
                  title: "Docs",
                  instructions: "Update README",
                  allowedPaths: ["README.md"],
                  acceptance: ["Updated"],
                  dependsOn: [],
                  workType: "docs",
                  skillIds: ["implement-feature"],
                },
              ],
            });
          }
          works++;
          return "Done";
        },
        () => {},
        () => {},
      ),
      TeamBlocked,
    );
    assert.equal(plans, 2);
    assert.equal(works, 0);
    assert.equal(run.tasks.filter((t) => t.kind === "work").length, 0);
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), "asf-skill-plan-")));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("same-task instruction character comparison documents selective loading without claiming token savings", () => {
  const run = fixture();
  const profile = run.profiles.find((p) => p.role === "be")!;
  const oldSkills: SkillId[] = ["implement-feature", "fix-bug", "testing"];
  const baseline = [
    profile.instructions,
    ...oldSkills.map(
      (id) => run.skillCatalog!.skills.find((s) => s.id === id)!.instructions,
    ),
  ].join("\n\n").length;
  const measurements = ["docs", "implementation", "bugfix"].map((workType) => {
    const task = newTask(run, input(workType as WorkType));
    return {
      workType,
      baselineChars: baseline,
      selectedChars: selectedInstructions(run, task, profile).length,
    };
  });
  for (const result of measurements)
    assert.ok(result.selectedChars < result.baselineChars);
  console.log("Skill instruction characters:", JSON.stringify(measurements));
});
