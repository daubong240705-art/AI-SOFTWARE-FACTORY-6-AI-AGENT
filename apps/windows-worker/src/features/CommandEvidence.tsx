import { useState } from "react";
import type { CommandResult } from "../../shared/runs";
import { formatDuration } from "../lib/formatDuration";
export function CommandEvidence({
  runId,
  command,
}: {
  runId: string;
  command: CommandResult;
}) {
  const [output, setOutput] = useState(command.output),
    [error, setError] = useState("");
  return (
    <details
      className="command-result"
      open={command.status === "error"}
      onToggle={(e) => {
        if (e.currentTarget.open)
          void window.worker
            .commandOutput({ runId, callId: command.callId })
            .then((r) => {
              if (r.ok) setOutput(r.value);
            });
      }}
    >
      <summary>
        <code>{command.command}</code>
        {command.taskId && <span className="pill">{command.taskId}</span>}
        <span className="pill">
          {command.exitCode === null
            ? command.status
            : `exit ${command.exitCode}`}
        </span>
      </summary>
      <p className="small muted" style={{ overflowWrap: "anywhere" }}>
        {command.cwd ?? "CWD chưa được lưu ở lượt cũ"} ·{" "}
        {command.startedAt && command.endedAt
          ? formatDuration(command.endedAt - command.startedAt)
          : "Chưa có thời gian kết thúc"}
      </p>
      <pre>{output || "Chưa có output."}</pre>
      {command.outputTruncated && (
        <p className="muted small">
          Output lưu tối đa 256.000 ký tự; phần vượt giới hạn đã bỏ.
        </p>
      )}
      <button
        onClick={() =>
          void navigator.clipboard
            .writeText(output)
            .catch(() => setError("Không sao chép được output."))
        }
      >
        Sao chép output
      </button>
      {error && <p className="warning-text small">{error}</p>}
    </details>
  );
}
