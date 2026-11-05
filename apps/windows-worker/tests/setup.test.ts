import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings } from "../shared/defaults";
import {
  applySharedModel,
  applyModelPreset,
  setupDestination,
  setupIdentity,
} from "../shared/setup";

test("shared model updates enabled roles only without mutating permissions, limits or input", () => {
  const settings = defaultSettings();
  settings.agents.find((a) => a.role === "pm")!.enabled = false;
  settings.agents.find((a) => a.role === "pm")!.model = "keep-disabled";
  const before = structuredClone(settings),
    next = applySharedModel(settings, " custom/model ");
  assert.deepEqual(settings, before);
  assert.equal(
    next.agents.find((a) => a.role === "pm")!.model,
    "keep-disabled",
  );
  assert.ok(
    next.agents
      .filter((a) => a.enabled)
      .every((a) => a.model === "custom/model"),
  );
  assert.deepEqual({ ...next, agents: before.agents }, before);
  assert.throws(() => applySharedModel(settings, " "));
  assert.throws(() => applySharedModel(settings, "x".repeat(201)));
});
test("existing preset role allocation is preserved including disabled state and no automatic enable", () => {
  const settings = defaultSettings();
  settings.agents[1].enabled = false;
  const models = { fast: "fast", planning: "plan", coding: "code" };
  for (const preset of ["fast", "balanced", "quality"] as const) {
    const next = applyModelPreset(settings, preset, models);
    const model = (role: string) =>
      next.agents.find((a) => a.role === role)!.model;
    assert.equal(model("be"), "code");
    assert.equal(model("fe"), "code");
    assert.equal(model("devops"), "fast");
    assert.equal(model("lead"), preset === "fast" ? "fast" : "plan");
    assert.equal(model("test"), preset === "quality" ? "plan" : "fast");
    assert.equal(model("pm"), preset === "quality" ? "plan" : "fast");
    assert.equal(next.agents[1].enabled, false);
  }
  assert.equal(
    applyModelPreset(settings, "fast", { ...models, planning: "" }).agents[0]
      .model,
    "fast",
  );
  assert.throws(() =>
    applyModelPreset(settings, "quality", { ...models, planning: "" }),
  );
});
test("readiness destinations and identities reflect configuration without credential material", () => {
  assert.equal(setupDestination("runtime"), "runtime");
  for (const key of ["lead", "gateway", "credential", "ca"])
    assert.equal(setupDestination(key), "models");
  assert.equal(setupDestination("git"), null);
  assert.equal(setupDestination("folder"), null);
  const settings = defaultSettings(),
    before = setupIdentity(settings);
  settings.agents[0].model = "changed";
  assert.notEqual(setupIdentity(settings), before);
  assert.equal(
    setupIdentity({ ...settings, maxRequests: 99 }),
    setupIdentity(settings),
  );
});
