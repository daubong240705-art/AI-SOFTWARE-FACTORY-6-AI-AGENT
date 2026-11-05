import { imageLimits, type ChatImage } from "../../shared/images";
import { ChatImages } from "./ChatImages";
import { Select } from "../ui/Select";
import { Popover } from "../ui/Popover";
import { useCallback, useEffect, useRef, useState } from "react";
import { QuestionCards } from "./QuestionCards";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  FileCode2,
  ImagePlus,
  FolderOpen,
  MoreHorizontal,
  LoaderCircle,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Settings2,
  Square,
  Terminal,
  X,
} from "lucide-react";
import type {
  Project,
  ProjectStatus,
  Reply,
  Role,
  Settings,
} from "../../shared/contracts";
import type { RuntimeView as View } from "../../shared/runs";
import { useRunDetail } from "../lib/use-run-detail";
import { runCapabilities } from "../../shared/inspector";
import { isActive, runLabels } from "../../shared/runs";
import type {
  ChatSend,
  ConversationDetail,
  WorkChatContext,
} from "../../shared/chat";
import { RunPanel } from "./RunPanel";
import { ChatMarkdown } from "./ChatMarkdown";
import { FollowUpCard } from "./FollowUpCard";
import { WorkspaceTools } from "./WorkspaceTools";
import { Workspaces } from "./Workspaces";
async function unwrap<T>(promise: Promise<Reply<T>>): Promise<T> {
  const reply = await promise;
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}
type Props = {
  visible?: boolean;
  presentation?: "fullscreen" | "dock";
  workContext?: WorkChatContext | null;
  onClearContext?: () => void;
  onRefreshContext?: () => Promise<void>;
  onExpand?: () => void;
  onDock?: () => void;
  onCloseDock?: () => void;
  draftFlush: { current: () => Promise<unknown> };
  project: Project | null;
  status: ProjectStatus | null;
  conversationId: string | null;
  settings: Settings;
  models: string[];
  runtime: View;
  initialRunId: string | null;
  openRunVersion?: number;
  leadFocusVersion?: number;
  saveSettings: () => Promise<unknown>;
  setModel: (role: Role, model: string) => void;
  setPermissionMode: (mode: Settings["permissionMode"]) => void;
  onNew: () => void;
  onChooseProject: () => void;
  onSettings: () => void;
  onChanged: () => void;
  onActive: () => void;
  onOpenWorkspace: (project: Project) => Promise<void>;
  onInspect: (runId: string, taskId?: string) => void;
  inWorkDetail?: boolean;
  onWorkTab?: (tab: "requirements" | "progress" | "result") => void;
  onOpenWork?: (runId: string) => void;
};
export function ChatHost({
  visible = true,
  presentation = "fullscreen",
  workContext,
  onClearContext,
  onRefreshContext,
  onExpand,
  onDock,
  onCloseDock,
  draftFlush,
  project,
  conversationId,
  settings,
  models,
  runtime,
  initialRunId,
  openRunVersion,
  leadFocusVersion,
  saveSettings,
  setModel,
  setPermissionMode,
  onNew,
  onChooseProject,
  onSettings,
  onChanged,
  onActive,
  onOpenWorkspace,
  onInspect,
  inWorkDetail = false,
  onWorkTab,
  onOpenWork,
}: Props) {
  const [chat, setChat] = useState<ConversationDetail | null>(null);
  const requestRef = useRef<ChatSend | null>(null);
  const composing = useRef(false);
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const [images, setImages] = useState<ChatImage[]>([]);
  const imagesRef = useRef<ChatImage[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageImportLock = useRef(false);
  const imageWrites = useRef<Promise<unknown>>(Promise.resolve());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const initialized = useRef(false);
  const [earlier, setEarlier] = useState<ConversationDetail["messages"]>([]);
  const [canLoadEarlier, setCanLoadEarlier] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftState, setDraftState] = useState("");
  const [mode, setMode] = useState<"team" | "direct">("team");
  const [role, setRole] = useState<Role>("be");
  useEffect(() => {
    if (leadFocusVersion) {
      setMode("team");
      inputRef.current?.focus();
    }
  }, [leadFocusVersion]);
  const [latestRunId, setLatestRunId] = useState<string | null>(null);
  const [panelRun, setPanelRun] = useState<string | null>(initialRunId);
  const [panel, setPanel] = useState<string | null>(
    initialRunId ? "result" : null,
  );
  const currentFeed = useRunDetail(
    project?.id ?? null,
    visible ? latestRunId : null,
  );
  const panelFeed = useRunDetail(
    project?.id ?? null,
    visible && panel ? (panelRun ?? latestRunId) : null,
  );
  const current = currentFeed.detail,
    panelDetail = panelFeed.detail;
  useEffect(() => {
    if (initialRunId) {
      setPanelRun(initialRunId);
      setPanel("result");
    }
  }, [initialRunId, openRunVersion]);
  const [title, setTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const seenQuestions = useRef(new Set<string>());
  useEffect(() => {
    if (!visible) return;
    const position = savedScroll.current,
      atBottom = nearBottom.current;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = atBottom ? el.scrollHeight : position;
    });
  }, [visible, presentation]);
  const [newContent, setNewContent] = useState(false);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const questionFlushes = useRef(new Map<string, () => Promise<unknown>>());
  const registerQuestionFlush = useCallback(
    (id: string, flush: (() => Promise<unknown>) | null) => {
      if (flush) questionFlushes.current.set(id, flush);
      else questionFlushes.current.delete(id);
    },
    [],
  );
  const actionLock = useRef(false);
  useEffect(() => {
    const flush = () =>
      Promise.all([
        writes.current,
        imageWrites.current,
        ...[...questionFlushes.current.values()].map((fn) => fn()),
      ]);
    draftFlush.current = flush;
    return () => {
      if (draftFlush.current === flush)
        draftFlush.current = () => Promise.resolve();
    };
  }, [draftFlush]);
  const roleForModel = mode === "team" ? "lead" : role;
  const model =
    settings.agents.find((a) => a.role === roleForModel && a.enabled)?.model ??
    "";
  const currentActive = !!current && isActive(current.run.state);
  const activeId = runtime.activeId ?? (currentActive ? current.run.id : null);
  const [copyId, setCopyId] = useState("");
  const [refresh, setRefresh] = useState(0);
  function saveDraft(text: string) {
    if (!conversationId) return;
    setDraftState("Đang lưu…");
    writes.current = writes.current
      .catch(() => {})
      .then(() =>
        unwrap(
          window.worker.saveConversationDraft({
            id: conversationId,
            draft: text,
          }),
        ),
      )
      .then(
        () => setDraftState(""),
        () => {
          setDraftState("Chưa lưu được nháp");
          throw new Error("Chưa lưu được nháp");
        },
      );
    void writes.current.catch(() => {});
  }
  useEffect(() => {
    if (!visible) return;
    if (!conversationId) {
      setLoaded(true);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const detail = await unwrap(
          window.worker.conversation(conversationId!),
        );
        if (!alive) return;
        setChat((previous) => {
          const messages = new Map(
            (previous?.messages ?? []).map((message) => [
              `${message.runId}:${message.role}`,
              message,
            ]),
          );
          for (const message of detail.messages)
            messages.set(`${message.runId}:${message.role}`, message);
          return {
            ...detail,
            messages: [...messages.values()].sort(
              (a, b) => a.sequence - b.sequence,
            ),
          };
        });
        if (!initialized.current) {
          let restoredImages = detail.draftImages ?? [];
          try {
            const raw = localStorage.getItem(
              `asf-chat-pending:${conversationId}`,
            );
            const pending = raw ? (JSON.parse(raw) as ChatSend) : null;
            if (
              pending?.projectId === project?.id &&
              pending?.conversationId === conversationId &&
              pending.prompt === detail.conversation.draft.trim() &&
              pending.imageIds?.length
            ) {
              const available = [
                ...restoredImages,
                ...detail.messages.flatMap((m) => m.images ?? []),
                ...(detail.queue ?? []).flatMap((q) => q.images ?? []),
              ];
              const refs = pending.imageIds.map((id) =>
                available.find((image) => image.id === id),
              );
              if (refs.every((image): image is ChatImage => !!image))
                restoredImages = refs;
            }
          } catch {}
          setImages(restoredImages);
          imagesRef.current = restoredImages;
          setDraft(detail.conversation.draft);
          draftRef.current = detail.conversation.draft;
          setTitle(detail.conversation.title);
          setLoaded(true);
          initialized.current = true;
          setCanLoadEarlier(detail.hasEarlier);
          inputRef.current?.focus();
        }
        const latest = detail.messages.at(-1)?.runId;
        setLatestRunId(latest ?? null);
      } catch (e) {
        if (alive)
          setError(
            e instanceof Error ? e.message : "Không tải được hội thoại.",
          );
      }
      if (alive) timer = setTimeout(() => void poll(), 400);
    }
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [conversationId, refresh, visible]);
  useEffect(() => {
    void currentFeed.refresh?.();
    if (panelRun && panelRun !== latestRunId) void panelFeed.refresh?.();
  }, [refresh]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (nearBottom.current) {
      element.scrollTop = element.scrollHeight;
      setNewContent(false);
    } else setNewContent(true);
  }, [
    chat?.messages
      .map((m) => m.id + ":" + m.content.length + ":" + m.state)
      .join("|"),
  ]);
  const pendingQuestions =
    chat?.questionSets
      ?.filter((set) => set.state === "pending")
      .map((set) => set.id)
      .join(",") ?? "";
  useEffect(() => {
    if (!visible) return;
    const id = pendingQuestions
      .split(",")
      .find((key) => key && !seenQuestions.current.has(key));
    if (!id) return;
    seenQuestions.current.add(id);
    const frame = requestAnimationFrame(() => {
      const card = scrollRef.current?.querySelector<HTMLElement>(
        `[data-question-set="${id}"]`,
      );
      if (card) {
        nearBottom.current = false;
        card.scrollIntoView({ block: "start" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingQuestions, visible]);
  async function action(fn: () => Promise<void>) {
    if (actionLock.current) return false;
    actionLock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Không thực hiện được thao tác.",
      );
      return false;
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  async function attachImages(files: File[]) {
    if (!project || !conversationId || busy || imageImportLock.current) return;
    imageImportLock.current = true;
    const operation = action(async () => {
      if (files.length + imagesRef.current.length > imageLimits.count)
        throw Error("Mỗi tin nhắn tối đa 4 ảnh.");
      for (const file of files) {
        if (!["image/png", "image/jpeg"].includes(file.type))
          throw Error("Chỉ nhận ảnh PNG hoặc JPEG.");
        if (file.size > imageLimits.inputBytes)
          throw Error("Ảnh vượt giới hạn 5 MB.");
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(Error("Không đọc được ảnh."));
          reader.readAsDataURL(file);
        });
        const next = await unwrap(
          window.worker.importChatImage({
            projectId: project.id,
            conversationId,
            name: file.name,
            base64,
          }),
        );
        imagesRef.current = next;
        setImages(next);
        requestRef.current = null;
        try {
          localStorage.removeItem(`asf-chat-pending:${conversationId}`);
        } catch {}
      }
    });
    imageWrites.current = operation;
    try {
      await operation;
    } finally {
      imageImportLock.current = false;
    }
  }
  async function removeImage(image: ChatImage) {
    const operation = action(async () => {
      const next = await unwrap(
        window.worker.removeChatImage({
          projectId: image.projectId,
          conversationId: image.conversationId,
          id: image.id,
        }),
      );
      imagesRef.current = next;
      setImages(next);
      requestRef.current = null;
      try {
        localStorage.removeItem(`asf-chat-pending:${conversationId}`);
      } catch {}
    });
    imageWrites.current = operation;
    await operation;
  }
  async function send() {
    if (busy || !conversationId || !project || !draftRef.current.trim()) return;
    await action(async () => {
      const submitted = draftRef.current.trim();
      const sentImages = imagesRef.current;
      await writes.current;
      await saveSettings();
      const intent = {
        projectId: project.id,
        conversationId,
        prompt: submitted,
        ...(imagesRef.current.length
          ? { imageIds: imagesRef.current.map((image) => image.id) }
          : {}),
        role: roleForModel,
        mode,
        ...(workContext
          ? {
              workContext: {
                itemId: workContext.itemId,
                revision: workContext.revision,
              },
            }
          : {}),
      };
      if (!requestRef.current) {
        try {
          const pending = localStorage.getItem(
            `asf-chat-pending:${conversationId}`,
          );
          if (pending) requestRef.current = JSON.parse(pending) as ChatSend;
        } catch {}
      }
      if (
        !requestRef.current ||
        JSON.stringify({ ...requestRef.current, requestId: undefined }) !==
          JSON.stringify(intent)
      )
        requestRef.current = { ...intent, requestId: crypto.randomUUID() };
      try {
        localStorage.setItem(
          `asf-chat-pending:${conversationId}`,
          JSON.stringify(requestRef.current),
        );
      } catch {}
      const receipt = await unwrap(window.worker.sendChat(requestRef.current));
      if (receipt.state === "removed")
        throw new Error(
          "Tin nhắn này đã bỏ khỏi hàng chờ. Sửa nội dung để gửi lần mới.",
        );
      requestRef.current = null;
      imagesRef.current = [];
      setImages([]);
      try {
        localStorage.removeItem(`asf-chat-pending:${conversationId}`);
      } catch {}
      if (receipt.followUpId) {
        draftRef.current = "";
        setDraft("");
        saveDraft("");
        setRefresh((n) => n + 1);
        onChanged();
        return;
      }
      const runId = receipt.runId!;
      draftRef.current = "";
      setDraft("");
      saveDraft("");
      setChat((c) =>
        c
          ? {
              ...c,
              messages: [
                ...c.messages,
                {
                  sequence: Number.MAX_SAFE_INTEGER - 1,
                  id: runId + "-user",
                  conversationId,
                  role: "user",
                  content: submitted,
                  images: sentImages,
                  runId,
                  state: "queued",
                  createdAt: new Date().toISOString(),
                },
                {
                  sequence: Number.MAX_SAFE_INTEGER,
                  id: runId + "-assistant",
                  conversationId,
                  role: "assistant",
                  content: "",
                  runId,
                  state: "queued",
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : c,
      );
      setLatestRunId(runId);
      setPanelRun(null);
      setRefresh((n) => n + 1);
      nearBottom.current = true;
      onChanged();
      inputRef.current?.focus();
    });
  }
  async function stop() {
    if (!activeId) return;
    await action(async () => {
      await unwrap(window.worker.stopRun(activeId));
      setRefresh((n) => n + 1);
      onChanged();
    });
  }
  async function permission(id: string, allow: boolean) {
    if (!current) return;
    await action(async () => {
      await unwrap(
        window.worker.replyPermission({
          runId: current.run.id,
          requestId: id,
          allow,
        }),
      );
      setRefresh((n) => n + 1);
    });
  }
  function showDetails(runId: string, tab: string) {
    if (inWorkDetail) {
      if (tab === "result") onWorkTab?.("result");
      else onInspect(runId);
      return;
    }
    setPanelRun(runId);
    setPanel(tab);
  }
  const task = current?.run.tasks.find(
    (t) => t.id === current.run.currentTaskId,
  );
  const messages = [
    ...earlier.filter((m) => !chat?.messages.some((n) => n.id === m.id)),
    ...(chat?.messages ?? []),
  ];
  async function loadEarlier() {
    if (!conversationId) return;
    await action(async () => {
      const first = messages[0];
      if (!first) return;
      const beforeHeight = scrollRef.current?.scrollHeight ?? 0;
      const page = await unwrap(
        window.worker.conversation(conversationId, first.sequence),
      );
      setEarlier((items) => [...page.messages, ...items]);
      setCanLoadEarlier(page.hasEarlier);
      requestAnimationFrame(() => {
        const element = scrollRef.current;
        if (element) element.scrollTop += element.scrollHeight - beforeHeight;
      });
    });
  }
  return (
    <div
      hidden={!visible}
      className={`chat-host ${presentation} ${inWorkDetail ? "work-chat" : ""} ${!visible ? "chat-hidden" : ""}`}
      aria-label={
        presentation === "dock" ? "Trò chuyện cạnh công việc" : "Trò chuyện"
      }
    >
      <div
        className={`chat-workspace ${panel && !inWorkDetail ? "with-panel" : ""}`}
      >
        <section className="chat-column">
          <header className="chat-header">
            <div className="chat-heading">
              {renaming ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void action(async () => {
                      if (!conversationId) return;
                      const updated = await unwrap(
                        window.worker.renameConversation({
                          id: conversationId,
                          title: title.trim(),
                        }),
                      );
                      setChat((c) => (c ? { ...c, conversation: updated } : c));
                      setRenaming(false);
                      onChanged();
                    });
                  }}
                >
                  <input
                    aria-label="Tên cuộc trò chuyện"
                    value={title}
                    maxLength={100}
                    onChange={(e) => setTitle(e.target.value)}
                    autoFocus
                  />
                  <button
                    className="icon-button"
                    aria-label="Lưu tên"
                    disabled={busy || !title.trim()}
                  >
                    <Check size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Hủy đổi tên"
                    onClick={() => setRenaming(false)}
                  >
                    <X size={15} />
                  </button>
                </form>
              ) : (
                <button
                  className="chat-title"
                  title="Đổi tên cuộc trò chuyện"
                  disabled={!chat}
                  onClick={() => {
                    setTitle(chat?.conversation.title ?? "");
                    setRenaming(true);
                  }}
                >
                  <span>
                    {chat?.conversation.title ?? "Cuộc trò chuyện mới"}
                  </span>
                  <Pencil size={13} />
                </button>
              )}
            </div>
            <div className="inline">
              {presentation === "dock" ? (
                <>
                  <button onClick={onExpand} aria-label="Mở chat toàn màn hình">
                    Mở rộng
                  </button>
                  <button aria-label="Đóng chat cạnh" onClick={onCloseDock}>
                    <X size={16} />
                  </button>
                </>
              ) : (
                !inWorkDetail &&
                onDock && (
                  <button
                    onClick={onDock}
                    aria-label="Thu chat về cạnh công việc"
                  >
                    Thu gọn
                  </button>
                )
              )}
              <button
                className="icon-button"
                title="Mở thư mục dự án"
                aria-label="Mở thư mục dự án"
                disabled={!project}
                onClick={() =>
                  project &&
                  void action(async () => {
                    await unwrap(window.worker.revealProject(project.id));
                  })
                }
              >
                <FolderOpen size={17} />
              </button>
              <button
                className={panel === "changes" ? "selected" : ""}
                onClick={() => {
                  if (inWorkDetail) {
                    if (current) onInspect(current.run.id);
                    return;
                  }
                  setPanelRun(null);
                  setPanel(panel === "changes" ? null : "changes");
                }}
              >
                <FileCode2 size={15} />
                <span>Thay đổi</span>
                {current?.run.changes.length ? (
                  <span className="pill">{current.run.changes.length}</span>
                ) : null}
              </button>
              <button
                className="icon-button"
                aria-label={panel ? "Đóng chi tiết" : "Mở chi tiết"}
                title="Chi tiết"
                onClick={() => {
                  if (inWorkDetail) onWorkTab?.("progress");
                  else setPanel(panel ? null : "activity");
                }}
              >
                {panel ? (
                  <PanelRightClose size={17} />
                ) : (
                  <PanelRightOpen size={17} />
                )}
              </button>
            </div>
          </header>
          <div className="chat-context" aria-label="Ngữ cảnh gửi Lead">
            <span title={project?.path}>
              {project?.name ?? "Chưa chọn dự án"}
            </span>
            {workContext && (
              <>
                <strong title={workContext.title}>
                  {workContext.code} · v{workContext.revision}
                </strong>
                <Popover
                  label="Thay đổi ngữ cảnh"
                  icon={<MoreHorizontal size={14} />}
                >
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await onRefreshContext?.();
                      })
                    }
                  >
                    Cập nhật yêu cầu
                  </button>
                  {!inWorkDetail && (
                    <button disabled={busy} onClick={onClearContext}>
                      Bỏ ngữ cảnh công việc
                    </button>
                  )}
                </Popover>
              </>
            )}
          </div>
          {runtime.activeId && !currentActive && (
            <div className="chat-banner">
              <LoaderCircle size={14} className="spin" />
              Một cuộc trò chuyện khác đang chạy.
              <button onClick={onActive}>Mở tác vụ</button>
              <button disabled={busy} onClick={() => void stop()}>
                Dừng
              </button>
            </div>
          )}
          <div
            className="chat-scroll"
            ref={scrollRef}
            onScroll={() => {
              const el = scrollRef.current;
              if (el) {
                if (visible) savedScroll.current = el.scrollTop;
                nearBottom.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 90;
                if (nearBottom.current) setNewContent(false);
              }
            }}
          >
            {!loaded ? (
              <div className="chat-empty">
                <LoaderCircle className="spin" size={22} />
              </div>
            ) : !messages.length ? (
              <div className="chat-empty">
                <div className="chat-empty-icon">
                  <MessageSquare size={26} />
                </div>
                <h1>
                  {project
                    ? "Bạn muốn làm gì hôm nay?"
                    : "Bắt đầu với dự án của bạn"}
                </h1>
                {project ? (
                  <span className="muted">{project.name}</span>
                ) : (
                  <button onClick={onChooseProject}>
                    <FolderOpen size={16} />
                    Chọn thư mục dự án
                  </button>
                )}
              </div>
            ) : (
              <div className="chat-transcript">
                {canLoadEarlier && (
                  <button
                    className="load-earlier"
                    disabled={busy}
                    onClick={() => void loadEarlier()}
                  >
                    Xem tin nhắn trước
                  </button>
                )}
                {messages.map((message) => (
                  <article
                    className={`chat-message ${message.role}`}
                    key={message.id}
                  >
                    <div className="message-author">
                      {message.role === "user" ? "Bạn" : "ASF"}
                      {message.role === "user" && (
                        <span className="chat-message-status">
                          {isActive(message.state)
                            ? "Đã lưu · đang xử lý"
                            : message.state === "completed" &&
                                messages.some(
                                  (reply) =>
                                    reply.runId === message.runId &&
                                    reply.role === "assistant" &&
                                    !!reply.content.trim(),
                                )
                              ? "Có phản hồi"
                              : runLabels[message.state]}
                        </span>
                      )}
                      {message.role === "assistant" && (
                        <span className={`run-state ${message.state}`}>
                          {runLabels[message.state]}
                        </span>
                      )}
                    </div>
                    {message.role === "user" ? (
                      <>
                        <div className="user-content">{message.content}</div>
                        <ChatImages images={message.images ?? []} />
                      </>
                    ) : message.content ? (
                      <ChatMarkdown text={message.content} />
                    ) : (
                      <div className="chat-working muted">
                        {isActive(message.state) ? (
                          <>
                            <LoaderCircle className="spin" size={15} />
                            {task
                              ? `${task.role.toUpperCase()} · ${task.title}`
                              : "Đang xử lý yêu cầu…"}
                          </>
                        ) : (
                          runLabels[message.state]
                        )}
                      </div>
                    )}
                    <div className="message-actions">
                      <button
                        className="icon-button"
                        title="Sao chép tin nhắn"
                        aria-label="Sao chép tin nhắn"
                        disabled={!message.content}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              message.content,
                            );
                            setCopyId(message.id);
                            setTimeout(() => setCopyId(""), 1500);
                          } catch {
                            setError("Không sao chép được nội dung.");
                          }
                        }}
                      >
                        {copyId === message.id ? (
                          <Check size={13} />
                        ) : (
                          <Copy size={13} />
                        )}
                      </button>
                      {message.role === "assistant" && (
                        <>
                          <button
                            onClick={() =>
                              inWorkDetail
                                ? onInspect(message.runId)
                                : (onOpenWork ?? onInspect)(message.runId)
                            }
                          >
                            {!inWorkDetail && workContext
                              ? "Mở công việc"
                              : "Chi tiết"}
                          </button>
                          <Popover
                            label="Thao tác tin nhắn"
                            icon={<MoreHorizontal size={15} />}
                          >
                            {message.retryOf && (
                              <button
                                onClick={() =>
                                  showDetails(message.retryOf!, "result")
                                }
                              >
                                Lượt gốc
                              </button>
                            )}
                            {!isActive(message.state) &&
                              !message.integrationId &&
                              message.failureCode !== "integration-pending" &&
                              message.state !== "completed" && (
                                <button
                                  disabled={busy || !!activeId}
                                  title="Tạo lượt mới, kiểm tra lại source và thực hiện yêu cầu"
                                  onClick={() =>
                                    void action(async () => {
                                      await unwrap(
                                        window.worker.retryRun(message.runId),
                                      );
                                      setRefresh((n) => n + 1);
                                      onChanged();
                                    })
                                  }
                                >
                                  Thử lại · lượt mới
                                </button>
                              )}
                            <button
                              onClick={() =>
                                showDetails(message.runId, "activity")
                              }
                            >
                              <Terminal size={13} />
                              Hoạt động
                            </button>
                            <button
                              onClick={() =>
                                showDetails(message.runId, "changes")
                              }
                            >
                              <FileCode2 size={13} />
                              Thay đổi
                            </button>
                          </Popover>
                        </>
                      )}
                      <time>
                        {new Date(message.createdAt).toLocaleTimeString(
                          "vi-VN",
                          {
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )}
                      </time>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {inWorkDetail &&
              chat?.questionSets?.some((set) => set.state === "pending") && (
                <button
                  className="work-question-link"
                  onClick={() => onWorkTab?.("requirements")}
                >
                  Trả lời câu hỏi trong Yêu cầu
                </button>
              )}
            {!inWorkDetail && !!chat?.questionSets?.length && (
              <div className="chat-transcript question-sets">
                {chat.questionSets.map((set) => (
                  <QuestionCards
                    key={set.id}
                    set={set}
                    beforeSubmit={saveSettings}
                    registerFlush={registerQuestionFlush}
                    onChanged={() => {
                      setRefresh((n) => n + 1);
                      onChanged();
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          {newContent && (
            <button
              className="chat-jump"
              onClick={() => {
                nearBottom.current = true;
                scrollRef.current?.scrollTo({
                  top: scrollRef.current.scrollHeight,
                  behavior: "smooth",
                });
                setNewContent(false);
              }}
            >
              <ArrowDown size={14} />
              Tin nhắn mới
            </button>
          )}
          <div className="chat-composer-area">
            {!!chat?.queue?.length && (
              <div className="follow-up-list" aria-label="Hàng chờ yêu cầu">
                {chat.queue.map((item, index) => (
                  <FollowUpCard
                    key={item.id}
                    item={item}
                    busy={busy}
                    active={!!activeId}
                    first={index === 0}
                    onEdit={async (prompt) => {
                      const saved = await action(async () => {
                        await unwrap(
                          window.worker.editFollowUp({ id: item.id, prompt }),
                        );
                        setRefresh((n) => n + 1);
                      });
                      if (!saved) throw new Error("Chưa lưu được yêu cầu.");
                    }}
                    onRemove={() =>
                      void action(async () => {
                        await unwrap(window.worker.removeFollowUp(item.id));
                        setRefresh((n) => n + 1);
                      })
                    }
                    onResume={() =>
                      void action(async () => {
                        await unwrap(window.worker.resumeFollowUp(item.id));
                        setRefresh((n) => n + 1);
                        onChanged();
                      })
                    }
                  />
                ))}
              </div>
            )}
            {error && (
              <div className="chat-error" role="alert">
                <span>{error}</span>
                <button
                  className="icon-button"
                  aria-label="Đóng lỗi"
                  onClick={() => setError("")}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            {(currentFeed.error || currentFeed.stale) && (
              <p role="status" className="notice">
                {currentFeed.error ||
                  "Chưa đồng bộ · Trạng thái lượt chạy lần cuối"}
              </p>
            )}
            {current?.run.permissions.map((p) => (
              <div className="chat-permission" key={p.id}>
                <strong>
                  {p.taskId ? `${p.taskId} · ` : ""}Cho phép {p.permission} một
                  lần?
                </strong>
                <pre>{p.patterns.join("\n")}</pre>
                <div className="inline">
                  <button
                    disabled={busy || currentFeed.stale || !!currentFeed.error}
                    onClick={() => void permission(p.id, false)}
                  >
                    Từ chối
                  </button>
                  <button
                    className="primary"
                    disabled={busy || currentFeed.stale || !!currentFeed.error}
                    onClick={() => void permission(p.id, true)}
                  >
                    Cho phép
                  </button>
                </div>
              </div>
            ))}
            <div className="chat-composer">
              <ChatImages
                images={images}
                onRemove={(image) => void removeImage(image)}
                disabled={busy}
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                multiple
                hidden
                onChange={(event) => {
                  void attachImages(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <textarea
                ref={inputRef}
                aria-label="Nhắn tin cho agent"
                placeholder={
                  project
                    ? "Nhắn cho Lead hoặc giao việc…"
                    : "Chọn dự án để bắt đầu"
                }
                value={draft}
                maxLength={32000}
                disabled={!project || !conversationId || !loaded || busy}
                rows={3}
                onChange={(e) => {
                  const text = e.target.value;
                  draftRef.current = text;
                  setDraft(text);
                  saveDraft(text);
                }}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData.files);
                  if (files.length) {
                    event.preventDefault();
                    void attachImages(files);
                  }
                }}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={() => {
                  composing.current = false;
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    !composing.current &&
                    event.keyCode !== 229
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="chat-composer-controls">
                <div className="chat-options">
                  <button
                    className="icon-button"
                    aria-label="Đính kèm ảnh"
                    title="PNG/JPEG · Tối đa 4 ảnh · Model cần hỗ trợ ảnh"
                    disabled={
                      busy ||
                      !loaded ||
                      !conversationId ||
                      images.length >= imageLimits.count
                    }
                    onClick={() => fileRef.current?.click()}
                  >
                    <ImagePlus size={16} />
                  </button>
                  <Select
                    aria-label="Chế độ thực thi"
                    value={mode}
                    onValueChange={(value) =>
                      setMode(value as "team" | "direct")
                    }
                    disabled={busy || !!activeId}
                  >
                    <option value="team">Lead</option>
                    <option value="direct">Một agent</option>
                  </Select>
                  {mode === "direct" && (
                    <Select
                      aria-label="Vai trò thực thi"
                      value={role}
                      onValueChange={(value) => setRole(value as Role)}
                      disabled={busy || !!activeId}
                    >
                      {settings.agents
                        .filter((a) => a.enabled)
                        .map((a) => (
                          <option key={a.role} value={a.role}>
                            {a.role.toUpperCase()}
                          </option>
                        ))}
                    </Select>
                  )}
                  <Select
                    aria-label={`Model ${roleForModel.toUpperCase()}`}
                    title={model || "Chọn model"}
                    value={model}
                    onValueChange={(value) => setModel(roleForModel, value)}
                    disabled={busy || !!activeId}
                  >
                    <option value="">Chọn model</option>
                    {[...new Set([model, ...models])]
                      .filter(Boolean)
                      .map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                  </Select>
                  <Select
                    aria-label="Quyền thực thi"
                    title="Full access tự duyệt lệnh bằng quyền Windows của bạn. Giữ phạm vi vai trò và giới hạn lượt chạy."
                    value={settings.permissionMode ?? "ask"}
                    onValueChange={(value) =>
                      setPermissionMode(value as Settings["permissionMode"])
                    }
                    disabled={busy || !!activeId}
                  >
                    <option value="ask">Hỏi trước khi chạy</option>
                    <option value="full-access">Full access</option>
                  </Select>
                  <button
                    className="icon-button"
                    aria-label="Cấu hình đội agent"
                    title="Đội agent và giới hạn"
                    onClick={onSettings}
                  >
                    <Settings2 size={15} />
                  </button>
                </div>
                {activeId ? (
                  <button
                    className="chat-send stop"
                    title="Dừng tác vụ"
                    aria-label="Dừng tác vụ"
                    disabled={busy}
                    onClick={() => void stop()}
                  >
                    <Square size={16} fill="currentColor" />
                  </button>
                ) : null}
                {
                  <button
                    className="chat-send primary"
                    title={activeId ? "Thêm vào hàng chờ" : "Gửi yêu cầu"}
                    aria-label={activeId ? "Thêm vào hàng chờ" : "Gửi yêu cầu"}
                    disabled={
                      busy ||
                      !project ||
                      !conversationId ||
                      !loaded ||
                      !draft.trim() ||
                      !model
                    }
                    onClick={() => void send()}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <ArrowUp size={19} />
                    )}
                  </button>
                }
              </div>
            </div>
            <div className="chat-composer-note">
              <span>
                {draftState ||
                  (activeId
                    ? "Enter thêm hàng chờ · Shift+Enter xuống dòng"
                    : "Enter gửi · Shift+Enter xuống dòng")}
              </span>
              {project && !conversationId && (
                <button onClick={onNew}>Tạo hội thoại</button>
              )}
            </div>
          </div>
        </section>
        {panel && !inWorkDetail && (
          <aside className="chat-detail-panel">
            <div className="chat-detail-header">
              <div
                className="tabs"
                role="tablist"
                aria-label="Chi tiết lượt chạy"
              >
                {[
                  ["result", "Kết quả"],
                  ["changes", "Thay đổi"],
                  ["activity", "Hoạt động"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={panel === id}
                    className={panel === id ? "selected" : ""}
                    onClick={() => setPanel(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Popover
                label="Công cụ dự án"
                icon={<MoreHorizontal size={16} />}
              >
                <button
                  className={panel === "tools" ? "selected" : ""}
                  onClick={() => setPanel("tools")}
                >
                  Chạy local
                </button>
                <button
                  className={panel === "workspaces" ? "selected" : ""}
                  onClick={() => setPanel("workspaces")}
                >
                  Workspace
                </button>
              </Popover>
              <button
                className="icon-button"
                aria-label="Đóng panel chi tiết"
                onClick={() => setPanel(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="chat-detail-body">
              {(panelFeed.error || panelFeed.stale) && (
                <p role="status" className="notice">
                  {panelFeed.error || "Chưa đồng bộ · Chi tiết lần cuối"}
                </p>
              )}
              {panel === "workspaces" && project ? (
                <Workspaces
                  key={project.id}
                  projectId={project.id}
                  integrationId={panelDetail?.run.integration?.origin.id}
                  active={!!activeId}
                  onOpen={onOpenWorkspace}
                />
              ) : panel === "tools" && project ? (
                <WorkspaceTools
                  key={project.id}
                  projectId={project.id}
                  active={!!activeId}
                />
              ) : (
                <RunPanel
                  detail={panelDetail}
                  onInspect={onInspect}
                  showRecovery={
                    !!panelDetail &&
                    runCapabilities(panelDetail.run, activeId).recovery &&
                    !panelFeed.stale &&
                    !panelFeed.error
                  }
                  onOpenWorkspace={onOpenWorkspace}
                  tab={panel}
                  busy={busy || panelFeed.stale || !!panelFeed.error}
                  showPermissions={false}
                  onPermission={() => {}}
                />
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
