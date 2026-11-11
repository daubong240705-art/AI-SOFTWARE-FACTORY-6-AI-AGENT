import { z } from "zod";

export const AUTONOMY_LEVELS = [0, 1, 2, 3, 4] as const;
export const autonomyLevelSchema = z.union(AUTONOMY_LEVELS.map((level) => z.literal(level)));
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];
export const AUTONOMY_LABELS: Readonly<Record<AutonomyLevel, string>> = {
  0: "L0 suggest", 1: "L1 in-task", 2: "L2 in-team",
  3: "L3 cross-team-in-budget", 4: "L4 external-under-standing-approval",
};
// Architecture 04 section 18: Project Lead L3, Team Lead L2 (AP-8).
export const DEFAULT_AUTONOMY_LEVELS = { project: 3, team: 2 } as const;
export const AUTONOMY_ACTIONS = {
  "task-work": 1,
  // Split work, pick a seat, add a task within a stage, or run a rework loop.
  "team-plan-change": 2,
  "request-clarify-consult": 2,
  "request-produce": 3,
  "plan-patch-auto": 3,
  "consulting-engagement": 3,
  "external-action": 4,
} as const satisfies Readonly<Record<string, AutonomyLevel>>;
export type AutonomyAction = keyof typeof AUTONOMY_ACTIONS;
export const ALWAYS_OPERATOR = [
  "scope-or-criteria-change", "open-gate", "raise-budget", "spend-money",
  "publish-externally", "irreversible-action", "global-knowledge",
] as const;
export type OperatorAction = (typeof ALWAYS_OPERATOR)[number];
export const requiredLevel = (action: AutonomyAction): AutonomyLevel => AUTONOMY_ACTIONS[action];
export function allows(level: AutonomyLevel, action: AutonomyAction | OperatorAction): boolean {
  if ((ALWAYS_OPERATOR as readonly string[]).includes(action)) return false;
  return level >= requiredLevel(action as AutonomyAction);
}
