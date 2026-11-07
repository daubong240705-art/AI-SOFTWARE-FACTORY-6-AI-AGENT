import { patchIsSafeToApply } from "./evidence.js";
import { runGit } from "./git.js";
import { checkedDirectory, WorkspaceError } from "./paths.js";

export async function applyPatchToRepo(input: { repo: string; patch: string; dryRun?: boolean }): Promise<{
  applied: boolean; checked: true;
}> {
  if (typeof input.patch !== "string" || (input.dryRun !== undefined && typeof input.dryRun !== "boolean"))
    throw new WorkspaceError("invalid-input");
  const repo = checkedDirectory(input.repo);
  const safety = patchIsSafeToApply(input.patch);
  try {
    await runGit(checkedDirectory(repo), ["apply", "--check", "--whitespace=nowarn", "-"], { stdin: input.patch });
  } catch (error) {
    if (!safety.ok) throw new WorkspaceError("unsafe-content");
    throw error;
  }
  if (!safety.ok) throw new WorkspaceError("unsafe-content");
  if (input.dryRun === true) return { applied: false, checked: true };
  await runGit(checkedDirectory(repo), ["apply", "--whitespace=nowarn", "-"], { stdin: input.patch });
  return { applied: true, checked: true };
}
