import fs from "node:fs";
import { join } from "node:path";
import { runGit } from "../workspace/git.js";
import { INTEGRATION_BRANCH } from "../workspace/integration.js";

/** A read-only look at the project for the Lead chat: a detached worktree of the latest integrated code. */
export interface LeadView { cwd: string; ref: string; sha: string; projectRoot: string }

const queues = new Map<string, Promise<unknown>>();

/**
 * Prepares `<viewRoot>/<projectId>` as a detached worktree at factory/integration (or the project's HEAD before the
 * first integration). It is reset to that commit before every Lead turn, so anything written there is thrown away and
 * task worktrees are never touched. Returns null when the project is not a Git repository or Git fails.
 */
export function prepareLeadView(viewRoot: string, projectId: string, projectRoot: string): Promise<LeadView | null> {
  const previous = queues.get(projectId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => refresh(viewRoot, projectId, projectRoot)).catch(() => null);
  queues.set(projectId, next);
  return next;
}

async function refresh(viewRoot: string, projectId: string, projectRoot: string): Promise<LeadView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId) || !fs.existsSync(join(projectRoot, ".git"))) return null;
  const integration = await runGit(projectRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${INTEGRATION_BRANCH}^{commit}`], { acceptExitCodes: [1] });
  const ref = integration.exitCode === 0 ? INTEGRATION_BRANCH : "HEAD";
  const sha = integration.exitCode === 0 ? integration.stdout.trim()
    : (await runGit(projectRoot, ["rev-parse", "--verify", "HEAD^{commit}"])).stdout.trim();
  if (!/^[0-9a-f]{40,64}$/.test(sha)) return null;
  fs.mkdirSync(viewRoot, { recursive: true, mode: 0o700 });
  const cwd = join(viewRoot, projectId);
  const valid = fs.existsSync(join(cwd, ".git"));
  if (!valid) {
    fs.rmSync(cwd, { recursive: true, force: true });
    await runGit(projectRoot, ["worktree", "prune"]);
    await runGit(projectRoot, ["worktree", "add", "--detach", "--force", "--", cwd, sha]);
  } else {
    const head = (await runGit(cwd, ["rev-parse", "HEAD"], { acceptExitCodes: [128] })).stdout.trim();
    if (head !== sha) await runGit(cwd, ["checkout", "--detach", "--force", sha]);
    // Undo anything a previous turn may have left: the view always equals the commit.
    await runGit(cwd, ["reset", "--hard", "--quiet", sha]);
    await runGit(cwd, ["clean", "-fdq"]);
  }
  return { cwd, ref, sha, projectRoot };
}
