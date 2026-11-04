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
export function loadProfiles(): ProfileSnapshot[] {
  const root = resolve(__dirname, "../..");
  return roles.map((role) => {
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
      version: "1.0.0",
      hash: hash(instructions),
      instructions,
      skills: skills.map((s) => ({
        name: s.name,
        version: "1.0.0",
        hash: hash(s.text),
      })),
    };
  });
}
