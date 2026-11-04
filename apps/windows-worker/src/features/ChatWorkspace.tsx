import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  FileCode2,
  FolderOpen,
  GitBranch,
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
import type { RuntimeView as View, RunDetail } from "../../shared/runs";
import { isActive, runLabels } from "../../shared/runs";
import type { ConversationDetail } from "../../shared/chat";
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
  draftFlush: { current: () => Promise<unknown> };
  project: Project | null;
  status: ProjectStatus | null;
  conversationId: string | null;
  settings: Settings;
  models: string[];
  runtime: View;
  initialRunId: string | null;
  saveSettings: () => Promise<unknown>;
  setModel: (role: Role, model: string) => void;
  setPermissionMode: (mode: Settings["permissionMode"]) => void;
  onNew: () => void;
  onChooseProject: () => void;
  onSettings: () => void;
  onChanged: () => void;
  onActive: () => void;
  onOpenWorkspace: (project: Project) => Promise<void>;
};
export function ChatWorkspace({
  draftFlush,
  project,
  status,
  conversationId,
  settings,
  models,
  runtime,
  initialRunId,
  saveSettings,
  setModel,
  setPermissionMode,
  onNew,
  onChooseProject,
  onSettings,
  onChanged,
  onActive,
  onOpenWorkspace,
}: Props) {
  const [chat, setChat] = useState<ConversationDetail | null>(null);
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const initialized = useRef(false);
  const [earlier, setEarlier] = useState<ConversationDetail["messages"]>([]);
  const [canLoadEarlier, setCanLoadEarlier] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftState, setDraftState] = useState("");
  const [mode, setMode] = useState<"team" | "direct">("team");
  const [role, setRole] = useState<Role>("be");
  const [current, setCurrent] = useState<RunDetail | null>(null);
  const [panelRun, setPanelRun] = useState<string | null>(initialRunId);
  const [panelDetail, setPanelDetail] = useState<RunDetail | null>(null);
  const [panel, setPanel] = useState<string | null>(
    initialRunId ? "result" : null,
  );
  const [title, setTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const [newContent, setNewContent] = useState(false);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const actionLock = useRef(false);
  useEffect(() => {
    const flush = () => writes.current;
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
          setDraft(detail.conversation.draft);
          draftRef.current = detail.conversation.draft;
          setTitle(detail.conversation.title);
          setLoaded(true);
          initialized.current = true;
          setCanLoadEarlier(detail.hasEarlier);
          inputRef.current?.focus();
        }
        const latest = detail.messages.at(-1)?.runId;
        if (latest) {
          const run = await unwrap(window.worker.runDetail(latest));
          if (alive) setCurrent(run);
        } else if (alive) setCurrent(null);
        const selected = panelRun ?? latest;
        if (selected) {
          const run = await unwrap(window.worker.runDetail(selected));
          if (alive) setPanelDetail(run);
        } else if (alive) setPanelDetail(null);
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
  }, [conversationId, panelRun, refresh]);
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
  async function send() {
    if (busy || !conversationId || !project || !draftRef.current.trim()) return;
    await action(async () => {
      const submitted = draftRef.current.trim();
      await writes.current;
      await saveSettings();
      if (activeId || chat?.queue?.length) {
        await unwrap(
          window.worker.enqueue({
            projectId: project.id,
            conversationId,
            prompt: submitted,
            role: roleForModel,
            mode,
          }),
        );
        draftRef.current = "";
        setDraft("");
        saveDraft("");
        setRefresh((n) => n + 1);
        return;
      }
      const run = await unwrap(
        window.worker.startRun({
          projectId: project.id,
          conversationId,
          prompt: submitted,
          role: roleForModel,
          mode,
        }),
      );
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
                  id: run.id + "-user",
                  conversationId,
                  role: "user",
                  content: submitted,
                  runId: run.id,
                  state: run.state,
                  createdAt: run.createdAt,
                },
                {
                  sequence: Number.MAX_SAFE_INTEGER,
                  id: run.id + "-assistant",
                  conversationId,
                  role: "assistant",
                  content: "",
                  runId: run.id,
                  state: run.state,
                  createdAt: run.createdAt,
                },
              ],
            }
          : c,
      );
      setCurrent({ run, events: [] });
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
    <div className={`chat-workspace ${panel ? "with-panel" : ""}`}>
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
                <span>{chat?.conversation.title ?? "Cuộc trò chuyện mới"}</span>
                <Pencil size={13} />
              </button>
            )}
            <div className="chat-project muted small">
              <span title={project?.path}>
                {project?.name ?? "Chưa chọn dự án"}
              </span>
              {status?.branch && (
                <>
                  <GitBranch size={12} />
                  <span>{status.branch}</span>
                </>
              )}
            </div>
          </div>
          <div className="inline">
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
              onClick={() => setPanel(panel ? null : "activity")}
            >
              {panel ? (
                <PanelRightClose size={17} />
              ) : (
                <PanelRightOpen size={17} />
              )}
            </button>
          </div>
        </header>
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
                    {message.role === "assistant" && (
                      <span className={`run-state ${message.state}`}>
                        {runLabels[message.state]}
                      </span>
                    )}
                  </div>
                  {message.role === "user" ? (
                    <div className="user-content">{message.content}</div>
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
                          await navigator.clipboard.writeText(message.content);
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
                          onClick={() => showDetails(message.runId, "activity")}
                        >
                          <Terminal size={13} />
                          Hoạt động
                        </button>
                        <button
                          onClick={() => showDetails(message.runId, "changes")}
                        >
                          <FileCode2 size={13} />
                          Thay đổi
                        </button>
                      </>
                    )}
                    <time>
                      {new Date(message.createdAt).toLocaleTimeString("vi-VN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                </article>
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
          {current?.run.permissions.map((p) => (
            <div className="chat-permission" key={p.id}>
              <strong>
                {p.taskId ? `${p.taskId} · ` : ""}Cho phép {p.permission} một
                lần?
              </strong>
              <pre>{p.patterns.join("\n")}</pre>
              <div className="inline">
                <button
                  disabled={busy}
                  onClick={() => void permission(p.id, false)}
                >
                  Từ chối
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void permission(p.id, true)}
                >
                  Cho phép
                </button>
              </div>
            </div>
          ))}
          <div className="chat-composer">
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
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="chat-composer-controls">
              <div className="chat-options">
                <select
                  aria-label="Chế độ thực thi"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "team" | "direct")}
                  disabled={busy || !!activeId}
                >
                  <option value="team">Lead</option>
                  <option value="direct">Một agent</option>
                </select>
                {mode === "direct" && (
                  <select
                    aria-label="Vai trò thực thi"
                    value={role}
                    onChange={(e) => setRole(e.target.value as Role)}
                    disabled={busy || !!activeId}
                  >
                    {settings.agents
                      .filter((a) => a.enabled)
                      .map((a) => (
                        <option key={a.role} value={a.role}>
                          {a.role.toUpperCase()}
                        </option>
                      ))}
                  </select>
                )}
                <select
                  aria-label={`Model ${roleForModel.toUpperCase()}`}
                  title={model || "Chọn model"}
                  value={model}
                  onChange={(e) => setModel(roleForModel, e.target.value)}
                  disabled={busy || !!activeId}
                >
                  <option value="">Chọn model</option>
                  {[...new Set([model, ...models])].filter(Boolean).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Quyền thực thi"
                  title="Full access tự duyệt lệnh bằng quyền Windows của bạn. Giữ phạm vi vai trò và giới hạn lượt chạy."
                  value={settings.permissionMode ?? "ask"}
                  onChange={(e) =>
                    setPermissionMode(
                      e.target.value as Settings["permissionMode"],
                    )
                  }
                  disabled={busy || !!activeId}
                >
                  <option value="ask">Hỏi trước khi chạy</option>
                  <option value="full-access">Full access</option>
                </select>
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
      {panel && (
        <aside className="chat-detail-panel">
          <div className="chat-detail-header">
            <div
              className="tabs"
              role="tablist"
              aria-label="Chi tiết lượt chạy"
            >
              {[
                ["activity", "Hoạt động"],
                ["changes", "Thay đổi"],
                ["result", "Kết quả"],
                ["tools", "Chạy local"],
                ["workspaces", "Workspace"],
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
            <button
              className="icon-button"
              aria-label="Đóng panel chi tiết"
              onClick={() => setPanel(null)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="chat-detail-body">
            {panel === "workspaces" && project ? (
              <Workspaces
                key={project.id}
                projectId={project.id}
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
                tab={panel}
                busy={busy}
                showPermissions={false}
                onPermission={() => {}}
              />
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
