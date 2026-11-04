import { useState } from "react";
import type { Run } from "../../shared/runs";
import { isActive } from "../../shared/runs";
import type { Project } from "../../shared/contracts";

export function IntegrationResult({
  run,
  busy,
  onOpen,
}: {
  run: Run;
  busy: boolean;
  onOpen?: (project: Project) => Promise<void>;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  if (!run.integration) return null;
  const value = run.integration;
  async function openResult() {
    setOpening(true);
    setError("");
    try {
      const reply = await window.worker.openWorkspace(value.origin.id);
      if (!reply.ok) throw new Error(reply.error);
      await onOpen?.(reply.value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không mở được bản tích hợp.");
    } finally {
      setOpening(false);
    }
  }
  return (
    <section className="notice integration-result" aria-label="Bản tích hợp">
      <strong>
        {value.state === "verified"
          ? "Bản tích hợp đã xác minh"
          : value.state === "conflict"
            ? "Xung đột tích hợp"
            : value.state === "ready"
              ? "Bản tích hợp chờ xác minh"
              : "Tích hợp chưa hoàn tất"}
      </strong>
      <code className="small command-script">{value.workspace}</code>
      <p className="small muted">
        {value.taskIds.length} task · Source{" "}
        {value.sourceVersion.slice(0, 12) || "chưa chụp"}
      </p>
      {!!value.conflicts.length && (
        <p className="warning-text small">{value.conflicts.join(", ")}</p>
      )}
      {onOpen && (
        <button
          disabled={busy || opening || isActive(run.state)}
          onClick={() => void openResult()}
        >
          Mở bản tích hợp
        </button>
      )}
      <p className="small muted">
        Source gốc được giữ nguyên. Tiếp tục trên bản này bằng chế độ tuần tự
        hoặc một agent.
      </p>
      {error && (
        <p role="alert" className="warning-text small">
          {error}
        </p>
      )}
    </section>
  );
}
