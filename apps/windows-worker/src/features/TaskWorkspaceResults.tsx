import type { Run } from "../../shared/runs";
import { AcceptanceEvidence } from "./AcceptanceEvidence";

export function TaskWorkspaceResults({ run }: { run: Run }) {
  const tasks = run.tasks.filter((task) => task.workspace);
  if (!tasks.length) return null;
  return (
    <section aria-label="Kết quả workspace riêng">
      <p className="small muted">
        Thay đổi trong workspace riêng; chưa tích hợp vào source gốc.
      </p>
      {tasks.map((task) => (
        <details className="team-task" key={task.id}>
          <summary>
            <strong>
              {task.role.toUpperCase()} · {task.title}
            </strong>
            <span className="small muted">{task.changes.length} file</span>
          </summary>
          <code className="small command-script">{task.workspace}</code>
          {task.error && <p className="warning-text small">{task.error}</p>}
          {task.changes.map((file) => (
            <div className="changed-file" key={file.path}>
              <code>{file.path}</code>
              <span>{file.kind}</span>
            </div>
          ))}
          {task.evidence && task.sessionId && (
            <AcceptanceEvidence
              refs={task.changes
                .filter((file) => file.path in task.evidence!.files)
                .map((file) => ({
                  kind: "file",
                  runId: run.id,
                  taskId: task.originalTaskId ?? task.id,
                  attemptId: task.id,
                  sessionId: task.sessionId!,
                  sourceVersion: task.evidence!.sourceVersion,
                  path: file.path,
                  hash: task.evidence!.files[file.path]?.hash ?? null,
                }))}
            />
          )}
        </details>
      ))}
    </section>
  );
}
