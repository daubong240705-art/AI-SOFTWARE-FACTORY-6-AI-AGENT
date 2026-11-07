import fs from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import {
  assertInside, buildPatch, checkpoint, collectEvidence, createWorktree, patchIsSafeToApply,
  removeWorktree, validateRoots, WorkspaceError, type Evidence, type WorkspaceRoots,
} from "../workspace/index.js";

export interface AttemptEvidence extends Evidence {
  branch: string; patchFile: string | null; patchSha256: string | null;
  patchSafe: boolean; unsafeReasons: string[];
}
export interface WorkspaceProvider {
  prepare(input: { projectId: string; taskCode: string; epoch: number; projectRoot: string;
    startFromBranch: string | null }): Promise<{ path: string; branch: string; baseSha: string }>;
  finish(input: { path: string; baseSha: string; branch: string; attemptId: string }): Promise<AttemptEvidence>;
  discard(input: { projectRoot: string; path: string; deleteBranch: boolean }): Promise<void>;
}

export const ATTEMPT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/i;

export function createWorkspaceProvider(options: { roots: WorkspaceRoots; evidenceDir: string }): WorkspaceProvider {
  let roots: WorkspaceRoots;
  let evidenceDir: string;
  try {
    roots = validateRoots(options.roots);
    evidenceDir = assertInside(dirname(options.evidenceDir), options.evidenceDir);
  } catch { throw new WorkspaceError("invalid-input", "workspace unavailable"); }
  const guarded = async <T>(operation: () => Promise<T>): Promise<T> => {
    try { return await operation(); }
    catch { throw new WorkspaceError("git-failed", "workspace unavailable"); }
  };
  return {
    prepare: (input) => guarded(async () => createWorktree(roots, {
      projectRoot: assertInside(roots.projectsRoot, input.projectRoot),
      projectSlug: createHash("sha256").update(input.projectId).digest("hex"),
      taskCode: input.taskCode, epoch: input.epoch,
      ...(input.startFromBranch === null ? {} : { startFromBranch: input.startFromBranch }),
    })),
    finish: (input) => guarded(async () => {
      if (!ATTEMPT_UUID.test(input.attemptId)) throw new WorkspaceError("invalid-input");
      const path = assertInside(roots.worktreesRoot, input.path);
      await checkpoint(path, `factory attempt ${input.attemptId} checkpoint`);
      const evidence = await collectEvidence(assertInside(roots.worktreesRoot, path), input.baseSha);
      const patch = await buildPatch(assertInside(roots.worktreesRoot, path), input.baseSha);
      const safety = patchIsSafeToApply(patch.patch);
      let patchFile: string | null = null;
      let patchSha256: string | null = null;
      if (!patch.truncated && !evidence.patchTruncated && safety.ok) {
        fs.mkdirSync(assertInside(dirname(evidenceDir), evidenceDir), { recursive: true, mode: 0o700 });
        fs.chmodSync(assertInside(dirname(evidenceDir), evidenceDir), 0o700);
        patchFile = `${input.attemptId}.patch`;
        // Exclusive creation also refuses a pre-existing symlink or stale artifact.
        fs.writeFileSync(assertInside(evidenceDir, join(evidenceDir, patchFile)), patch.patch, { mode: 0o600, flag: "wx" });
        patchSha256 = createHash("sha256").update(patch.patch).digest("hex");
      }
      return { ...evidence, branch: input.branch, patchFile, patchSha256,
        patchSafe: safety.ok && !patch.truncated && !evidence.patchTruncated, unsafeReasons: safety.reasons };
    }),
    discard: (input) => guarded(async () => removeWorktree(roots, input)),
  };
}
