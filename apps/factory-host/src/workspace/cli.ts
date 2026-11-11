import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cloneProject } from "./clone.js";
import { WorkspaceError } from "./paths.js";

export async function main(args: string[]): Promise<void> {
  try {
    if (args[0] !== "clone" || args.length !== 7) throw new WorkspaceError("invalid-input");
    const values = new Map<string, string>();
    for (let i = 1; i < args.length; i += 2) {
      const key = args[i]; const value = args[i + 1];
      if (!key || !["--projects-root", "--name", "--source"].includes(key) || value === undefined || values.has(key))
        throw new WorkspaceError("invalid-input");
      values.set(key, value);
    }
    const projectsRoot = values.get("--projects-root"); const name = values.get("--name"); const source = values.get("--source");
    if (!projectsRoot || name === undefined || !source) throw new WorkspaceError("invalid-input");
    const result = await cloneProject({ projectsRoot, worktreesRoot: `${resolve(projectsRoot)}.worktrees` }, { name, source });
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    process.stderr.write(`Workspace clone failed: ${error instanceof WorkspaceError ? error.code : "failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
