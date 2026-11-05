import { useRunDetail } from "../lib/use-run-detail";
import { runLabels } from "../../shared/runs";
import { taskLabels } from "../../shared/inspector";

export function WorkProgress({
  projectId,
  runId,
  onInspect,
}: {
  projectId: string;
  runId: string;
  onInspect: (id: string, taskId?: string) => void;
}) {
  const feed = useRunDetail(projectId, runId);
  const run = feed.detail?.run;
  return (
    <section className="work-progress" aria-label="Tiến độ thực hiện">
      {(feed.error || feed.stale) && (
        <p className="notice" role="status">
          {feed.error || "Chưa đồng bộ · Trạng thái lần cuối"}
        </p>
      )}
      {!run ? (
        <p>Đang tải tiến độ…</p>
      ) : (
        <>
          <p>
            <strong>{runLabels[run.state]}</strong>
            {run.error ? ` · ${run.error}` : ""}
          </p>
          {!run.tasks.length && (
            <p className="muted">
              Chưa có kế hoạch task. Trạng thái này không xác nhận công việc đã
              được kiểm chứng.
            </p>
          )}
          <ol className="work-progress-tasks">
            {run.tasks.map((task) => (
              <li key={task.id}>
                <button onClick={() => onInspect(run.id, task.id)}>
                  <strong>{task.title}</strong>
                  <span>
                    {task.role.toUpperCase()} · {taskLabels[task.state]}
                  </span>
                </button>
                {task.error && <p className="error">{task.error}</p>}
                {!!task.dependsOn.length && (
                  <small>
                    Phụ thuộc:{" "}
                    {task.dependsOn
                      .map(
                        (id) => run.tasks.find((t) => t.id === id)?.title ?? id,
                      )
                      .join(", ")}
                  </small>
                )}
              </li>
            ))}
          </ol>
          <details>
            <summary>Thông tin thực hiện</summary>
            <p>{run.workspace}</p>
            <button onClick={() => onInspect(run.id)}>
              Chi tiết task, model và lệnh
            </button>
          </details>
        </>
      )}
    </section>
  );
}
