import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  Folder,
  FolderOpen,
  History,
  KeyRound,
  Layers,
  LoaderCircle,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Save,
  Settings2,
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
import { version } from "../package.json";
import { ChatWorkspace } from "./features/ChatWorkspace";
import { AgentMonitor } from "./features/AgentMonitor";
import { KanbanBoard } from "./features/KanbanBoard";
import { useMonitor } from "./lib/use-monitor";
import { TaskInspector } from "./features/TaskInspector";
import type { InspectorSelection } from "../shared/inspector";
import { HistoryTools } from "./features/HistoryTools";
import type { ConversationSummary } from "../shared/chat";
import type { RuntimeView } from "../shared/runs";
import { runLabels } from "../shared/runs";

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
type Page = "project" | "history" | "settings" | "monitor" | "board";
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
  const didLoad = useRef(false);
  const chatFlush = useRef<() => Promise<unknown>>(() => Promise.resolve());
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [page, setPage] = useState<Page>("project");
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<ProjectStatus | null>(null);
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
  const [runtime, setRuntime] = useState<RuntimeView>({
    activeId: null,
    runs: [],
  });
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationSearch, setConversationSearch] = useState("");
  const [chatRefresh, setChatRefresh] = useState(0);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [openRunVersion, setOpenRunVersion] = useState(0);
  const [inspection, setInspection] = useState<InspectorSelection | null>(null);
  const [boardRunId, setBoardRunId] = useState<string | null>(null);
  useEffect(() => {
    setInspection(null);
    setBoardRunId(null);
  }, [project?.id]);
  function inspect(
    runId: string,
    taskId?: string | null,
    executionId?: string,
  ) {
    if (project)
      setInspection({ projectId: project.id, runId, taskId, executionId });
  }
  async function openInspectedChat(runId: string, conversation: string | null) {
    await flushDraft();
    setOpenRunVersion((n) => n + 1);
    setSelectedRun(runId);
    setConversationId(conversation);
    setInspection(null);
    await navigate("project");
  }
  async function openInspectorWorkspace(selected: Project) {
    await flushDraft();
    const data = await value(window.worker.bootstrap());
    setBoot(data);
    setInspection(null);
    await selectProject(selected);
  }
  const monitor = useMonitor(
    project && ["project", "monitor"].includes(page) ? project.id : null,
  );
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
    if (didLoad.current) return;
    didLoad.current = true;
    void act("load", async () => {
      const data = await load();
      if (data.projects[0]) await selectProject(data.projects[0]);
    });
  }, []);
  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await value(window.worker.runtimeView());
        if (!mounted) return;
        setRuntime(next);
      } catch {
        /* Keep persisted content during a transient IPC refresh failure. */
      }
      if (mounted) timer = setTimeout(() => void poll(), 900);
    }
    void poll();
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [selectedRun, project?.id]);
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
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const items = await value(
          window.worker.conversations({
            projectId: project?.id,
            search: conversationSearch,
          }),
        );
        if (alive) setConversations(items);
      } catch {
        /* Keep the last list if refresh fails. */
      }
      if (alive) timer = setTimeout(() => void refresh(), 1500);
    }
    void refresh();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [project?.id, conversationSearch, chatRefresh]);
  async function flushDraft() {
    await chatFlush.current();
  }
  async function selectProject(selected: Project) {
    const items = await value(
      window.worker.conversations({ projectId: selected.id }),
    );
    const selectedChat =
      items[0] ?? (await value(window.worker.createConversation(selected.id)));
    setProject(selected);
    setConversations(items);
    setConversationId(selectedChat.id);
    setPage("project");
    setSelectedRun(null);
    setConversationSearch("");
  }
  async function newConversation() {
    if (!project) {
      await chooseProject();
      return;
    }
    await act("conversation", async () => {
      await flushDraft();
      const created = await value(window.worker.createConversation(project.id));
      setConversationId(created.id);
      setSelectedRun(null);
      setPage("project");
      setChatRefresh((n) => n + 1);
      setConversationSearch("");
    });
  }
  async function openConversation(id: string) {
    await act("conversation", async () => {
      await flushDraft();
      const detail = await value(window.worker.conversation(id));
      const selected =
        boot?.projects.find((p) => p.id === detail.conversation.projectId) ??
        null;
      setProject(selected);
      setConversationId(id);
      setSelectedRun(null);
      setPage("project");
    });
  }
  async function openActive() {
    const active = runtime.runs.find((r) => r.id === runtime.activeId);
    if (active?.conversationId) await openConversation(active.conversationId);
  }
  async function chooseProject() {
    await act("project", async () => {
      await flushDraft();
      const selected = await value(window.worker.chooseProject());
      if (selected) {
        const data = await value(window.worker.bootstrap());
        setBoot(data);
        await selectProject(selected);
      }
    });
  }
  async function openProject(selected: Project) {
    await act("project", async () => {
      await flushDraft();
      const opened = await value(window.worker.openProject(selected.id));
      const data = await value(window.worker.bootstrap());
      setBoot(data);
      await selectProject(opened);
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
  async function navigate(next: Page) {
    try {
      await flushDraft();
    } catch (error) {
      tell(
        error instanceof Error ? error.message : "Không lưu được nháp.",
        "error",
      );
      return;
    }
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
            className={page === "board" ? "active" : ""}
            onClick={() => navigate("board")}
            title="Công việc"
          >
            <Workflow size={18} />
            <span>Công việc</span>
          </button>
          <button
            className={page === "monitor" ? "active" : ""}
            onClick={() => navigate("monitor")}
            title="Đội ngũ"
          >
            <Layers size={18} />
            <span>Đội ngũ</span>
          </button>
          <button
            className={page === "project" ? "active" : ""}
            onClick={() => navigate("project")}
            title="Dự án"
          >
            <Folder size={18} />
            <span>Trò chuyện</span>
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
        <div className="conversation-nav">
          <button
            className="new-conversation"
            disabled={!!busy}
            onClick={() => void newConversation()}
          >
            <Plus size={16} />
            Cuộc trò chuyện mới
          </button>
          <input
            className="conversation-search"
            aria-label="Tìm cuộc trò chuyện"
            placeholder="Tìm cuộc trò chuyện…"
            value={conversationSearch}
            onChange={(event) => setConversationSearch(event.target.value)}
            maxLength={200}
          />
          <div className="conversation-list">
            {conversations.map((item) => (
              <button
                key={item.id}
                title={item.title}
                className={
                  conversationId === item.id && page === "project"
                    ? "selected"
                    : ""
                }
                disabled={!!busy}
                onClick={() => void openConversation(item.id)}
              >
                <span>{item.title}</span>
                <small>
                  {new Date(item.updatedAt).toLocaleDateString("vi-VN", {
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </small>
              </button>
            ))}
            {!conversations.length && (
              <span className="recent-empty">Chưa có cuộc trò chuyện</span>
            )}
          </div>
        </div>
        <div className="sidebar-bottom">
          <div className="local-state">
            <span className="status-dot" />
            <span>Standalone</span>
            <small>v{version}</small>
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
        <header className={`topbar ${page === "project" ? "chat-topbar" : ""}`}>
          <div className="breadcrumb">
            Workspace
            <ChevronRight size={14} />
            <span>
              {page === "project"
                ? "Trò chuyện"
                : page === "monitor"
                  ? "Đội ngũ"
                  : page === "board"
                    ? "Công việc"
                    : page === "history"
                      ? "Lịch sử"
                      : "Cài đặt"}
            </span>
          </div>
          {page === "project" && project && (
            <button
              className="monitor-chat-link"
              onClick={() => navigate("monitor")}
            >
              {monitor.stale
                ? "Agent · Chưa đồng bộ"
                : monitor.snapshot
                  ? `${monitor.snapshot.agents.filter((a) => a.availability === "occupied").length} role đang làm · Xem đội ngũ`
                  : "Xem đội ngũ"}
            </button>
          )}
          <span className="phase-badge">
            <span />
            Desktop · V1.3B
          </span>
        </header>
        <main className={page === "project" ? "chat-main" : ""}>
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
                <ChatWorkspace
                  key={conversationId ?? "empty"}
                  draftFlush={chatFlush}
                  onInspect={inspect}
                  project={project}
                  status={status}
                  conversationId={conversationId}
                  settings={settings}
                  models={models}
                  runtime={runtime}
                  initialRunId={selectedRun}
                  openRunVersion={openRunVersion}
                  saveSettings={save}
                  setModel={(role, model) => updateAgent(role, { model })}
                  setPermissionMode={(permissionMode) =>
                    setSettings({ ...settings, permissionMode })
                  }
                  onNew={() => void newConversation()}
                  onChooseProject={() => void chooseProject()}
                  onSettings={() => navigate("settings")}
                  onChanged={() => setChatRefresh((n) => n + 1)}
                  onActive={() => void openActive()}
                  onOpenWorkspace={async (project) => {
                    await flushDraft();
                    const data = await value(window.worker.bootstrap());
                    setBoot(data);
                    await selectProject(project);
                  }}
                />
              )}
              {page === "board" &&
                (project ? (
                  <KanbanBoard
                    key={`${project.id}:${boardRunId}`}
                    initialRunId={boardRunId}
                    onInspect={inspect}
                    projectId={project.id}
                    projectName={project.name}
                    onOpenRun={(id, conversation) => {
                      setSelectedRun(id);
                      setConversationId(conversation);
                      void navigate("project");
                    }}
                  />
                ) : (
                  <Empty
                    icon={<Workflow size={28} />}
                    title="Chọn dự án để xem công việc"
                  >
                    <button onClick={() => void chooseProject()}>
                      Chọn dự án
                    </button>
                  </Empty>
                ))}
              {page === "monitor" &&
                (project ? (
                  <AgentMonitor
                    onInspect={inspect}
                    state={monitor}
                    projectName={project.name}
                    onRefresh={() => void monitor.refresh?.()}
                    onSettings={() => navigate("settings")}
                    onOpenRun={(id, conversation) => {
                      setSelectedRun(id);
                      setConversationId(conversation);
                      navigate("project");
                    }}
                  />
                ) : (
                  <Empty
                    icon={<Layers size={28} />}
                    title="Chọn dự án để xem đội ngũ"
                  >
                    <button onClick={() => void chooseProject()}>
                      Chọn dự án
                    </button>
                  </Empty>
                ))}
              {page === "history" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">WORKSPACE</div>
                      <h1>Lịch sử</h1>
                    </div>
                    <span className="pill">
                      {runtime.runs.length} lượt gần nhất
                    </span>
                  </div>
                  <section className="card">
                    <HistoryTools
                      active={!!runtime.activeId}
                      onChanged={() => setChatRefresh((n) => n + 1)}
                    />
                    {!runtime.runs.length ? (
                      <Empty
                        icon={<Clock3 size={28} />}
                        title="Chưa có lượt chạy"
                      >
                        Các bản nháp nằm trong từng dự án.
                      </Empty>
                    ) : (
                      <div className="run-history">
                        {runtime.runs.map((run) => (
                          <button
                            key={run.id}
                            disabled={!!busy}
                            onClick={() =>
                              void act("history", async () => {
                                await flushDraft();
                                const selected = boot.projects.find(
                                  (project) => project.id === run.projectId,
                                );
                                if (selected) {
                                  const opened = await value(
                                    window.worker.openProject(selected.id),
                                  );
                                  setProject(opened);
                                } else setProject(null);
                                setConversationId(run.conversationId ?? null);
                                setSelectedRun(run.id);

                                setPage("project");
                              })
                            }
                          >
                            <div>
                              <strong>{run.prompt.slice(0, 100)}</strong>
                              <small>
                                {run.projectName} · {run.role.toUpperCase()} ·{" "}
                                {new Date(run.createdAt).toLocaleString(
                                  "vi-VN",
                                )}
                              </small>
                            </div>
                            <span className={`run-state ${run.state}`}>
                              {runLabels[run.state]}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
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
                          Quyền thực thi
                          <select
                            value={settings.permissionMode ?? "ask"}
                            disabled={!!busy || !!runtime.activeId}
                            onChange={(event) =>
                              setSettings({
                                ...settings,
                                permissionMode: event.target
                                  .value as Settings["permissionMode"],
                              })
                            }
                          >
                            <option value="ask">Hỏi trước khi chạy</option>
                            <option value="full-access">Full access</option>
                          </select>
                        </label>
                        <p className="muted small">
                          Full access tự duyệt lệnh bằng quyền Windows của bạn.
                          Giữ phạm vi vai trò và giới hạn lượt chạy. Áp dụng cho
                          lượt mới.
                        </p>
                        <label>
                          Thực thi nhóm
                          <select
                            value={settings.teamExecution ?? "sequential"}
                            disabled={!!busy || !!runtime.activeId}
                            onChange={(event) =>
                              setSettings({
                                ...settings,
                                teamExecution: event.target
                                  .value as Settings["teamExecution"],
                              })
                            }
                          >
                            <option value="sequential">Tuần tự</option>
                            <option value="isolated-pair">
                              Hai task độc lập · workspace riêng
                            </option>
                          </select>
                        </label>
                        <p className="muted small">
                          Repo sạch · tích hợp trong workspace riêng · kiểm thử
                          source hợp nhất.
                        </p>
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
                          Timeout và request được chặn theo lượt chạy. Vòng sửa
                          tự động tối đa hai vòng cho toàn bộ yêu cầu.
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
                {runtime.activeId
                  ? "OpenCode đang hoạt động"
                  : "OpenCode 1.19.5 · sẵn sàng cấu hình"}
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
      {inspection && project?.id === inspection.projectId && (
        <TaskInspector
          key={`${inspection.projectId}:${inspection.runId}`}
          selection={inspection}
          activeId={runtime.activeId}
          onClose={() => setInspection(null)}
          onSelect={setInspection}
          onChat={openInspectedChat}
          onBoard={async (runId) => {
            await flushDraft();
            setBoardRunId(runId);
            setInspection(null);
            await navigate("board");
          }}
          onAgents={async () => {
            await flushDraft();
            setInspection(null);
            await navigate("monitor");
          }}
          onOpenWorkspace={openInspectorWorkspace}
        />
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
              Bỏ dự án khỏi danh sách gần đây. Source và lịch sử hội thoại được
              giữ lại.
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
                    await flushDraft();
                    await value(window.worker.removeProject(remove.id));
                    if (project?.id === remove.id) {
                      setProject(null);
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
