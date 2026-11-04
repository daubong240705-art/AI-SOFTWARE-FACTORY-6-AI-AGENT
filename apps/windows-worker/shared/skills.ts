import { z } from "zod";
import type { Role } from "./contracts";

export const skillIds = [
  "implement-feature",
  "fix-bug",
  "testing",
  "local-dev",
] as const;
export const skillIdSchema = z.enum(skillIds);
export type SkillId = z.infer<typeof skillIdSchema>;
export const workTypes = [
  "docs",
  "analysis",
  "implementation",
  "bugfix",
  "testing",
  "local-dev",
] as const;
export const workTypeSchema = z.enum(workTypes);
export type WorkType = z.infer<typeof workTypeSchema>;
export type SkillTaskKind = WorkType | "plan" | "review";
export type Capability = "read" | "edit" | "shell";
export type SkillSnapshot = {
  id: SkillId;
  version: string;
  description: string;
  roles: Role[];
  taskKinds: SkillTaskKind[];
  requiredCapabilities: Capability[];
  path: string;
  source: "asf-internal";
  hash: string;
  instructions: string;
};
export type SkillCatalogSnapshot = { version: 1; skills: SkillSnapshot[] };
export type SkillSelection = {
  version: 1;
  role: Role;
  taskKind: SkillTaskKind;
  skills: SkillSnapshot[];
};
