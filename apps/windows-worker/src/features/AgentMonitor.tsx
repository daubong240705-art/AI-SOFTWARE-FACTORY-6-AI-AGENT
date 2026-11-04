import { useState } from "react";
import { activityLabels, availabilityLabels } from "../../shared/monitor";
import { runLabels, type RunState } from "../../shared/runs";
import type { MonitorState } from "../lib/monitor-store";
import "../monitor.css";

function duration(start: string | null, now: string): string {
  if (!start) return "";
  const seconds = Math.max(
    0,
    Math.floor((Date.parse(now) - Date.parse(start)) / 1000),
  );
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
export function AgentMonitor({
  state,
  projectName,
  onOpenRun,
  onSettings,
  onRefresh,
}: {
  state: MonitorState;
  projectName: string;
  onOpenRun: (id: string, conversationId: string | null) => void;
  onSettings: () => void;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const snapshot = state.snapshot;
  const agents = snapshot?.agents ?? [];
  return (
    <section className="agent-monitor" aria-label="Theo dõi agent">
      <div className="page-heading">
        <div>
          <h1>Đội ngũ</h1>
          <span className="muted">{projectName}</span>
        </div>
        <button onClick={onRefresh}>Cập nhật</button>
      </div>
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      {state.stale && (
        <div className="notice" role="status">
          Chưa đồng bộ · Đang hiển thị trạng thái lần cuối
        </div>
      )}
      {!snapshot ? (
        <p className="muted">
          {state.error ? "Chưa có dữ liệu agent." : "Đang tải trạng thái…"}
        </p>
      ) : (
        <>
          {snapshot.activeRun &&
            snapshot.activeRun.projectId !== snapshot.projectId && (
              <p className="monitor-other">
                Đang chạy ở {snapshot.activeRun.projectName}
              </p>
            )}
          <div className="monitor-filters" aria-label="Lọc agent">
            {(
              [
                "all",
                "occupied",
                "available",
                "unconfigured",
                "disabled",
              ] as const
            ).map((key) => (
              <button
                key={key}
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {key === "all" ? "Tất cả" : availabilityLabels[key]}{" "}
                <span>
                  {key === "all"
                    ? agents.length
                    : agents.filter((a) => a.availability === key).length}
                </span>
              </button>
            ))}
          </div>
          <div className="monitor-progress">
            <span>
              {snapshot.progress.verifiedTasks}/{snapshot.progress.currentTasks}{" "}
              task xác minh
            </span>
            <span>
              {snapshot.progress.passedCriteria}/
              {snapshot.progress.applicableCriteria} tiêu chí đạt
            </span>
            {snapshot.runState && (
              <span>
                {runLabels[snapshot.runState as RunState] ?? snapshot.runState}
              </span>
            )}
            {snapshot.runId && (
              <button
                onClick={() =>
                  onOpenRun(snapshot.runId!, snapshot.conversationId)
                }
              >
                Mở lượt chạy
              </button>
            )}
          </div>
          <div className="agent-grid">
            {agents
              .filter((a) => filter === "all" || a.availability === filter)
              .map((agent) => (
                <article
                  key={agent.role}
                  className={`agent-card ${agent.availability}`}
                >
                  <header>
                    <strong>
                      {agent.role === "lead"
                        ? "Lead"
                        : agent.role.toUpperCase()}
                    </strong>
                    <span className="pill">
                      {state.stale
                        ? "Chưa đồng bộ"
                        : availabilityLabels[agent.availability]}
                    </span>
                  </header>
                  {agent.executions.map((execution) => (
                    <div
                      className="agent-execution"
                      key={execution.executionId}
                    >
                      <div className="agent-activity">
                        {activityLabels[execution.activity]}{" "}
                        <small>
                          {duration(execution.startedAt, snapshot.observedAt)}
                        </small>
                      </div>
                      <button
                        className="agent-task"
                        onClick={() =>
                          onOpenRun(execution.runId, snapshot.conversationId)
                        }
                      >
                        {execution.taskId ?? "Direct"} · {execution.title}
                      </button>
                      <div className="agent-model" title={execution.model}>
                        {execution.model}
                      </div>
                    </div>
                  ))}
                  {!agent.executions.length && (
                    <div
                      className="agent-model"
                      title={agent.configuredModel ?? ""}
                    >
                      {agent.configuredModel || "Chưa chọn model"}
                    </div>
                  )}
                  {agent.waiting.map((task) => (
                    <div className="agent-waiting" key={task.taskId}>
                      {task.taskId} · {task.reason}
                      <small>{task.title}</small>
                    </div>
                  ))}
                  {!agent.executions.length && agent.lastFinished && (
                    <div className="agent-last">
                      {agent.lastFinished.outcome === "completed"
                        ? "Vừa kết thúc"
                        : agent.lastFinished.outcome === "failed"
                          ? "Lần trước thất bại"
                          : "Lần trước đã dừng/gián đoạn"}
                      <small>{agent.lastFinished.title}</small>
                    </div>
                  )}
                  {agent.availability === "unconfigured" && (
                    <button className="subtle" onClick={onSettings}>
                      Cấu hình model / gateway
                    </button>
                  )}
                </article>
              ))}
          </div>
          <small className="muted monitor-updated">
            Cập nhật {new Date(snapshot.observedAt).toLocaleTimeString("vi-VN")}
          </small>
        </>
      )}
    </section>
  );
}
