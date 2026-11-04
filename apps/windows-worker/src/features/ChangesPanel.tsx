import { useEffect, useState } from "react";
import { Copy, FolderOpen, RotateCcw } from "lucide-react";
import type { Run } from "../../shared/runs";
import { isActive } from "../../shared/runs";
import type {
  EvidenceView,
  FileDiff,
  RestorePreview,
} from "../../shared/evidence";
export function PatchView({ patch }: { patch: string }) {
  let oldLine = 0,
    newLine = 0;
  return (
    <div className="unified-diff" aria-label="Diff theo dòng">
      {patch.split("\n").map((line, index) => {
        const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
        const header =
          !!hunk ||
          (oldLine === 0 &&
            newLine === 0 &&
            (line.startsWith("---") ||
              line.startsWith("+++") ||
              line.startsWith("Index:") ||
              line.startsWith("===")));
        if (hunk) {
          oldLine = Number(hunk[1]);
          newLine = Number(hunk[2]);
        }
        const added = !header && line.startsWith("+"),
          deleted = !header && line.startsWith("-");
        const content = !header && (added || deleted || line.startsWith(" "));
        const a = content && !added ? oldLine++ : "",
          b = content && !deleted ? newLine++ : "";
        return (
          <div
            key={index}
            className={`diff-line ${header ? "diff-hunk" : added ? "diff-add" : deleted ? "diff-delete" : ""}`}
          >
            <span className="diff-number">{a}</span>
            <span className="diff-number">{b}</span>
            <code>
              {line.slice(0, 10000)}
              {line.length > 10000 ? " … (dòng dài đã rút gọn)" : ""}
            </code>
          </div>
        );
      })}
    </div>
  );
}
export function ChangesPanel({ run }: { run: Run }) {
  const [view, setView] = useState<EvidenceView | null>(null),
    [error, setError] = useState("");
  const [legacy, setLegacy] = useState(false),
    [selected, setSelected] = useState("");
  const [existing, setExisting] = useState(false),
    [comparison, setComparison] = useState<"run" | "staged" | "unstaged">(
      "run",
    );
  const [diff, setDiff] = useState<FileDiff | null>(null),
    [preview, setPreview] = useState<RestorePreview | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let alive = true;
    window.worker.evidence(run.id).then((reply) => {
      if (!alive) return;
      if (reply.ok) {
        setView(reply.value);
        setLegacy(false);
      } else {
        setError(reply.error);
        setLegacy(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [run.id, run.state]);
  const files = existing ? view?.existing : view?.files;
  useEffect(() => {
    if (!files?.some((f) => f.path === selected))
      setSelected(files?.[0]?.path ?? "");
  }, [files?.map((f) => f.path).join("|"), selected]);
  useEffect(() => {
    let alive = true;
    setDiff(null);
    setPreview(null);
    setError("");
    setNotice("");
    if (selected)
      window.worker
        .fileDiff({
          runId: run.id,
          path: selected,
          comparison,
          source: existing ? "before" : "after",
        })
        .then((reply) => {
          if (!alive) return;
          if (reply.ok) setDiff(reply.value);
          else setError(reply.error);
        });
    return () => {
      alive = false;
    };
  }, [run.id, selected, comparison, existing, view?.afterAt]);
  async function perform(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Không thực hiện được thao tác.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (legacy)
    return (
      <div className="changes-list">
        <p className="muted small">
          {error || "Lượt cũ chỉ có danh sách file; không có diff lịch sử."}
        </p>
        {run.changes.map((f) => (
          <div className="changed-file" key={f.path}>
            <code>{f.path}</code>
            <span className="pill">{f.kind}</span>
          </div>
        ))}
      </div>
    );
  if (!view) return <p className="muted">Đang tải snapshot…</p>;
  if (!view.finished && !existing)
    return (
      <div className="changes-list">
        <p className="muted small">
          Diff kết quả xuất hiện sau khi lượt chạy dừng.
        </p>
        <button
          onClick={() => {
            setExisting(true);
            setComparison("unstaged");
          }}
        >
          Có sẵn trước lượt ({view.preExistingCount})
        </button>
      </div>
    );
  return (
    <div className="source-changes">
      <div className="tabs">
        <button
          className={!existing ? "selected" : ""}
          onClick={() => {
            setExisting(false);
            setComparison("run");
          }}
        >
          Trong lượt ({view.files.length})
        </button>
        <button
          className={existing ? "selected" : ""}
          onClick={() => {
            setExisting(true);
            setComparison("unstaged");
          }}
        >
          Có sẵn ({view.preExistingCount})
        </button>
      </div>
      <div className="small muted">
        {existing ? "Snapshot trước lượt chạy" : "Snapshot kết quả"} ·{" "}
        {new Date(
          existing ? view.beforeAt : (view.afterAt ?? view.beforeAt),
        ).toLocaleString("vi-VN")}
      </div>
      {!view.complete && (
        <p className="warning-text small">
          Snapshot có giới hạn; file lớn, liên kết và nội dung nhạy cảm không có
          bản khôi phục.
        </p>
      )}
      {view.indexChanged && (
        <p className="warning-text small">
          Git index thay đổi trong lượt này. Kiểm tra phần staged trước khi khôi
          phục.
        </p>
      )}
      {view.headBefore !== view.headAfter && (
        <p className="warning-text small">HEAD thay đổi trong lượt này.</p>
      )}
      <div className="snapshot-files" aria-label="File trong snapshot">
        {files?.map((f) => (
          <button
            key={f.path}
            className={selected === f.path ? "selected" : ""}
            onClick={() => setSelected(f.path)}
            title={f.path}
          >
            <code>{f.path}</code>
            <span className="small muted">
              {existing
                ? `${f.gitBefore?.index ?? " "}${f.gitBefore?.worktree ?? " "}`
                : f.kind === "added"
                  ? "Thêm"
                  : f.kind === "deleted"
                    ? "Xóa"
                    : "Sửa"}
              {f.preExisting && !existing ? " · Có sẵn" : ""}
            </span>
            {(f.renamedFrom || f.renamedTo) && (
              <small className="muted">
                {f.renamedFrom ? `← ${f.renamedFrom}` : `→ ${f.renamedTo}`}
              </small>
            )}
            {existing && f.gitBefore?.originalPath && (
              <small className="muted">← {f.gitBefore.originalPath}</small>
            )}
          </button>
        ))}
      </div>
      {!files?.length && (
        <p className="muted small">Không có thay đổi được ghi nhận.</p>
      )}
      {selected && (
        <>
          <div className="diff-toolbar">
            <select
              aria-label="Kiểu so sánh"
              value={comparison}
              onChange={(e) =>
                setComparison(e.target.value as typeof comparison)
              }
            >
              {!existing && <option value="run">Trước → sau lượt</option>}
              <option value="staged">Staged · HEAD → index</option>
              <option value="unstaged">Source · index → file</option>
            </select>
            <button
              title="Mở vị trí file"
              aria-label="Mở vị trí file"
              onClick={() =>
                void perform(async () => {
                  const r = await window.worker.revealFile({
                    runId: run.id,
                    path: selected,
                  });
                  if (!r.ok) throw new Error(r.error);
                })
              }
            >
              <FolderOpen size={14} />
            </button>
            <button
              aria-label="Sao chép patch"
              title="Sao chép patch"
              disabled={!diff?.patch}
              onClick={() =>
                void perform(async () => {
                  await navigator.clipboard.writeText(diff!.patch);
                  setNotice("Đã sao chép patch.");
                })
              }
            >
              <Copy size={14} />
            </button>
          </div>
          {diff?.reason && <p className="muted small">{diff.reason}</p>}
          {diff?.patch && <PatchView patch={diff.patch} />}
          {diff?.patch && !diff.patch.includes("@@") && (
            <p className="muted small">
              Không có khác biệt nội dung trong phép so sánh này.
            </p>
          )}
          {!existing && diff?.canRestore && (
            <button
              className="restore-trigger"
              disabled={busy || isActive(run.state)}
              onClick={() =>
                void perform(async () => {
                  const r = await window.worker.previewRestore({
                    runId: run.id,
                    path: selected,
                  });
                  if (!r.ok) throw new Error(r.error);
                  setPreview(r.value);
                })
              }
            >
              <RotateCcw size={14} />
              Xem trước khôi phục
            </button>
          )}
          {preview && (
            <section className="restore-preview">
              <strong>{preview.action}</strong>
              <div className="small muted">{preview.path}</div>
              <PatchView patch={preview.patch} />
              <div className="inline">
                <button disabled={busy} onClick={() => setPreview(null)}>
                  Hủy
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const r = await window.worker.restoreFile(preview.token);
                      setPreview(null);
                      if (!r.ok) throw new Error(r.error);
                      setNotice(
                        "Đã khôi phục file. Diff lịch sử được giữ nguyên.",
                      );
                    })
                  }
                >
                  Khôi phục file này
                </button>
              </div>
            </section>
          )}
        </>
      )}
      {error && (
        <p className="warning-text small" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="small" role="status">
          {notice}
        </p>
      )}
      <p className="muted small">
        So sánh source trước/sau; có thể gồm thay đổi đồng thời ngoài ứng dụng.
      </p>
    </div>
  );
}
