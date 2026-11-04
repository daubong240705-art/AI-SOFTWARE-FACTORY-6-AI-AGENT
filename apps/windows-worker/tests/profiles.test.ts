import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProfiles } from "../electron/team/profiles";
import { runtimeContext, sourcePolicyError } from "../electron/team/policy";
import { runtimePermissions } from "../electron/runtime/permissions";
import { changes, snapshot } from "../electron/workspace/snapshot";
import { defaultSettings, roles } from "../shared/defaults";
import type { Run } from "../shared/runs";
import type { Role } from "../shared/contracts";
import type { TeamTask } from "../shared/team";

function runFor(role: Role, workspace: string): Run {
  return {
    role,
    workspace,
    prompt: "Review the current change",
    profiles: loadProfiles([role]),
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
      assert.equal(context.instructions, run.profiles[0].instructions);
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

test("team and direct use the same policy; missing profile fails closed and task scope remains narrow", () => {
  const run = runFor("lead", tmpdir());
  run.profiles = loadProfiles();
  for (const role of roles) {
    const task = {
      role,
      allowedPaths: ["src"],
      instructions: "Implement this task",
    } as TeamTask;
    const team = runtimeContext(run, task, "Controller-specified schema");
    const direct = runtimeContext({ ...run, role });
    assert.equal(team.readOnly, direct.readOnly);
    assert.equal(team.allowShell, direct.allowShell);
    assert.equal(team.instructions, direct.instructions);
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
    const context = runtimeContext(
      run,
      { role: "be", allowedPaths: ["src"] } as TeamTask,
      "Work",
    );
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
    assert.equal(profile.version, "1.1.0");
    assert.equal(
      profile.hash,
      createHash("sha256").update(profile.instructions).digest("hex"),
    );
    for (const skill of profile.skills) {
      assert.equal(
        skill.version,
        ["testing", "fix-bug"].includes(skill.name) ? "1.1.0" : "1.0.0",
      );
      assert.match(skill.hash, /^[a-f0-9]{64}$/);
    }
    assert.deepEqual(loadProfiles([profile.role]), [profile]);
  }
});
