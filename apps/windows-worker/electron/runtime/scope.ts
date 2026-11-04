import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// OpenCode 1.19.5 checks edit permission against paths relative to the Git
// worktree, which may be above the selected project (e.g. a monorepo app).
export function editScopes(
  workspace: string,
  allowedPaths: string[],
): Record<string, "allow" | "deny"> {
  let worktree = workspace;
  for (let current = workspace; ; current = dirname(current)) {
    if (existsSync(join(current, ".git"))) {
      worktree = current;
      break;
    }
    if (dirname(current) === current) break;
  }
  const policy: Record<string, "allow" | "deny"> = { "*": "deny" };
  for (const scope of allowedPaths) {
    const path = relative(worktree, resolve(workspace, scope)).replaceAll(
      "\\",
      "/",
    );
    if (!path) policy["*"] = "allow";
    else {
      policy[path] = "allow";
      policy[path + "/**"] = "allow";
    }
  }
  return policy;
}
