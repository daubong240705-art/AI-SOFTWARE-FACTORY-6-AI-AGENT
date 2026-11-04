import { useState } from "react";
import type { Run } from "../../shared/runs";
import type { RecoveryPreview } from "../../shared/lifecycle";
export function RecoveryActions({
  run,
  onChanged,
}: {
  run: Run;
  onChanged: () => void;
}) {
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (run.integration)
    return (
      <p className="small muted">
        Mở bản tích hợp để xem và tiếp tục. Lượt này không tự phát lại lên
        source gốc.
      </p>
    );
  if (run.failure?.code === "integration-pending")
    return (
      <p className="small muted">
        Mở Workspace để xem kết quả. Chưa có thao tác tích hợp tự động.
      </p>
    );
  if (
    !["interrupted", "failed", "cancelled", "needs_input"].includes(run.state)
  )
    return null;
  async function inspect() {
    setBusy(true);
    setError("");
    try {
      const r = await window.worker.recovery(run.id);
      if (!r.ok) throw new Error(r.error);
      setPreview(r.value);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function proceed() {
    setBusy(true);
    setError("");
    try {
      const r = await window.worker.continueRecovery(preview!.token);
      if (!r.ok) throw new Error(r.error);
      setPreview(null);
      onChanged();
    } catch (e) {
      setPreview(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function abort() {
    setBusy(true);
    setError("");
    try {
      const r = await window.worker.stopRun(run.id);
      if (!r.ok) throw new Error(r.error);
      setPreview(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="recovery-actions">
      <button disabled={busy} onClick={() => void inspect()}>
        Kiểm tra để tiếp tục
      </button>
      {run.state === "interrupted" && (
        <button disabled={busy} onClick={() => void abort()}>
          Kết thúc lượt gián đoạn
        </button>
      )}
      {preview && (
        <div className="notice">
          <p>{preview.message}</p>
          <p className="small">
            {preview.changed
              ? "Source/Git đã đổi hoặc chưa có checkpoint cũ."
              : "Source/Git khớp checkpoint đã lưu."}
          </p>
          <button
            disabled={busy || !preview.complete}
            onClick={() => void proceed()}
          >
            Tiếp tục · attempt mới
          </button>
          <button disabled={busy} onClick={() => setPreview(null)}>
            Đóng
          </button>
          {!preview.complete && (
            <p className="warning-text small">
              Snapshot chưa đủ; cần xử lý trước khi tiếp tục.
            </p>
          )}
        </div>
      )}
      {error && <p className="warning-text small">{error}</p>}
    </section>
  );
}
