import { useRunDetail } from "../lib/use-run-detail";
import { workStateView } from "../../shared/work-state";
import type { QuestionSet } from "../../shared/questions";
import { taskLabels } from "../../shared/inspector";
import { runIssue, currentIssueTasks } from "../../shared/attention";
import { RecoveryActions } from "./RecoveryActions";
import { taskTitle, taskDescription } from "../../shared/task-presentation";

export function WorkProgress({
  projectId,
  runId,
  onInspect,
  questionState,
  onRequirements,
  onResult,
  onDiscuss,
  activeRunId,
}: {
  projectId: string;
  runId: string;
  onInspect: (id: string, taskId?: string) => void;
  questionState?: QuestionSet["state"];
  onRequirements?: () => void;
  onResult?: () => void;
  onDiscuss?: () => void;
  activeRunId?: string | null;
}) {
  const feed = useRunDetail(projectId, runId);
  const run = feed.detail?.run;
  const issue =
    run &&
    !(
      run.state === "needs_input" &&
      questionState &&
      questionState !== "pending"
    )
      ? runIssue(run)
      : null;
  const tasks = run
    ? currentIssueTasks(run.tasks).filter(
        (task) =>
          task.kind === "work" ||
          task.kind === "fix" ||
          ["failed", "blocked", "running"].includes(task.state),
      )
    : [];
  const unavailable = feed.stale || !!feed.error;
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
          {issue ? (
            <section className="work-issue" aria-label="Vấn đề cần xử lý">
              <h3>{issue.label}</h3>
              {issue.taskTitle && (
                <p>
                  <strong>
                    {issue.role?.toUpperCase()} · {issue.taskTitle}
                  </strong>
                </p>
              )}
              <p>{issue.reason}</p>
              <p className="work-issue-next">{issue.nextAction}</p>
              {!!issue.criteria.length && (
                <ul>
                  {issue.criteria.map((criterion, index) => (
                    <li key={index}>{criterion}</li>
                  ))}
                </ul>
              )}
              <div className="work-issue-actions">
                <button
                  disabled={unavailable}
                  onClick={() => onInspect(run.id, issue.taskId ?? undefined)}
                >
                  {issue.taskId ? "Mở task gặp vấn đề" : "Xem chi tiết lỗi"}
                </button>
                {onDiscuss && (
                  <button disabled={unavailable} onClick={onDiscuss}>
                    Trao đổi với Lead
                  </button>
                )}
              </div>
              {!unavailable && !activeRunId && (
                <RecoveryActions
                  key={run.id}
                  run={run}
                  onChanged={() => void feed.refresh?.()}
                />
              )}
            </section>
          ) : (
            <p>
              <strong>{state?.label}</strong>
              {state?.reason ? ` · ${state.reason}` : ""}
            </p>
          )}
          {state?.actions
            .filter(
              (action) =>
                action.id !== "progress" &&
                (!issue ||
                  action.id === "questions" ||
                  action.id === "permissions"),
            )
            .map((action) => (
              <button
                key={action.id}
                disabled={unavailable}
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
            {tasks.map((task) => (
              <li key={task.id}>
                <button
                  disabled={unavailable}
                  onClick={() => onInspect(run.id, task.id)}
                >
                  <strong>{taskTitle(task)}</strong>
                  <span className="task-card-description">
                    {taskDescription(task).slice(0, 240)}
                  </span>
                  <span>
                    {task.role.toUpperCase()} ·{" "}
                    {task.state === "completed" && issue
                      ? "Đã chạy xong · lượt chưa hoàn tất"
                      : taskLabels[task.state]}
                  </span>
                </button>
                {task.error && task.id !== issue?.taskId && (
                  <p className="error">{task.error}</p>
                )}
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
            <ul>
              {run.tasks
                .filter((task) => !tasks.includes(task))
                .map((task) => (
                  <li key={task.id}>
                    <button
                      className="subtle"
                      disabled={unavailable}
                      onClick={() => onInspect(run.id, task.id)}
                    >
                      {taskTitle(task)} · {taskLabels[task.state]}
                    </button>
                  </li>
                ))}
            </ul>
            <p>{run.workspace}</p>
            <button disabled={unavailable} onClick={() => onInspect(run.id)}>
              Chi tiết task, model và lệnh
            </button>
          </details>
        </>
      )}
    </section>
  );
}
