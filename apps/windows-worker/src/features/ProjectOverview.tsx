import { useState } from "react";
import {
  CircleAlert,
  CheckCircle2,
  ChevronRight,
  Clock3,
  RefreshCw,
} from "lucide-react";
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
}) {
  const [allAttention, setAllAttention] = useState(false);
  const [allResults, setAllResults] = useState(false);
  const snapshot = state.snapshot,
    data = snapshot?.overview;
  const attention = data ? attentionItems(data) : [];
  const unavailable = state.stale || !!state.error;
  const active = data?.runs.find(
    (run) => run.id === snapshot?.activeRun?.id && isActive(run.state),
  );
  const results =
    data?.runs
      .filter((run) => run.state === "completed" && run.hasWork)
      .slice(0, 5) ?? [];
  const executions =
    snapshot?.agents.flatMap((agent) =>
      agent.executions.map((execution) => ({ ...execution, role: agent.role })),
    ) ?? [];
  return (
    <section className="project-overview" aria-label="Tổng quan dự án">
      <div className="page-heading">
        <h1>Tổng quan</h1>
        <button
          className="icon-button subtle"
          aria-label="Cập nhật tổng quan"
          title="Cập nhật tổng quan"
          onClick={onRefresh}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {unavailable && (
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
          {active ? (
            <section
              className="overview-section"
              aria-labelledby="working-title"
            >
              <div className="overview-active">
                <div className="overview-active-heading">
                  <h2 id="working-title">Đang làm</h2>
                  <span className={`run-state ${active.state}`}>
                    {runLabels[active.state]}
                  </span>
                </div>
                <button
                  className="overview-active-title"
                  disabled={unavailable}
                  onClick={() => onInspect(active.id)}
                >
                  {active.prompt}
                  <ChevronRight size={16} />
                </button>
                {snapshot!.progress.currentTasks > 0 && (
                  <p className="overview-progress">
                    {snapshot!.progress.verifiedTasks}/
                    {snapshot!.progress.currentTasks} task xác minh
                  </p>
                )}
                {!!executions.length && (
                  <div className="overview-executions">
                    {executions.map((execution) => (
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
                        <strong>{execution.role.toUpperCase()}</strong>
                        <span>
                          {execution.title}
                          <small>{activityLabels[execution.activity]}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ) : (
            <div className="overview-idle" role="status">
              <Clock3 size={16} />
              {unavailable ? (
                "Chưa xác định trạng thái hiện tại."
              ) : snapshot?.activeRun &&
                snapshot.activeRun.projectId !== snapshot.projectId ? (
                <span>
                  Slot đang dùng ở{" "}
                  <strong>{snapshot.activeRun.projectName}</strong>
                </span>
              ) : (
                "Không có lượt chạy trong dự án này."
              )}
              {!!data.queue.filter((q) => q.state === "waiting").length && (
                <span>
                  · {data.queue.filter((q) => q.state === "waiting").length} chờ
                  lượt
                </span>
              )}
            </div>
          )}
          <div className="overview-columns">
            <section
              className="overview-section"
              aria-labelledby="attention-title"
            >
              <div className="overview-section-heading">
                <h2 id="attention-title">
                  Cần bạn xử lý{" "}
                  <span className="overview-count">{attention.length}</span>
                </h2>
              </div>
              {attention.length ? (
                <ul className="overview-list attention-list">
                  {attention
                    .slice(0, allAttention ? undefined : 3)
                    .map((item) => (
                      <li key={item.key}>
                        <button
                          className="overview-attention-row"
                          aria-label={`${item.action}: ${item.title}`}
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
                          <span className="overview-row-body">
                            <span className="overview-row-label">
                              {item.label}
                            </span>
                            <strong className="overview-row-title">
                              {item.title}
                            </strong>
                            <span
                              className="overview-row-reason"
                              title={item.reason}
                            >
                              {item.reason}
                            </span>
                          </span>
                          <ChevronRight size={16} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="overview-empty">
                  <CheckCircle2 size={17} />
                  Không có việc cần xử lý gần đây.
                </p>
              )}
              {attention.length > 3 && (
                <button
                  className="overview-expand"
                  aria-expanded={allAttention}
                  onClick={() => setAllAttention(!allAttention)}
                >
                  {allAttention
                    ? "Thu gọn"
                    : `Xem thêm ${attention.length - 3} mục`}
                </button>
              )}
            </section>
            <section
              className="overview-section"
              aria-labelledby="results-title"
            >
              <div className="overview-section-heading">
                <h2 id="results-title">Kết quả công việc</h2>
              </div>
              {results.length ? (
                <ul className="overview-results">
                  {results.slice(0, allResults ? undefined : 3).map((run) => (
                    <li key={run.id}>
                      <button
                        disabled={unavailable}
                        onClick={() => onInspect(run.id)}
                      >
                        <span className="overview-result-title">
                          {run.prompt}
                        </span>
                        <span className="overview-result-meta">
                          <span
                            className={run.verified ? "success-text" : "muted"}
                          >
                            {run.verified ? "Đã xác minh" : "Chưa xác minh"}
                          </span>
                          <time dateTime={run.endedAt ?? run.createdAt}>
                            {time(run.endedAt ?? run.createdAt)}
                          </time>
                        </span>
                        {run.changes > 0 && (
                          <span className="muted small">
                            {run.changes} file thay đổi
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="overview-empty">
                  Chưa có kết quả công việc gần đây.
                </p>
              )}
              {results.length > 3 && (
                <button
                  className="overview-expand"
                  aria-expanded={allResults}
                  onClick={() => setAllResults(!allResults)}
                >
                  {allResults
                    ? "Thu gọn"
                    : `Xem thêm ${results.length - 3} kết quả`}
                </button>
              )}
            </section>
          </div>
          {data.timeline.length > 0 && (
            <details className="overview-section overview-activity">
              <summary>
                Hoạt động gần đây <ChevronRight size={16} aria-hidden="true" />
              </summary>
              {data.timeline.length ? (
                <ol className="overview-timeline">
                  {data.timeline.slice(0, 6).map((entry) => (
                    <li key={entry.sequence}>
                      <span className="overview-event-dot" />
                      <span>
                        {entry.title}
                        {entry.role && (
                          <small className="muted">
                            {" "}
                            · {entry.role.toUpperCase()}
                          </small>
                        )}
                      </span>
                      <time dateTime={entry.at}>{time(entry.at)}</time>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="overview-empty">Chưa có hoạt động đáng chú ý.</p>
              )}
              {data.timelineRunId && (
                <button
                  className="overview-expand"
                  disabled={unavailable}
                  onClick={() => onInspect(data.timelineRunId!)}
                >
                  Xem chi tiết lượt chạy
                </button>
              )}
            </details>
          )}
          <p className="overview-scope muted small">
            Trong {data.runs.length} lượt gần nhất
          </p>
        </>
      )}
    </section>
  );
}
