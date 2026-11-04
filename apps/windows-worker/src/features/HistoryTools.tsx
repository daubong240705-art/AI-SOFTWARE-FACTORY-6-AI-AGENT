import { useState } from "react";
import type { RetentionPreview } from "../../shared/lifecycle";
export function HistoryTools({
  active,
  onChanged,
}: {
  active: boolean;
  onChanged: () => void;
}) {
  const [preview, setPreview] = useState<RetentionPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function inspect() {
    setBusy(true);
    setError("");
    try {
      const r = await window.worker.retention({ days: 30, keep: 20 });
      if (!r.ok) throw new Error(r.error);
      setPreview(r.value);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function prune() {
    setBusy(true);
    setError("");
    try {
      const r = await window.worker.prune(preview!.token);
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
  return (
    <details className="history-tools">
      <summary>Dọn lịch sử cũ</summary>
      <p className="small muted">
        Lượt hơn 30 ngày; giữ ít nhất 20 lượt gần nhất, lượt gián đoạn và dữ
        liệu còn được tham chiếu. Không xóa source.
      </p>
      <button disabled={busy || active} onClick={() => void inspect()}>
        Xem trước
      </button>
      {preview && (
        <p>
          {preview.count} lượt có thể xóa · {preview.protected} lượt giữ lại.{" "}
          <button
            disabled={busy || active || !preview.count}
            onClick={() => void prune()}
          >
            Xóa {preview.count} lượt
          </button>
        </p>
      )}
      {error && <p className="warning-text small">{error}</p>}
    </details>
  );
}
