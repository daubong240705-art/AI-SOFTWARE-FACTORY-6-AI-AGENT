import { useEffect, useState } from "react";
import type { OwnedWorkspace, WorkspaceRemoval } from "../../shared/worktrees";
import type { Project, Reply } from "../../shared/contracts";
const unwrap = async <T,>(promise: Promise<Reply<T>>): Promise<T> => {
  const r = await promise;
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
export function Workspaces({
  projectId,
  active,
  onOpen,
}: {
  projectId: string;
  active: boolean;
  onOpen: (project: Project) => Promise<void>;
}) {
  const [items, setItems] = useState<OwnedWorkspace[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [removal, setRemoval] = useState<WorkspaceRemoval | null>(null);
  async function refresh() {
    setItems(await unwrap(window.worker.workspaces(projectId)));
  }
  useEffect(() => {
    let alive = true;
    void unwrap(window.worker.workspaces(projectId))
      .then((values) => {
        if (alive) setItems(values);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Không thực hiện được thao tác.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="workspace-tools">
      <div className="inline">
        <button
          disabled={busy || active}
          onClick={() =>
            void action(async () => {
              setRemoval(null);
              await unwrap(window.worker.createWorkspace(projectId));
            })
          }
        >
          Tạo workspace riêng
        </button>
        <button disabled={busy} onClick={() => void action(refresh)}>
          Tải lại
        </button>
      </div>
      <p className="small muted">
        Từ commit hiện tại · chạy tuần tự · chưa tự gộp source.
      </p>
      {error && (
        <p className="warning-text small" role="alert">
          {error}
        </p>
      )}
      {items.map((item) => (
        <div className="command-result" key={item.id}>
          <strong>
            {item.head.slice(0, 8)} ·{" "}
            {item.state === "ready" ? "Sẵn sàng" : "Cần kiểm tra"}
          </strong>
          <code className="small command-script">{item.path}</code>
          {item.issue && <p className="warning-text small">{item.issue}</p>}
          <div className="inline">
            <button
              disabled={busy || active || item.state !== "ready"}
              onClick={() =>
                void action(async () => {
                  await onOpen(
                    await unwrap(window.worker.openWorkspace(item.id)),
                  );
                })
              }
            >
              Mở làm dự án
            </button>
            <button
              disabled={busy || active}
              onClick={() =>
                void action(async () => {
                  await unwrap(window.worker.recoverWorkspace(item.id));
                })
              }
            >
              Kiểm tra phục hồi
            </button>
            <button
              disabled={busy || active}
              onClick={() =>
                void action(async () => {
                  setRemoval(null);
                  setRemoval(
                    await unwrap(
                      window.worker.previewWorkspaceRemoval(item.id),
                    ),
                  );
                })
              }
            >
              Dọn workspace
            </button>
          </div>
          {removal?.id === item.id && (
            <div className="notice">
              <p className="small">
                Xóa worktree sạch này? Source gốc giữ nguyên.
              </p>
              <button
                disabled={busy || active}
                onClick={() =>
                  void action(async () => {
                    const token = removal.token;
                    setRemoval(null);
                    await unwrap(window.worker.removeWorkspace(token));
                  })
                }
              >
                Xóa worktree sạch
              </button>
              <button onClick={() => setRemoval(null)}>Hủy</button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
