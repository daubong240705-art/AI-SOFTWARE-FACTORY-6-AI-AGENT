import { useRef, useState, useEffect } from "react";
import type { Run } from "../../shared/runs";
import type { TeamTask } from "../../shared/team";
import type { EvidenceRef, FileDiff } from "../../shared/evidence";
import { AcceptanceEvidence } from "./AcceptanceEvidence";
import { PatchView } from "./ChangesPanel";

export function TaskChanges({ run, task }: { run: Run; task: TeamTask }) {
  const [diff, setDiff] = useState<Pick<
    FileDiff,
    "patch" | "binary" | "reason"
  > | null>(null);
  const [path, setPath] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const refs: EvidenceRef[] =
    task.evidence && task.sessionId
      ? task.changes
          .filter((f) => f.path in task.evidence!.files)
          .map((file) => ({
            kind: "file",
            runId: run.id,
            taskId: task.originalTaskId ?? task.id,
            attemptId: task.id,
            sessionId: task.sessionId!,
            sourceVersion: task.evidence!.sourceVersion,
            path: file.path,
            hash: task.evidence!.files[file.path]?.hash ?? null,
          }))
      : [];
  async function open(ref: EvidenceRef) {
    const request = ++generation.current;
    setDiff(null);
    setError("");
    setLoading(true);
    setPath(ref.kind === "file" ? ref.path : "");
    try {
      const reply = await window.worker.taskFileDiff(ref);
      if (request !== generation.current) return;
      if (!reply.ok) throw new Error(reply.error);
      setDiff(reply.value);
    } catch (e) {
      if (request === generation.current) setError((e as Error).message);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }
  return (
    <section aria-label="Thay đổi của task">
      <p className="small muted">
        Workspace task · {task.workspace ?? run.workspace}
      </p>
      {task.changes.map((file) => (
        <div key={file.path} className="changed-file">
          <code>{file.path}</code>
          <span>{file.kind}</span>
          {refs.some((r) => r.kind === "file" && r.path === file.path) && (
            <button
              disabled={loading}
              onClick={() =>
                void open(
                  refs.find((r) => r.kind === "file" && r.path === file.path)!,
                )
              }
            >
              Xem diff
            </button>
          )}
        </div>
      ))}
      {!task.changes.length && (
        <p className="muted">Chưa ghi nhận file thay đổi.</p>
      )}
      {refs.length > 0 && (
        <details>
          <summary>Nội dung evidence đã lưu</summary>
          <AcceptanceEvidence refs={refs} />
        </details>
      )}
      {loading && <p role="status">Đang mở diff…</p>}
      {error && (
        <p className="warning-text" role="alert">
          {error}
        </p>
      )}
      {diff && (
        <section aria-label="Diff của task">
          <strong>{path}</strong>
          {diff.reason && <p className="muted">{diff.reason}</p>}
          <PatchView patch={diff.patch} />
        </section>
      )}
    </section>
  );
}
