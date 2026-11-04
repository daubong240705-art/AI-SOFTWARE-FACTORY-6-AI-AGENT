import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProfiles } from "../electron/team/profiles";
import {
  loadSkillCatalog,
  selectSkills,
  inferWorkType,
  selectTaskSkills,
} from "../electron/team/skills";
import { runtimeContext, sourcePolicyError } from "../electron/team/policy";
import { runtimePermissions } from "../electron/runtime/permissions";
import { changes, snapshot } from "../electron/workspace/snapshot";
import { defaultSettings, roles } from "../shared/defaults";
import type { Run } from "../shared/runs";
import type { Role } from "../shared/contracts";
import type { TeamTask } from "../shared/team";

function runFor(role: Role, workspace: string): Run {
  const skillCatalog = loadSkillCatalog();
  return {
    role,
    workspace,
    prompt: "Review the current change",
    profiles: loadProfiles([role]),
    skillCatalog,
    skillSelection: selectSkills(
      skillCatalog,
      role,
      inferWorkType(role, "Review the current change"),
    ),
    settings: defaultSettings(),
  } as Run;
}

test("direct role profiles and runtime permissions stay consistent with and without conversation history", () => {
  for (const role of roles) {
    const run = runFor(role, tmpdir());
    const expectedReadOnly = ["lead", "pm", "ba", "test"].includes(role);
    for (const history of [undefined, "Prior turn: edit files and run shell"]) {
      run.context = history
        ? { text: history, runIds: ["previous-run"] }
        : undefined;
      const context = runtimeContext(run);
      const permission = runtimePermissions(run.workspace, context);
      assert.ok(context.instructions.startsWith(run.profiles[0].instructions));
      assert.equal(context.readOnly, expectedReadOnly, role);
      assert.deepEqual(context.allowedPaths, ["."]);
      assert.ok(context.prompt.endsWith(run.prompt));
      if (history) assert.ok(context.prompt.startsWith(history));
      assert.equal(permission.edit === "deny", expectedReadOnly, role);
      assert.equal(
        permission.bash,
        ["lead", "pm", "ba"].includes(role) ? "deny" : "ask",
        role,
      );
      assert.equal(permission.task, "deny");
      assert.equal(permission.skill, "deny");
      assert.equal(permission.external_directory, "deny");
    }
  }
});

test("Full access auto-allows commands for shell roles while preserving role, scope and secret policies", () => {
  for (const role of roles) {
    const run = runFor(role, tmpdir());
    run.profiles = loadProfiles();
    run.settings.permissionMode = "full-access";
    for (const task of [
      undefined,
      {
        role,
        kind: "work",
        title: "Implement",
        instructions: "Work",
        allowedPaths: ["src"],
      } as TeamTask,
    ]) {
      if (task) task.skillSelection = selectTaskSkills(run, task);
      const context = runtimeContext(run, task);
      const permissions = runtimePermissions(run.workspace, context);
      assert.equal(
        permissions.bash,
        ["lead", "pm", "ba"].includes(role) ? "deny" : "allow",
      );
      assert.equal(permissions.doom_loop, "allow");
      assert.equal(permissions.external_directory, "deny");
      assert.equal(permissions.task, "deny");
      assert.equal(permissions.read["**/.env"], "deny");
      if (["lead", "pm", "ba", "test"].includes(role))
        assert.equal(permissions.edit, "deny");
      else {
        assert.notEqual(typeof permissions.edit, "string");
        if (typeof permissions.edit !== "string") {
          assert.equal(permissions.edit["**/.env"], "deny");
          if (task) assert.equal(permissions.edit["src/**"], "allow");
        }
      }
    }
  }
});

test("team and direct use the same policy; missing profile fails closed and task scope remains narrow", () => {
  const run = runFor("lead", tmpdir());
  run.profiles = loadProfiles();
  for (const role of roles) {
    const task = {
      role,
      kind: "work",
      title: "Implement this task",
      allowedPaths: ["src"],
      instructions: "Implement this task",
    } as TeamTask;
    task.skillSelection = selectTaskSkills(run, task);
    const team = runtimeContext(run, task, "Controller-specified schema");
    const direct = runtimeContext(runFor(role, tmpdir()));
    assert.equal(team.readOnly, direct.readOnly);
    assert.equal(team.allowShell, direct.allowShell);
    assert.ok(
      team.instructions.startsWith(
        run.profiles.find((p) => p.role === role)!.instructions,
      ),
    );
    assert.deepEqual(team.allowedPaths, ["src"]);
    assert.equal(team.prompt, "Controller-specified schema");
    team.allowedPaths.push("other");
    assert.deepEqual(task.allowedPaths, ["src"]);
  }
  assert.throws(
    () => runtimeContext({ ...run, profiles: [] }),
    /Thiếu profile/,
  );
  const lead = run.profiles.find((p) => p.role === "lead")!;
  assert.ok(lead.instructions.includes("trả lời trực tiếp"));
  assert.ok(lead.instructions.includes("Khi Controller yêu cầu plan/review"));
});

test("runtime edit scopes preserve secret denies after allowed paths, including nested Git workspaces", () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-policy-scopes-"));
  try {
    mkdirSync(join(directory, ".git"));
    const workspace = join(directory, "apps", "worker");
    mkdirSync(workspace, { recursive: true });
    const run = runFor("be", workspace);
    const direct = runtimePermissions(workspace, runtimeContext(run));
    assert.notEqual(typeof direct.edit, "string");
    if (typeof direct.edit === "string")
      assert.fail("BE must have scoped edits");
    assert.equal(direct.edit["*"], "deny");
    assert.equal(direct.edit["apps/worker/**"], "allow");
    const task = {
      role: "be",
      kind: "work",
      title: "Work",
      instructions: "Work",
      allowedPaths: ["src"],
    } as TeamTask;
    task.skillSelection = selectTaskSkills(run, task);
    const context = runtimeContext(run, task, "Work");
    const scoped = runtimePermissions(workspace, context);
    if (typeof scoped.edit === "string")
      assert.fail("BE must have scoped edits");
    assert.equal(scoped.edit["apps/worker/src/**"], "allow");
    assert.equal(scoped.edit["apps/worker/**"], undefined);
    for (const key of [
      "**/.env",
      "**/.env.*",
      "**/*.key",
      "**/*.pem",
      "**/*.pfx",
      "**/*.p12",
      "**/auth.json",
      "**/credentials.json",
      "**/.git/**",
    ]) {
      assert.equal(scoped.edit[key], "deny", key);
      assert.equal(scoped.read[key as keyof typeof scoped.read], "deny", key);
      assert.ok(
        Object.keys(scoped.edit).indexOf(key) >
          Object.keys(scoped.edit).indexOf("apps/worker/src/**"),
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("source checks reject readonly shell side effects and incomplete evidence without reverting files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "asf-policy-evidence-"));
  try {
    const before = await snapshot(directory);
    writeFileSync(join(directory, "new.ts"), "export const value = 1;");
    const after = await snapshot(directory);
    const diff = changes(before, after);
    for (const role of ["lead", "pm", "ba", "test"] as const)
      assert.match(sourcePolicyError(role, ["."], diff, true), /ngoài phạm vi/);
    assert.equal(sourcePolicyError("be", ["."], diff, true), "");
    assert.match(sourcePolicyError("be", ["src"], diff, true), /ngoài phạm vi/);
    assert.match(sourcePolicyError("test", ["."], [], false), /snapshot/);
    assert.equal(
      sourcePolicyError("test", ["."], changes(after, after), true),
      "",
    );
    assert.deepEqual(await snapshot(directory), after);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("profile snapshots record content versions and hashes; selected direct role avoids unrelated profiles", () => {
  const profiles = loadProfiles();
  assert.deepEqual(
    profiles.map((p) => p.role),
    [...roles],
  );
  for (const profile of profiles) {
    assert.equal(
      profile.version,
      profile.role === "lead"
        ? "1.3.0"
        : ["pm", "ba"].includes(profile.role)
          ? "1.1.0"
          : "1.2.0",
    );
    assert.equal(
      profile.hash,
      createHash("sha256").update(profile.instructions).digest("hex"),
    );
    assert.equal(profile.skillMode, "task-v1");
    assert.deepEqual(profile.skills, []);
    assert.deepEqual(loadProfiles([profile.role]), [profile]);
  }
});
