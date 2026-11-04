import { useEffect, useRef, useState } from "react";
import type { EvidenceRef } from "../../shared/evidence";
export function AcceptanceEvidence({ refs }: { refs: EvidenceRef[] }) {
  const [selected, setSelected] = useState<EvidenceRef | null>(null);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const identity = JSON.stringify(refs);
  useEffect(() => {
    generation.current++;
    setSelected(null);
    setContent("");
    setError("");
    setLoading(false);
    return () => {
      generation.current++;
    };
  }, [identity]);
  async function open(ref: EvidenceRef) {
    const request = ++generation.current;
    setSelected(ref);
    setContent("");
    setError("");
    setLoading(true);
    try {
      const result = await window.worker.acceptanceEvidence(ref);
      if (request !== generation.current) return;
      if (result.ok) setContent(result.value);
      else setError(result.error);
    } catch {
      if (request === generation.current) setError("Không mở được bằng chứng.");
    } finally {
      if (request === generation.current) setLoading(false);
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
