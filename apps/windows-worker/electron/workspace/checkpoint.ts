import { randomUUID, createHash } from "node:crypto";
import { snapshot, type Snapshot } from "./snapshot";
import { captureGit, type GitCapture } from "./git-evidence";
import { sourceVersion } from "../team/evidence";
import type { Checkpoint } from "../../shared/lifecycle";
import type { Run } from "../../shared/runs";

export function checkpoint(
  run: Run,
  phase: string,
  source: Snapshot,
  git: GitCapture,
  taskId?: string,
): Checkpoint {
  const value: Checkpoint = {
    id: randomUUID(),
    at: new Date().toISOString(),
    phase,
    taskId,
    source: sourceVersion(source) ?? null,
    head: git.state?.head ?? null,
    index: git.state?.indexHash ?? null,
    gitRoot: git.state?.root ?? null,
    complete: source.complete && (!git.state || git.state.complete),
  };
  run.checkpoints = [...(run.checkpoints ?? []), value].slice(-40);
  return value;
}
export async function inspectWorkspace(run: Run): Promise<Checkpoint> {
  const source = await snapshot(run.workspace);
  const git = await captureGit(run.workspace);
  return checkpoint({ ...run, checkpoints: [] }, "inspection", source, git);
}
export function fingerprint(value: Checkpoint): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        value.source,
        value.head,
        value.index,
        value.gitRoot,
        value.complete,
      ]),
    )
    .digest("hex");
}
