import { Clock3, FileCode2, Terminal, TriangleAlert } from "lucide-react";
import type { RunDetail } from "../../shared/runs";
import { runLabels } from "../../shared/runs";
import { formatDuration } from "../lib/formatDuration";

export function RunPanel({
  detail,
  tab,
  onPermission,
  busy,
}: {
  detail: RunDetail | null;
  tab: string;
  onPermission: (id: string, allow: boolean) => void;
  busy: boolean;
}) {
  if (!detail)
    return (
      <div className="empty">
        <div className="empty-icon">
          <Terminal size={25} />
        </div>
        <strong>Chưa có lượt chạy</strong>
        <span className="muted small">
          Nhập yêu cầu và chọn agent để bắt đầu.
        </span>
      </div>
    );
  const { run, events } = detail;
  return (
    <div className="run-panel">
      <div className="run-header">
        <span className={`run-state ${run.state}`}>{runLabels[run.state]}</span>
        <span className="muted small">
          {run.role.toUpperCase()} · {run.model}
        </span>
        <span className="muted small">{run.requests} request</span>
      </div>
      {run.permissions.map((permission) => (
        <section className="permission-box" key={permission.id}>
          <strong>
            <TriangleAlert size={16} />
            Cho phép công cụ một lần?
          </strong>
          <div>{permission.permission}</div>
          <pre>{permission.patterns.join("\n")}</pre>
          <p className="muted small">
            Shell chạy bằng quyền Windows của bạn, có thể tác động ngoài
            workspace.
          </p>
          <div className="inline">
            <button
              disabled={busy}
              onClick={() => onPermission(permission.id, false)}
            >
              Từ chối
            </button>
            <button
              disabled={busy}
              className="primary"
              onClick={() => onPermission(permission.id, true)}
            >
              Cho phép một lần
            </button>
          </div>
        </section>
      ))}
      {tab === "activity" && (
        <div className="event-list">
          {events.map((event) => (
            <div className="event-row" key={event.sequence}>
              <span className="event-marker" />
              <time>{new Date(event.at).toLocaleTimeString("vi-VN")}</time>
              <div>
                <span className="event-type">
                  {event.type.replaceAll("_", " ").toLowerCase()}
                </span>
                <p>{event.text}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === "changes" && (
        <div className="changes-list">
          {!run.baselineComplete && (
            <p className="warning-text small">
              Danh sách giới hạn ở file source đã quét; bỏ qua dependency, file
              nhạy cảm và file lớn.
            </p>
          )}
          {run.changes.length ? (
            run.changes.map((file) => (
              <div key={file.path} className="changed-file">
                <FileCode2 size={16} />
                <code>{file.path}</code>
                <span className="pill">
                  {file.kind === "added"
                    ? "Thêm"
                    : file.kind === "deleted"
                      ? "Xóa"
                      : "Sửa"}
                </span>
              </div>
            ))
          ) : (
            <div className="empty">
              <FileCode2 size={24} />
              <strong>Chưa ghi nhận thay đổi</strong>
            </div>
          )}
          <p className="muted small">
            So sánh source trước/sau lượt chạy. Diff từng dòng sẽ có ở WW-4.
          </p>
        </div>
      )}
      {tab === "result" && (
        <div className="run-result">
          {run.error && (
            <div className="notice error">
              <TriangleAlert size={16} />
              {run.error}
            </div>
          )}
          {run.summary ? (
            <pre className="final-summary">{run.summary}</pre>
          ) : (
            <p className="muted">Chưa có báo cáo cuối.</p>
          )}
          {run.commands.length > 0 && (
            <section>
              <h2>
                <Terminal size={16} />
                Lệnh đã thực thi
              </h2>
              {run.commands.map((command) => (
                <details
                  className="command-result"
                  key={command.callId}
                  open={command.status === "error"}
                >
                  <summary>
                    <code>{command.command}</code>
                    <span className="pill">
                      {command.exitCode === null
                        ? command.status
                        : `exit ${command.exitCode}`}
                    </span>
                  </summary>
                  <pre>{command.output || "Chưa có output."}</pre>
                </details>
              ))}
            </section>
          )}
          <div className="run-facts">
            <span>
              <Clock3 size={13} />{" "}
              {formatDuration(
                (run.endedAt ? Date.parse(run.endedAt) : Date.now()) -
                  Date.parse(run.startedAt ?? run.createdAt),
              )}
            </span>
            <span>{run.toolsCompleted} tool hoàn thành</span>
            <span>
              Token báo cáo: {run.inputTokens} vào / {run.outputTokens} ra
            </span>
          </div>
          <p className="muted small">
            Trạng thái kết thúc phản ánh runtime; kết quả build/test chỉ có giá
            trị khi kèm lệnh và exit code.
          </p>
        </div>
      )}
    </div>
  );
}
