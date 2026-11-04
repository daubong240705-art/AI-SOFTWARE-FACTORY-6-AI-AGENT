import { CircleAlert, CheckCircle2, Clock3, RefreshCw } from "lucide-react";
import { attentionItems } from "../../shared/overview";
import { activityLabels } from "../../shared/monitor";
import { isActive, runLabels } from "../../shared/runs";
import type { MonitorState } from "../lib/monitor-store";

function time(value: string) {
  return new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function ProjectOverview({
  state,
  onRefresh,
  onInspect,
  onChat,
  onConversation,
  onBoard,
  onAgents,
}: {
  state: MonitorState;
  onRefresh: () => void;
  onInspect: (
    runId: string,
    taskId?: string | null,
    executionId?: string,
  ) => void;
  onChat: (runId: string, conversationId: string | null) => void;
  onConversation: (id: string) => void;
  onBoard: () => void;
  onAgents: () => void;
}) {
  const snapshot = state.snapshot,
    data = snapshot?.overview;
  const attention = data ? attentionItems(data) : [];
  const unavailable = state.stale || !!state.error;
  const active = data?.runs.find(
    (run) => run.id === snapshot?.activeRun?.id && isActive(run.state),
  );
  const results =
    data?.runs.filter((run) => run.state === "completed").slice(0, 5) ?? [];
  return (
    <section className="project-overview" aria-label="Tổng quan dự án">
      <div className="page-heading">
        <h1>Tổng quan</h1>
        <button onClick={onRefresh}>
          <RefreshCw size={15} />
          Cập nhật
        </button>
      </div>
      {(state.error || state.stale) && (
        <div
          className={`notice ${state.error ? "error" : ""}`}
          role={state.error ? "alert" : "status"}
        >
          <CircleAlert size={16} />
          <span>
            {state.error || "Chưa đồng bộ · Đang hiển thị dữ liệu lần cuối"}
          </span>
        </div>
      )}
      {!data ? (
        <div className="overview-placeholder" role="status">
          {state.error
            ? "Chưa tải được tổng quan. Chọn Cập nhật để thử lại."
            : "Đang tải tổng quan…"}
        </div>
      ) : (
        <>
          <section
            className="overview-section"
            aria-labelledby="attention-title"
          >
            <div className="overview-section-heading">
              <h2 id="attention-title">
                Cần bạn xử lý{" "}
                <span className="overview-count">{attention.length}</span>
              </h2>
              <span className="muted small">
                {data.runs.length} lượt gần nhất · Hàng đợi dự án
              </span>
            </div>
            {attention.length ? (
              <ul className="overview-list attention-list">
                {attention.map((item) => (
                  <li key={item.key}>
                    <CircleAlert size={18} className="warning-text" />
                    <div className="overview-row-body">
                      <span className="muted small">
                        {item.label} · {time(item.at)}
                      </span>
                      <h3>{item.title}</h3>
                      <p className="muted">{item.reason}</p>
                    </div>
                    <button
                      disabled={unavailable}
                      onClick={() => {
                        if (item.runId && item.label !== "Cần bổ sung")
                          onInspect(item.runId);
                        else if (item.runId)
                          onChat(item.runId, item.conversationId);
                        else if (item.conversationId)
                          onConversation(item.conversationId);
                      }}
                    >
                      {item.action}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="overview-empty">
                <CheckCircle2 size={17} />
                Không có việc cần bạn xử lý trong các lượt gần đây.
              </p>
            )}
          </section>
          <div className="overview-columns">
            <section
              className="overview-section"
              aria-labelledby="working-title"
            >
              <div className="overview-section-heading">
                <h2 id="working-title">Đang làm</h2>
                <button className="subtle" onClick={onAgents}>
                  Đội ngũ
                </button>
              </div>
              {snapshot?.activeRun &&
                snapshot.activeRun.projectId !== snapshot.projectId && (
                  <p className="overview-other">
                    Slot đang dùng ở{" "}
                    <strong>{snapshot.activeRun.projectName}</strong>. Yêu cầu
                    mới sẽ chờ lượt.
                  </p>
                )}
              {active ? (
                <div className="overview-active">
                  <span className={`run-state ${active.state}`}>
                    {runLabels[active.state]}
                  </span>
                  <h3>{active.prompt}</h3>
                  <div className="overview-progress">
                    <span>
                      {snapshot!.progress.verifiedTasks}/
                      {snapshot!.progress.currentTasks} task xác minh
                    </span>
                    <span>
                      {snapshot!.progress.passedCriteria}/
                      {snapshot!.progress.applicableCriteria} tiêu chí đạt
                    </span>
                  </div>
                  {snapshot?.agents.flatMap((agent) =>
                    agent.executions.map((execution) => (
                      <button
                        className="overview-execution"
                        key={execution.executionId}
                        disabled={unavailable}
                        onClick={() =>
                          onInspect(
                            execution.runId,
                            execution.taskId,
                            execution.executionId,
                          )
                        }
                      >
                        <strong>{agent.role.toUpperCase()}</strong>
                        <span>
                          {execution.title}
                          <small>{activityLabels[execution.activity]}</small>
                        </span>
                      </button>
                    )),
                  )}
                  <button
                    disabled={unavailable}
                    onClick={() => onInspect(active.id)}
                  >
                    Chi tiết lượt chạy
                  </button>
                </div>
              ) : (
                <p className="overview-empty">
                  <Clock3 size={17} />
                  {unavailable
                    ? "Chưa xác định trạng thái hiện tại."
                    : "Không có lượt chạy trong dự án này."}
                </p>
              )}
              {!!data.queue.length && (
                <p className="muted overview-queue">
                  {data.queue.filter((q) => q.state === "waiting").length} yêu
                  cầu chờ lượt ·{" "}
                  {data.queue.filter((q) => q.state === "held").length} tạm giữ
                </p>
              )}
            </section>
            <section
              className="overview-section"
              aria-labelledby="results-title"
            >
              <div className="overview-section-heading">
                <h2 id="results-title">Kết quả gần đây</h2>
                <button className="subtle" onClick={onBoard}>
                  Công việc
                </button>
              </div>
              {results.length ? (
                <ul className="overview-results">
                  {results.map((run) => (
                    <li key={run.id}>
                      <button
                        disabled={unavailable}
                        onClick={() => onInspect(run.id)}
                      >
                        <span className="overview-result-title">
                          {run.prompt}
                        </span>
                        <span
                          className={run.verified ? "success-text" : "muted"}
                        >
                          {run.verified
                            ? "Đã xác minh"
                            : "Đã kết thúc · Chưa xác minh"}
                        </span>
                        <span className="muted small">
                          {run.changes} file thay đổi ·{" "}
                          {time(run.endedAt ?? run.createdAt)}
                        </span>
                        {run.summary && (
                          <span className="muted overview-result-summary">
                            {run.summary}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="overview-empty">
                  Chưa có kết quả trong các lượt gần đây.
                </p>
              )}
            </section>
          </div>
          <section
            className="overview-section"
            aria-labelledby="activity-title"
          >
            <div className="overview-section-heading">
              <div>
                <h2 id="activity-title">Hoạt động gần đây</h2>
                <p className="muted small">
                  Lượt hiện tại hoặc gần nhất trong dự án
                </p>
              </div>
              {data.timelineRunId && (
                <button
                  className="subtle"
                  disabled={unavailable}
                  onClick={() => onInspect(data.timelineRunId!)}
                >
                  Chi tiết kỹ thuật
                </button>
              )}
            </div>
            {data.timeline.length ? (
              <ol className="overview-timeline">
                {data.timeline.map((entry) => (
                  <li key={entry.sequence}>
                    <span className="overview-event-dot" />
                    <span>
                      {entry.title}
                      {entry.role && (
                        <small className="muted">
                          {" "}
                          · {entry.role.toUpperCase()}
                          {entry.taskId ? ` / ${entry.taskId}` : ""}
                        </small>
                      )}
                      {entry.count > 1 && ` ×${entry.count}`}
                    </span>
                    <time dateTime={entry.at}>{time(entry.at)}</time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="overview-empty">Chưa có hoạt động đáng chú ý.</p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
