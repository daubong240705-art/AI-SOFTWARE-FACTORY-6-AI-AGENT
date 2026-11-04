import { useEffect, useRef, useState } from "react";
import { GitBranch, RefreshCw } from "lucide-react";
import type { GitSnapshot, GitFile, GitDiff } from "../../shared/git";
import type { Reply } from "../../shared/contracts";
import { PatchView } from "./ChangesPanel";
import { WorkItemPanel } from "./WorkItemPanel";

async function value<T>(reply: Promise<Reply<T>>) {
  const r = await reply;
  if (!r.ok) throw Error(r.error);
  return r.value;
}
// StrictMode may remount an effect; share its in-flight read without polling.
const reads = new Map<string, Promise<GitSnapshot>>();
function snapshot(projectId: string, offset = 0, head?: string) {
  const key = `${projectId}:${offset}:${head ?? ""}`;
  let pending = reads.get(key);
  if (!pending) {
    pending = value(
      window.worker.gitSnapshot({
        projectId,
        offset,
        ...(head ? { head } : {}),
      }),
    ).finally(() => reads.delete(key));
    reads.set(key, pending);
  }
  return pending;
}
const labels: Record<string, string> = {
  M: "Đã sửa",
  A: "Mới",
  D: "Đã xóa",
  "?": "Chưa theo dõi",
  U: "Xung đột",
  T: "Đổi loại",
};
function fileLabel(file: GitFile) {
  return labels[file.worktree.trim() || file.index] ?? "Thay đổi";
}
export function GitWorkspace({
  projectId,
  activeRunId,
  onInspect,
  onConversation,
  onAskLead,
}: {
  projectId: string;
  activeRunId: string | null;
  onInspect: (runId: string) => void;
  onConversation: (runId: string | null, conversationId: string | null) => void;
  onAskLead: (itemId: string) => void;
}) {
  const [data, setData] = useState<GitSnapshot | null>(null);
  const [tab, setTab] = useState<"changes" | "history">("changes");
  const [selected, setSelected] = useState<GitFile | null>(null);
  const [comparison, setComparison] = useState<"staged" | "unstaged">(
    "unstaged",
  );
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [workItem, setWorkItem] = useState<string | null>(null);
  const generation = useRef(0),
    lock = useRef(false);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    void snapshot(projectId)
      .then((next) => {
        if (alive) setData(next);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
      generation.current++;
    };
  }, [projectId]);
  async function perform(fn: () => Promise<void>) {
    if (lock.current || busy) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const current = ++generation.current;
    try {
      await fn();
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e.message : "Không đọc được Git.");
    } finally {
      lock.current = false;
      if (current === generation.current) setBusy(false);
    }
  }
  async function refresh(more = false) {
    await perform(async () => {
      const next = await snapshot(
        projectId,
        more ? (data?.nextOffset ?? 0) : 0,
        more ? (data?.head ?? undefined) : undefined,
      );
      setData((previous) =>
        more && previous
          ? {
              ...next,
              commits: [
                ...previous.commits,
                ...next.commits.filter(
                  (c) => !previous.commits.some((p) => p.hash === c.hash),
                ),
              ],
            }
          : next,
      );
      if (!more) {
        setSelected(null);
        setDiff(null);
      }
    });
  }
  async function openFile(file: GitFile, mode: "staged" | "unstaged") {
    await perform(async () => {
      setSelected(file);
      setComparison(mode);
      setDiff(null);
      setDiff(
        await value(
          window.worker.gitDiff({
            projectId,
            path: file.path,
            comparison: mode,
          }),
        ),
      );
    });
  }
  return (
    <section className="git-workspace" aria-label="Git local">
      <div className="page-heading">
        <h1>Git</h1>
        <button
          className="icon-button subtle"
          disabled={busy}
          aria-label="Cập nhật Git"
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="muted small" role="status">
          Đang đọc Git…
        </p>
      )}
      {data?.available ? (
        <>
          <div className="git-summary">
            <span>
              <GitBranch size={15} />
              {data.branch ?? "Detached HEAD"}
            </span>
            <code>{data.head?.slice(0, 10) ?? "Chưa có commit"}</code>
            <span className="muted small">
              {data.files.length
                ? `${data.filesTruncated ? "200+" : data.files.length} file thay đổi`
                : "Working tree sạch"}
            </span>
            <time className="muted small">
              {new Date(data.checkedAt).toLocaleTimeString("vi-VN")}
            </time>
          </div>
          <div className="work-view-switch git-tabs" aria-label="Nội dung Git">
            <button
              aria-pressed={tab === "changes"}
              onClick={() => setTab("changes")}
            >
              Thay đổi
            </button>
            <button
              aria-pressed={tab === "history"}
              onClick={() => setTab("history")}
            >
              Lịch sử commit
            </button>
          </div>
          {tab === "changes" ? (
            <>
              {!data.files.length ? (
                <p className="overview-empty">Không có file thay đổi.</p>
              ) : (
                <div className="git-changes-layout">
                  <div className="git-file-list" aria-label="File thay đổi">
                    {data.files.map((file) => (
                      <button
                        key={file.path}
                        aria-pressed={selected?.path === file.path}
                        disabled={busy}
                        className="git-file"
                        onClick={() =>
                          void openFile(
                            file,
                            file.worktree !== " " ? "unstaged" : "staged",
                          )
                        }
                      >
                        <code>{file.path}</code>
                        <span className="muted small">{fileLabel(file)}</span>
                        <code className="git-xy" title="Index / Working tree">
                          {file.index}
                          {file.worktree}
                        </code>
                      </button>
                    ))}
                  </div>
                  <section
                    className="git-diff-panel"
                    aria-label="Diff Git hiện tại"
                  >
                    {selected ? (
                      <>
                        <header>
                          <strong>{selected.path}</strong>
                          <div
                            className="work-view-switch"
                            aria-label="So sánh Git"
                          >
                            <button
                              aria-pressed={comparison === "unstaged"}
                              disabled={busy || selected.worktree === " "}
                              onClick={() =>
                                void openFile(selected, "unstaged")
                              }
                            >
                              Unstaged
                            </button>
                            <button
                              aria-pressed={comparison === "staged"}
                              disabled={
                                busy || [" ", "?"].includes(selected.index)
                              }
                              onClick={() => void openFile(selected, "staged")}
                            >
                              Staged
                            </button>
                          </div>
                        </header>
                        {diff && (
                          <>
                            <p className="small muted">
                              {comparison === "staged"
                                ? "HEAD → Index"
                                : "Index → Working tree"}{" "}
                              ·{" "}
                              {new Date(diff.checkedAt).toLocaleTimeString(
                                "vi-VN",
                              )}
                            </p>
                            {diff.reason && (
                              <p className="notice">{diff.reason}</p>
                            )}
                            {diff.patch ? (
                              <PatchView patch={diff.patch} />
                            ) : (
                              !diff.reason && (
                                <p className="muted small">
                                  Không có thay đổi nội dung.
                                </p>
                              )
                            )}
                          </>
                        )}
                      </>
                    ) : (
                      <p className="muted small">
                        Chọn file để xem diff hiện tại.
                      </p>
                    )}
                  </section>
                </div>
              )}
              {data.filesTruncated && (
                <p className="muted small">
                  Hiển thị 200 file đầu tiên. Thu hẹp thư mục dự án để xem phạm
                  vi nhỏ hơn.
                </p>
              )}
            </>
          ) : (
            <>
              {!data.commits.length && (
                <p className="overview-empty">
                  Chưa có commit trong phạm vi dự án.
                </p>
              )}
              <ol className="git-history">
                {data.commits.map((commit) => (
                  <li key={commit.hash}>
                    <code title={commit.hash}>{commit.hash.slice(0, 10)}</code>
                    <div>
                      <strong>{commit.subject || "(Không có tiêu đề)"}</strong>
                      <p className="small muted">
                        {commit.author} ·{" "}
                        {new Date(commit.at).toLocaleString("vi-VN")}
                      </p>
                      {!!commit.workItems.length && (
                        <div className="git-work-refs">
                          {commit.workItems.map((ref) => (
                            <button
                              key={ref.id}
                              onClick={() => setWorkItem(ref.id)}
                              aria-label={`Mở công việc ${ref.code}`}
                            >
                              {ref.code}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {data.hasMore && (
                <button
                  disabled={busy || !!error}
                  onClick={() => void refresh(true)}
                >
                  Xem thêm commit
                </button>
              )}
            </>
          )}
        </>
      ) : (
        data && <p className="overview-empty">{data.reason}</p>
      )}
      {workItem && (
        <WorkItemPanel
          projectId={projectId}
          itemId={workItem}
          onClose={() => setWorkItem(null)}
          activeRunId={activeRunId}
          onInspect={(id) => {
            setWorkItem(null);
            onInspect(id);
          }}
          onConversation={(id, conversation) => {
            setWorkItem(null);
            onConversation(id, conversation);
          }}
          onChanged={() => {}}
          onAskLead={(id) => {
            setWorkItem(null);
            onAskLead(id);
          }}
        />
      )}
    </section>
  );
}
