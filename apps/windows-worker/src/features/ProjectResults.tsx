import { useEffect, useRef, useState } from "react";
import {
  reportStateLabel,
  reportStatusLabels,
  type ReportStatus,
} from "../../shared/reports";
import type { ResultEntry, ResultPage } from "../../shared/workspace";
import { Select } from "../ui/Select";

export function ProjectResults({
  projectId,
  onOpen,
  refreshVersion = 0,
}: {
  projectId: string;
  onOpen: (entry: ResultEntry) => void;
  refreshVersion?: number;
}) {
  const [page, setPage] = useState<ResultPage | null>(null);
  const [search, setSearch] = useState("");
  const [verification, setVerification] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  async function load(more = false) {
    const token = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const reply = await window.worker.resultIndex({
        projectId,
        search,
        ...(verification ? { verification: verification as ReportStatus } : {}),
        ...(more && page?.next ? { before: page.next } : {}),
      });
      if (token !== generation.current) return;
      if (!reply.ok) throw Error(reply.error);
      if (reply.value.items.some((item) => item.projectId !== projectId))
        throw Error("Kết quả không thuộc dự án.");
      setPage((previous) =>
        more && previous
          ? {
              ...reply.value,
              items: [
                ...previous.items,
                ...reply.value.items.filter(
                  (item) => !previous.items.some((p) => p.id === item.id),
                ),
              ],
            }
          : reply.value,
      );
    } catch (e) {
      if (token === generation.current)
        setError(e instanceof Error ? e.message : "Không tải được kết quả.");
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    setPage(null);
    const timer = setTimeout(() => void load(), 180);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [projectId, search, verification, refreshVersion]);
  return (
    <section className="project-results" aria-label="Kết quả dự án">
      <div className="page-heading">
        <h1>Kết quả</h1>
        <button disabled={busy} onClick={() => void load()}>
          Cập nhật
        </button>
      </div>
      <div className="result-filters">
        <input
          aria-label="Tìm kết quả"
          placeholder="Tìm công việc hoặc kết quả…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={200}
        />
        <Select
          aria-label="Lọc kiểm chứng"
          value={verification}
          onValueChange={setVerification}
        >
          <option value="">Mọi kết quả</option>
          {Object.entries(reportStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="small muted" role="status">
          Đang tải kết quả…
        </p>
      )}
      {!busy && !error && !page?.items.length && (
        <p className="overview-empty">
          {search || verification
            ? "Không có kết quả phù hợp."
            : "Chưa có kết quả công việc."}
        </p>
      )}
      <ul className="result-list">
        {page?.items.map((item) => (
          <li key={item.id}>
            <button disabled={busy || !!error} onClick={() => onOpen(item)}>
              <span className="result-body">
                <strong>
                  {item.code ? `${item.code} · ` : ""}
                  {item.title}
                </strong>
                <span className="small muted">
                  {reportStateLabel(item.state)}
                </span>
                {item.summary && (
                  <span className="result-summary">{item.summary}</span>
                )}
              </span>
              <span className="result-meta">
                <span className="pill">
                  {reportStatusLabels[item.verification]}
                </span>
                <time>{new Date(item.at).toLocaleString("vi-VN")}</time>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {page?.hasMore && (
        <button disabled={busy || !!error} onClick={() => void load(true)}>
          Xem thêm kết quả
        </button>
      )}
    </section>
  );
}
