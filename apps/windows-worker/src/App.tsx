import { DetailHost } from "./features/DetailHost";
import { WorkItemPanel, type WorkTab } from "./features/WorkItemPanel";
import { Select } from "./ui/Select";
import {
  WorkspaceSidebar,
  WorkspaceHeader,
  type WorkspacePage,
} from "./features/WorkspaceShell";
import { WorkspaceHome } from "./features/WorkspaceHome";
import { Popover } from "./ui/Popover";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  ChevronDown,
  Check,
  CheckCircle2,
  Clock3,
  Code2,
  FolderOpen,
  KeyRound,
  Layers,
  Box,
  LoaderCircle,
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
import { ChatHost } from "./features/ChatHost";
import { AgentMonitor } from "./features/AgentMonitor";
import { OfficeWorkspace } from "./features/OfficeWorkspace";
import { KanbanBoard } from "./features/KanbanBoard";
import { useMonitor } from "./lib/use-monitor";
import { TaskInspector } from "./features/TaskInspector";
import { ProjectOverview } from "./features/ProjectOverview";
import { GlobalInbox } from "./features/GlobalInbox";
import { GitWorkspace } from "./features/GitWorkspace";
import type { InboxItem } from "../shared/inbox";
import type { InspectorSelection } from "../shared/inspector";
import { HistoryTools } from "./features/HistoryTools";
import type { ConversationSummary, WorkChatContext } from "../shared/chat";
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
type Page = WorkspacePage;
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
  const [page, setPage] = useState<Page>("home");
  const [project, setProject] = useState<Project | null>(null);
  const [boardProjects, setBoardProjects] = useState<Project[]>([]);
  const [createRequest, setCreateRequest] = useState<{
    projectId: string;
    version: number;
  } | null>(null);
  const projectChats = useRef(
    new Map<
      string,
      { id: string; context: WorkChatContext | null; runId: string | null }
    >(),
  );
  useEffect(() => {
    if (project)
      setBoardProjects((previous) =>
        previous.some((item) => item.id === project.id)
          ? previous.map((item) => (item.id === project.id ? project : item))
          : [...previous, project],
      );
  }, [project]);
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
  const [runtimeError, setRuntimeError] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chatDock, setChatDock] = useState(false);
  const [chatContext, setChatContext] = useState<WorkChatContext | null>(null);
  const [chatReturnPage, setChatReturnPage] = useState<Page>("board");
  const [conversationSearch, setConversationSearch] = useState("");
  const [chatRefresh, setChatRefresh] = useState(0);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [openRunVersion, setOpenRunVersion] = useState(0);
  const workFlush = useRef<() => Promise<unknown>>(() => Promise.resolve());
  const [workDetail, setWorkDetail] = useState<{
    context: WorkChatContext;
    tab: WorkTab;
    runId?: string;
  } | null>(null);
  const [inspection, setInspection] = useState<InspectorSelection | null>(null);
  const [boardRunId, setBoardRunId] = useState<string | null>(null);
  const [leadFocusVersion, setLeadFocusVersion] = useState(0);
  const [officeRole, setOfficeRole] = useState<Role | null>(null);
  const [officeSelection, setOfficeSelection] =
    useState<InspectorSelection | null>(null);
  const [boardSelection, setBoardSelection] =
    useState<InspectorSelection | null>(null);
  useEffect(() => {
    setWorkDetail((previous) =>
      previous?.context.projectId === project?.id ? previous : null,
    );
    setInspection((previous) =>
      previous?.projectId === project?.id ? previous : null,
    );
    setBoardRunId(null);
    setOfficeRole(null);
    setOfficeSelection(null);
    setBoardSelection(null);
  }, [project?.id]);
  function showWork(context: WorkChatContext, tab: WorkTab, runId?: string) {
    setWorkDetail({ context, tab, runId });
    setChatContext(context);
    setConversationId(context.conversationId);
    setSelectedRun(null);
    setInspection(null);
    setChatDock(false);
  }
  async function openWorkItem(itemId: string, tab: WorkTab = "requirements") {
    if (!project) return;
    await act("detail", async () => {
      await flushDraft();
      const context = await value(
        window.worker.workChat({ projectId: project.id, itemId }),
      );
      showWork(context, tab);
    });
  }
  async function changeWorkTab(tab: WorkTab) {
    await flushDraft();
    setWorkDetail((current) => (current ? { ...current, tab } : null));
  }
  async function closeDetail() {
    await act("detail", async () => {
      await flushDraft();
      if (inspection && workDetail) setInspection(null);
      else {
        setInspection(null);
        setWorkDetail(null);
      }
    });
  }
  function showDetail(selection: InspectorSelection) {
    void act("detail", async () => {
      await flushDraft();
      const context = await value(
        window.worker.workChatForRun({
          projectId: selection.projectId,
          runId: selection.runId,
        }),
      );
      if (context) {
        showWork(
          context,
          selection.initialTab === "result" ? "result" : "progress",
          selection.runId,
        );
        if (selection.taskId || selection.executionId) setInspection(selection);
      } else {
        setWorkDetail(null);
        setChatDock(false);
        setInspection(selection);
      }
    });
  }
  function inspect(
    runId: string,
    taskId?: string | null,
    executionId?: string,
  ) {
    if (!project) return;
    if (workDetail) {
      void act("detail", async () => {
        await flushDraft();
        setInspection({ projectId: project.id, runId, taskId, executionId });
      });
    } else showDetail({ projectId: project.id, runId, taskId, executionId });
  }
  async function openInspectedChat(
    runId: string,
    conversation: string | null,
    questions = false,
  ) {
    await flushDraft();
    const context = project
      ? await value(
          window.worker.workChatForRun({ projectId: project.id, runId }),
        )
      : null;
    if (context) {
      showWork(context, questions ? "requirements" : "discussion", runId);
      return;
    }
    setWorkDetail(null);
    setChatContext(context);
    setChatDock(false);
    setOpenRunVersion((n) => n + 1);
    setSelectedRun(questions ? null : runId);
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
  async function openInboxItem(item: InboxItem) {
    await flushDraft();
    const data = await value(window.worker.bootstrap());
    const selected = data.projects.find((p) => p.id === item.projectId);
    if (!selected)
      throw new Error("Dự án không còn trong danh sách. Cập nhật hộp thư.");
    setBoot(data);
    if (item.runId) {
      const context = await value(
        window.worker.workChatForRun({
          projectId: selected.id,
          runId: item.runId,
        }),
      );
      if (context) {
        setProject(selected);
        showWork(
          context,
          item.kind === "question"
            ? "requirements"
            : item.kind === "report"
              ? "result"
              : "progress",
          item.runId,
        );
        return;
      }
    }
    setWorkDetail(null);
    if (item.kind === "question" && item.runId) {
      const context = await value(
        window.worker.workChatForRun({
          projectId: selected.id,
          runId: item.runId,
        }),
      );
      setChatContext(context);
      setConversationId(context?.conversationId ?? item.conversationId);
      setSelectedRun(null);
      setLeadFocusVersion((n) => n + 1);
    } else if (item.kind === "queue" && item.conversationId) {
      await value(window.worker.conversation(item.conversationId));
      setChatContext(null);
      setConversationId(item.conversationId);
      setSelectedRun(null);
    } else {
      setChatContext(null);
      setConversationId(item.conversationId);
      setSelectedRun(null);
    }
    setProject(selected);
    setChatDock(false);
    if (item.kind === "question" || item.kind === "queue") {
      setInspection(null);
      await navigate("project");
    } else if (item.runId) {
      setInspection({
        projectId: selected.id,
        runId: item.runId,
        ...(item.kind === "report" ? { initialTab: "result" as const } : {}),
      });
    }
  }
  const monitor = useMonitor(
    project && ["overview", "project", "monitor", "office"].includes(page)
      ? project.id
      : null,
    undefined,
    page === "overview",
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
      if (data.projects[0]) await selectProject(data.projects[0], "home");
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
        setRuntimeError(false);
      } catch {
        if (mounted) setRuntimeError(true);
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
    await Promise.all([chatFlush.current(), workFlush.current()]);
  }
  async function selectProject(selected: Project, destination: Page = "board") {
    if (project && conversationId)
      projectChats.current.set(project.id, {
        id: conversationId,
        context: chatContext,
        runId: selectedRun,
      });
    const items = await value(
      window.worker.conversations({ projectId: selected.id }),
    );
    const saved = projectChats.current.get(selected.id);
    const selectedChat =
      items.find((item) => item.id === saved?.id) ??
      items[0] ??
      (await value(window.worker.createConversation(selected.id)));
    setWorkDetail(null);
    setInspection(null);
    setChatDock(false);
    setChatContext(saved?.id === selectedChat.id ? saved.context : null);
    setProject(selected);
    setConversations(items);
    setConversationId(selectedChat.id);
    setPage(destination);
    setSelectedRun(saved?.id === selectedChat.id ? saved.runId : null);
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
      setWorkDetail(null);
      setInspection(null);
      setChatContext(null);
      setChatDock(false);
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
      setWorkDetail(null);
      setInspection(null);
      setProject(selected);
      setConversationId(id);
      setChatContext(null);
      setChatDock(false);
      setSelectedRun(null);
      setPage("project");
    });
  }
  async function openActive() {
    const active = runtime.runs.find((r) => r.id === runtime.activeId);
    if (active?.conversationId) await openConversation(active.conversationId);
    else if (active)
      await act("active", async () => {
        await flushDraft();
        const selected = boot?.projects.find((p) => p.id === active.projectId);
        if (!selected)
          throw new Error("Dự án của lượt chạy không còn trong danh sách.");
        setWorkDetail(null);
        setInspection(null);
        setProject(selected);
        setConversationId(null);
        setChatContext(null);
        setChatDock(false);
        setOpenRunVersion((n) => n + 1);
        setSelectedRun(active.id);
        setPage("project");
      });
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
      if (selected.id === project?.id) {
        setChatDock(false);
        await navigate("board");
        return;
      }
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
    setWorkDetail(null);
    setInspection(null);
    setPage(next);
    setChatDock(false);
  }
  async function createWork() {
    if (!project || ["home", "inbox", "history", "settings"].includes(page)) {
      await navigate("home");
      if (!boot?.projects.length) await chooseProject();
      return;
    }
    await act("create", async () => {
      await flushDraft();
      setChatDock(false);
      setPage("board");
      setCreateRequest({ projectId: project.id, version: Date.now() });
    });
  }
  const modelSelector = (
    model: string,
    change: (id: string) => void,
    label: string,
    disabled = false,
  ) => (
    <Select
      aria-label={label}
      value={model}
      onValueChange={(value) => change(value)}
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
    </Select>
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

  const conversationNavigation = (
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
              conversationId === item.id && page === "project" ? "selected" : ""
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
  );
  return (
    <div className={`app ${compact ? "compact" : ""}`}>
      <WorkspaceSidebar
        page={page}
        project={project}
        projects={boot?.projects ?? []}
        compact={compact}
        busy={!!busy}
        dirty={!!dirty}
        onNavigate={(next) => void navigate(next)}
        onProject={(item) => void openProject(item)}
        onAddProject={() => void chooseProject()}
        onCompact={() => setCompact(!compact)}
      />
      <div className="main-column">
        <WorkspaceHeader
          page={page}
          project={project}
          busy={!!busy}
          onNavigate={(next) => void navigate(next)}
          onCreate={() => void createWork()}
          projectMenu={
            <>
              <Popover
                className="workspace-project"
                label="Dự án"
                icon={
                  <>
                    <span>{project?.name ?? "Chọn dự án"}</span>
                    <ChevronDown size={14} />
                  </>
                }
              >
                <p className="popover-heading">Thông tin dự án</p>
                {project && (
                  <div className="popover-project-details">
                    <span title={project.path}>{project.path}</span>
                    {status?.branch && (
                      <span>
                        <GitBranch size={14} />
                        {status.branch}
                      </span>
                    )}
                    {status?.error && (
                      <span title={status.error}>Chưa đọc được Git</span>
                    )}
                    <button
                      className="subtle"
                      disabled={!!busy}
                      onClick={() => setRemove(project)}
                    >
                      Bỏ khỏi danh sách
                    </button>
                  </div>
                )}
              </Popover>
            </>
          }
          running={
            <>
              {runtimeError ? (
                <span className="muted small">
                  Trạng thái lượt chạy chưa đồng bộ
                </span>
              ) : (
                runtime.activeId && (
                  <button
                    className="workspace-running"
                    onClick={() => void openActive()}
                  >
                    <span className="status-dot" />
                    {runtime.runs.find((r) => r.id === runtime.activeId)
                      ?.projectId === project?.id
                      ? "Đang có lượt chạy"
                      : `Đang chạy ở ${runtime.runs.find((r) => r.id === runtime.activeId)?.projectName ?? "dự án khác"}`}
                  </button>
                )
              )}
            </>
          }
          conversationMenu={
            <Popover
              className="conversation-picker"
              label="Danh sách hội thoại"
              icon={<MessageSquare size={18} />}
            >
              {conversationNavigation}
            </Popover>
          }
        />
        <main
          className={
            page === "overview"
              ? "overview-main"
              : page === "project"
                ? "chat-main"
                : page === "board"
                  ? "board-main"
                  : page === "office"
                    ? "office-main"
                    : ""
          }
        >
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
              {page === "home" && (
                <WorkspaceHome
                  projects={boot.projects}
                  runtime={runtime}
                  runtimeError={runtimeError}
                  busy={!!busy}
                  onProject={(item) => void openProject(item)}
                  onAddProject={() => void chooseProject()}
                  onActive={() => void openActive()}
                  onInbox={() => void navigate("inbox")}
                />
              )}
              {page === "inbox" && <GlobalInbox onOpen={openInboxItem} />}
              {page === "git" &&
                (project ? (
                  <GitWorkspace
                    key={project.id}
                    projectId={project.id}
                    onOpenItem={(id) => void openWorkItem(id)}
                  />
                ) : (
                  <Empty
                    icon={<GitBranch size={28} />}
                    title="Chọn dự án để xem Git"
                  >
                    <button onClick={() => void chooseProject()}>
                      Chọn dự án
                    </button>
                  </Empty>
                ))}
              {page === "overview" &&
                (project ? (
                  <ProjectOverview
                    projectId={project.id}
                    onSettings={() => void navigate("settings")}
                    onReport={(runId) => {
                      if (project)
                        showDetail({
                          projectId: project.id,
                          runId,
                          initialTab: "result",
                        });
                    }}
                    key={project.id}
                    state={monitor}
                    onRefresh={() => void monitor.refresh?.()}
                    onInspect={inspect}
                    onChat={(runId, conversation, questions) =>
                      void act("conversation", () =>
                        openInspectedChat(runId, conversation, questions),
                      )
                    }
                    onConversation={(id) => void openConversation(id)}
                  />
                ) : (
                  <Empty
                    icon={<LayoutDashboard size={28} />}
                    title="Chọn dự án để bắt đầu"
                  >
                    <button onClick={() => void chooseProject()}>
                      Chọn dự án
                    </button>
                  </Empty>
                ))}
              <DetailHost
                active={!!workDetail || !!inspection}
                error={notice?.kind === "error" ? notice.text : undefined}
                label={workDetail?.context.title ?? "Chi tiết công việc"}
                onClose={() => void closeDetail()}
              >
                {workDetail && (
                  <div className="work-document" hidden={!!inspection}>
                    <WorkItemPanel
                      visible={!inspection}
                      key={workDetail.context.itemId}
                      projectId={workDetail.context.projectId}
                      itemId={workDetail.context.itemId}
                      tab={workDetail.tab}
                      onTab={changeWorkTab}
                      selectedRunId={workDetail.runId}
                      draftFlush={workFlush}
                      refreshVersion={chatRefresh}
                      beforeSubmit={save}
                      activeRunId={runtime.activeId}
                      onClose={() => void closeDetail()}
                      onAskLead={() =>
                        void act("detail", () => changeWorkTab("discussion"))
                      }
                      onInspect={inspect}
                      onChanged={() => {
                        setChatRefresh((n) => n + 1);
                        void monitor.refresh?.();
                      }}
                    />
                  </div>
                )}
                <ChatHost
                  key={conversationId ?? "empty"}
                  visible={
                    !inspection &&
                    (workDetail
                      ? workDetail.tab === "discussion"
                      : page === "project" || chatDock)
                  }
                  presentation={
                    workDetail || page === "project" ? "fullscreen" : "dock"
                  }
                  inWorkDetail={!!workDetail}
                  onWorkTab={(tab) =>
                    void act("detail", () => changeWorkTab(tab))
                  }
                  onOpenWork={(runId) =>
                    showDetail({ projectId: project!.id, runId })
                  }
                  workContext={
                    chatContext?.projectId === project?.id &&
                    chatContext?.conversationId === conversationId
                      ? chatContext
                      : null
                  }
                  onClearContext={() => setChatContext(null)}
                  onRefreshContext={async () => {
                    if (project && chatContext)
                      setChatContext(
                        await value(
                          window.worker.workChat({
                            projectId: project.id,
                            itemId: chatContext.itemId,
                          }),
                        ),
                      );
                  }}
                  onExpand={() => {
                    setChatDock(false);
                    setPage("project");
                  }}
                  onDock={() => {
                    setChatDock(true);
                    setPage(chatReturnPage);
                  }}
                  onCloseDock={() =>
                    void act("chat", async () => {
                      await flushDraft();
                      setChatDock(false);
                    })
                  }
                  leadFocusVersion={leadFocusVersion}
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
                {inspection && project?.id === inspection.projectId && (
                  <TaskInspector
                    key={`${inspection.projectId}:${inspection.runId}`}
                    selection={inspection}
                    activeId={runtime.activeId}
                    embedded
                    backLabel={workDetail ? "Quay lại hồ sơ" : undefined}
                    onClose={() => void closeDetail()}
                    onSelect={setInspection}
                    onChat={openInspectedChat}
                    onBoard={async (runId) => {
                      await flushDraft();
                      setBoardRunId(runId);
                      setBoardSelection(inspection);
                      setInspection(null);
                      await navigate("board");
                    }}
                    onAgents={async () => {
                      await flushDraft();
                      setInspection(null);
                      await navigate("monitor");
                    }}
                    onOffice={async (role) => {
                      await flushDraft();
                      setOfficeRole(role);
                      setOfficeSelection(inspection);
                      setInspection(null);
                      await navigate("office");
                    }}
                    onOpenWorkspace={openInspectorWorkspace}
                  />
                )}
              </DetailHost>
              {boardProjects.map((boardProject) => (
                <KanbanBoard
                  visible={page === "board" && project?.id === boardProject.id}
                  key={boardProject.id}
                  initialRunId={
                    project?.id === boardProject.id ? boardRunId : null
                  }
                  createRequest={
                    createRequest?.projectId === boardProject.id
                      ? createRequest.version
                      : 0
                  }
                  showCreateButton={false}
                  onOpenItem={(itemId) => void openWorkItem(itemId)}
                  onInspect={(runId) => {
                    if (boardSelection?.runId === runId)
                      showDetail(boardSelection);
                    else inspect(runId);
                  }}
                  projectId={boardProject.id}
                  projectName={boardProject.name}
                  onOpenRun={(id, conversation) => {
                    if (id)
                      void act("conversation", () =>
                        openInspectedChat(id, conversation),
                      );
                    else void openConversation(conversation!);
                  }}
                />
              ))}
              {page === "board" && !project && (
                <Empty
                  icon={<Workflow size={28} />}
                  title="Chọn dự án để xem công việc"
                >
                  <button onClick={() => void chooseProject()}>
                    Chọn dự án
                  </button>
                </Empty>
              )}
              {page === "monitor" &&
                (project ? (
                  <AgentMonitor
                    onInspect={inspect}
                    state={monitor}
                    projectName={project.name}
                    onRefresh={() => void monitor.refresh?.()}
                    onSettings={() => navigate("settings")}
                    onOpenRun={(id, conversation) => {
                      void act("conversation", () =>
                        openInspectedChat(id, conversation),
                      );
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
              {page === "office" &&
                (project ? (
                  <OfficeWorkspace
                    key={project.id}
                    projectId={project.id}
                    selectedRole={officeRole}
                    selection={officeSelection}
                    onSelectRole={setOfficeRole}
                    onInspect={(selection) => {
                      setOfficeSelection(selection);
                      showDetail(selection);
                    }}
                    onBoard={() => {
                      setBoardRunId(null);
                      setBoardSelection(null);
                      void navigate("board");
                    }}
                    state={monitor}
                    projectName={project.name}
                    onMonitor={() => void navigate("monitor")}
                  />
                ) : (
                  <Empty
                    icon={<Box size={28} />}
                    title="Chọn dự án để mở văn phòng"
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
                          <Select
                            aria-label="Quyền thực thi mặc định"
                            value={settings.permissionMode ?? "ask"}
                            disabled={!!busy || !!runtime.activeId}
                            onValueChange={(value) =>
                              setSettings({
                                ...settings,
                                permissionMode:
                                  value as Settings["permissionMode"],
                              })
                            }
                          >
                            <option value="ask">Hỏi trước khi chạy</option>
                            <option value="full-access">Full access</option>
                          </Select>
                        </label>
                        <p className="muted small">
                          Full access tự duyệt lệnh bằng quyền Windows của bạn.
                          Giữ phạm vi vai trò và giới hạn lượt chạy. Áp dụng cho
                          lượt mới.
                        </p>
                        <label>
                          Thực thi nhóm
                          <Select
                            aria-label="Thực thi nhóm"
                            value={settings.teamExecution ?? "sequential"}
                            disabled={!!busy || !!runtime.activeId}
                            onValueChange={(value) =>
                              setSettings({
                                ...settings,
                                teamExecution:
                                  value as Settings["teamExecution"],
                              })
                            }
                          >
                            <option value="sequential">Tuần tự</option>
                            <option value="isolated-pair">
                              Hai task độc lập · workspace riêng
                            </option>
                          </Select>
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
                            <Select
                              value={settings.maxFixRounds}
                              disabled={!!busy}
                              onValueChange={(value) =>
                                setSettings({
                                  ...settings,
                                  maxFixRounds: Number(value),
                                })
                              }
                            >
                              {[0, 1, 2].map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </Select>
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
        {(busy || runtime.activeId) && (
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
                  {runtime.activeId ? "OpenCode đang hoạt động" : "Sẵn sàng"}
                </>
              )}
            </span>
          </footer>
        )}
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
              <Select
                value={preset}
                onValueChange={(value) => setPreset(value as typeof preset)}
              >
                <option value="fast">Fast</option>
                <option value="balanced">Balanced</option>
                <option value="quality">Quality</option>
              </Select>
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
                    setBoardProjects((items) =>
                      items.filter((item) => item.id !== remove.id),
                    );
                    projectChats.current.delete(remove.id);
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
