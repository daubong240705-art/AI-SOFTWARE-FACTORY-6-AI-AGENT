"use client";
import { useState } from "react";
import { RunDetail } from "@/lib/api";
import { ErrorBox, useAuth } from "./workspace";

const states: Record<string, string> = {
  pending: "Đang chờ",
  leased: "Đang chạy",
  succeeded: "Đạt",
  failed: "Lỗi",
  waiting_release: "Chờ phát hành",
  cancelled: "Đã hủy",
};

export function Executions({
  data,
  reload,
}: {
  data: RunDetail;
  reload: () => Promise<void>;
}) {
  const auth = useAuth();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function release(
    id: string,
    result: Record<string, unknown>,
    comment: string,
  ) {
    setBusy(true);
    setError("");
    try {
      await auth.write(`/api/executions/${id}/release`, {
        candidate_sha: result.candidate_sha,
        pipeline_id: result.pipeline_id,
        job_id: result.job_id,
        comment,
      });
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Thực thi</h2>
      <ErrorBox message={error} />
      <p className="muted">
        Model:{" "}
        {Object.entries(data.run.config_snapshot.models ?? {})
          .filter(([role]) => ["pm", "ba", "be", "fe"].includes(role))
          .map(([r, m]) => `${r.toUpperCase()}: ${m}`)
          .join(" · ")}
      </p>
      {data.external_links.map((link) => (
        <p key={link.kind + link.external_id}>
          <a href={link.url} target="_blank" rel="noreferrer">
            {link.kind === "merge_request"
              ? "MR"
              : link.kind === "work_package"
                ? "Work package"
                : "Bug"}{" "}
            #{link.external_id} ↗
          </a>
        </p>
      ))}
      {!data.executions.length && (
        <p className="muted">
          Chưa có execution. Cần run thật, kết nối dự án và đặc tả đã được
          duyệt.
        </p>
      )}
      {data.executions.map((item) => (
        <details key={item.id} open={item.state === "waiting_release"}>
          <summary>
            {item.role.toUpperCase()} · lần {item.attempt} ·{" "}
            {states[item.state] ?? item.state}
          </summary>
          <p className="hash">
            Candidate SHA:{" "}
            {String(item.result.candidate_sha ?? item.candidate_sha)}
          </p>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {JSON.stringify(item.result, null, 2)}
          </pre>
          {item.state === "waiting_release" && auth.user?.role !== "viewer" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void release(item.id, item.result, String(form.get("comment")));
              }}
            >
              <label>
                Nhận xét duyệt phát hành
                <textarea required name="comment" maxLength={2000} />
              </label>
              <label className="checkbox">
                <input type="checkbox" required />
                Tôi duyệt đúng candidate SHA, pipeline và job hiển thị ở trên.
              </label>
              <button disabled={busy} className="primary">
                Duyệt triển khai candidate này
              </button>
            </form>
          )}
        </details>
      ))}
    </section>
  );
}
