import { useEffect, useState } from "react";
import type { LocalCommand, ProjectCommand } from "../../shared/lifecycle";
import type { Reply } from "../../shared/contracts";
async function value<T>(p: Promise<Reply<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
export function WorkspaceTools({
  projectId,
  active,
}: {
  projectId: string;
  active: boolean;
}) {
  const [commands, setCommands] = useState<ProjectCommand[]>([]);
  const [selected, setSelected] = useState("");
  const [local, setLocal] = useState<LocalCommand | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void value(window.worker.commandCatalog(projectId))
      .then((items) => {
        if (alive) {
          setCommands(items);
          setSelected(items[0]?.id ?? "");
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await value(window.worker.localCommand());
        if (alive) setLocal(next);
      } catch {}
      if (alive) timer = setTimeout(() => void poll(), 800);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  const running = local && ["running", "stopping"].includes(local.state);
  const mine = local?.projectId === projectId;
  const stateLabels = {
    running: "Đang chạy",
    stopping: "Đang dừng",
    completed: "Đã kết thúc",
    failed: "Thất bại",
    interrupted: "Đã dừng",
  };
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setLocal(await value(window.worker.localCommand()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không chạy được lệnh.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-tools">
      <div className="inline">
        <select
          aria-label="Lệnh dự án"
          value={selected}
          disabled={busy || !!running || active}
          onChange={(e) => setSelected(e.target.value)}
        >
          {!commands.length && <option value="">Không có npm script</option>}
          {commands.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !selected || !!running || active}
          onClick={() =>
            void act(() =>
              value(
                window.worker.startCommand({ projectId, script: selected }),
              ),
            )
          }
        >
          Chạy
        </button>
        {running && (
          <button
            disabled={busy}
            onClick={() => void act(() => value(window.worker.stopCommand()))}
          >
            Dừng lệnh
          </button>
        )}
      </div>
      {commands.find((c) => c.id === selected) && (
        <code className="command-script">
          {commands.find((c) => c.id === selected)!.script}
        </code>
      )}
      {error && <p className="warning-text small">{error}</p>}
      {local && (
        <>
          <p className="small muted">
            {local.title} · {stateLabels[local.state]}
            {local.exitCode !== null ? ` · exit ${local.exitCode}` : ""}
            {!mine ? " · Dự án khác" : ""}
          </p>
          {mine && local.url && running && (
            <button
              onClick={() =>
                void act(() => value(window.worker.openExternal(local.url!)))
              }
            >
              Mở preview
            </button>
          )}
          {mine && <pre>{local.output || "Đang chờ output…"}</pre>}
        </>
      )}
    </div>
  );
}
