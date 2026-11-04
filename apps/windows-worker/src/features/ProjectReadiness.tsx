import { useRef, useState } from "react";
import type { Readiness } from "../../shared/readiness";

export function ProjectReadiness({
  projectId,
  onSettings,
}: {
  projectId: string;
  onSettings: () => void;
}) {
  const [value, setValue] = useState<Readiness | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  async function check(force = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const reply = await window.worker.readiness({ projectId, force });
      if (!reply.ok) throw Error(reply.error);
      setValue(reply.value);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Không kiểm tra được môi trường.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <details
      className="project-readiness"
      onToggle={(e) => {
        if (e.currentTarget.open && !value) void check();
      }}
    >
      <summary>
        Môi trường
        {value
          ? value.ready
            ? " · Đã đủ cấu hình local"
            : " · Cần cấu hình"
          : ""}
      </summary>
      {busy && (
        <p className="muted small" role="status">
          Đang kiểm tra…
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {value && (
        <>
          <ul className="readiness-checks">
            {value.checks.map((c) => (
              <li key={c.id}>
                <div>
                  <strong>{c.label}</strong>
                  <small>
                    {c.level === "required" ? "Bắt buộc" : "Khuyến nghị"}
                  </small>
                </div>
                <span>
                  {c.status === "pass"
                    ? "Đạt"
                    : c.status === "fail"
                      ? "Thiếu"
                      : "Chưa xác định"}
                </span>
                <p className="muted small">{c.detail}</p>
              </li>
            ))}
          </ul>
          <p className="small muted">
            {value.slot === "occupied"
              ? "Slot đang dùng; yêu cầu mới sẽ theo hàng chờ hiện có."
              : "Slot thực thi đang trống."}{" "}
            · {new Date(value.checkedAt).toLocaleTimeString("vi-VN")}
          </p>
        </>
      )}
      <div className="inline">
        <button disabled={busy} onClick={() => void check(true)}>
          Kiểm tra lại
        </button>
        <button onClick={onSettings}>Cài đặt</button>
      </div>
    </details>
  );
}
