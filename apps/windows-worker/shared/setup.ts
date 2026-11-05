import { z } from "zod";
import type { Settings } from "./contracts";

export type SetupSection = "models" | "runtime" | "data";
export type ModelPreset = "fast" | "balanced" | "quality";
const modelId = z.string().trim().min(1, "Nhập model ID.").max(200);
export function applySharedModel(settings: Settings, model: string): Settings {
  const selected = modelId.parse(model);
  return {
    ...settings,
    agents: settings.agents.map((agent) =>
      agent.enabled ? { ...agent, model: selected } : { ...agent },
    ),
  };
}
export function applyModelPreset(
  settings: Settings,
  preset: ModelPreset,
  models: { fast: string; planning: string; coding: string },
): Settings {
  const fast = modelId.parse(models.fast),
    coding = modelId.parse(models.coding),
    planning = preset === "fast" ? fast : modelId.parse(models.planning);
  return {
    ...settings,
    agents: settings.agents.map((agent) => ({
      ...agent,
      model: ["be", "fe"].includes(agent.role)
        ? coding
        : preset === "fast"
          ? fast
          : agent.role === "lead" ||
              agent.role === "ba" ||
              (preset === "quality" && ["pm", "test"].includes(agent.role))
            ? planning
            : fast,
    })),
  };
}
export function setupDestination(checkId: string): SetupSection | null {
  if (["gateway", "lead", "credential", "ca"].includes(checkId))
    return "models";
  if (checkId === "runtime") return "runtime";
  return null;
}
// No key or credential material in UI identities.
export function setupIdentity(settings: Settings): string {
  return JSON.stringify([
    settings.gatewayUrl,
    settings.caPath,
    settings.runtimePath,
    settings.teamExecution,
    settings.agents,
  ]);
}
