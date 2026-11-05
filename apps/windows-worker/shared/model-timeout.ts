import type { Settings } from "./contracts";

// Reasoning models can be silent for more than 90 seconds. The controller
// still owns the absolute deadline across all model requests and tools.
export function modelTimeoutMs(settings: Pick<Settings, "timeoutMinutes">) {
  return settings.timeoutMinutes * 60_000;
}
