import { useRunDetail } from "../lib/use-run-detail";
import { latestBoardTasks } from "../../shared/board";
import { taskLabels } from "../../shared/inspector";
import { taskResult } from "../../shared/task-presentation";
import { TaskDescription, TaskResult } from "./TaskReadableContent";

export function WorkAgentTasks({
  projectId,
  runId,
  documents = false,
  onInspect,
}: {
  projectId: string;
  runId: string;
  documents?: boolean;
  onInspect: (id: string, taskId?: string) => void;
}) {
  const feed = useRunDetail(projectId, runId);
  const run = feed.detail?.run;
  const tasks = run
    ? documents
      ? run.tasks.filter((t) => t.role === "ba" && t.summary.trim())
      : latestBoardTasks(run.tasks)
    : [];
  return (
    <section
      className="work-agent-details"
      aria-label={documents ? "Tài liệu phân tích BA" : "Phân công theo agent"}
    >
      <h3>
        {documents
          ? "Phân tích và thiết kế dữ liệu · BA"
          : "Phân công theo agent"}
      </h3>
      {(feed.error || feed.stale) && (
        <p role="status" className="notice">
          {feed.error || "Chưa đồng bộ · Dữ liệu lần cuối"}
        </p>
      )}
      {!run ? (
        <p>Đang tải task…</p>
      ) : !tasks.length ? (
        <p className="muted">
          {documents
            ? "Chưa có tài liệu BA trong lần thực hiện này."
            : "Lead chưa lập kế hoạch task."}
        </p>
      ) : (
        <>
          {!documents && (
            <p className="small muted">
              {run.settings.teamExecution === "isolated-pair"
                ? "Tối đa 2 task độc lập chạy song song trong worktree riêng; task có phụ thuộc chờ tích hợp."
                : "Lượt này chạy tuần tự. Để chạy hai task độc lập, chọn Thực thi nhóm trong Cài đặt trước lượt mới."}
            </p>
          )}
          {tasks.map((task) => (
            <details key={task.id} open={documents ? true : undefined}>
              <summary>
                {task.role.toUpperCase()} · {task.id} · {task.title} ·{" "}
                {taskLabels[task.state]}
              </summary>
              <p className="small muted">
                {task.endedAt
                  ? new Date(task.endedAt).toLocaleString("vi-VN")
                  : "Chưa kết thúc"}
                {documents
                  ? " · Đã lưu trong hồ sơ lần thực hiện; báo cáo chưa thay thế kiểm chứng."
                  : ""}
              </p>
              {!documents && (
                <>
                  <TaskDescription task={task} />
                  <h4>Tiêu chí hoàn thành</h4>
                  <ol>
                    {task.acceptance.map((criterion, i) => (
                      <li key={i}>{criterion}</li>
                    ))}
                  </ol>
                  <p>
                    Phụ thuộc:{" "}
                    {task.dependsOn.length
                      ? task.dependsOn
                          .map((id) => {
                            const dependency = latestBoardTasks(run.tasks).find(
                              (t) => (t.originalTaskId ?? t.id) === id,
                            );
                            return dependency
                              ? `${dependency.role.toUpperCase()} · ${dependency.title} (${taskLabels[dependency.state]})`
                              : id;
                          })
                          .join(", ")
                      : "Không có"}
                  </p>
                  <p>Phạm vi: {task.allowedPaths.join(", ")}</p>
                </>
              )}
              {task.summary && <TaskResult task={task} />}
              {task.error && <p className="error">{task.error}</p>}
              <div className="work-actions">
                <button onClick={() => onInspect(runId, task.id)}>
                  Chi tiết task
                </button>
                {documents && (
                  <button
                    onClick={() => {
                      const blob = new Blob(
                        [
                          `# ${task.title}\n\nLượt: ${runId}\nTask: ${task.id}\nTrạng thái: ${task.state}\n\n${taskResult(task).text}\n`,
                        ],
                        { type: "text/markdown;charset=utf-8" },
                      );
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = `BA-${runId}-${task.id}.md`;
                      link.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }}
                  >
                    Tải tài liệu .md
                  </button>
                )}
              </div>
            </details>
          ))}
        </>
      )}
    </section>
  );
}
