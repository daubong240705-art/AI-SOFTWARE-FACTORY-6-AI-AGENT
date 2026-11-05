import { useEffect, useRef, useState } from "react";
import type { Run } from "../../shared/runs";
import { reportStatusLabels, type ReportView } from "../../shared/reports";
import { ChatMarkdown } from "./ChatMarkdown";
import { AcceptanceEvidence } from "./AcceptanceEvidence";
import { CommandEvidence } from "./CommandEvidence";

export function WorkReport({
  run,
  onInspect,
  onChanged,
}: {
  run: Pick<Run, "id" | "projectId">;
  onInspect?: (id: string) => void;
  onChanged?: () => void;
}) {
  const [view, setView] = useState<ReportView | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [comment, setComment] = useState("");
  const [diff, setDiff] = useState<{ path: string; text: string } | null>(null);
  const lock = useRef(false);
  const request = useRef<{
    action: string;
    comment: string;
    id: string;
  } | null>(null);
  async function load() {
    const reply = await window.worker.workReport({
      projectId: run.projectId,
      runId: run.id,
    });
    if (!reply.ok) throw new Error(reply.error);
    setView(reply.value);
  }
  useEffect(() => {
    let live = true;
    void window.worker
      .workReport({ projectId: run.projectId, runId: run.id })
      .then((reply) => {
        if (!live) return;
        if (reply.ok) setView(reply.value);
        else setError(reply.error);
      })
      .catch(() => {
        if (live) setError("Không tải được báo cáo.");
      });
    return () => {
      live = false;
    };
  }, [run.id, run.projectId]);
  async function act(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Không thực hiện được thao tác.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function decide(action: "accept" | "request-fix") {
    const body = action === "accept" ? "" : comment.trim();
    if (request.current?.action !== action || request.current.comment !== body)
      request.current = { action, comment: body, id: crypto.randomUUID() };
    const reply = await window.worker.reportDecision({
      projectId: run.projectId,
      runId: run.id,
      requestId: request.current.id,
      action,
      comment: body,
    });
    if (!reply.ok) throw new Error(reply.error);
    setView(reply.value);
    setFixing(false);
    onChanged?.();
  }
  if (!view)
    return (
      <section className="work-report" aria-label="Báo cáo kết quả">
        <p role={error ? "alert" : "status"}>{error || "Đang tải báo cáo…"}</p>
      </section>
    );
  const { report, decision } = view;
  return (
    <section className="work-report" aria-label="Báo cáo kết quả">
      <div className="report-heading">
        <strong>
          {report.work
            ? `${report.work.title} · v${report.work.revision}`
            : "Kết quả lượt chạy"}
        </strong>
        <span className="pill">
          Kiểm chứng: {reportStatusLabels[report.verification]}
        </span>
      </div>
      <p className="small muted">
        {new Date(report.endedAt).toLocaleString("vi-VN")} ·{" "}
        {report.provenance.model}
      </p>
      {report.error && <p className="notice error">{report.error}</p>}
      {view.artifactIssues.length > 0 && (
        <div className="notice error">
          <strong>Bằng chứng lưu trữ bị thiếu</strong>
          {view.artifactIssues.map((issue, i) => (
            <p key={i}>{issue}</p>
          ))}
        </div>
      )}
      {report.summary ? (
        <ChatMarkdown text={report.summary} />
      ) : (
        <p className="muted">Không có tóm tắt cuối.</p>
      )}
      {report.review && !("version" in report.review) && (
        <p className="small muted">
          Kết quả cũ · bằng chứng chưa được xác minh.
        </p>
      )}
      {report.review?.limitations.map((text, i) => (
        <p className="small muted" key={`limit-${i}`}>
          {text}
        </p>
      ))}
      {report.criteria.length > 0 && (
        <details open className="report-section">
          <summary>Tiêu chí · {report.criteria.length}</summary>
          {report.criteria.map((criterion, i) => (
            <article className="command-result" key={i}>
              <div className="report-heading">
                <strong>{criterion.criterion}</strong>
                <span className="pill">
                  {reportStatusLabels[criterion.result]}
                </span>
              </div>
              <p className="small muted">{criterion.evidence}</p>
              <AcceptanceEvidence refs={criterion.refs} />
            </article>
          ))}
        </details>
      )}
      {report.commands.length ? (
        <details className="report-section">
          <summary>Lệnh đã chạy · {report.commands.length}</summary>
          {report.commands.map((command, i) => (
            <div key={i}>
              <p className="small">
                {reportStatusLabels[command.result]}
                {command.artifactIssue ? ` · ${command.artifactIssue}` : ""}
              </p>
              <CommandEvidence runId={report.runId} command={command} />
            </div>
          ))}
        </details>
      ) : (
        <p className="small muted">Lệnh kiểm thử: chưa chạy.</p>
      )}
      {report.changes.length > 0 && (
        <details className="report-section">
          <summary>File thay đổi · {report.changes.length}</summary>
          <ul className="report-files">
            {report.changes.map((file, i) => (
              <li key={i}>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const reply = await window.worker.reportFile({
                        projectId: run.projectId,
                        runId: run.id,
                        path: file.path,
                      });
                      if (!reply.ok) throw new Error(reply.error);
                      setDiff({
                        path: file.path,
                        text:
                          reply.value.reason ||
                          reply.value.patch ||
                          "Không có thay đổi nội dung.",
                      });
                    })
                  }
                >
                  <code>{file.path}</code>
                </button>
                <span className="muted small">{file.kind}</span>
              </li>
            ))}
          </ul>
          {diff && (
            <div className="report-diff">
              <strong>{diff.path}</strong>
              <pre>{diff.text}</pre>
            </div>
          )}
        </details>
      )}
      {report.work && (
        <section className="report-acceptance" aria-label="Nghiệm thu kết quả">
          <label className="report-policy">
            <input
              type="checkbox"
              checked={view.policy.required}
              disabled={busy}
              onChange={(e) => {
                const required = e.target.checked;
                void act(async () => {
                  const reply = await window.worker.reportPolicy({
                    projectId: report.projectId,
                    itemId: report.work!.itemId,
                    version: view.policy.version,
                    required,
                  });
                  if (!reply.ok) throw new Error(reply.error);
                  setView({ ...view, policy: reply.value });
                });
              }}
            />
            Yêu cầu người dùng nghiệm thu
          </label>
          <p className="small muted">
            {view.freshness === "stale"
              ? "Báo cáo cũ"
              : view.freshness === "unknown"
                ? "Chưa đối chiếu source"
                : decision?.action === "accept"
                  ? "Đã nghiệm thu phiên bản này"
                  : decision?.action === "request-fix"
                    ? "Đã gửi yêu cầu sửa"
                    : view.policy.required
                      ? "Chờ nghiệm thu"
                      : "Nghiệm thu tùy chọn"}
          </p>
          {view.reasons.map((reason) => (
            <p className="small muted" key={reason}>
              {reason}
            </p>
          ))}
          {decision ? (
            <div>
              <p>{decision.comment}</p>
              {decision.receipt && (
                <p className="small muted">
                  {decision.receipt.state === "removed"
                    ? "Yêu cầu tiếp tục đã bị bỏ."
                    : decision.receipt.followUpId
                      ? "Đã đưa vào hàng chờ."
                      : "Đã tạo lượt tiếp tục."}
                </p>
              )}
              {decision.receipt?.runId && onInspect && (
                <button onClick={() => onInspect(decision.receipt!.runId!)}>
                  Xem lượt sửa
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="inline">
                <button
                  disabled={
                    busy || !view.canDecide || view.freshness !== "current"
                  }
                  onClick={() => void act(() => decide("accept"))}
                >
                  Nghiệm thu
                </button>
                <button
                  disabled={busy || !view.canDecide}
                  onClick={() => setFixing(!fixing)}
                >
                  Yêu cầu sửa
                </button>
              </div>
              {fixing && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(() => decide("request-fix"));
                  }}
                >
                  <label>
                    Nội dung cần sửa
                    <textarea
                      autoFocus
                      value={comment}
                      maxLength={6000}
                      disabled={busy}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={busy || !comment.trim()}
                  >
                    Gửi yêu cầu sửa
                  </button>
                </form>
              )}
            </>
          )}
          <div className="inline">
            <button disabled={busy} onClick={() => void act(load)}>
              Đối chiếu lại
            </button>
            <span className="small muted">
              {new Date(view.checkedAt).toLocaleTimeString("vi-VN")}
            </span>
          </div>
        </section>
      )}
      <button
        disabled={busy}
        onClick={() =>
          void act(async () => {
            const reply = await window.worker.exportRun(report.runId);
            if (!reply.ok) throw new Error(reply.error);
            setStatus(reply.value ? "Đã xuất báo cáo." : "");
          })
        }
      >
        Xuất báo cáo
      </button>
      {status && (
        <p role="status" className="small muted">
          {status}
        </p>
      )}
      <details className="report-section">
        <summary>Nguồn báo cáo</summary>
        <dl className="report-provenance">
          <dt>Báo cáo</dt>
          <dd>{report.id}</dd>
          <dt>Lượt chạy</dt>
          <dd>{report.runId}</dd>
          <dt>Source</dt>
          <dd>{report.sourceVersion ?? "Chưa xác định"}</dd>
          <dt>Chi phí</dt>
          <dd>Chưa xác định</dd>
          <dt>Token</dt>
          <dd>
            {report.metrics.inputTokens ?? "Chưa rõ"} vào ·{" "}
            {report.metrics.outputTokens ?? "Chưa rõ"} ra
          </dd>
        </dl>
        <p className="small muted">
          Nghiệm thu là quyết định của người dùng; không thay đổi kết quả kiểm
          chứng kỹ thuật.
        </p>
      </details>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </section>
  );
}
