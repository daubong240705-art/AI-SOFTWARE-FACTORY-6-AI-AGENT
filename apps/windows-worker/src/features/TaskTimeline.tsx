import { useState } from "react";
import type { Role } from "../../shared/contracts";
import type { RunDetail } from "../../shared/runs";
import { compactTimeline } from "../../shared/inspector";

export function TaskTimeline({
  detail,
  taskId,
}: {
  detail: RunDetail;
  taskId?: string;
}) {
  const [role, setRole] = useState("");
  const [limit, setLimit] = useState(20);
  const rows = compactTimeline(detail, {
    taskId,
    role: role ? (role as Role) : undefined,
  });
  return (
    <section className="task-timeline" aria-label="Dòng thời gian">
      <header className="inline">
        <strong>Dòng thời gian</strong>
        {!taskId && (
          <select
            aria-label="Lọc timeline theo agent"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setLimit(20);
            }}
          >
            <option value="">Mọi agent</option>
            {[
              ...new Set(
                [
                  detail.run.role,
                  ...detail.run.tasks.map((t) => t.role),
                ].filter(Boolean),
              ),
            ].map((r) => (
              <option key={r} value={r}>
                {r.toUpperCase()}
              </option>
            ))}
          </select>
        )}
        <small className="muted">{rows.length} mốc còn lưu</small>
      </header>
      {rows.length > limit && (
        <button onClick={() => setLimit((n) => n + 40)}>Xem mốc trước</button>
      )}
      {!rows.length && (
        <p className="muted small">
          Chưa có mốc phù hợp. Lượt cũ có thể thiếu metadata task.
        </p>
      )}
      <ol>
        {rows.slice(-limit).map((row) => (
          <li key={row.sequence}>
            <time>{new Date(row.at).toLocaleTimeString("vi-VN")}</time>
            <div>
              <span>
                {row.role?.toUpperCase()}
                {row.taskId ? ` · ${row.taskId}` : ""}
              </span>
              <p>
                {row.title}
                {row.count > 1 ? ` ×${row.count}` : ""}
              </p>
              {row.legacy && (
                <small className="muted">
                  Dữ liệu cũ · chưa có metadata owner
                </small>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
