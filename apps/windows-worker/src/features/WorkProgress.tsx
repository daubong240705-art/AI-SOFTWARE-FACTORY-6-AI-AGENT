import { useRunDetail } from "../lib/use-run-detail";
import { workStateView } from "../../shared/work-state";
import type { QuestionSet } from "../../shared/questions";
import { taskLabels } from "../../shared/inspector";

export function WorkProgress({
  projectId,
  runId,
  onInspect,
  questionState,
  onRequirements,
  onResult,
}: {
  projectId: string;
  runId: string;
  onInspect: (id: string, taskId?: string) => void;
  questionState?: QuestionSet["state"];
  onRequirements?: () => void;
  onResult?: () => void;
}) {
  const feed = useRunDetail(projectId, runId);
  const run = feed.detail?.run;
  const state = run
    ? workStateView(run, {
        questionState,
        stale: feed.stale || !!feed.error,
        report: feed.detail?.reportState,
      })
    : null;
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
            <strong>{state?.label}</strong>
            {state?.reason ? ` · ${state.reason}` : ""}
          </p>
          {state?.actions
            .filter((action) => action.id !== "progress")
            .map((action) => (
              <button
                key={action.id}
                onClick={() =>
                  action.id === "questions"
                    ? onRequirements?.()
                    : action.id === "result"
                      ? onResult?.()
                      : onInspect(run.id)
                }
              >
                {action.label}
              </button>
            ))}
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
