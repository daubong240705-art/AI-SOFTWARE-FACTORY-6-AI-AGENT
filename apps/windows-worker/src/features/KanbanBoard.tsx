import { Select } from "../ui/Select";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  boardColumns,
  boardColumnLabels,
  type BoardCard,
  type BoardQuery,
  type BoardPage,
} from "../../shared/board";
import { roles, type Reply, type Role } from "../../shared/contracts";
import { useMonitor } from "../lib/use-monitor";
import { workTemplates, applyWorkTemplate } from "../../shared/templates";
import { BoardAgentTasks } from "./BoardAgentTasks";

async function unwrap<T>(reply: Promise<Reply<T>>) {
  const result = await reply;
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const blank = {
  title: "",
  body: "",
  criteria: "",
  suggestedRole: null as Role | null,
  priority: 0,
  planningState: "backlog" as "backlog" | "ready",
};

export function KanbanBoard({
  projectId,
  onOpenRun,
  onInspect,
  initialRunId,
  visible = true,
  createRequest = 0,
  showCreateButton = true,
  onOpenItem,
}: {
  projectId: string;
  onOpenRun: (runId: string | null, conversationId: string | null) => void;
  onInspect: (runId: string, taskId?: string) => void;
  initialRunId?: string | null;
  visible?: boolean;
  createRequest?: number;
  showCreateButton?: boolean;
  onOpenItem: (itemId: string) => void;
}) {
  const [query, setQuery] = useState<BoardQuery>(
    initialRunId ? { runId: initialRunId, showStopped: true } : {},
  );
  const monitor = useMonitor(visible ? projectId : null, query);
  const [editing, setEditing] = useState<"new" | null>(null);
  const [draft, setDraft] = useState(blank);
  const [template, setTemplate] = useState("");
  const originalTemplate = template
    ? applyWorkTemplate(template)
    : { body: "", criteria: "" };
  const [selected, setSelected] = useState<BoardCard | null>(null);
  const [view, setView] = useState<"board" | "list">("board");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    dialog = useRef<HTMLDialogElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const scrollPositions = useRef(
    new Map<Element, { left: number; top: number }>(),
  );
  const consumedCreate = useRef(0);
  const initialHandled = useRef(false);
  const lastPage = useRef<BoardPage | undefined>(undefined);
  if (monitor.snapshot?.board) lastPage.current = monitor.snapshot.board;
  const page = monitor.snapshot?.board ?? lastPage.current;
  useEffect(() => {
    if (editing && visible) dialog.current?.showModal();
    else dialog.current?.close();
  }, [editing, visible]);
  useEffect(() => {
    if (visible && createRequest && consumedCreate.current !== createRequest) {
      consumedCreate.current = createRequest;
      setDraft(blank);
      setTemplate("");
      setEditing("new");
    }
  }, [createRequest, visible]);
  useLayoutEffect(() => {
    if (visible)
      for (const [element, position] of scrollPositions.current) {
        element.scrollLeft = position.left;
        element.scrollTop = position.top;
      }
  }, [visible]);
  useEffect(() => {
    if (initialRunId) {
      initialHandled.current = false;
      setSelected(null);
      setQuery({ runId: initialRunId, showStopped: true });
    }
  }, [initialRunId]);
  useEffect(() => {
    if (!initialHandled.current && initialRunId && page) {
      const card = page.cards.find((item) => item.runId === initialRunId);
      if (card) {
        initialHandled.current = true;
        if (card.itemId && onOpenItem) onOpenItem(card.itemId);
        else setSelected(card);
      }
    } else if (selected && page)
      setSelected(
        page.cards.find((card) => card.key === selected.key) ?? selected,
      );
  }, [page]);
  async function action(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      await monitor.refresh?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Không thực hiện được thao tác.",
      );
      await monitor.refresh?.();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function filter(patch: Partial<BoardQuery>) {
    setSelected(null);
    setQuery({ ...query, ...patch, offset: 0 });
  }
  function openWorkItem(card: BoardCard) {
    if (card.itemId) onOpenItem(card.itemId);
    else setSelected(card);
  }
  function move(
    card: BoardCard,
    planningState: "backlog" | "ready",
    beforeId?: string,
  ) {
    return action(async () => {
      await unwrap(
        window.worker.moveBoardItem({
          id: card.itemId!,
          version: card.version!,
          planningState,
          beforeId,
        }),
      );
    });
  }
  function drop(event: React.DragEvent, column: string, beforeId?: string) {
    event.preventDefault();
    event.stopPropagation();
    if (!["backlog", "ready"].includes(column) || monitor.stale) return;
    const key = event.dataTransfer.getData("application/x-asf-board");
    const card = page?.cards.find(
      (item) => item.key === key && item.kind === "planning" && !item.archived,
    );
    if (card && card.itemId !== beforeId)
      void move(card, column as "backlog" | "ready", beforeId);
  }
  const stale = monitor.stale;
  const [advancedFilters, setAdvancedFilters] = useState(false);
  const filterCount =
    Number(query.priority !== undefined) +
    Number(!!query.workType) +
    Number(!!query.showStopped) +
    Number(!!query.archived);
  return (
    <section
      ref={workspace}
      onScrollCapture={(event) => {
        if (!visible) return;
        const element = event.target as Element;
        scrollPositions.current.set(element, {
          left: element.scrollLeft,
          top: element.scrollTop,
        });
      }}
      hidden={!visible}
      className={`kanban-workspace ${!visible ? "workspace-hidden" : ""}`}
      aria-label="Kanban công việc"
    >
      <div className="page-heading">
        <div>
          <h1>Công việc</h1>
        </div>
        {showCreateButton && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              setDraft(blank);
              setTemplate("");
              setEditing("new");
            }}
          >
            Thêm việc
          </button>
        )}
      </div>
      {(error || monitor.error) && (
        <div className="notice error" role="alert">
          {error || monitor.error}
        </div>
      )}
      {stale && (
        <div className="notice" role="status">
          Chưa đồng bộ · Đang hiển thị dữ liệu lần cuối
        </div>
      )}
      <div className="board-filters">
        <div className="work-view-switch" aria-label="Kiểu hiển thị công việc">
          <button
            aria-pressed={view === "board"}
            onClick={() => setView("board")}
          >
            Board
          </button>
          <button
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            Danh sách
          </button>
        </div>
        {query.runId && (
          <button onClick={() => filter({ runId: undefined })}>
            Bỏ lọc lượt chạy
          </button>
        )}
        <input
          aria-label="Tìm công việc"
          placeholder="Tìm tiêu đề, task…"
          maxLength={200}
          value={query.search ?? ""}
          onChange={(event) => filter({ search: event.target.value })}
        />
        <Select
          aria-label="Lọc role"
          value={query.role ?? ""}
          onValueChange={(value) =>
            filter({ role: (value || undefined) as Role | undefined })
          }
        >
          <option value="">Mọi role</option>
          {roles.map((role) => (
            <option key={role} value={role}>
              {role.toUpperCase()}
            </option>
          ))}
        </Select>
        <button
          aria-expanded={advancedFilters}
          onClick={() => setAdvancedFilters(!advancedFilters)}
        >
          Bộ lọc{filterCount > 0 ? ` · ${filterCount}` : ""}
        </button>
      </div>
      {advancedFilters && (
        <div className="board-filters board-advanced-filters">
          <Select
            aria-label="Lọc ưu tiên"
            value={query.priority ?? ""}
            onValueChange={(value) =>
              filter({
                priority: value ? Number(value) : undefined,
              })
            }
          >
            <option value="">Mọi ưu tiên</option>
            <option value="0">Thường</option>
            <option value="1">Cao</option>
            <option value="2">Gấp</option>
          </Select>
          <Select
            aria-label="Lọc loại việc"
            value={query.workType ?? ""}
            onValueChange={(value) =>
              filter({
                workType: (value || undefined) as BoardQuery["workType"],
              })
            }
          >
            <option value="">Mọi loại việc</option>
            {[
              "docs",
              "analysis",
              "implementation",
              "bugfix",
              "testing",
              "local-dev",
            ].map((type) => (
              <option key={type}>{type}</option>
            ))}
          </Select>
          <label>
            <input
              type="checkbox"
              checked={!!query.showStopped}
              onChange={(e) => filter({ showStopped: e.target.checked })}
            />{" "}
            Đã dừng / bỏ qua
          </label>
          <label>
            <input
              type="checkbox"
              checked={!!query.archived}
              onChange={(e) => filter({ archived: e.target.checked })}
            />{" "}
            Lưu trữ
          </label>
          <button disabled={busy} onClick={() => void monitor.refresh?.()}>
            Cập nhật
          </button>
        </div>
      )}
      {!page ? (
        <p className="muted">
          {monitor.error ? "Chưa tải được công việc." : "Đang tải công việc…"}
        </p>
      ) : (
        <>
          <div className="board-pagination">
            <span>
              {page.total
                ? `${page.offset + 1}–${Math.min(page.offset + page.pageSize, page.total)} / ${page.total} công việc`
                : "Chưa có công việc"}
            </span>
            <button
              disabled={!page.offset}
              onClick={() =>
                setQuery({
                  ...query,
                  offset: Math.max(0, page.offset - page.pageSize),
                })
              }
            >
              Trước
            </button>
            <button
              disabled={!page.hasMore}
              onClick={() =>
                setQuery({ ...query, offset: page.offset + page.pageSize })
              }
            >
              Sau
            </button>
          </div>
          {view === "list" ? (
            <div
              className="work-list"
              role="region"
              aria-label="Danh sách công việc"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th>Mã</th>
                    <th>Công việc</th>
                    <th>Trạng thái</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {page.cards.map((card) => (
                    <tr key={card.key}>
                      <td>{card.code ?? "—"}</td>
                      <td>
                        <button
                          className="board-card-title"
                          data-work-key={card.key}
                          onClick={() => openWorkItem(card)}
                        >
                          {card.title}
                        </button>
                        <BoardAgentTasks
                          card={card}
                          role={query.role}
                          onInspect={onInspect}
                        />
                      </td>
                      <td>{boardColumnLabels[card.column]}</td>
                      <td>
                        {card.roles
                          .map((role) => role.toUpperCase())
                          .join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div
              className="kanban-columns"
              role="region"
              aria-label="Các cột công việc"
              tabIndex={0}
            >
              {boardColumns.map((column) => (
                <section
                  key={column}
                  className={`kanban-column ${column}`}
                  onDragOver={(e) => {
                    if (["backlog", "ready"].includes(column))
                      e.preventDefault();
                  }}
                  onDrop={(event) => drop(event, column)}
                >
                  <header>
                    <strong>{boardColumnLabels[column]}</strong>
                    <span>
                      {
                        page.cards.filter((card) => card.column === column)
                          .length
                      }
                    </span>
                  </header>
                  {page.cards
                    .filter((card) => card.column === column)
                    .map((card) => (
                      <article
                        key={card.key}
                        className={`board-task ${selected?.key === card.key ? "selected" : ""}`}
                        draggable={
                          card.kind === "planning" &&
                          !card.archived &&
                          !busy &&
                          !stale
                        }
                        onDragStart={(event) => {
                          event.dataTransfer.setData(
                            "application/x-asf-board",
                            card.key,
                          );
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(event) => {
                          if (card.kind === "planning") event.preventDefault();
                        }}
                        onDrop={(event) =>
                          drop(
                            event,
                            column,
                            card.kind === "planning" ? card.itemId! : undefined,
                          )
                        }
                      >
                        <button
                          className="board-card-title"
                          data-work-key={card.key}
                          onClick={() => {
                            openWorkItem(card);
                          }}
                        >
                          {card.code && (
                            <small className="work-code">{card.code}</small>
                          )}
                          {card.title}
                        </button>
                        <div className="board-card-meta">
                          <span>
                            {card.roles
                              .map((role) => role.toUpperCase())
                              .join(" · ")}
                          </span>
                          <span>
                            {card.kind === "planning"
                              ? ["Thường", "Cao", "Gấp"][card.priority]
                              : card.reason}
                          </span>
                        </div>
                        {card.kind === "runtime" && card.progress.tasks > 0 && (
                          <small>
                            {card.progress.verified}/{card.progress.tasks} task
                            xác minh
                            {card.changes ? ` · ${card.changes} file` : ""}
                          </small>
                        )}
                        {card.kind === "planning" && !card.archived && (
                          <div className="board-card-actions">
                            <Select
                              aria-label={`Chuyển ${card.title}`}
                              disabled={busy || stale}
                              value={card.column}
                              onValueChange={(value) =>
                                void move(card, value as "backlog" | "ready")
                              }
                            >
                              <option value="backlog">Chưa làm</option>
                              <option value="ready">Sẵn sàng</option>
                            </Select>
                          </div>
                        )}
                        <BoardAgentTasks
                          card={card}
                          role={query.role}
                          onInspect={onInspect}
                        />
                      </article>
                    ))}
                  {!page.cards.some((card) => card.column === column) && (
                    <p className="column-empty">Trống</p>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}
      {selected && !selected.itemId && (
        <aside className="board-details" aria-label="Chi tiết thẻ">
          <header>
            <strong>{selected.title}</strong>
            <button
              aria-label="Đóng chi tiết thẻ"
              onClick={() => setSelected(null)}
            >
              Đóng
            </button>
          </header>
          <p>{selected.reason || boardColumnLabels[selected.column]}</p>
          {selected.kind === "runtime" && (
            <p>
              {selected.progress.executed}/{selected.progress.tasks} task đã
              thực thi · {selected.progress.verified} xác minh ·{" "}
              {selected.progress.passed}/{selected.progress.criteria} tiêu chí
              đạt
            </p>
          )}
          <div className="board-detail-actions">
            {selected.runId && (
              <button
                disabled={busy || stale}
                onClick={() =>
                  void action(async () => {
                    const item = await unwrap(
                      window.worker.materializeWorkItem({
                        projectId,
                        runId: selected.runId!,
                      }),
                    );
                    setSelected(null);
                    onOpenItem(item.id);
                  })
                }
              >
                Lưu thành công việc
              </button>
            )}
            {selected.runId && (
              <button onClick={() => onInspect(selected.runId!)}>
                Chi tiết công việc
              </button>
            )}
            {selected.runId && (
              <button
                onClick={() =>
                  onOpenRun(selected.runId, selected.conversationId)
                }
              >
                Mở kết quả / task
              </button>
            )}
            {selected.followUpId && (
              <>
                <button
                  disabled={busy || stale || !!monitor.snapshot?.activeRun}
                  onClick={() =>
                    void action(async () => {
                      await unwrap(
                        window.worker.resumeFollowUp(selected.followUpId!),
                      );
                    })
                  }
                >
                  Chạy tiếp
                </button>
                <button
                  disabled={busy || stale}
                  onClick={() =>
                    void action(async () => {
                      await unwrap(
                        window.worker.removeFollowUp(selected.followUpId!),
                      );
                    })
                  }
                >
                  Bỏ khỏi hàng chờ
                </button>
              </>
            )}
            {selected.runId === monitor.snapshot?.activeRun?.id && (
              <button
                disabled={busy || stale}
                title="Dừng tất cả task thuộc lượt chạy này"
                onClick={() =>
                  void action(async () => {
                    await unwrap(window.worker.stopRun(selected.runId!));
                  })
                }
              >
                Dừng lượt chạy
              </button>
            )}
          </div>
        </aside>
      )}
      <dialog
        ref={dialog}
        className="board-editor"
        aria-label="Thẻ công việc"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setEditing(null);
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void action(async () => {
              if (editing === "new")
                await unwrap(
                  window.worker.createBoardItem({
                    projectId,
                    ...draft,
                    criteria: draft.criteria
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }),
                );
              setEditing(null);
            });
          }}
        >
          <h2>{editing === "new" ? "Thêm việc" : "Sửa công việc"}</h2>
          <label>
            Mẫu công việc
            <Select
              aria-label="Mẫu công việc"
              value={template}
              disabled={
                draft.body !== originalTemplate.body ||
                draft.criteria !== originalTemplate.criteria
              }
              onValueChange={(id) => {
                setDraft({
                  ...draft,
                  ...(id ? applyWorkTemplate(id) : { body: "", criteria: "" }),
                });
                setTemplate(id);
              }}
            >
              <option value="">Viết yêu cầu mới</option>
              {workTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Tiêu đề
            <input
              autoFocus
              aria-label="Tiêu đề công việc"
              maxLength={160}
              required
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label>
            Yêu cầu
            <textarea
              aria-label="Yêu cầu công việc"
              rows={7}
              maxLength={12000}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </label>
          <label>
            Tiêu chí hoàn thành · mỗi dòng một tiêu chí
            <textarea
              aria-label="Tiêu chí hoàn thành"
              rows={3}
              maxLength={15030}
              value={draft.criteria}
              onChange={(e) => setDraft({ ...draft, criteria: e.target.value })}
            />
          </label>
          <div className="board-editor-row">
            <label>
              Role gợi ý
              <Select
                aria-label="Role gợi ý"
                value={draft.suggestedRole ?? ""}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    suggestedRole: (value || null) as Role | null,
                  })
                }
              >
                <option value="">Lead tự chọn</option>
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {role.toUpperCase()}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              Ưu tiên
              <Select
                aria-label="Ưu tiên công việc"
                value={draft.priority}
                onValueChange={(value) =>
                  setDraft({ ...draft, priority: Number(value) })
                }
              >
                <option value="0">Thường</option>
                <option value="1">Cao</option>
                <option value="2">Gấp</option>
              </Select>
            </label>
            <label>
              Cột
              <Select
                aria-label="Cột công việc"
                value={draft.planningState}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    planningState: value as "backlog" | "ready",
                  })
                }
              >
                <option value="backlog">Chưa làm</option>
                <option value="ready">Sẵn sàng</option>
              </Select>
            </label>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <footer>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              Hủy
            </button>
            <button className="primary" disabled={busy || !draft.title.trim()}>
              Lưu
            </button>
          </footer>
        </form>
      </dialog>
    </section>
  );
}
