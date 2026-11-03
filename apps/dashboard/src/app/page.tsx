"use client";

import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ApiError, fetchApi, Project, ProjectList, Readiness } from "@/lib/api";

const roles = [
  ["PM", "Project Manager"],
  ["BA", "Business Analyst"],
  ["BE", "Backend Developer"],
  ["FE", "Frontend Developer"],
  ["TEST", "Quality Engineer"],
  ["OPS", "DevOps Engineer"],
];

function Icon({
  type,
  size = 20,
}: {
  type: "grid" | "box" | "arrow" | "plus" | "pulse" | "close";
  size?: number;
}) {
  const paths = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    box: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5Z" />
        <path d="M3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    pulse: <path d="M2 12h5l3-8 4 16 3-8h5" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[type]}
    </svg>
  );
}

export default function Workspace() {
  const [projects, setProjects] = useState<ProjectList | null>(null);
  const [status, setStatus] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [offset, setOffset] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogTitle = useId();
  const requestSequence = useRef(0);

  const refresh = useCallback(async (pageOffset: number) => {
    const sequence = ++requestSequence.current;
    const [list, health] = await Promise.allSettled([
      fetchApi<ProjectList>(`/api/projects?limit=6&offset=${pageOffset}`),
      fetchApi<Readiness>("/api/status"),
    ]);
    if (sequence !== requestSequence.current) return;
    setError("");
    if (list.status === "fulfilled") setProjects(list.value);
    else
      setError(
        list.reason instanceof Error
          ? list.reason.message
          : "Không tải được dự án.",
      );
    setStatus(health.status === "fulfilled" ? health.value : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Schedule the initial/page fetch; cleanup cancels Strict Mode's first pass.
    const timer = setTimeout(() => void refresh(offset), 0);
    return () => clearTimeout(timer);
  }, [offset, refresh]);
  useEffect(() => {
    if (modal) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [modal]);

  function loadPage(pageOffset: number) {
    setLoading(true);
    setError("");
    if (pageOffset === offset) void refresh(pageOffset);
    else setOffset(pageOffset);
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    const values = new FormData(event.currentTarget);
    try {
      const project = await fetchApi<Project>("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.get("name"),
          slug: values.get("slug"),
          description: values.get("description"),
          repository_url: values.get("repository_url") || null,
        }),
      });
      setModal(false);
      setNotice(`Đã tạo dự án “${project.name}”.`);
      loadPage(0);
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : "Không thể lưu dự án. Thử lại sau.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="AI Software Factory">
          <span className="brand-mark">
            f<span>·</span>
          </span>
          <span>
            software
            <br />
            <strong>factory</strong>
          </span>
        </Link>
        <div className="workspace-label">
          WORKSPACE <span>01</span>
        </div>
        <nav aria-label="Điều hướng">
          <a className="nav-active" href="#projects">
            <Icon type="grid" /> Tổng quan <span className="nav-dot" />
          </a>
          <span className="nav-unavailable">
            <Icon type="pulse" /> Workflow <small>Sắp có</small>
          </span>
        </nav>
        <div className="sidebar-note">
          <span className="tiny-dot" /> KHÔNG GIAN PHÁT TRIỂN
          <p>
            Nền tảng điều phối
            <br />6 AI Agent.
          </p>
          <span className="version">v0.1 / Phase 1</span>
        </div>
        <div className="sidebar-footer">
          <span className="avatar">L</span>
          <div>
            Local workspace<small>Môi trường phát triển</small>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace <span>/</span> <strong>Tổng quan</strong>
          </div>
          <span className="environment">
            <span className="tiny-dot" /> DEVELOPMENT
          </span>
        </header>
        <main>
          <section className="intro">
            <div>
              <p className="eyebrow">YOUR DEVELOPMENT CONTROL ROOM</p>
              <h1>
                Từ ý tưởng,
                <br className="mobile-break" /> đến phần mềm.
              </h1>
              <p className="intro-copy">
                Một không gian cho dự án, tác vụ và đội ngũ AI của bạn.
              </p>
            </div>
            <button
              className="button primary"
              onClick={() => {
                setFormError("");
                setModal(true);
              }}
            >
              <Icon type="plus" size={18} /> Tạo dự án
            </button>
          </section>

          <div className="phase-banner">
            <span className="phase-chip">PHASE 01</span>
            <span>
              Đang xây dựng nền tảng. Quản lý dự án đã sẵn sàng; workflow Agent
              sẽ được bổ sung tiếp theo.
            </span>
            <span className="banner-number">01 / 06</span>
          </div>

          <section className="metrics" aria-label="Tổng quan hệ thống">
            <article className="metric">
              <div>
                <span>Dự án trong workspace</span>
                <Icon type="box" />
              </div>
              <strong>
                {projects ? String(projects.total).padStart(2, "0") : "—"}
              </strong>
              <p>Dữ liệu từ workspace của bạn</p>
            </article>
            <article className="metric">
              <div>
                <span>Dịch vụ nền tảng</span>
                <Icon type="pulse" />
              </div>
              <strong className="service-value">
                {loading
                  ? "Đang kiểm tra"
                  : status?.status === "ready"
                    ? "Sẵn sàng"
                    : "Chưa sẵn sàng"}
              </strong>
              <p>
                <span
                  className={`tiny-dot ${status?.status === "ready" ? "green" : "muted-dot"}`}
                />{" "}
                API · PostgreSQL · Redis
              </p>
            </article>
            <article className="metric">
              <div>
                <span>Vai trò AI Agent</span>
                <Icon type="grid" />
              </div>
              <strong>
                06 <small>vai trò</small>
              </strong>
              <p>Chưa kích hoạt thực thi</p>
            </article>
          </section>

          <section className="projects-section" id="projects">
            <div className="section-heading">
              <div>
                <span className="eyebrow">BUILD SOMETHING NEW</span>
                <h2>
                  Dự án của bạn <span>{projects?.total ?? "—"}</span>
                </h2>
              </div>
              <button
                className="text-button"
                disabled={loading}
                onClick={() => loadPage(offset)}
              >
                Làm mới <span aria-hidden="true">↻</span>
              </button>
            </div>
            {notice && (
              <div className="notice" role="status">
                {notice}
                <button aria-label="Ẩn thông báo" onClick={() => setNotice("")}>
                  <Icon type="close" size={16} />
                </button>
              </div>
            )}
            {error ? (
              <div className="error-box" role="alert">
                <strong>Chưa tải được workspace</strong>
                <p>{error}</p>
                <button
                  className="button secondary"
                  onClick={() => loadPage(offset)}
                >
                  Thử lại
                </button>
              </div>
            ) : loading ? (
              <div
                className="project-grid"
                aria-label="Đang tải dự án"
                aria-busy="true"
              >
                {[1, 2, 3].map((i) => (
                  <div className="skeleton" key={i} />
                ))}
              </div>
            ) : projects?.items.length ? (
              <>
                <div className="project-grid">
                  {projects.items.map((project) => (
                    <article className="project-card" key={project.id}>
                      <div className="project-card-top">
                        <span className="project-icon">
                          <Icon type="box" size={23} />
                        </span>
                        <span className="project-state">Đã khởi tạo</span>
                      </div>
                      <h3>{project.name}</h3>
                      <p>
                        {project.description || "Chưa có mô tả cho dự án này."}
                      </p>
                      <div className="project-meta">
                        <code>{project.slug}</code>
                        <time dateTime={project.created_at}>
                          {new Date(project.created_at).toLocaleDateString(
                            "vi-VN",
                          )}
                        </time>
                      </div>
                      {project.repository_url ? (
                        <a
                          className="repo-link"
                          href={project.repository_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Mở repository <Icon type="arrow" size={16} />
                        </a>
                      ) : (
                        <span className="no-repo">
                          Chưa liên kết repository
                        </span>
                      )}
                    </article>
                  ))}
                </div>
                <div className="pagination">
                  <span>
                    {offset + 1}–{offset + projects.items.length} /{" "}
                    {projects.total} dự án
                  </span>
                  <div>
                    <button
                      className="text-button"
                      disabled={loading || offset === 0}
                      onClick={() => loadPage(Math.max(0, offset - 6))}
                    >
                      ← Trước
                    </button>
                    <button
                      className="text-button"
                      disabled={loading || offset + 6 >= projects.total}
                      onClick={() => loadPage(offset + 6)}
                    >
                      Tiếp →
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-art">
                  <Icon type="box" size={32} />
                  <span className="orbit one" />
                  <span className="orbit two" />
                </div>
                <p className="eyebrow">A CLEAN SLATE</p>
                <h3>Dự án tiếp theo bắt đầu ở đây.</h3>
                <p>
                  Tạo workspace cho ý tưởng đầu tiên.
                  <br />
                  Mọi dự án và tiến trình sẽ được tập hợp tại đây.
                </p>
                <button
                  className="button secondary"
                  onClick={() => {
                    setFormError("");
                    setModal(true);
                  }}
                >
                  Tạo dự án đầu tiên <Icon type="arrow" size={16} />
                </button>
              </div>
            )}
          </section>

          <section className="team-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">THE TEAM, COMING TOGETHER</span>
                <h2>Sáu vai trò. Một quy trình.</h2>
              </div>
              <span className="muted-label">Thực thi từ giai đoạn sau</span>
            </div>
            <div className="role-grid">
              {roles.map(([role, name]) => (
                <article className="role" key={role}>
                  <span className="role-code">{role}</span>
                  <h3>{name}</h3>
                  <p>
                    <span className="tiny-dot muted-dot" /> Chưa triển khai
                  </p>
                </article>
              ))}
            </div>
          </section>
          <footer className="main-footer">
            <span>AI SOFTWARE FACTORY</span>
            <span>Foundation first. Progress you can trace.</span>
          </footer>
        </main>
      </div>

      <dialog
        ref={dialogRef}
        className="project-dialog"
        aria-labelledby={dialogTitle}
        onCancel={(event) => {
          if (saving) event.preventDefault();
          else setModal(false);
        }}
        onClose={() => setModal(false)}
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">A NEW BEGINNING</p>
            <h2 id={dialogTitle}>Tạo dự án</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Đóng"
            disabled={saving}
            onClick={() => setModal(false)}
          >
            <Icon type="close" />
          </button>
        </div>
        <p className="dialog-copy">
          Khai báo dự án trong workspace. Repository và công việc Agent được kết
          nối ở các phase tiếp theo.
        </p>
        <form onSubmit={createProject}>
          <label>
            Tên dự án{" "}
            <input
              name="name"
              required
              maxLength={120}
              placeholder="Ví dụ: Cổng hỗ trợ nội bộ"
              autoFocus
            />
          </label>
          <label>
            Mã dự án{" "}
            <input
              name="slug"
              required
              maxLength={80}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="cong-ho-tro"
            />
            <small>
              Chữ thường, số và dấu gạch ngang. Không trùng trong workspace.
            </small>
          </label>
          <label>
            Mô tả{" "}
            <textarea
              name="description"
              maxLength={4000}
              rows={3}
              placeholder="Mục tiêu hoặc phạm vi ban đầu của dự án…"
            />
          </label>
          <label>
            Repository <span className="optional">không bắt buộc</span>
            <input
              name="repository_url"
              type="url"
              maxLength={500}
              placeholder="https://gitlab.example.com/group/project"
            />
            <small>Dùng URL HTTPS/HTTP không chứa token hoặc mật khẩu.</small>
          </label>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              disabled={saving}
              onClick={() => setModal(false)}
            >
              Hủy
            </button>
            <button className="button primary" disabled={saving} type="submit">
              {saving ? "Đang lưu…" : "Tạo dự án"}
              <Icon type="arrow" size={16} />
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
