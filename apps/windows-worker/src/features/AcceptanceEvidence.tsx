import { useState } from "react";
import type { EvidenceRef } from "../../shared/evidence";
export function AcceptanceEvidence({ refs }: { refs: EvidenceRef[] }) {
  const [selected, setSelected] = useState<EvidenceRef | null>(null);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function open(ref: EvidenceRef) {
    setSelected(ref);
    setContent("");
    setError("");
    setLoading(true);
    try {
      const result = await window.worker.acceptanceEvidence(ref);
      if (result.ok) setContent(result.value);
      else setError(result.error);
    } catch {
      setError("Không mở được bằng chứng.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <div className="inline">
        {refs.map((ref, i) => (
          <button key={i} disabled={loading} onClick={() => void open(ref)}>
            {ref.kind === "command" ? `Lệnh · ${ref.attemptId}` : ref.path}
          </button>
        ))}
      </div>
      {selected && (
        <section aria-label="Bằng chứng nghiệm thu">
          <p className="small muted">
            {selected.attemptId} ·{" "}
            {selected.kind === "command" ? selected.callId : selected.path}
          </p>
          {loading ? (
            <p className="small muted">Đang mở…</p>
          ) : error ? (
            <p className="warning-text small">{error}</p>
          ) : (
            <pre>{content || "Output trống."}</pre>
          )}
          {content.length === 256000 && (
            <p className="small muted">Hiển thị tối đa 256.000 ký tự.</p>
          )}
          <button onClick={() => setSelected(null)}>Đóng</button>
        </section>
      )}
    </>
  );
}
