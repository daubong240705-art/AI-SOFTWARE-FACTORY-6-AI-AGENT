import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { roles } from "../../shared/defaults";
import type { Role } from "../../shared/contracts";
import type { ProfileSnapshot } from "../../shared/team";
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
    return {
      skillMode: "task-v1",
      role,
      version: version(text, /^# .+ — (\d+\.\d+\.\d+)\r?$/m),
      hash: hash(text),
      instructions: text,
      skills: [],
    };
  });
}

function version(text: string, pattern: RegExp): string {
  const value = text.match(pattern)?.[1];
  if (!value) throw new Error("Profile/skill thiếu phiên bản hợp lệ.");
  return value;
}
