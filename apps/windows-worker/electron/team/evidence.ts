import { createHash } from "node:crypto";
import type { EvidenceRef } from "../../shared/evidence";
import type { Run, CommandResult } from "../../shared/runs";
import { inScope, type TeamTask, type EvidenceReview } from "../../shared/team";
import type { EvidenceStore } from "../storage/evidence";
import type { Snapshot } from "../workspace/snapshot";

export function sourceVersion(source: Snapshot): string | undefined {
  if (!source.complete) return undefined;
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.entries(source.files).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      ),
    )
    .digest("hex");
}
export function commandArtifactId(
  runId: string,
  attemptId: string,
  sessionId: string,
  callId: string,
): string {
  return (
    "cmd-v1-" +
    createHash("sha256")
      .update(JSON.stringify([runId, attemptId, sessionId, callId]))
      .digest("hex")
  );
}
// Used by capture and tests: never identify a command by its call ID alone.
export function upsertCommand(
  commands: CommandResult[],
  command: CommandResult,
): boolean {
  const index = commands.findIndex(
    (c) => command.artifactId && c.artifactId === command.artifactId,
  );
  if (index >= 0) commands[index] = command;
  else if (commands.length < 100) commands.push(command);
  else return false;
  return true;
}
export function criteria(tasks: TeamTask[]) {
  return tasks.flatMap((task) =>
    task.acceptance.map((criterion, index) => ({
      taskId: task.id,
      criterionId: `${task.id}:ac${index + 1}`,
      criterion,
      requiresCommand:
        task.role === "test" ||
        /\b(test(?:s|ing)?|build|lint|typecheck|compile)\b|kiểm thử|kiểm tra tự động|biên dịch/i.test(
          criterion,
        ),
    })),
  );
}
export function commandRef(
  run: Run,
  taskId: string,
  task: TeamTask,
  command: CommandResult,
): EvidenceRef | undefined {
  if (
    !command.artifactId ||
    !command.sessionId ||
    !command.sourceVersion ||
    command.taskId !== task.id ||
    command.sessionId !== task.sessionId
  )
    return;
  return {
    kind: "command",
    runId: run.id,
    taskId,
    attemptId: task.id,
    sessionId: command.sessionId,
    sourceVersion: command.sourceVersion,
    artifactId: command.artifactId,
    callId: command.callId,
  };
}
export function evidenceCatalog(
  run: Run,
  latest: Map<string, TeamTask>,
  currentVersion?: string,
) {
  const refs: EvidenceRef[] = [];
  let omitted = 0;
  for (const [taskId, task] of latest) {
    const commands = run.commands.filter((c) => c.taskId === task.id);
    const candidates: EvidenceRef[] = commands
      .map((c) => commandRef(run, taskId, task, c))
      .filter((r): r is EvidenceRef => !!r);
    if (currentVersion) {
      for (let i = candidates.length - 1; i >= 0; i--) {
        if (candidates[i].sourceVersion !== currentVersion) {
          candidates.splice(i, 1);
          omitted++;
        }
      }
    }
    if (task.evidence && task.sessionId) {
      const paths = [
        ...new Set([
          ...task.changes.map((c) => c.path),
          ...Object.keys(task.evidence.files),
        ]),
      ];
      for (const path of paths) {
        const file = task.evidence.files[path];
        if (
          file === undefined ||
          file?.reason ||
          (file && !file.hash) ||
          !inScope(path, task.allowedPaths)
        )
          continue;
        candidates.push({
          kind: "file",
          runId: run.id,
          taskId,
          attemptId: task.id,
          sessionId: task.sessionId,
          sourceVersion: task.evidence.sourceVersion,
          path,
          hash: file?.hash ?? null,
        });
      }
    }
    // Keep space for every task and explicitly report evidence omitted from context.
    for (const ref of candidates.slice(0, 12)) {
      if (JSON.stringify([...refs, ref]).length <= 24000) refs.push(ref);
      else omitted++;
    }
    omitted += Math.max(0, candidates.length - 12);
  }
  return { refs, omitted };
}

/** Ownership only; integrity/source freshness is checked separately. */
export function supportsCriterion(
  ref: EvidenceRef,
  criterionTaskId: string,
  task: TeamTask,
  work: readonly TeamTask[],
): boolean {
  if (ref.taskId === criterionTaskId) return true;
  if (ref.kind !== "command" || task.role !== "test") return false;
  const covers = (id: string, seen = new Set<string>()): boolean => {
    if (id === criterionTaskId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (work.find((t) => t.id === id)?.dependsOn ?? []).some((dep) =>
      covers(dep, seen),
    );
  };
  return !task.dependsOn.length || covers(ref.taskId);
}
export function verifyEvidence(
  review: EvidenceReview,
  run: Run,
  work: TeamTask[],
  latest: Map<string, TeamTask>,
  current: Snapshot,
  store?: EvidenceStore,
): void {
  const expected = criteria(work);
  if (
    review.acceptance.length !== expected.length ||
    new Set(review.acceptance.map((a) => a.criterionId)).size !==
      expected.length ||
    expected.some(
      (c) =>
        !review.acceptance.some(
          (a) => a.criterionId === c.criterionId && a.criterion === c.criterion,
        ),
    )
  )
    throw new Error(
      "Review phải bao phủ đúng một lần mọi AC ID và nguyên văn tiêu chí.",
    );
  const currentVersion = sourceVersion(current);
  const issues: string[] = [];
  for (const ac of review.acceptance) {
    const criterion = expected.find((c) => c.criterionId === ac.criterionId)!;
    const invalid: string[] = [];
    let validCommand = false;
    if (!ac.refs.length) invalid.push("Thiếu evidence.");
    for (const ref of ac.refs) {
      const task = latest.get(ref.taskId);
      try {
        if (!store || !currentVersion)
          throw new Error("Không có nguồn evidence hoàn chỉnh.");
        if (
          ref.runId !== run.id ||
          !task ||
          ref.attemptId !== task.id ||
          !task.sessionId ||
          ref.sessionId !== task.sessionId ||
          task.state !== "completed"
        )
          throw new Error("Sai run/task/attempt/session hoặc task chưa đạt.");
        if (!supportsCriterion(ref, criterion.taskId, task, work))
          throw new Error(
            "Evidence không thuộc task hoặc TEST phụ thuộc của tiêu chí.",
          );
        if (ref.kind === "command") {
          const c = run.commands.find(
            (c) =>
              c.artifactId === ref.artifactId &&
              c.taskId === ref.attemptId &&
              c.sessionId === ref.sessionId &&
              c.callId === ref.callId,
          );
          if (
            !c ||
            ref.artifactId !==
              commandArtifactId(run.id, task.id, ref.sessionId, ref.callId) ||
            c.status !== "completed" ||
            c.exitCode !== 0 ||
            !c.sourceVersion ||
            c.sourceVersion !== ref.sourceVersion ||
            ref.sourceVersion !== currentVersion
          )
            throw new Error("Lệnh thiếu, thất bại hoặc thuộc source cũ.");
          const output = store.command(run.id, ref.artifactId);
          if (
            !c.artifactHash ||
            createHash("sha256").update(output).digest("hex") !== c.artifactHash
          )
            throw new Error("Artifact lệnh không khớp hash.");
          validCommand = true;
        } else {
          const evidence = task.evidence;
          const file =
            evidence && Object.hasOwn(evidence.files, ref.path)
              ? evidence.files[ref.path]
              : undefined;
          if (
            !evidence ||
            evidence.sourceVersion !== ref.sourceVersion ||
            file === undefined ||
            file?.reason ||
            (file?.hash ?? null) !== ref.hash ||
            (current.files[ref.path] ?? null) !== ref.hash ||
            !inScope(ref.path, task.allowedPaths)
          )
            throw new Error("File thiếu, ngoài scope hoặc đã đổi phiên bản.");
          store.bytes(file);
        }
      } catch (error) {
        invalid.push(
          error instanceof Error ? error.message : "Evidence không hợp lệ.",
        );
      }
    }
    if ((criterion.requiresCommand || ac.method === "command") && !validCommand)
      invalid.push("Tiêu chí kiểm thử cần command evidence thành công.");
    if (invalid.length) {
      if (ac.status === "passed") ac.status = "unverified";
      issues.push(`${ac.criterionId}: ${[...new Set(invalid)].join(" ")}`);
    }
  }
  review.verification = { verified: issues.length === 0, issues };
  // Keep the rejected conclusion and its evidence visible without another model call.
  if (
    review.status === "completed" &&
    (issues.length || review.acceptance.some((a) => a.status !== "passed"))
  ) {
    review.status = "blocked";
    review.summary =
      `Chưa đủ bằng chứng để hoàn thành. ${review.summary}`.slice(0, 6000);
    review.limitations = [...review.limitations, ...issues].slice(0, 10);
  }
}

// History viewer resolves immutable stored content, never a path on disk.
export function readEvidence(
  run: Run,
  ref: EvidenceRef,
  store: EvidenceStore,
): string {
  const task = run.tasks.find((t) => t.id === ref.attemptId);
  if (
    ref.runId !== run.id ||
    !task ||
    (task.originalTaskId ?? task.id) !== ref.taskId ||
    task.sessionId !== ref.sessionId
  )
    throw new Error("Evidence không thuộc task/session này.");
  if (ref.kind === "command") {
    const c = run.commands.find(
      (c) =>
        c.artifactId === ref.artifactId &&
        c.callId === ref.callId &&
        c.taskId === ref.attemptId &&
        c.sessionId === ref.sessionId &&
        c.sourceVersion === ref.sourceVersion,
    );
    if (!c) throw new Error("Không có command evidence tương ứng.");
    const output = store.command(run.id, ref.artifactId);
    if (
      !c.artifactHash ||
      createHash("sha256").update(output).digest("hex") !== c.artifactHash
    )
      throw new Error("Artifact lệnh không khớp hash.");
    return output;
  }
  const file =
    task.evidence && Object.hasOwn(task.evidence.files, ref.path)
      ? task.evidence.files[ref.path]
      : undefined;
  if (
    file === undefined ||
    task.evidence?.sourceVersion !== ref.sourceVersion ||
    file?.reason ||
    (file?.hash ?? null) !== ref.hash ||
    !inScope(ref.path, task.allowedPaths)
  )
    throw new Error("Không có file evidence tương ứng.");
  const data = store.bytes(file);
  if (data === null) return "File đã bị xóa ở lần thực thi này.";
  if (data.includes(0)) return "File nhị phân; nội dung không hiển thị.";
  return new TextDecoder("utf-8", { fatal: true })
    .decode(data)
    .slice(0, 256000);
}
