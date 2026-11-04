import { useState } from "react";
import type { RunDetail } from "../../shared/runs";
import { isActive } from "../../shared/runs";

export function ActivityLog({ detail }: { detail: RunDetail }) {
  const [technical, setTechnical] = useState(false);
  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState("");
  const { run, events } = detail;
  const current = run.tasks.find((task) => task.id === run.currentTaskId);
  const working = run.tasks.some((task) => ["work", "fix"].includes(task.kind));
  return (
    <div className="activity-summary">
      {run.error && <p className="warning-text small">{run.error}</p>}
      {isActive(run.state) && current?.kind === "plan" && (
        <p className="muted small">Lead đang xem yêu cầu…</p>
      )}
      {isActive(run.state) && current?.kind === "review" && (
        <p className="muted small">Lead đang tổng hợp kết quả…</p>
      )}
      {!working && run.state === "completed" && (
        <p className="muted small">Đã trả lời.</p>
      )}
      {!!run.commands.length && (
        <div className="activity-commands" aria-label="Lệnh thực thi">
          {run.commands.length > 5 && (
            <p className="small muted">
              {run.commands.length} lệnh · 5 lệnh gần nhất
            </p>
          )}
          {run.commands.slice(-5).map((command, index) => (
            <div className="activity-command" key={command.artifactId ?? index}>
              <code title={command.command}>{command.command}</code>
              <span className="muted small">
                {command.status === "completed"
                  ? command.exitCode === 0
                    ? "Đạt"
                    : command.exitCode === null
                      ? "Chưa có exit code"
                      : `Lỗi ${command.exitCode}`
                  : ["running", "pending"].includes(command.status)
                    ? "Đang chạy"
                    : "Chưa đạt"}
              </span>
            </div>
          ))}
        </div>
      )}
      <details
        className="technical-log"
        onToggle={(event) => setTechnical(event.currentTarget.open)}
      >
        <summary>Chi tiết kỹ thuật</summary>
        {technical && (
          <div className="event-list">
            <div className="inline">
              <input
                aria-label="Tìm sự kiện hoặc task"
                placeholder="Tìm sự kiện hoặc task…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                aria-label="Loại sự kiện"
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
              >
                <option value="">Tất cả sự kiện</option>
                {[...new Set(events.map((e) => e.type))].sort().map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <code className="small muted">Run {run.id}</code>
            {events
              .filter(
                (event) =>
                  (!eventType || event.type === eventType) &&
                  `${event.type} ${event.text}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
              )
              .map((event) => (
                <div className="event-row" key={event.sequence}>
                  <time>{new Date(event.at).toLocaleTimeString("vi-VN")}</time>
                  <div>
                    <span className="event-type">
                      #{event.sequence} · {event.type}
                    </span>
                    <p>{event.text}</p>
                  </div>
                </div>
              ))}
          </div>
        )}
      </details>
    </div>
  );
}
