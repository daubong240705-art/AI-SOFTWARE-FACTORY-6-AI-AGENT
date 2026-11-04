import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { roles } from "../../shared/defaults";
import type { Role } from "../../shared/contracts";
import type { ProfileSnapshot } from "../../shared/team";
const skillMap: Record<Role, string[]> = {
  lead: ["testing", "fix-bug"],
  pm: [],
  ba: [],
  be: ["implement-feature", "fix-bug", "testing"],
  fe: ["implement-feature", "fix-bug", "testing"],
  test: ["testing"],
  devops: ["local-dev", "fix-bug"],
};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export function loadProfiles(
  selected: readonly Role[] = roles,
): ProfileSnapshot[] {
  const root = resolve(__dirname, "../..");
  return selected.map((role) => {
    const text = readFileSync(
      join(root, "agent-profiles", role + ".md"),
      "utf8",
    );
    const skills = skillMap[role].map((name) => ({
      name,
      text: readFileSync(join(root, "skills", name, "SKILL.md"), "utf8"),
    }));
    const instructions = [text, ...skills.map((s) => s.text)].join("\n\n");
    return {
      role,
      version: version(text, /^# .+ — (\d+\.\d+\.\d+)\r?$/m),
      hash: hash(instructions),
      instructions,
      skills: skills.map((s) => ({
        name: s.name,
        version: version(s.text, /^version: (\d+\.\d+\.\d+)\r?$/m),
        hash: hash(s.text),
      })),
    };
  });
}

function version(text: string, pattern: RegExp): string {
  const value = text.match(pattern)?.[1];
  if (!value) throw new Error("Profile/skill thiếu phiên bản hợp lệ.");
  return value;
}
