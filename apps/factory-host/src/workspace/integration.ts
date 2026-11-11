import { runGit } from "./git.js";
import { checkedProject } from "./worktrees.js";
import { validateRoots, WorkspaceError, type WorkspaceRoots } from "./paths.js";

export const INTEGRATION_BRANCH = "factory/integration";
const integrationRef = `refs/heads/${INTEGRATION_BRANCH}`;
export type IntegrationOutcome = { outcome: "merged"; sha: string } | { outcome: "conflict" };

export async function integrationExists(roots: WorkspaceRoots, projectRoot: string): Promise<boolean> {
  const safe = validateRoots(roots);
  const project = await checkedProject(safe.projectsRoot, projectRoot);
  return (await runGit(project, ["show-ref", "--verify", "--quiet", integrationRef], { acceptExitCodes: [1] })).exitCode === 0;
}

/** Only Git objects and refs are written. A failed CAS leaves retry to the worker. */
export async function mergeIntoIntegration(roots: WorkspaceRoots, input: {
  projectRoot: string; taskBranch: string; message: string;
}): Promise<IntegrationOutcome> {
  const safe = validateRoots(roots);
  const project = await checkedProject(safe.projectsRoot, input.projectRoot);
  if (typeof input.taskBranch !== "string" || !input.taskBranch.startsWith("factory/") ||
    typeof input.message !== "string" || input.message.includes("\0")) throw new WorkspaceError("invalid-input");
  const taskRef = `refs/heads/${input.taskBranch}`;
  await runGit(project, ["check-ref-format", taskRef]);
  if (!await integrationExists(safe, project)) {
    const head = (await runGit(project, ["rev-parse", "--verify", "HEAD"])).stdout.trim();
    // The empty old value creates the ref only if it is still absent.
    await runGit(project, ["update-ref", integrationRef, head, ""]);
  }
  const tip = (await runGit(project, ["rev-parse", "--verify", integrationRef])).stdout.trim();
  const taskTip = (await runGit(project, ["rev-parse", "--verify", taskRef])).stdout.trim();
  // Pin both inputs so ref movement during merge-tree cannot change either parent.
  const merge = await runGit(project, ["merge-tree", "--write-tree", "--no-messages", tip, taskTip], { acceptExitCodes: [1] });
  if (merge.exitCode === 1) return { outcome: "conflict" };
  const tree = merge.stdout.trim();
  if (!/^[0-9a-f]{40,64}$/.test(tree)) throw new WorkspaceError("git-failed");
  const oldTree = (await runGit(project, ["rev-parse", "--verify", `${tip}^{tree}`])).stdout.trim();
  if (tree === oldTree) return { outcome: "merged", sha: tip };
  const sha = (await runGit(project, ["commit-tree", tree, "-p", tip, "-p", taskTip, "-m", input.message],
    { factoryIdentity: true })).stdout.trim();
  await runGit(project, ["update-ref", integrationRef, sha, tip]);
  return { outcome: "merged", sha };
}
