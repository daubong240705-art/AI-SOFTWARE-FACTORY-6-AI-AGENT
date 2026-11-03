"use client";
import { Executions } from "./executions";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { date, fetchApi, labels, RunDetail, TimelineEvent } from "@/lib/api";
import { ErrorBox, Frame, useAuth } from "./workspace";

function Content({ value }: { value: unknown }) {
  if (value === null || value === undefined)
    return <span className="muted">—</span>;
  if (Array.isArray(value))
    return (
      <ul className="artifact-list">
        {value.map((item, i) => (
          <li key={i}>
            <Content value={item} />
          </li>
        ))}
      </ul>
    );
  if (typeof value === "object")
    return (
      <dl className="artifact-fields">
        {Object.entries(value).map(([key, val]) => (
          <div key={key}>
            <dt>{key.replaceAll("_", " ")}</dt>
            <dd>
              <Content value={val} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return <span className="preserve">{String(value)}</span>;
}

export function RunPage({ id }: { id: string }) {
  const auth = useAuth();
  const { reload: reloadAuth } = auth;
  const [data, setData] = useState<RunDetail | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [decision, setDecision] = useState("approve");
  const [reviewing, setReviewing] = useState(false);
  const [notice, setNotice] = useState("");
  const key = useRef<string>("");
  const load = useCallback(async () => {
    if (!auth.user) return;
    try {
      setData(await fetchApi<RunDetail>(`/api/runs/${id}`));
    } catch (e) {
      setError(String(e));
    }
  }, [auth.user, id]);
  useEffect(() => {
    if (!auth.user) return;
    let alive = true;
    let stream: EventSource | null = null;
    let cursor = 0;
    function merge(rows: TimelineEvent[]) {
      if (!alive) return;
      if (rows.length) cursor = Math.max(cursor, ...rows.map((e) => e.id));
      setEvents((prev) =>
        Array.from(
          new Map([...prev, ...rows].map((e) => [e.id, e])).values(),
        ).sort((a, b) => a.id - b.id),
      );
    }
    function connect() {
      if (!alive) return;
      stream?.close();
      stream = new EventSource(`/api/runs/${id}/stream?after=${cursor}`);
      stream.onopen = () => {
        setConnected(true);
        void load();
      };
      stream.onerror = () => {
        setConnected(false);
      };
      stream.addEventListener("timeline", (e) => {
        merge([JSON.parse((e as MessageEvent).data)]);
        void load();
      });
      stream.addEventListener("session-expired", () => {
        stream?.close();
        setConnected(false);
        void reloadAuth();
      });
      stream.addEventListener("unavailable", () => {
        stream?.close();
        setConnected(false);
        void load();
      });
    }
    function offline() {
      stream?.close();
      setConnected(false);
    }
    window.addEventListener("offline", offline);
    window.addEventListener("online", connect);
    async function start() {
      setEvents([]);
      void load();
      try {
        // Complete initial replay before connecting; there is no history/stream race.
        while (alive) {
          const history = await fetchApi<{ items: TimelineEvent[] }>(
            `/api/runs/${id}/events?after=${cursor}&limit=100`,
          );
          merge(history.items);
          if (history.items.length < 100) break;
        }
        if (!alive) return;
        connect();
      } catch (e) {
        if (alive) setError(String(e));
      }
    }
    void start();
    // Fallback refresh also replays missing history when SSE is interrupted.
    const timer = setInterval(() => {
      void load();
      void fetchApi<{ items: TimelineEvent[] }>(
        `/api/runs/${id}/events?after=${cursor}&limit=100`,
      )
        .then((h) => merge(h.items))
        .catch(() => {});
    }, 10000);
    return () => {
      alive = false;
      stream?.close();
      clearInterval(timer);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", connect);
    };
  }, [auth.user, reloadAuth, id, load]);
  const run = data?.run;
  const spec = data?.artifacts.find(
    (a) => a.kind === "spec" && a.spec_version === run?.spec_version,
  );
  // A new artifact invalidates the explicit human confirmation.
  useEffect(() => {
    key.current = "";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfirmed(false);
    setReviewing(false);
  }, [spec?.content_hash, spec?.spec_version]);
  const canWrite =
    auth.user?.role === "admin" || auth.user?.role === "approver";
  async function review(e: FormEvent) {
    e.preventDefault();
    if (!spec || !confirmed) return;
    setBusy(true);
    setError("");
    setNotice("");
    if (!key.current) key.current = crypto.randomUUID();
    try {
      await auth.write(`/api/runs/${id}/approval`, {
        spec_version: spec.spec_version,
        spec_hash: spec.content_hash,
        decision,
        comment,
        idempotency_key: key.current,
      });
      setNotice(
        decision === "approve"
          ? "Đã ghi nhận phê duyệt."
          : "Đã ghi nhận từ chối.",
      );
      setReviewing(false);
      await load();
    } catch (e) {
      setError(String(e));
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function action(name: "retry" | "cancel") {
    if (!comment.trim()) {
      setError("Nhập lý do trước khi tiếp tục.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await auth.write(`/api/runs/${id}/${name}`, { comment });
      setNotice("Đã ghi nhận thao tác.");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const elapsed = run
    ? Math.max(
        0,
        Math.round(
          (new Date(run.updated_at).getTime() -
            new Date(run.created_at).getTime()) /
            1000,
        ),
      )
    : 0;
  return (
    <Frame
      title="Chi tiết run"
      subtitle="Trạng thái, artifact và quyết định phê duyệt được lưu bền."
    >
      {run && (
        <Link className="back-link" href={`/projects/${run.project_id}`}>
          ← Về dự án
        </Link>
      )}
      <div className="section-tools">
        <code className="run-id">{id}</code>
        <div className="actions">
          <span className={`connection ${connected ? "online" : ""}`}>
            {connected ? "● Trực tiếp" : "◌ Đang kết nối lại · dự phòng 10s"}
          </span>
          <button
            onClick={() => {
              setError("");
              void load();
            }}
          >
            Tải lại
          </button>
        </div>
      </div>
      <ErrorBox message={error} />
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {!data && !error && <p role="status">Đang tải run…</p>}
      {data && run && (
        <>
          <section className="panel">
            <div className="section-tools">
              <h2>Yêu cầu · v{run.spec_version}</h2>
              <span className={`status ${run.status}`}>
                {labels[run.status] ?? run.status}
              </span>
            </div>
            <p className="preserve">{run.requirement}</p>
            <p className="muted">
              Tạo {date(run.created_at)} · Cập nhật {date(run.updated_at)}
            </p>
            <div
              className={`notice ${run.mode === "mock" ? "simulation" : ""}`}
            >
              {run.mode === "mock"
                ? "MÔ PHỎNG — plan/spec là dữ liệu mô phỏng, không gọi model."
                : "CHẾ ĐỘ THẬT — PM/BA có thể gọi model qua 9Router."}{" "}
              BE/FE/TEST/DEVOPS thực thi khi run thật có kết nối dự án và worker phù hợp.
            </div>
            {run.error_code && (
              <ErrorBox message={`Workflow: ${run.error_code}`} />
            )}
            {run.status === "waiting_integration" && (
              <div className="notice">
                Đã duyệt đặc tả. Run này chưa có kết nối dự án để thực thi coding/test/deploy.
              </div>
            )}
          </section>
          <Executions data={data} reload={load} />
          <div className="metric-grid">
            <div>
              <span>Khoảng thời gian ghi nhận</span>
              <strong>{elapsed}s</strong>
            </div>
            <div>
              <span>Task phiên bản hiện tại</span>
              <strong>
                {
                  data.tasks.filter(
                    (t) =>
                      t.spec_version === run.spec_version &&
                      t.status === "completed",
                  ).length
                }{" "}
                /{" "}
                {
                  data.tasks.filter((t) => t.spec_version === run.spec_version)
                    .length
                }
              </strong>
            </div>
            <div>
              <span>Lần gọi model</span>
              <strong>
                {data.usage.calls} / {run.call_limit}
              </strong>
            </div>
            <div>
              <span>Token tính budget</span>
              <strong>
                {data.usage.charged_tokens.toLocaleString()} /{" "}
                {run.token_budget.toLocaleString()}
              </strong>
            </div>
          </div>
          <p className="muted">
            Thời gian tính từ lúc tạo đến lần cập nhật gần nhất, gồm cả chờ
            duyệt. Token đầu vào/đầu ra: {data.usage.input_tokens ?? "chưa có"}{" "}
            / {data.usage.output_tokens ?? "chưa có"}. Chi phí tiền tệ chưa được
            tính.
          </p>
          <h2>Sáu Agent</h2>
          <div className="role-grid">
            {["pm", "ba", "be", "fe", "test", "devops"].map((role) => {
              const task = data.tasks.find(
                (t) => t.role === role && t.spec_version === run.spec_version,
              );
              return (
                <section className="role-tile" key={role}>
                  <div className="role-icon">{role.toUpperCase()}</div>
                  <strong>
                    {
                      {
                        pm: "Quản lý dự án",
                        ba: "Phân tích nghiệp vụ",
                        be: "Backend",
                        fe: "Frontend",
                        test: "Kiểm thử",
                        devops: "Triển khai",
                      }[role]
                    }
                  </strong>
                  <span className={`status ${task?.status}`}>
                    {labels[task?.status ?? ""] ??
                      task?.status ??
                      "Chưa có task"}
                  </span>
                  {task?.simulated && <small>Mô phỏng</small>}
                </section>
              );
            })}
          </div>
          <section className="panel">
            <h2>Plan, spec và các phiên bản</h2>
            {data.artifacts.length === 0 && (
              <p className="muted">
                Chưa có artifact. Nội dung sẽ xuất hiện khi PM/BA hoàn thành.
              </p>
            )}
            {data.artifacts.map((a) => (
              <details
                className="artifact"
                key={a.id}
                open={a.spec_version === run.spec_version}
              >
                <summary>
                  {a.kind.toUpperCase()} · v{a.spec_version}{" "}
                  {a.simulated && <span className="status">Mô phỏng</span>}
                </summary>
                <p className="hash">SHA-256: {a.content_hash}</p>
                <Content value={a.content} />
              </details>
            ))}
          </section>
          {canWrite && (
            <section className="panel">
              <h2>Thao tác với run</h2>
              <label>
                Nhận xét / lý do (bắt buộc)
                <textarea
                  value={comment}
                  onChange={(e) => {
                    setComment(e.target.value);
                    key.current = "";
                    setConfirmed(false);
                  }}
                  maxLength={2000}
                  rows={3}
                />
              </label>
              {run.status === "waiting_approval" && spec && (
                <>
                  <div className="actions">
                    <button
                      className="primary"
                      disabled={busy || !comment.trim()}
                      onClick={() => {
                        setDecision("approve");
                        key.current = "";
                        setConfirmed(false);
                        setReviewing(true);
                      }}
                    >
                      Duyệt spec
                    </button>
                    <button
                      disabled={busy || !comment.trim()}
                      onClick={() => {
                        setDecision("reject");
                        key.current = "";
                        setConfirmed(false);
                        setReviewing(true);
                      }}
                    >
                      Từ chối spec
                    </button>
                  </div>
                  {reviewing && (
                    <form className="review-confirm" onSubmit={review}>
                      <h3>
                        Xác nhận{" "}
                        {decision === "approve" ? "phê duyệt" : "từ chối"} ·
                        spec v{spec.spec_version}
                      </h3>
                      <p className="hash">SHA-256: {spec.content_hash}</p>
                      <p>
                        Người thực hiện: <strong>{auth.user?.username}</strong>
                      </p>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={confirmed}
                          onChange={(e) => setConfirmed(e.target.checked)}
                          required
                        />
                        Tôi đã đọc đúng spec phiên bản {spec.spec_version} và
                        xác nhận quyết định này.
                      </label>
                      <div className="actions">
                        <button
                          className="primary"
                          disabled={busy || !confirmed || !comment.trim()}
                        >
                          {busy ? "Đang ghi nhận…" : "Xác nhận quyết định"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setReviewing(false)}
                        >
                          Quay lại
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}
              <div className="actions action-secondary">
                {["failed", "rejected"].includes(run.status) && (
                  <button
                    disabled={busy || !comment.trim()}
                    onClick={() => void action("retry")}
                  >
                    Thử lại
                    {run.status === "rejected" ? " với phiên bản mới" : ""}
                  </button>
                )}
                {[
                  "created",
                  "planning",
                  "waiting_approval",
                  "running",
                  "failed",
                  "rejected",
                  "waiting_integration",
                  "blocked",
                ].includes(run.status) && (
                  <button
                    className="danger"
                    disabled={busy || !comment.trim()}
                    onClick={() => void action("cancel")}
                  >
                    Hủy run
                  </button>
                )}
              </div>
            </section>
          )}
          {!canWrite && (
            <div className="notice">
              Bạn có quyền viewer: xem dữ liệu và lịch sử. Quyền phê duyệt thuộc
              approver/admin.
            </div>
          )}
          <section className="panel">
            <h2>Lịch sử phê duyệt</h2>
            {data.approvals.length === 0 && (
              <p className="muted">Chưa có quyết định.</p>
            )}
            {data.approvals.map((a) => (
              <div className="approval-row" key={a.id}>
                <strong>
                  v{a.spec_version} ·{" "}
                  {a.decision === "approve" ? "Đã duyệt" : "Từ chối"} ·{" "}
                  {a.actor}
                </strong>
                <p className="preserve">{a.comment}</p>
                <small>
                  {date(a.created_at)} ·{" "}
                  {a.identity_source === "authenticated_session"
                    ? "Danh tính đã xác thực"
                    : "Dữ liệu dev cũ — danh tính chưa xác thực"}
                </small>
              </div>
            ))}
          </section>
          {data.model_calls.length > 0 && (
            <section className="panel">
              <h2>Lần gọi model</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th>Model</th>
                      <th>Trạng thái</th>
                      <th>Thời gian</th>
                      <th>Token budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.model_calls.map((c) => (
                      <tr key={c.id}>
                        <td>{c.role.toUpperCase()}</td>
                        <td>{c.model}</td>
                        <td>{c.error_code || c.status}</td>
                        <td>
                          {c.latency_ms === null ? "—" : `${c.latency_ms}ms`}
                        </td>
                        <td>{c.charged_tokens}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <section className="panel">
            <h2>
              Timeline <span className="muted">· {events.length} sự kiện</span>
            </h2>
            <ol className="timeline">
              {events.map((e) => (
                <li key={e.id}>
                  <div className="timeline-dot" />
                  <div>
                    <strong>{e.kind}</strong>
                    {e.simulated && <span className="status">Mô phỏng</span>}
                    <small>
                      #{e.id} · {date(e.created_at)}
                    </small>
                    <details>
                      <summary>Chi tiết sự kiện</summary>
                      <Content value={e.payload} />
                    </details>
                  </div>
                </li>
              ))}
            </ol>
            {events.length === 0 && <p className="muted">Chưa có sự kiện.</p>}
          </section>
        </>
      )}
    </Frame>
  );
}
