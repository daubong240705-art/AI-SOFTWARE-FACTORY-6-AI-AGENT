import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  ExternalLink,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  History,
  KeyRound,
  Layers,
  ListTodo,
  LoaderCircle,
  PanelLeftClose,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Terminal,
  Trash2,
  TriangleAlert,
  Workflow,
  X,
} from "lucide-react";
import type {
  Bootstrap,
  Project,
  ProjectStatus,
  Reply,
  Role,
  Settings,
  ToolStatus,
} from "../shared/contracts";
import { defaultSettings } from "../shared/defaults";

const names: Record<Role, { label: string; description: string }> = {
  lead: { label: "Lead", description: "Điều phối" },
  pm: { label: "PM", description: "Kế hoạch" },
  ba: { label: "BA", description: "Yêu cầu" },
  be: { label: "BE", description: "Backend" },
  fe: { label: "FE", description: "Frontend" },
  test: { label: "TEST", description: "Kiểm thử" },
  devops: { label: "DEVOPS", description: "Môi trường local" },
};
async function value<T>(promise: Promise<Reply<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
type Page = "project" | "history" | "settings";
type Notice = { kind: "error" | "success"; text: string };

function Empty({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [page, setPage] = useState<Page>("project");
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [tab, setTab] = useState("activity");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolStatus[] | null>(null);
  const [keyAction, setKeyAction] = useState<"keep" | "replace" | "remove">(
    "keep",
  );
  const keyInput = useRef<HTMLInputElement>(null);
  const [presetOpen, setPresetOpen] = useState(false);
  const [preset, setPreset] = useState<"fast" | "balanced" | "quality">(
    "balanced",
  );
  const [presetModels, setPresetModels] = useState({
    fast: "",
    planning: "",
    coding: "",
  });
  const [remove, setRemove] = useState<Project | null>(null);
  const [compact, setCompact] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dirty =
    boot &&
    (JSON.stringify(settings) !== JSON.stringify(boot.settings) ||
      keyAction !== "keep");
  const models = boot?.models ?? [];

  function tell(text: string, kind: Notice["kind"] = "success") {
    setNotice({ text, kind });
  }
  async function act(name: string, action: () => Promise<void>) {
    setBusy(name);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      tell(
        error instanceof Error
          ? error.message
          : "Không thực hiện được thao tác.",
        "error",
      );
    } finally {
      setBusy(null);
    }
  }
  async function load() {
    const data = await value(window.worker.bootstrap());
    setBoot(data);
    setSettings(data.settings);
    return data;
  }
  useEffect(() => {
    void act("load", async () => {
      await load();
    });
  }, []);
  useEffect(() => {
    if (page !== "settings")
      setKeyAction((current) => (current === "replace" ? "keep" : current));
  }, [page]);
  useEffect(() => {
    if (!project) {
      setStatus(null);
      return;
    }
    let active = true;
    setStatus(null);
    value(window.worker.projectStatus(project.id))
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch((error) => {
        if (active)
          setStatus({
            gitRoot: null,
            branch: null,
            changedFiles: 0,
            error: error.message,
          });
      });
    return () => {
      active = false;
    };
  }, [project?.id, project?.lastOpenedAt]);
  // Debounced drafts are persisted by project; settings never contain the task text.
  useEffect(() => {
    if (!project) return;
    const id = project.id;
    const timer = setTimeout(() => {
      value(window.worker.saveDraft({ id, draft }))
        .then(() => setDraftStatus(draft ? "Đã lưu nháp" : ""))
        .catch(() => setDraftStatus("Chưa lưu được nháp"));
    }, 400);
    return () => clearTimeout(timer);
  }, [project?.id, draft]);

  async function flushDraft() {
    if (project)
      await value(
        window.worker.saveDraft({ id: project.id, draft: draftRef.current }),
      );
  }
  function selectProject(selected: Project) {
    setProject(selected);
    setDraft(selected.draft);
    setDraftStatus("");
    setPage("project");
  }
  async function chooseProject() {
    await act("project", async () => {
      await flushDraft();
      const selected = await value(window.worker.chooseProject());
      if (selected) {
        const data = await value(window.worker.bootstrap());
        setBoot(data);
        selectProject(selected);
      }
    });
  }
  async function openProject(selected: Project) {
    await act("project", async () => {
      await flushDraft();
      const opened = await value(window.worker.openProject(selected.id));
      const data = await value(window.worker.bootstrap());
      setBoot(data);
      selectProject(opened);
    });
  }
  async function save() {
    const next = await value(
      window.worker.saveSettings({
        settings,
        keyAction,
        ...(keyAction === "replace"
          ? { apiKey: keyInput.current?.value ?? "" }
          : {}),
      }),
    );
    if (keyInput.current) keyInput.current.value = "";
    setKeyAction("keep");
    setBoot(next);
    setSettings(next.settings);
    return next;
  }
  async function fetchCatalog() {
    await act("models", async () => {
      const next = await save();
      const found = await value(window.worker.fetchModels());
      setBoot({ ...next, models: found });
      tell(
        found.length
          ? `Đã kết nối · ${found.length} model`
          : "Đã kết nối. Gateway chưa cung cấp model nào.",
      );
    });
  }
  function updateAgent(
    role: Role,
    update: Partial<Settings["agents"][number]>,
  ) {
    setSettings((current) => ({
      ...current,
      agents: current.agents.map((agent) =>
        agent.role === role ? { ...agent, ...update } : agent,
      ),
    }));
  }
  async function chooseFile(kind: "ca" | "runtime") {
    await act("file", async () => {
      const path = await value(window.worker.chooseFile(kind));
      if (path)
        setSettings((current) => ({
          ...current,
          [kind === "ca" ? "caPath" : "runtimePath"]: path,
        }));
    });
  }
  function applyPreset() {
    const { fast, planning, coding } = presetModels;
    if (!fast || !coding || (preset !== "fast" && !planning)) return;
    setSettings((current) => ({
      ...current,
      agents: current.agents.map((agent) => ({
        ...agent,
        model:
          agent.role === "be" || agent.role === "fe"
            ? coding
            : preset === "fast"
              ? fast
              : agent.role === "lead" ||
                  agent.role === "ba" ||
                  (preset === "quality" && ["pm", "test"].includes(agent.role))
                ? planning
                : fast,
      })),
    }));
    setPresetOpen(false);
    tell("Đã áp dụng preset. Bấm Lưu cấu hình để giữ thay đổi.");
  }
  function navigate(next: Page) {
    if (page === "settings" && next !== "settings" && keyInput.current?.value) {
      keyInput.current.value = "";
      setKeyAction("keep");
      tell("Key chưa lưu đã được xóa khỏi ô nhập.");
    }
    setPage(next);
  }

  const modelSelector = (
    model: string,
    change: (id: string) => void,
    label: string,
    disabled = false,
  ) => (
    <select
      aria-label={label}
      value={model}
      onChange={(event) => change(event.target.value)}
      disabled={disabled || !!busy}
    >
      <option value="">Chọn model</option>
      {model && !models.includes(model) && (
        <option value={model}>{model} · ngoài catalog</option>
      )}
      {models.map((id) => (
        <option value={id} key={id}>
          {id}
        </option>
      ))}
    </select>
  );

  const team = (
    <section className="card team-card">
      <div className="card-heading">
        <div>
          <h2>Đội agent</h2>
          <span className="muted small">
            {settings.agents.filter((agent) => agent.enabled).length}/7 đang bật
          </span>
        </div>
        <div className="inline">
          <button
            className="subtle"
            onClick={() => setPresetOpen(true)}
            disabled={!models.length || !!busy}
          >
            <Layers size={15} />
            Preset
          </button>
          <button
            className="subtle"
            disabled={!dirty || !!busy}
            onClick={() =>
              void act("save", async () => {
                await save();
                tell("Đã lưu cấu hình.");
              })
            }
          >
            <Save size={15} />
            Lưu
          </button>
        </div>
      </div>
      <div className="team-header">
        <span>Agent</span>
        <span>Model</span>
        <span>Bật</span>
      </div>
      {settings.agents.map((agent) => (
        <div
          className={`agent-row ${!agent.enabled ? "inactive" : ""}`}
          key={agent.role}
        >
          <div className="agent-info">
            <div
              className={`agent-avatar ${agent.role === "lead" ? "lead" : ""}`}
            >
              {agent.role === "lead" ? (
                <Workflow size={17} />
              ) : (
                names[agent.role].label.slice(0, 2)
              )}
            </div>
            <div>
              <strong>{names[agent.role].label}</strong>
              <small>{names[agent.role].description}</small>
            </div>
          </div>
          {modelSelector(
            agent.model,
            (model) => updateAgent(agent.role, { model }),
            `Model ${names[agent.role].label}`,
            !agent.enabled,
          )}
          <button
            type="button"
            className="toggle"
            role="switch"
            aria-label={`Bật ${names[agent.role].label}`}
            aria-checked={agent.enabled}
            disabled={agent.role === "lead" || !!busy}
            title={agent.role === "lead" ? "Lead luôn bật" : undefined}
            onClick={() => updateAgent(agent.role, { enabled: !agent.enabled })}
          >
            <span />
          </button>
        </div>
      ))}
      {!models.length && (
        <button className="card-link" onClick={() => navigate("settings")}>
          Kết nối gateway để tải model <ArrowRight size={14} />
        </button>
      )}
    </section>
  );

  return (
    <div className={`app ${compact ? "compact" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Workflow size={23} />
          </div>
          <div className="brand-text">
            <strong>
              ASF<span>Worker</span>
            </strong>
            <small>LOCAL WORKSPACE</small>
          </div>
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav aria-label="Điều hướng chính">
          <button
            className={page === "project" ? "active" : ""}
            onClick={() => navigate("project")}
            title="Dự án"
          >
            <Folder size={18} />
            <span>Dự án</span>
            {project && <span className="nav-dot" />}
          </button>
          <button
            className={page === "history" ? "active" : ""}
            onClick={() => navigate("history")}
            title="Lịch sử"
          >
            <History size={18} />
            <span>Lịch sử</span>
          </button>
          <button
            className={page === "settings" ? "active" : ""}
            onClick={() => navigate("settings")}
            title="Cài đặt"
          >
            <Settings2 size={18} />
            <span>Cài đặt</span>
            {dirty && <span className="nav-dot" />}
          </button>
        </nav>
        <div className="recent-title">
          <span>DỰ ÁN GẦN ĐÂY</span>
          <button
            className="icon-button"
            aria-label="Thêm dự án"
            onClick={() => void chooseProject()}
            disabled={!!busy}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="recent-list">
          {boot?.projects.map((item) => (
            <div
              key={item.id}
              className={`recent-row ${project?.id === item.id ? "selected" : ""}`}
            >
              <button
                className="recent-project"
                onClick={() => void openProject(item)}
                title={item.path}
                disabled={!!busy}
              >
                <Folder size={15} />
                <span>{item.name}</span>
              </button>
              <button
                className="icon-button remove-project"
                aria-label={`Bỏ ${item.name} khỏi danh sách`}
                onClick={() => setRemove(item)}
                disabled={!!busy}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          {!boot?.projects.length && (
            <span className="recent-empty">Chưa có dự án</span>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-state">
            <span className="status-dot" />
            <span>Standalone</span>
            <small>v0.1.0</small>
          </div>
          <button
            className="collapse-sidebar subtle"
            onClick={() => setCompact(!compact)}
            title="Thu gọn thanh bên"
            aria-label="Thu gọn thanh bên"
          >
            <PanelLeftClose size={16} />
            <span>Thu gọn</span>
          </button>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace
            <ChevronRight size={14} />
            <span>
              {page === "project"
                ? "Dự án"
                : page === "history"
                  ? "Lịch sử"
                  : "Cài đặt"}
            </span>
          </div>
          <span className="phase-badge">
            <span />
            Desktop · WW-1
          </span>
        </header>
        <main>
          {notice && (
            <div
              className={`notice ${notice.kind}`}
              role={notice.kind === "error" ? "alert" : "status"}
            >
              {notice.kind === "error" ? (
                <TriangleAlert size={16} />
              ) : (
                <CheckCircle2 size={16} />
              )}
              <span>{notice.text}</span>
              <button
                className="icon-button"
                aria-label="Đóng thông báo"
                onClick={() => setNotice(null)}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {!boot ? (
            <Empty
              icon={
                busy ? <LoaderCircle className="spin" /> : <TriangleAlert />
              }
              title={busy ? "Đang mở workspace" : "Không mở được dữ liệu"}
            >
              {!busy && (
                <button
                  onClick={() =>
                    void act("load", async () => {
                      await load();
                    })
                  }
                >
                  Thử lại
                </button>
              )}
            </Empty>
          ) : (
            <>
              {page === "project" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">WORKSPACE</div>
                      <h1>{project?.name ?? "Dự án của bạn"}</h1>
                      <div className="muted path" title={project?.path}>
                        {project?.path ?? "Chọn thư mục source để bắt đầu."}
                      </div>
                    </div>
                    <div className="inline">
                      {project && (
                        <button
                          disabled={!!busy}
                          onClick={() =>
                            void act("reveal", async () => {
                              await value(
                                window.worker.revealProject(project.id),
                              );
                            })
                          }
                        >
                          <ExternalLink size={16} />
                          Mở thư mục
                        </button>
                      )}
                      <button
                        className={project ? "" : "primary"}
                        onClick={() => void chooseProject()}
                        disabled={!!busy}
                      >
                        <Plus size={16} />
                        Chọn dự án
                      </button>
                    </div>
                  </div>
                  {project && (
                    <div className="project-meta">
                      <span>
                        <GitBranch size={14} />
                        {status?.branch ??
                          (status ? "Chưa có Git" : "Đang đọc Git…")}
                      </span>
                      {status?.gitRoot && (
                        <span>{status.changedFiles} file thay đổi</span>
                      )}
                      {status?.error && (
                        <span className="muted">{status.error}</span>
                      )}
                      <button
                        className="icon-button"
                        title="Làm mới Git"
                        aria-label="Làm mới Git"
                        disabled={!!busy}
                        onClick={() =>
                          void act("git", async () => {
                            setStatus(
                              await value(
                                window.worker.projectStatus(project.id),
                              ),
                            );
                          })
                        }
                      >
                        <RefreshCw size={14} />
                      </button>
                    </div>
                  )}
                  <div className="workspace-grid">
                    <div className="work-column">
                      <section className="card composer">
                        <div className="card-heading">
                          <h2>
                            <ListTodo size={17} />
                            Yêu cầu
                          </h2>
                          <span className="muted small">{draftStatus}</span>
                        </div>
                        <textarea
                          aria-label="Yêu cầu phát triển"
                          placeholder={
                            project
                              ? "Bạn muốn xây dựng hoặc thay đổi điều gì?"
                              : "Chọn một dự án trước khi nhập yêu cầu."
                          }
                          disabled={!project}
                          value={draft}
                          maxLength={32000}
                          onChange={(event) => {
                            setDraft(event.target.value);
                            setDraftStatus("Đang lưu…");
                          }}
                          onBlur={() =>
                            void flushDraft().catch(() =>
                              setDraftStatus("Chưa lưu được nháp"),
                            )
                          }
                        />
                        <div className="composer-footer">
                          <span>
                            <span className="status-dot muted-dot" />
                            Chưa chạy
                          </span>
                          <button
                            className="primary"
                            disabled
                            title="Thực thi OpenCode sẽ có ở WW-2"
                          >
                            <Play size={14} fill="currentColor" />
                            Chạy yêu cầu
                          </button>
                        </div>
                        <div className="runtime-note">
                          <Terminal size={14} />
                          <span>Thực thi OpenCode sẽ được nối ở WW-2.</span>
                        </div>
                      </section>
                      <section className="card output-card">
                        <div
                          className="tabs"
                          role="tablist"
                          aria-label="Kết quả công việc"
                        >
                          {[
                            ["activity", "Hoạt động", <Terminal size={15} />],
                            ["changes", "Thay đổi", <FileCode2 size={15} />],
                            ["result", "Kết quả", <CheckCircle2 size={15} />],
                          ].map(([id, label, icon]) => (
                            <button
                              key={id as string}
                              role="tab"
                              aria-selected={tab === id}
                              className={tab === id ? "selected" : ""}
                              onClick={() => setTab(id as string)}
                            >
                              {icon}
                              {label}
                            </button>
                          ))}
                        </div>
                        <div role="tabpanel">
                          {tab === "activity" ? (
                            <Empty
                              icon={<Terminal size={25} />}
                              title="Chưa có hoạt động"
                            >
                              Các bước thực thi sẽ xuất hiện tại đây.
                            </Empty>
                          ) : tab === "changes" ? (
                            <Empty
                              icon={<FileCode2 size={25} />}
                              title="Chưa có thay đổi từ agent"
                            >
                              Diff sẽ có khi runtime bắt đầu làm việc.
                            </Empty>
                          ) : (
                            <Empty
                              icon={<CheckCircle2 size={25} />}
                              title="Chưa có kết quả"
                            >
                              Chưa có yêu cầu nào được thực thi.
                            </Empty>
                          )}
                        </div>
                      </section>
                    </div>
                    <div className="team-column">
                      {team}
                      <div className="workspace-hint">
                        <ShieldCheck size={16} />
                        <span>Source local. Model kết nối qua 9Router.</span>
                      </div>
                    </div>
                  </div>
                  {!project && (
                    <section className="recent-cards">
                      <div className="section-title">
                        <h2>Dự án gần đây</h2>
                        <span className="muted small">
                          {boot.projects.length} dự án
                        </span>
                      </div>
                      {boot.projects.length ? (
                        <div className="project-cards">
                          {boot.projects.map((item) => (
                            <button
                              key={item.id}
                              className="project-card"
                              disabled={!!busy}
                              onClick={() => void openProject(item)}
                            >
                              <FolderOpen size={21} />
                              <div>
                                <strong>{item.name}</strong>
                                <small title={item.path}>{item.path}</small>
                              </div>
                              <ChevronRight size={16} />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="no-projects">
                          <Folder size={18} />
                          Chưa có dự án. Source của bạn sẽ giữ nguyên trên máy.
                        </div>
                      )}
                    </section>
                  )}
                </>
              )}
              {page === "history" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">WORKSPACE</div>
                      <h1>Lịch sử</h1>
                    </div>
                    <span className="pill">0 lượt chạy</span>
                  </div>
                  <section className="card">
                    <Empty
                      icon={<Clock3 size={28} />}
                      title="Chưa có lượt chạy"
                    >
                      Các bản nháp nằm trong từng dự án.
                    </Empty>
                  </section>
                </>
              )}
              {page === "settings" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">PREFERENCES</div>
                      <h1>Cài đặt</h1>
                    </div>
                    <div className="inline">
                      {dirty && <span className="unsaved">Chưa lưu</span>}
                      <button
                        className="primary"
                        disabled={!dirty || !!busy}
                        onClick={() =>
                          void act("save", async () => {
                            await save();
                            tell("Đã lưu cấu hình.");
                          })
                        }
                      >
                        {busy === "save" ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <Save size={16} />
                        )}
                        Lưu cấu hình
                      </button>
                    </div>
                  </div>
                  <div className="settings-grid">
                    <div className="settings-main">
                      <section className="card settings-card">
                        <div className="card-heading">
                          <h2>
                            <KeyRound size={17} />
                            9Router
                          </h2>
                          <span className="pill">
                            {boot.hasKey ? "Đã lưu key" : "Chưa có key"}
                          </span>
                        </div>
                        <label>
                          Gateway URL
                          <input
                            placeholder="https://router.example/v1"
                            value={settings.gatewayUrl}
                            onChange={(event) =>
                              setSettings({
                                ...settings,
                                gatewayUrl: event.target.value,
                              })
                            }
                            disabled={!!busy}
                            spellCheck={false}
                          />
                        </label>
                        <label>
                          API key
                          <div className="input-actions">
                            <input
                              ref={keyInput}
                              type="password"
                              autoComplete="new-password"
                              placeholder={
                                boot.hasKey
                                  ? "Để trống để giữ key đã lưu"
                                  : "Nhập API key"
                              }
                              disabled={!boot.secureStorage || !!busy}
                              onChange={(event) =>
                                setKeyAction(
                                  event.target.value ? "replace" : "keep",
                                )
                              }
                              aria-label="API key"
                              spellCheck={false}
                            />
                            {boot.hasKey && (
                              <button
                                className={
                                  keyAction === "remove" ? "danger" : ""
                                }
                                disabled={!!busy}
                                onClick={() => {
                                  if (keyInput.current)
                                    keyInput.current.value = "";
                                  setKeyAction(
                                    keyAction === "remove" ? "keep" : "remove",
                                  );
                                }}
                              >
                                {keyAction === "remove" ? "Giữ key" : "Xóa key"}
                              </button>
                            )}
                          </div>
                        </label>
                        {keyAction === "remove" && (
                          <p className="warning-text">
                            Key sẽ được xóa khi lưu.
                          </p>
                        )}
                        {!boot.secureStorage && (
                          <p className="warning-text">
                            Windows secure storage không khả dụng. Không thể lưu
                            API key.
                          </p>
                        )}
                        <label>
                          CA nội bộ{" "}
                          <span className="muted optional">Tùy chọn</span>
                          <div className="input-actions">
                            <input
                              value={settings.caPath}
                              placeholder="Chọn file .crt hoặc .pem"
                              onChange={(event) =>
                                setSettings({
                                  ...settings,
                                  caPath: event.target.value,
                                })
                              }
                              disabled={!!busy}
                            />
                            <button
                              aria-label="Chọn CA nội bộ"
                              onClick={() => void chooseFile("ca")}
                              disabled={!!busy}
                            >
                              <FolderOpen size={16} />
                            </button>
                          </div>
                        </label>
                        <div className="settings-action">
                          <span className="muted small">
                            {models.length
                              ? `${models.length} model trong catalog`
                              : "Chưa tải catalog"}
                          </span>
                          <button
                            onClick={() => void fetchCatalog()}
                            disabled={!!busy || !settings.gatewayUrl}
                          >
                            {busy === "models" ? (
                              <LoaderCircle size={15} className="spin" />
                            ) : (
                              <RefreshCw size={15} />
                            )}
                            Lưu & tải model
                          </button>
                        </div>
                        <details className="setting-details">
                          <summary>Thông tin kết nối</summary>
                          <p>
                            Gateway URL gồm API prefix, thường là /v1. Tải model
                            chỉ đọc catalog, không gọi sinh code.
                          </p>
                          <p>
                            API key được mã hóa bằng Windows secure storage.
                            Source gửi trong context có thể đi qua 9Router tới
                            nhà cung cấp model.
                          </p>
                          <p>
                            Đổi máy chủ gateway cần nhập key mới hoặc xóa key
                            cũ.
                          </p>
                        </details>
                      </section>
                      <section className="card settings-card">
                        <div className="card-heading">
                          <h2>
                            <Terminal size={17} />
                            Runtime & công cụ
                          </h2>
                        </div>
                        <label>
                          OpenCode executable
                          <div className="input-actions">
                            <input
                              placeholder="Tự tìm opencode trong PATH"
                              value={settings.runtimePath}
                              onChange={(event) =>
                                setSettings({
                                  ...settings,
                                  runtimePath: event.target.value,
                                })
                              }
                              disabled={!!busy}
                            />
                            <button
                              aria-label="Chọn OpenCode executable"
                              onClick={() => void chooseFile("runtime")}
                              disabled={!!busy}
                            >
                              <FolderOpen size={16} />
                            </button>
                          </div>
                        </label>
                        <div className="settings-action">
                          <span className="muted small">
                            Chỉ đọc phiên bản, không cài công cụ.
                          </span>
                          <button
                            disabled={!!busy}
                            onClick={() =>
                              void act("tools", async () => {
                                await save();
                                setTools(
                                  await value(window.worker.checkTools()),
                                );
                              })
                            }
                          >
                            {busy === "tools" ? (
                              <LoaderCircle size={15} className="spin" />
                            ) : (
                              <RefreshCw size={15} />
                            )}
                            Đọc phiên bản
                          </button>
                        </div>
                        {tools && (
                          <div className="tool-list">
                            {tools.map((tool) => (
                              <div className="tool-row" key={tool.name}>
                                <span>
                                  {tool.available ? (
                                    <Check size={15} className="success-text" />
                                  ) : (
                                    <TriangleAlert
                                      size={15}
                                      className="warning-text"
                                    />
                                  )}
                                  <strong>{tool.name}</strong>
                                </span>
                                <div>
                                  <span title={tool.path}>{tool.version}</span>
                                  {!tool.available && (
                                    <small>
                                      {tool.name === "OpenCode"
                                        ? "Chọn opencode.exe hoặc thêm vào PATH."
                                        : `Cài ${tool.name} nếu dự án cần công cụ này.`}
                                    </small>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                      <section className="card settings-card">
                        <div className="card-heading">
                          <h2>
                            <Settings2 size={17} />
                            Giới hạn mặc định
                          </h2>
                          <span className="pill">Tuần tự</span>
                        </div>
                        <div className="limit-grid">
                          <label>
                            Timeout <span className="muted optional">phút</span>
                            <input
                              type="number"
                              min="1"
                              max="240"
                              value={settings.timeoutMinutes}
                              disabled={!!busy}
                              onChange={(event) =>
                                setSettings({
                                  ...settings,
                                  timeoutMinutes: Number(event.target.value),
                                })
                              }
                            />
                          </label>
                          <label>
                            Request tối đa
                            <input
                              type="number"
                              min="1"
                              max="1000"
                              value={settings.maxRequests}
                              disabled={!!busy}
                              onChange={(event) =>
                                setSettings({
                                  ...settings,
                                  maxRequests: Number(event.target.value),
                                })
                              }
                            />
                          </label>
                          <label>
                            Vòng sửa lỗi
                            <select
                              value={settings.maxFixRounds}
                              disabled={!!busy}
                              onChange={(event) =>
                                setSettings({
                                  ...settings,
                                  maxFixRounds: Number(event.target.value),
                                })
                              }
                            >
                              {[0, 1, 2].map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <p className="muted small">
                          Được lưu cho WW-2/WW-3. Runtime chưa thực thi giới hạn
                          ở WW-1.
                        </p>
                      </section>
                    </div>
                    <div className="team-column">{team}</div>
                  </div>
                </>
              )}
            </>
          )}
        </main>
        <footer className="statusbar">
          <span>
            <span className="status-dot" />
            Dữ liệu local
          </span>
          <span>
            {busy ? (
              <>
                <LoaderCircle size={12} className="spin" />
                Đang xử lý
              </>
            ) : (
              <>
                <Code2 size={13} />
                Runtime chưa kết nối
              </>
            )}
          </span>
        </footer>
      </div>
      {presetOpen && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preset-title"
          >
            <div className="card-heading">
              <h2 id="preset-title">Áp dụng preset</h2>
              <button
                className="icon-button"
                aria-label="Đóng preset"
                onClick={() => setPresetOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <label>
              Chế độ
              <select
                value={preset}
                onChange={(event) =>
                  setPreset(event.target.value as typeof preset)
                }
              >
                <option value="fast">Fast</option>
                <option value="balanced">Balanced</option>
                <option value="quality">Quality</option>
              </select>
            </label>
            <label>
              Model nhanh
              {modelSelector(
                presetModels.fast,
                (fast) => setPresetModels({ ...presetModels, fast }),
                "Model nhanh",
              )}
            </label>
            {preset !== "fast" && (
              <label>
                Model lập kế hoạch
                {modelSelector(
                  presetModels.planning,
                  (planning) => setPresetModels({ ...presetModels, planning }),
                  "Model lập kế hoạch",
                )}
              </label>
            )}
            <label>
              Model coding
              {modelSelector(
                presetModels.coding,
                (coding) => setPresetModels({ ...presetModels, coding }),
                "Model coding",
              )}
            </label>
            <p className="muted small">
              BE/FE dùng model coding.{" "}
              {preset === "fast"
                ? "Các role còn lại dùng model nhanh."
                : preset === "balanced"
                  ? "Lead/BA dùng model lập kế hoạch."
                  : "Lead/PM/BA/TEST dùng model lập kế hoạch."}{" "}
              Trạng thái bật/tắt được giữ nguyên.
            </p>
            <div className="modal-actions">
              <button onClick={() => setPresetOpen(false)}>Hủy</button>
              <button
                className="primary"
                disabled={
                  !presetModels.fast ||
                  !presetModels.coding ||
                  (preset !== "fast" && !presetModels.planning)
                }
                onClick={applyPreset}
              >
                Áp dụng
              </button>
            </div>
          </section>
        </div>
      )}
      {remove && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-title"
          >
            <div className="card-heading">
              <h2 id="remove-title">Bỏ dự án khỏi danh sách?</h2>
            </div>
            <p>{remove.name}</p>
            <p className="muted">
              Source trên máy được giữ nguyên. Bản nháp trong ứng dụng sẽ được
              xóa.
            </p>
            <div className="modal-actions">
              <button disabled={!!busy} onClick={() => setRemove(null)}>
                Hủy
              </button>
              <button
                className="danger"
                disabled={!!busy}
                onClick={() =>
                  void act("remove", async () => {
                    await value(window.worker.removeProject(remove.id));
                    if (project?.id === remove.id) {
                      setProject(null);
                      setDraft("");
                    }
                    const data = await value(window.worker.bootstrap());
                    setBoot(data);
                    setRemove(null);
                  })
                }
              >
                <Trash2 size={15} />
                Bỏ khỏi danh sách
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
