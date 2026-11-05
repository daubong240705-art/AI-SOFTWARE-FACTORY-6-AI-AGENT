import { ArrowRight, Folder, Plus, Workflow } from "lucide-react";
import type { Project } from "../../shared/contracts";
import type { WorkspaceState } from "../lib/workspace-store";
import type { ResultEntry } from "../../shared/workspace";
import type { InboxItem } from "../../shared/inbox";
import { reportStateLabel } from "../../shared/reports";
import { Select } from "../ui/Select";
import { useState } from "react";

export function WorkspaceHome({
  projects,
  busy,
  onProject,
  onAddProject,
  onActive,
  onInbox,
  summary,
  onAttention,
  onResult,
  onLead,
  chatOpen,
}: {
  projects: Project[];
  busy: boolean;
  onProject: (project: Project) => void;
  onAddProject: () => void;
  onActive: () => void;
  onInbox: () => void;
  summary: WorkspaceState;
  onAttention: (item: InboxItem) => void;
  onResult: (item: ResultEntry) => void;
  onLead: (projectId: string) => void;
  chatOpen: boolean;
}) {
  const [target, setTarget] = useState("");
  const unavailable = summary.stale || !!summary.error;
  const active = summary.data?.active;
  return (
    <section className="workspace-home" aria-label="Trang chính">
      <div className="page-heading">
        <h1>Trang chính</h1>
        <button onClick={onInbox}>
          Cần xử lý
          <ArrowRight size={15} />
        </button>
      </div>
      <section
        className="home-section home-lead"
        aria-label="Trao đổi với Lead"
      >
        <h2>Trao đổi công việc</h2>
        <div className="home-lead-controls">
          <Select
            aria-label="Dự án trao đổi với Lead"
            value={target}
            onValueChange={setTarget}
            disabled={busy}
          >
            <option value="">Chọn dự án</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <button
            className="primary"
            disabled={busy || !target || !projects.some((p) => p.id === target)}
            onClick={() => onLead(target)}
          >
            {chatOpen ? "Mở trao đổi" : "Nhắn Lead"}
          </button>
        </div>
      </section>
      {summary.error && (
        <p className="notice" role="status">
          {summary.error}
        </p>
      )}
      {summary.stale && (
        <p className="small muted">Chưa đồng bộ · Dữ liệu lần cuối</p>
      )}
      {!summary.data && !summary.error ? (
        <p className="small muted" role="status">
          Đang tải tổng quan…
        </p>
      ) : unavailable ? (
        <p className="notice" role="status">
          Chưa đồng bộ trạng thái thực hiện.
        </p>
      ) : active ? (
        <section className="home-section">
          <h2>Đang thực hiện</h2>
          <button className="home-active" disabled={busy} onClick={onActive}>
            <Workflow size={19} />
            <span>
              <strong>{active.title}</strong>
              <small>
                {active.projectName} · {active.workState.label}
              </small>
            </span>
            <ArrowRight size={17} />
          </button>
        </section>
      ) : (
        <p className="home-idle">Không có lượt đang thực hiện.</p>
      )}
      <div className="home-summary-grid">
        <section className="home-section">
          <div className="home-section-heading">
            <h2>
              Cần xử lý{summary.data ? ` · ${summary.data.attentionCount}` : ""}
            </h2>
          </div>
          <ul className="home-summary-list">
            {summary.data?.attention.map((item) => (
              <li key={item.key}>
                <button
                  disabled={busy || unavailable}
                  onClick={() => onAttention(item)}
                >
                  <strong>
                    {item.code ? `${item.code} · ` : ""}
                    {item.title}
                  </strong>
                  <small>
                    {item.projectName} · {item.problem}
                  </small>
                  {item.taskTitle && <small>{item.taskTitle}</small>}
                  <span className="small muted">{item.nextAction}</span>
                </button>
              </li>
            ))}
          </ul>
          {summary.data && !summary.data.attention.length && (
            <p className="muted small">Không có việc cần xử lý.</p>
          )}
        </section>
        <section className="home-section">
          <h2>Bàn giao mới</h2>
          <ul className="home-summary-list">
            {summary.data?.results.map((item) => (
              <li key={item.id}>
                <button
                  disabled={busy || unavailable}
                  onClick={() => onResult(item)}
                >
                  <strong>
                    {item.code ? `${item.code} · ` : ""}
                    {item.title}
                  </strong>
                  <small>
                    {item.projectName} · {reportStateLabel(item.state)}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {summary.data && !summary.data.results.length && (
            <p className="muted small">Chưa có thay đổi bàn giao.</p>
          )}
        </section>
      </div>
      <section className="home-section">
        <div className="home-section-heading">
          <h2>Dự án</h2>
          <button className="subtle" disabled={busy} onClick={onAddProject}>
            <Plus size={16} />
            Thêm dự án
          </button>
        </div>
        {projects.length ? (
          <div className="home-projects">
            {projects.map((project) => (
              <button
                key={project.id}
                className="home-project"
                disabled={busy}
                onClick={() => onProject(project)}
              >
                <Folder size={19} />
                <span>
                  <strong>{project.name}</strong>
                  <small title={project.path}>{project.path}</small>
                </span>
                <ArrowRight size={17} />
              </button>
            ))}
          </div>
        ) : (
          <div className="home-empty">
            <Folder size={26} />
            <h3>Thêm dự án để bắt đầu</h3>
            <button className="primary" disabled={busy} onClick={onAddProject}>
              Chọn thư mục source
            </button>
          </div>
        )}
      </section>
    </section>
  );
}
