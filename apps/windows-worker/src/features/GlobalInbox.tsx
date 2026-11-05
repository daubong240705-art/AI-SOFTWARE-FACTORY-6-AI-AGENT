import { useEffect, useRef, useState } from "react";
import {
  RefreshCw,
  ChevronRight,
  MailCheck,
  Archive,
  Undo2,
} from "lucide-react";
import { Select } from "../ui/Select";
import type { Project } from "../../shared/contracts";
import {
  inboxLabels,
  type InboxItem,
  type InboxPage,
} from "../../shared/inbox";

export function GlobalInbox({
  onOpen,
  projects,
}: {
  onOpen: (item: InboxItem) => Promise<void>;
  projects: Project[];
}) {
  const [page, setPage] = useState<InboxPage | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [category, setCategory] = useState("");
  const [projectId, setProjectId] = useState("");
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const generation = useRef(0),
    lock = useRef(false);

  async function load(more = false) {
    const current = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const reply = await window.worker.inbox({
        unreadOnly,
        scope: closed ? "closed" : "open",
        ...(!closed && category
          ? { category: category as "decision" | "blocked" }
          : {}),
        ...(projectId ? { projectId } : {}),
        ...(more && page?.next ? { before: page.next } : {}),
      });
      if (current !== generation.current) return;
      if (!reply.ok) throw new Error(reply.error);
      const next = reply.value;
      setPage((previous) =>
        more && previous
          ? {
              ...next,
              items: [
                ...previous.items,
                ...next.items.filter(
                  (i) => !previous.items.some((p) => p.key === i.key),
                ),
              ],
            }
          : next,
      );
      setCheckedAt(new Date().toLocaleTimeString("vi-VN"));
    } catch (e) {
      if (current === generation.current)
        setError(
          e instanceof Error ? e.message : "Không tải được mục cần xử lý.",
        );
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    setPage(null);
    void load();
    return () => {
      generation.current++;
    };
  }, [unreadOnly, category, projectId, closed]);

  async function action(fn: () => Promise<void>) {
    if (lock.current || busy) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Không thực hiện được thao tác.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="global-inbox" aria-label="Cần xử lý · Mọi dự án">
      <div className="page-heading">
        <h1>Cần xử lý</h1>
        <button
          className="icon-button subtle"
          aria-label="Cập nhật mục cần xử lý"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <div className="inbox-toolbar">
        <div className="work-view-switch" aria-label="Lọc mục cần xử lý">
          <button
            disabled={busy}
            aria-pressed={!closed}
            onClick={() => setClosed(false)}
          >
            Đang cần xử lý
          </button>
          <button
            disabled={busy}
            aria-pressed={closed}
            onClick={() => setClosed(true)}
          >
            Cảnh báo đã đóng
          </button>
        </div>
        <Select
          aria-label="Lọc dự án"
          value={projectId}
          onValueChange={setProjectId}
          disabled={busy}
        >
          <option value="">Mọi dự án</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Loại cần xử lý"
          value={category}
          onValueChange={setCategory}
          disabled={busy || closed}
        >
          <option value="">Mọi loại</option>
          <option value="decision">Cần quyết định</option>
          <option value="blocked">Bị chặn</option>
        </Select>
        <label className="inbox-unread">
          <input
            type="checkbox"
            checked={unreadOnly}
            disabled={busy}
            onChange={(event) => setUnreadOnly(event.target.checked)}
          />
          Chưa đọc
        </label>
      </div>
      {closed && (
        <p className="muted small">
          Đóng cảnh báo chỉ bỏ nhắc nhở, công việc vẫn giữ nguyên trạng thái. Có
          thể mở lại bên dưới.
        </p>
      )}
      {checkedAt && <p className="muted small">Cập nhật {checkedAt}</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="muted small" role="status">
          Đang cập nhật…
        </p>
      )}
      {page && !page.items.length && (
        <p className="overview-empty">
          {closed
            ? "Không có cảnh báo đã đóng phù hợp."
            : unreadOnly
              ? "Không có mục chưa đọc phù hợp."
              : "Không có việc cần xử lý phù hợp."}
        </p>
      )}
      <ul className="inbox-items">
        {page?.items.map((item) => (
          <li key={item.key} className={item.unread ? "unread" : ""}>
            <button
              className="inbox-open"
              disabled={busy || !!error}
              onClick={() => void action(() => onOpen(item))}
            >
              <span
                className="inbox-dot"
                aria-label={item.unread ? "Chưa đọc" : "Đã đọc"}
              />
              <span className="inbox-body">
                <span className="inbox-meta">
                  <strong>{item.projectName}</strong>
                  <span>{item.problem}</span>
                  <time dateTime={item.at}>
                    {new Date(item.at).toLocaleString("vi-VN")}
                  </time>
                </span>
                <strong>
                  {item.code ? `${item.code} · ` : ""}
                  {item.title || inboxLabels[item.kind]}
                </strong>
                {item.taskTitle && (
                  <span className="small">Task: {item.taskTitle}</span>
                )}
                {(item.kind === "failure" || item.kind === "queue") &&
                  item.detail && (
                    <span className="small muted inbox-reason">
                      {item.detail}
                    </span>
                  )}
                <span className="small muted">{item.nextAction}</span>
                <span className="inbox-action small">{item.actionLabel}</span>
              </span>
              <ChevronRight size={16} />
            </button>
            {item.canDismiss && (
              <button
                className="icon-button subtle"
                disabled={busy || !!error}
                aria-label={`${closed ? "Mở lại" : "Đóng cảnh báo"}: ${item.title}`}
                title={
                  closed
                    ? "Mở lại cảnh báo"
                    : "Đóng cảnh báo · giữ nguyên trạng thái công việc"
                }
                onClick={() =>
                  void action(async () => {
                    const reply = await window.worker.inboxDismiss({
                      key: item.key,
                      token: item.token,
                      dismissed: !closed,
                    });
                    if (!reply.ok) throw new Error(reply.error);
                    await load();
                  })
                }
              >
                {closed ? <Undo2 size={17} /> : <Archive size={17} />}
              </button>
            )}
            {item.unread && (
              <button
                className="icon-button subtle inbox-seen"
                aria-label={`Đánh dấu đã đọc: ${item.title}`}
                title="Đánh dấu đã đọc"
                disabled={busy || !!error}
                onClick={() =>
                  void action(async () => {
                    const reply = await window.worker.inboxSeen({
                      key: item.key,
                      token: item.token,
                    });
                    if (!reply.ok) throw new Error(reply.error);
                    await load();
                  })
                }
              >
                <MailCheck size={17} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {page?.hasMore && (
        <button disabled={busy || !!error} onClick={() => void load(true)}>
          Xem thêm
        </button>
      )}
    </section>
  );
}
