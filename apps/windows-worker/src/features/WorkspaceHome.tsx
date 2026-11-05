import { ArrowRight, Folder, Plus, Workflow } from "lucide-react";
import type { Project } from "../../shared/contracts";
import type { RuntimeView } from "../../shared/runs";

export function WorkspaceHome({
  projects,
  runtime,
  runtimeError,
  busy,
  onProject,
  onAddProject,
  onActive,
  onInbox,
}: {
  projects: Project[];
  runtime: RuntimeView;
  runtimeError: boolean;
  busy: boolean;
  onProject: (project: Project) => void;
  onAddProject: () => void;
  onActive: () => void;
  onInbox: () => void;
}) {
  const active = runtime.runs.find((run) => run.id === runtime.activeId);
  return (
    <section className="workspace-home" aria-label="Trang chính">
      <div className="page-heading">
        <h1>Trang chính</h1>
        <button onClick={onInbox}>
          Cần xử lý
          <ArrowRight size={15} />
        </button>
      </div>
      {runtimeError ? (
        <p className="notice" role="status">
          Chưa đồng bộ trạng thái thực hiện.
        </p>
      ) : active ? (
        <section className="home-section">
          <h2>Đang thực hiện</h2>
          <button className="home-active" disabled={busy} onClick={onActive}>
            <Workflow size={19} />
            <span>
              <strong>{active.prompt}</strong>
              <small>{active.projectName} · Mở lượt thực hiện</small>
            </span>
            <ArrowRight size={17} />
          </button>
        </section>
      ) : (
        <p className="home-idle">Không có lượt đang thực hiện.</p>
      )}
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
