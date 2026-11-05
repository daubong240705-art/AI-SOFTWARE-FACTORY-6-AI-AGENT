import { useEffect, useRef, useState } from "react";
import { RefreshCw, ChevronRight, MailCheck } from "lucide-react";
import {
  inboxLabels,
  type InboxItem,
  type InboxPage,
} from "../../shared/inbox";

export function GlobalInbox({
  onOpen,
}: {
  onOpen: (item: InboxItem) => Promise<void>;
}) {
  const [page, setPage] = useState<InboxPage | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
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
  }, [unreadOnly]);

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
            aria-pressed={!unreadOnly}
            onClick={() => setUnreadOnly(false)}
          >
            Tất cả
          </button>
          <button
            disabled={busy}
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly(true)}
          >
            Chưa đọc
          </button>
        </div>
        <span className="muted small">
          Mọi dự án{checkedAt ? ` · ${checkedAt}` : ""}
        </span>
      </div>
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
          {unreadOnly ? "Không có mục chưa đọc." : "Không có việc cần xử lý."}
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
                  <span>{inboxLabels[item.kind]}</span>
                  <time dateTime={item.at}>
                    {new Date(item.at).toLocaleString("vi-VN")}
                  </time>
                </span>
                <strong>{item.title || inboxLabels[item.kind]}</strong>
                {item.detail && (
                  <span className="muted small">{item.detail}</span>
                )}
              </span>
              <ChevronRight size={16} />
            </button>
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
