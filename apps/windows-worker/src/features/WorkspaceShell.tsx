import type { ReactNode } from "react";
import {
  Box,
  Folder,
  GitBranch,
  History,
  House,
  Inbox,
  Layers,
  FileCheck2,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings2,
  Workflow,
} from "lucide-react";
import type { Project } from "../../shared/contracts";
import { Popover } from "../ui/Popover";
import { version } from "../../package.json";

export type WorkspacePage =
  | "home"
  | "team"
  | "results"
  | "git"
  | "inbox"
  | "overview"
  | "project"
  | "history"
  | "settings"
  | "monitor"
  | "board"
  | "office";

export const isProjectPage = (page: WorkspacePage) =>
  [
    "git",
    "overview",
    "project",
    "monitor",
    "board",
    "office",
    "results",
  ].includes(page);

export function WorkspaceSidebar({
  page,
  projects,
  project,
  compact,
  busy,
  dirty,
  onNavigate,
  onProject,
  onAddProject,
  onCompact,
  attentionCount,
}: {
  page: WorkspacePage;
  projects: Project[];
  project: Project | null;
  compact: boolean;
  busy: boolean;
  dirty: boolean;
  onNavigate: (page: WorkspacePage) => void;
  onProject: (project: Project) => void;
  onAddProject: () => void;
  onCompact: () => void;
  attentionCount?: number;
}) {
  return (
    <aside className="sidebar workspace-sidebar">
      <div className="brand">
        <div className="brand-icon">
          <Workflow size={21} />
        </div>
        <div className="brand-text">
          <strong>
            ASF<span>Worker</span>
          </strong>
        </div>
      </div>
      <nav aria-label="Toàn ứng dụng">
        <button
          className={page === "home" ? "active" : ""}
          aria-current={page === "home" ? "page" : undefined}
          title="Trang chính"
          onClick={() => onNavigate("home")}
        >
          <House size={18} />
          <span>Trang chính</span>
        </button>
        <button
          className={page === "inbox" ? "active" : ""}
          aria-current={page === "inbox" ? "page" : undefined}
          title="Cần xử lý · Mọi dự án"
          onClick={() => onNavigate("inbox")}
        >
          <Inbox size={18} />
          <span>Cần xử lý</span>
          {attentionCount !== undefined && attentionCount > 0 && (
            <span
              className="workspace-count"
              aria-label={`${attentionCount} mục cần xử lý`}
            >
              {attentionCount > 99 ? "99+" : attentionCount}
            </span>
          )}
        </button>
        <button
          className={page === "team" ? "active" : ""}
          aria-current={page === "team" ? "page" : undefined}
          title="Đội ngũ · Mọi dự án"
          onClick={() => onNavigate("team")}
        >
          <Layers size={18} />
          <span>Đội ngũ</span>
        </button>
      </nav>
      <section className="sidebar-projects" aria-label="Dự án">
        <div className="sidebar-section-label">Dự án</div>
        <nav aria-label="Danh sách dự án">
          {projects.map((item) => (
            <button
              key={item.id}
              data-project-id={item.id}
              aria-label={item.name}
              className={`sidebar-project ${isProjectPage(page) && project?.id === item.id ? "active" : ""}`}
              aria-current={
                isProjectPage(page) && project?.id === item.id
                  ? "page"
                  : undefined
              }
              title={`${item.name}\n${item.path}`}
              disabled={busy}
              onClick={() => onProject(item)}
            >
              <Folder size={17} />
              <span>{item.name}</span>
            </button>
          ))}
        </nav>
        {!projects.length && (
          <p className="sidebar-project-empty">Chưa có dự án</p>
        )}
        <button
          className="sidebar-add-project subtle"
          aria-label="Thêm dự án"
          title="Thêm dự án"
          disabled={busy}
          onClick={onAddProject}
        >
          <Plus size={17} />
          <span>Thêm dự án</span>
        </button>
      </section>
      <div className="sidebar-bottom">
        <nav aria-label="Tiện ích">
          <Popover
            label="Công cụ nâng cao"
            icon={
              <>
                <MoreHorizontal size={18} />
                <span>Công cụ nâng cao</span>
              </>
            }
          >
            <button
              aria-current={page === "history" ? "true" : undefined}
              onClick={() => onNavigate("history")}
            >
              <History size={17} />
              <span>Lịch sử thực hiện · Mọi dự án</span>
            </button>
            <p className="popover-version">ASF Worker · v{version}</p>
          </Popover>
          <button
            className={page === "settings" ? "active" : ""}
            aria-current={page === "settings" ? "page" : undefined}
            title="Cài đặt"
            onClick={() => onNavigate("settings")}
          >
            <Settings2 size={18} />
            <span>Cài đặt</span>
            {dirty && <span className="nav-dot" />}
          </button>
        </nav>
        <button
          className="collapse-sidebar subtle"
          title={compact ? "Mở thanh bên" : "Thu gọn thanh bên"}
          aria-label={compact ? "Mở thanh bên" : "Thu gọn thanh bên"}
          onClick={onCompact}
        >
          {compact ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          <span>Thu gọn</span>
        </button>
      </div>
    </aside>
  );
}

export function WorkspaceHeader({
  page,
  project,
  projectMenu,
  running,
  conversationMenu,
  busy,
  onNavigate,
  onCreate,
}: {
  page: WorkspacePage;
  project: Project | null;
  projectMenu: ReactNode;
  running: ReactNode;
  conversationMenu: ReactNode;
  busy: boolean;
  onNavigate: (page: WorkspacePage) => void;
  onCreate: () => void;
}) {
  const scoped = isProjectPage(page);
  return (
    <>
      <header className="topbar workspace-topbar">
        <div className="workspace-heading">
          {scoped ? (
            projectMenu
          ) : (
            <strong className="workspace-global-scope">Toàn ứng dụng</strong>
          )}
          {running}
        </div>
        <div className="workspace-actions">
          {page === "project" && conversationMenu}
          <button className="primary" disabled={busy} onClick={onCreate}>
            <Plus size={15} />
            <span>{project && scoped ? "Tạo công việc" : "Chọn dự án"}</span>
          </button>
        </div>
      </header>
      {scoped && (
        <nav className="project-navigation" aria-label="Nội dung dự án">
          <button
            className={page === "board" ? "active" : ""}
            aria-current={page === "board" ? "page" : undefined}
            onClick={() => onNavigate("board")}
          >
            <Workflow size={16} />
            Công việc
          </button>
          <button
            className={page === "project" ? "active" : ""}
            aria-current={page === "project" ? "page" : undefined}
            onClick={() => onNavigate("project")}
          >
            <MessageSquare size={16} />
            Trao đổi
          </button>
          <button
            className={page === "results" ? "active" : ""}
            aria-current={page === "results" ? "page" : undefined}
            onClick={() => onNavigate("results")}
          >
            <FileCheck2 size={16} />
            Kết quả
          </button>
          <Popover
            className="project-more"
            label="Khác trong dự án"
            icon={
              <>
                <MoreHorizontal size={17} />
                <span>Khác</span>
              </>
            }
          >
            <button
              aria-current={page === "overview" ? "true" : undefined}
              onClick={() => onNavigate("overview")}
            >
              <House size={16} />
              <span>Tổng quan dự án</span>
            </button>
            <button
              aria-current={page === "monitor" ? "true" : undefined}
              onClick={() => onNavigate("monitor")}
            >
              <Layers size={16} />
              <span>Đội ngũ dự án</span>
            </button>
            <button
              aria-current={page === "git" ? "true" : undefined}
              onClick={() => onNavigate("git")}
            >
              <GitBranch size={16} />
              <span>Git local</span>
            </button>
            <button
              aria-current={page === "office" ? "true" : undefined}
              onClick={() => onNavigate("office")}
            >
              <Box size={16} />
              <span>Văn phòng · Thử nghiệm</span>
            </button>
          </Popover>
          {!["board", "project", "results"].includes(page) && (
            <span className="project-current-page">
              {page === "overview"
                ? "Tổng quan"
                : page === "monitor"
                  ? "Đội ngũ"
                  : page === "git"
                    ? "Git"
                    : "Văn phòng"}
            </span>
          )}
        </nav>
      )}
    </>
  );
}
