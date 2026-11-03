"use client";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorBox, Frame, Pager, useAuth } from "./workspace";
import { date, fetchApi, labels, Project, ProjectList, Run } from "@/lib/api";

export function ProjectsPage() {
  const auth = useAuth();
  const [data, setData] = useState<ProjectList | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    if (!auth.user) return;
    try {
      setError("");
      setData(await fetchApi<ProjectList>(`/api/projects?offset=${offset}`));
    } catch (e) {
      setError(String(e));
    }
  }, [auth.user, offset]);
  // Initial authenticated fetch synchronizes the page with the API.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    setBusy(true);
    setError("");
    try {
      await auth.write("/api/projects", {
        ...fields,
        repository_url: fields.repository_url || null,
      });
      form.reset();
      setOpen(false);
      if (offset === 0) await load();
      else setOffset(0);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame
      title="Dự án của bạn"
      subtitle="Từ yêu cầu đầu tiên đến kế hoạch được phê duyệt."
    >
      <div className="section-tools">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h2>{data?.total ?? "—"} dự án</h2>
        </div>
        <div className="actions">
          <button onClick={() => void load()}>Tải lại</button>
          {auth.user?.role !== "viewer" && (
            <button className="primary" onClick={() => setOpen(!open)}>
              {open ? "Đóng" : "+ Tạo dự án"}
            </button>
          )}
        </div>
      </div>
      <ErrorBox message={error} />
      {open && (
        <section className="panel">
          <h2>Khai báo dự án</h2>
          <form onSubmit={create}>
            <div className="form-grid">
              <label>
                Tên dự án
                <input
                  name="name"
                  required
                  maxLength={120}
                  placeholder="Ví dụ: Cổng hỗ trợ nội bộ"
                />
              </label>
              <label>
                Mã dự án
                <input
                  name="slug"
                  required
                  maxLength={80}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  placeholder="cong-ho-tro"
                />
              </label>
            </div>
            <label>
              Mô tả
              <textarea name="description" maxLength={4000} rows={3} />
            </label>
            <label>
              Repository URL (tùy chọn)
              <input
                name="repository_url"
                type="url"
                maxLength={500}
                placeholder="https://gitlab.lazy.local/group/project.git"
              />
            </label>
            <p className="muted">
              Nhập URL không chứa mật khẩu hoặc token. Việc provision repository
              và template thực hiện ở phase sau.
            </p>
            <button className="primary" disabled={busy}>
              {busy ? "Đang lưu…" : "Lưu dự án"}
            </button>
          </form>
        </section>
      )}
      {!data && !error && <p role="status">Đang tải dự án…</p>}
      {data?.total === 0 && (
        <section className="panel empty">
          <h2>Workspace đã sẵn sàng</h2>
          <p>
            {auth.user?.role === "viewer"
              ? "Chưa có dự án. Approver hoặc admin có thể khai báo dự án đầu tiên."
              : "Tạo dự án đầu tiên để nhập yêu cầu và bắt đầu một run."}
          </p>
        </section>
      )}
      <div className="project-grid">
        {data?.items.map((p) => (
          <Link className="project-tile" key={p.id} href={`/projects/${p.id}`}>
            <div className="tile-head">
              <span className="project-symbol">
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              <span>↗</span>
            </div>
            <h2>{p.name}</h2>
            <p>{p.description || "Chưa có mô tả."}</p>
            <footer>
              <code>{p.slug}</code>
              <span>{date(p.created_at)}</span>
            </footer>
          </Link>
        ))}
      </div>
      {data && (
        <Pager offset={offset} total={data.total} onChange={setOffset} />
      )}
      <div className="notice">
        PM và BA có thể tạo plan/spec. BE, FE, TEST và DEVOPS hiện chưa triển
        khai thực thi; dashboard luôn hiển thị trạng thái thực tế.
      </div>
    </Frame>
  );
}

export function ProjectPage({ id }: { id: string }) {
  const auth = useAuth();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<{ items: Run[]; total: number } | null>(
    null,
  );
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!auth.user) return;
    try {
      setError("");
      const [p, r] = await Promise.all([
        fetchApi<Project>(`/api/projects/${id}`),
        fetchApi<{ items: Run[]; total: number }>(
          `/api/projects/${id}/runs?offset=${offset}`,
        ),
      ]);
      setProject(p);
      setRuns(r);
    } catch (e) {
      setError(String(e));
    }
  }, [auth.user, id, offset]);
  // Initial authenticated fetch synchronizes the page with the API.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const run = await auth.write<Run>(
        `/api/projects/${id}/runs`,
        Object.fromEntries(new FormData(e.currentTarget)),
      );
      router.push(`/runs/${run.id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame
      title={project?.name ?? "Dự án"}
      subtitle="Cấu hình và các lần thực thi của dự án."
    >
      <Link className="back-link" href="/">
        ← Tất cả dự án
      </Link>
      <ErrorBox message={error} />
      {!project && !error && <p role="status">Đang tải dự án…</p>}
      {project && (
        <>
          <section className="panel">
            <div className="section-tools">
              <h2>Cấu hình dự án</h2>
              <code>{project.slug}</code>
            </div>
            <p className="preserve">
              {project.description || "Chưa có mô tả."}
            </p>
            <dl className="facts">
              <dt>Repository</dt>
              <dd>
                {project.repository_url ? (
                  <a
                    href={project.repository_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {project.repository_url} ↗
                  </a>
                ) : (
                  "Chưa khai báo"
                )}
              </dd>
              <dt>Ngày tạo</dt>
              <dd>{date(project.created_at)}</dd>
            </dl>
          </section>
          {auth.user?.role !== "viewer" && (
            <section className="panel">
              <h2>Bắt đầu một run</h2>
              <form onSubmit={create}>
                <label>
                  Yêu cầu
                  <textarea
                    name="requirement"
                    required
                    maxLength={12000}
                    rows={5}
                    placeholder="Mô tả mục tiêu, người sử dụng và những điều kiện cần đáp ứng…"
                  />
                </label>
                <label>
                  Chế độ
                  <select name="mode" defaultValue="mock">
                    <option value="mock">Mô phỏng — không gọi model</option>
                    <option value="live">
                      Thật — PM/BA gọi 9Router, cần backend bật live
                    </option>
                  </select>
                </label>
                <p className="muted">
                  Mỗi thời điểm chỉ có một run hoạt động trong hệ thống. Cả hai
                  chế độ đều dừng ở gate phê duyệt, sau đó chờ tích hợp Agent.
                </p>
                <button className="primary" disabled={busy}>
                  {busy ? "Đang tạo…" : "Tạo run →"}
                </button>
              </form>
            </section>
          )}
          <section className="panel">
            <div className="section-tools">
              <h2>
                Lịch sử run <span className="muted">({runs?.total ?? 0})</span>
              </h2>
              <button onClick={() => void load()}>Tải lại</button>
            </div>
            {runs?.items.length === 0 && (
              <p className="muted">Chưa có run nào.</p>
            )}
            <div className="run-list">
              {runs?.items.map((r) => (
                <Link href={`/runs/${r.id}`} key={r.id} className="run-row">
                  <div>
                    <strong>{r.requirement.slice(0, 120)}</strong>
                    <p className="muted">
                      {date(r.created_at)} · v{r.spec_version} ·{" "}
                      {r.mode === "mock" ? "Mô phỏng" : "Thật"}
                    </p>
                  </div>
                  <span className={`status ${r.status}`}>
                    {labels[r.status] ?? r.status} →
                  </span>
                </Link>
              ))}
            </div>
            {runs && (
              <Pager offset={offset} total={runs.total} onChange={setOffset} />
            )}
          </section>
        </>
      )}
    </Frame>
  );
}
