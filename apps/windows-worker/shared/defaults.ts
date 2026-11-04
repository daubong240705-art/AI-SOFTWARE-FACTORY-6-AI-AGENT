import type { Settings } from "./contracts";

export const roles = [
  "lead",
  "pm",
  "ba",
  "be",
  "fe",
  "test",
  "devops",
] as const;

export function defaultSettings(): Settings {
  return {
    gatewayUrl: "",
    caPath: "",
    runtimePath: "",
    timeoutMinutes: 30,
    maxRequests: 40,
    maxFixRounds: 2,
    agents: roles.map((role) => ({ role, enabled: true, model: "" })),
  };
}
