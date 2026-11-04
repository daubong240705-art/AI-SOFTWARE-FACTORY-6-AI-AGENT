import { useEffect, useRef, useState } from "react";
import type {
  BoardItem,
  WorkItemDetail,
  WorkRevision,
} from "../../shared/board";
import { roles, type Reply, type Role } from "../../shared/contracts";
import { ChatMarkdown } from "./ChatMarkdown";
import { Select } from "../ui/Select";
import { runLabels, type RunState } from "../../shared/runs";

async function value<T>(promise: Promise<Reply<T>>) {
  const reply = await promise;
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}
const date = (at: string) => new Date(at).toLocaleString("vi-VN");

export function WorkItemPanel({
  projectId,
  itemId,
  onClose,
  onInspect,
  onConversation,
  onChanged,
  activeRunId,
  onAskLead,
}: {
  projectId: string;
  itemId: string;
  onClose: () => void;
  onInspect: (id: string) => void;
  onConversation: (runId: string | null, conversationId: string | null) => void;
  onChanged: () => void;
  activeRunId: string | null;
  onAskLead?: (itemId: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<WorkItemDetail | null>(null);
  const [tab, setTab] = useState("overview");
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<{
    title: string;
    body: string;
    criteria: string;
    version: number;
    suggestedRole: Role | null;
    priority: number;
  } | null>(null);
  const [comment, setComment] = useState("");
  const commentRequest = useRef<{ body: string; id: string } | null>(null);
  const submissionRequest = useRef<{ version: number; key: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [revision, setRevision] = useState<WorkRevision | null>(null);
  const ref = { projectId, itemId };
  async function load() {
    const next = await value(window.worker.workItemDetail(ref));
    setDetail(next);
    return next;
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    let live = true;
    void value(window.worker.workItemDetail({ projectId, itemId }))
      .then((next) => {
        if (live) setDetail(next);
      })
      .catch((e) => {
        if (live) setError(String(e.message));
      });
    return () => {
      live = false;
      dialog.current?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [projectId, itemId]);
  async function act(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Không thực hiện được thao tác.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function edit(item: BoardItem) {
    setDraft({
      title: item.title,
      body: item.body,
      criteria: item.criteria.join("\n"),
      version: item.version,
      suggestedRole: item.suggestedRole,
      priority: item.priority,
    });
  }
  const item = detail?.item;
  const pending = detail?.submissions.some(
    (s) =>
      !!s.followUpId ||
      s.attempts.some(
        (a) =>
          a.id === s.currentRunId &&
          ["queued", "running", "blocked", "cancelling"].includes(a.state),
      ),
  );
  return (
    <dialog
      ref={dialog}
      className={`work-item-panel ${expanded ? "expanded" : ""}`}
      aria-label="Hồ sơ công việc"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="work-panel-header">
        <div>
          <small>
            {item?.code ?? "Công việc"}
            {item ? ` · v${item.revision}` : ""}
          </small>
          <h2>{item?.title ?? "Đang tải…"}</h2>
        </div>
        <button
          aria-label={expanded ? "Thu gọn hồ sơ" : "Mở rộng hồ sơ"}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Thu gọn" : "Mở rộng"}
        </button>
        <button disabled={busy} onClick={onClose} aria-label="Đóng hồ sơ">
          Đóng
        </button>
      </header>
      <nav className="work-panel-tabs" aria-label="Nội dung hồ sơ">
        {[
          ["overview", "Tổng quan"],
          ["discussion", "Trao đổi"],
          ["executions", "Lần thực hiện"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
        <button
          disabled={busy}
          className="work-panel-refresh"
          onClick={() =>
            void act(async () => {
              await load();
            })
          }
        >
          Cập nhật
        </button>
      </nav>
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await load();
              })
            }
          >
            Tải lại dữ liệu
          </button>
        </div>
      )}
      <div className="work-panel-content" aria-busy={busy}>
        {!detail ? (
          <p>Đang tải hồ sơ…</p>
        ) : tab === "overview" ? (
          <>
            {draft ? (
              <form
                className="work-item-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    await value(
                      window.worker.updateBoardItem({
                        id: itemId,
                        version: draft.version,
                        patch: {
                          title: draft.title,
                          body: draft.body,
                          suggestedRole: draft.suggestedRole,
                          priority: draft.priority,
                          criteria: draft.criteria
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        },
                      }),
                    );
                    setDraft(null);
                    submissionRequest.current = null;
                    await load();
                  });
                }}
              >
                <label>
                  Tiêu đề
                  <input
                    required
                    maxLength={160}
                    value={draft.title}
                    onChange={(e) =>
                      setDraft({ ...draft, title: e.target.value })
                    }
                  />
                </label>
                <label>
                  Yêu cầu
                  <textarea
                    rows={7}
                    maxLength={12000}
                    value={draft.body}
                    onChange={(e) =>
                      setDraft({ ...draft, body: e.target.value })
                    }
                  />
                </label>
                <label>
                  Tiêu chí hoàn thành · mỗi dòng một tiêu chí
                  <textarea
                    rows={4}
                    maxLength={15030}
                    value={draft.criteria}
                    onChange={(e) =>
                      setDraft({ ...draft, criteria: e.target.value })
                    }
                  />
                </label>
                <details>
                  <summary>Tùy chọn giao việc</summary>
                  <div className="board-editor-row">
                    <label>
                      Role gợi ý
                      <Select
                        aria-label="Role gợi ý trong hồ sơ"
                        value={draft.suggestedRole ?? ""}
                        onValueChange={(role) =>
                          setDraft({
                            ...draft,
                            suggestedRole: (role || null) as Role | null,
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
                        aria-label="Ưu tiên trong hồ sơ"
                        value={draft.priority}
                        onValueChange={(priority) =>
                          setDraft({ ...draft, priority: Number(priority) })
                        }
                      >
                        <option value="0">Thường</option>
                        <option value="1">Cao</option>
                        <option value="2">Gấp</option>
                      </Select>
                    </label>
                  </div>
                </details>
                <div className="work-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDraft(null)}
                  >
                    Hủy sửa
                  </button>
                  <button
                    className="primary"
                    disabled={busy || !draft.title.trim()}
                  >
                    Lưu phiên bản
                  </button>
                </div>
                <small>
                  Sửa yêu cầu tạo phiên bản mới. Khi xung đột, tải lại để đối
                  chiếu; bản nháp được giữ nguyên.
                </small>
                {draft.version !== detail.item.version && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setDraft({ ...draft, version: detail.item.version })
                    }
                  >
                    Dùng bản nháp trên dữ liệu v{detail.item.version}
                  </button>
                )}
              </form>
            ) : (
              <>
                <ChatMarkdown text={detail.item.body || "Chưa có mô tả."} />
                {detail.item.criteria.length > 0 && (
                  <section>
                    <h3>Tiêu chí hoàn thành</h3>
                    <ul>
                      {detail.item.criteria.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </section>
                )}
                <div className="work-actions">
                  {onAskLead && !detail.item.archivedAt && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        onClose();
                        onAskLead(itemId);
                      }}
                    >
                      Hỏi Lead
                    </button>
                  )}
                  {!detail.item.archivedAt &&
                    detail.submissions.every((s) => s.state === "removed") && (
                      <Select
                        aria-label="Trạng thái kế hoạch"
                        value={detail.item.planningState}
                        disabled={busy}
                        onValueChange={(state) =>
                          void act(async () => {
                            await value(
                              window.worker.moveBoardItem({
                                id: itemId,
                                version: detail.item.version,
                                planningState: state as "backlog" | "ready",
                              }),
                            );
                            await load();
                          })
                        }
                      >
                        <option value="backlog">Chưa làm</option>
                        <option value="ready">Sẵn sàng</option>
                      </Select>
                    )}
                  {!detail.item.archivedAt && (
                    <button disabled={busy} onClick={() => edit(detail.item)}>
                      Sửa yêu cầu
                    </button>
                  )}
                  {!detail.item.archivedAt && (
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        pending ||
                        (detail.item.planningState !== "ready" &&
                          !detail.submissions.length)
                      }
                      onClick={() =>
                        void act(async () => {
                          if (
                            !submissionRequest.current ||
                            submissionRequest.current.version !==
                              detail.item.version
                          )
                            submissionRequest.current = {
                              version: detail.item.version,
                              key: crypto.randomUUID(),
                            };
                          await value(
                            window.worker.submitBoardItem({
                              id: itemId,
                              version: detail.item.version,
                              submissionKey: submissionRequest.current.key,
                            }),
                          );
                          await load();
                        })
                      }
                    >
                      {pending
                        ? detail.submissions.some((s) => !!s.followUpId)
                          ? "Đang chờ"
                          : "Đang thực hiện"
                        : "Gửi Lead"}
                    </button>
                  )}
                  <button
                    disabled={busy || pending}
                    onClick={() =>
                      void act(async () => {
                        await value(
                          window.worker.archiveBoardItem({
                            id: itemId,
                            version: detail.item.version,
                            archived: !detail.item.archivedAt,
                          }),
                        );
                        await load();
                      })
                    }
                  >
                    {detail.item.archivedAt ? "Khôi phục" : "Lưu trữ"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await value(window.worker.exportWorkItem(ref));
                      })
                    }
                  >
                    Xuất hồ sơ
                  </button>
                </div>
              </>
            )}
            <details
              className="work-revisions"
              open={revision ? true : undefined}
            >
              <summary>
                Lịch sử yêu cầu · {detail.item.revision} phiên bản
              </summary>
              <div className="work-actions">
                {detail.revisions.map((r) => (
                  <button
                    key={r.revision}
                    aria-pressed={revision?.revision === r.revision}
                    onClick={() => setRevision(r)}
                  >
                    v{r.revision}
                    {r.origin === "legacy" ? " · dữ liệu cũ" : ""}
                  </button>
                ))}
              </div>
              {detail.hasEarlierRevisions && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const page = await value(
                        window.worker.workItemDetail({
                          ...ref,
                          before: detail.revisions.at(-1)!.revision,
                        }),
                      );
                      setDetail({
                        ...detail,
                        revisions: [...detail.revisions, ...page.revisions],
                        hasEarlierRevisions: page.hasEarlierRevisions,
                      });
                    })
                  }
                >
                  Phiên bản trước
                </button>
              )}
              {revision && (
                <article className="work-revision">
                  <small>
                    v{revision.revision} · {date(revision.createdAt)}
                  </small>
                  <h3>{revision.title}</h3>
                  <ChatMarkdown text={revision.body} />
                  <ul>
                    {revision.criteria.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </article>
              )}
            </details>
          </>
        ) : tab === "discussion" ? (
          <>
            <p className="muted">
              Ghi chú được lưu trong hồ sơ. Gửi Lead từ Tổng quan để thực hiện
              yêu cầu.
            </p>
            {detail.hasEarlierComments && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const page = await value(
                      window.worker.workItemComments({
                        ...ref,
                        before: detail.comments.at(-1)!.sequence,
                      }),
                    );
                    setDetail({
                      ...detail,
                      comments: [...detail.comments, ...page.comments],
                      hasEarlierComments: page.hasMore,
                    });
                  })
                }
              >
                Trao đổi trước
              </button>
            )}
            {!detail.comments.length && (
              <p className="muted">Chưa có trao đổi.</p>
            )}
            {[...detail.comments].reverse().map((c) => (
              <article className="work-comment" key={c.id}>
                <small>Bạn · {date(c.createdAt)}</small>
                <ChatMarkdown text={c.body} />
              </article>
            ))}
            <form
              className="work-item-form"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  const body = comment.trim();
                  if (
                    !commentRequest.current ||
                    commentRequest.current.body !== body
                  )
                    commentRequest.current = { body, id: crypto.randomUUID() };
                  const saved = await value(
                    window.worker.addWorkComment({
                      ...ref,
                      clientId: commentRequest.current.id,
                      body,
                    }),
                  );
                  setDetail({
                    ...detail,
                    comments: [
                      saved,
                      ...detail.comments.filter((c) => c.id !== saved.id),
                    ],
                  });
                  setComment("");
                  commentRequest.current = null;
                });
              }}
            >
              <label>
                Trao đổi
                <textarea
                  rows={3}
                  maxLength={6000}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy || !comment.trim()}>
                Lưu trao đổi
              </button>
            </form>
            {detail.item.conversationId && (
              <button
                onClick={() => {
                  onClose();
                  onConversation(null, detail.item.conversationId);
                }}
              >
                Mở hội thoại Lead
              </button>
            )}
          </>
        ) : (
          <>
            {!detail.submissions.length && (
              <p className="muted">Chưa gửi thực hiện.</p>
            )}
            {detail.submissions.map((s) => (
              <article className="work-submission" key={s.id}>
                <header>
                  <strong>Yêu cầu v{s.revision}</strong>
                  <small>{date(s.createdAt)}</small>
                </header>
                {s.revision !== detail.item.revision && (
                  <p className="muted">
                    Phiên bản cũ · hiện tại v{detail.item.revision}
                  </p>
                )}
                <button
                  onClick={() => {
                    setTab("overview");
                    const found = detail.revisions.find(
                      (r) => r.revision === s.revision,
                    );
                    if (found) setRevision(found);
                    else
                      void act(async () => {
                        const page = await value(
                          window.worker.workItemDetail({
                            ...ref,
                            before: s.revision + 1,
                          }),
                        );
                        setRevision(
                          page.revisions.find(
                            (r) => r.revision === s.revision,
                          ) ?? null,
                        );
                      });
                  }}
                >
                  Xem yêu cầu đã gửi
                </button>
                {s.followUpId && (
                  <div className="work-actions">
                    <span>Trong hàng chờ</span>
                    <button
                      disabled={busy || !!activeRunId}
                      onClick={() =>
                        void act(async () => {
                          await value(
                            window.worker.resumeFollowUp(s.followUpId!),
                          );
                          await load();
                        })
                      }
                    >
                      Chạy tiếp
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await value(
                            window.worker.removeFollowUp(s.followUpId!),
                          );
                          submissionRequest.current = null;
                          await load();
                        })
                      }
                    >
                      Bỏ khỏi hàng chờ
                    </button>
                  </div>
                )}
                {s.state === "removed" && <p>Đã bỏ khỏi hàng chờ</p>}
                {s.attempts.map((a) => (
                  <div className="work-attempt" key={a.id}>
                    <div>
                      <strong>
                        {a.role.toUpperCase()} ·{" "}
                        {runLabels[a.state as RunState] ?? a.state}
                      </strong>
                      <small>
                        {a.model} · {date(a.createdAt)}
                      </small>
                    </div>
                    <button
                      onClick={() => {
                        onClose();
                        onInspect(a.id);
                      }}
                    >
                      Xem task / kết quả
                    </button>
                  </div>
                ))}
                {s.currentRunId === activeRunId && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await value(window.worker.stopRun(s.currentRunId!));
                        await load();
                      })
                    }
                  >
                    Dừng lượt chạy
                  </button>
                )}
                {s.hasEarlierAttempts && (
                  <p className="muted">
                    Hiển thị 100 lượt gần nhất; xuất hồ sơ để xem toàn bộ liên
                    kết.
                  </p>
                )}
              </article>
            ))}
            {detail.hasMoreSubmissions && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const page = await value(
                      window.worker.workItemDetail({
                        ...ref,
                        offset: detail.submissions.length,
                      }),
                    );
                    setDetail({
                      ...detail,
                      submissions: [...detail.submissions, ...page.submissions],
                      hasMoreSubmissions: page.hasMoreSubmissions,
                    });
                  })
                }
              >
                Lần thực hiện trước
              </button>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
