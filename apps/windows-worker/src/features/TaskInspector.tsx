import { Select } from "../ui/Select";
import { useEffect, useRef, useState } from "react";
import {
  inspectSelection,
  runCapabilities,
  taskLabels,
  type InspectorSelection,
} from "../../shared/inspector";
import { runLabels, type RunDetail } from "../../shared/runs";
import type { Project } from "../../shared/contracts";
import { useRunDetail } from "../lib/use-run-detail";
import { RunPanel } from "./RunPanel";
import { ActivityLog } from "./ActivityLog";
import { AcceptanceEvidence } from "./AcceptanceEvidence";
import { CommandEvidence } from "./CommandEvidence";
import { TaskChanges } from "./TaskChanges";
import { RecoveryActions } from "./RecoveryActions";

export function TaskInspector({
  selection,
  activeId,
  onClose,
  onSelect,
  onChat,
  onBoard,
  onAgents,
  onOpenWorkspace,
}: {
  selection: InspectorSelection;
  activeId: string | null;
  onClose: () => void;
  onSelect: (selection: InspectorSelection) => void;
  onChat: (runId: string, conversationId: string | null) => Promise<void>;
  onBoard: (runId: string) => Promise<void>;
  onAgents: () => Promise<void>;
  onOpenWorkspace: (project: Project) => Promise<void>;
}) {
  const feed = useRunDetail(selection.projectId, selection.runId);
  const [tab, setTab] = useState("overview"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const actionLock = useRef(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  async function action(work: () => Promise<unknown>) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
      await feed.refresh?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Không thực hiện được thao tác.",
      );
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  async function unwrap<T>(
    promise: Promise<{ ok: true; value: T } | { ok: false; error: string }>,
  ) {
    const reply = await promise;
    if (!reply.ok) throw new Error(reply.error);
    return reply.value;
  }
  let selected: ReturnType<typeof inspectSelection> | null = null,
    selectionError = "";
  if (feed.detail) {
    try {
      selected = inspectSelection(feed.detail, selection);
    } catch (e) {
      selectionError = (e as Error).message;
    }
  }
  const detail = selectionError ? null : feed.detail;
  const run = detail?.run,
    task = selected?.task;
  const capabilities = run ? runCapabilities(run, activeId) : null;
  const locked = busy || feed.stale || !!feed.error;
  const selectTask = (id: string) =>
    onSelect({ ...selection, taskId: id || null, executionId: undefined });
  const evidenceKey = `${run?.id}:${task?.id}:${task?.evidence?.sourceVersion}:${run?.integration?.sourceVersion}`;
  return (
    <dialog
      ref={dialog}
      className="task-inspector"
      aria-label="Chi tiết công việc"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="inspector-heading">
        <h2>Chi tiết công việc</h2>
        <button onClick={onClose} aria-label="Đóng chi tiết công việc">
          Đóng
        </button>
      </header>
      {(feed.error || selectionError || error) && (
        <p role="alert" className="notice error">
          {selectionError || error || feed.error}
        </p>
      )}
      {feed.stale && (
        <p role="status" className="notice">
          Chưa đồng bộ · Trạng thái lần cuối
        </p>
      )}
      {!run ? (
        <p className="muted">
          {selectionError || feed.error
            ? "Chọn lại công việc hoặc cập nhật."
            : "Đang tải chi tiết…"}
        </p>
      ) : (
        <>
          <p className="inspector-title">{task?.title ?? run.prompt}</p>
          <div className="inspector-actions">
            <button
              disabled={busy}
              onClick={() =>
                void action(() => onChat(run.id, run.conversationId ?? null))
              }
            >
              Mở Chat
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void action(() => onBoard(run.attemptRoot ?? run.id))
              }
            >
              Mở trên Kanban
            </button>
            <button disabled={busy} onClick={() => void action(onAgents)}>
              Xem đội ngũ
            </button>
            {capabilities?.stop && (
              <button
                disabled={locked}
                title="Dừng tất cả task thuộc lượt chạy này"
                onClick={() =>
                  void action(() => unwrap(window.worker.stopRun(run.id)))
                }
              >
                Dừng toàn lượt
              </button>
            )}
            {capabilities?.retry && (
              <button
                disabled={locked}
                onClick={() =>
                  void action(async () => {
                    const next = await unwrap(window.worker.retryRun(run.id));
                    onSelect({ projectId: next.projectId, runId: next.id });
                  })
                }
              >
                Thử lại · lượt mới
              </button>
            )}
          </div>
          <label className="inspector-task-picker">
            Task / attempt
            <Select
              aria-label="Chọn task / attempt"
              value={task?.id ?? ""}
              onValueChange={(value) => selectTask(value)}
            >
              <option value="">Toàn lượt · {run.role.toUpperCase()}</option>
              {run.tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id} · {t.role.toUpperCase()} · {t.title}
                </option>
              ))}
            </Select>
          </label>
          {selected?.supersededBy && (
            <p className="notice">
              Attempt này đã được thay bằng{" "}
              <button onClick={() => selectTask(selected!.supersededBy!)}>
                {selected.supersededBy}
              </button>
            </p>
          )}
          <div className="tabs" role="tablist" aria-label="Nội dung chi tiết">
            {[
              ["overview", "Tổng quan"],
              ["timeline", "Timeline"],
              ["changes", "Thay đổi"],
              ["result", "Kết quả"],
            ].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? "selected" : ""}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "overview" && (
            <div className="inspector-content">
              {task && <p>{task.instructions}</p>}
              <dl className="inspector-facts">
                <dt>Trạng thái</dt>
                <dd>{task ? taskLabels[task.state] : runLabels[run.state]}</dd>
                <dt>Role · model thực tế</dt>
                <dd>
                  {(task?.role ?? run.role).toUpperCase()} ·{" "}
                  {task?.model ?? run.model}
                </dd>
                <dt>Phạm vi</dt>
                <dd>
                  {task?.allowedPaths.join(", ") ?? "Theo cấu hình lượt chạy"}
                </dd>
                <dt>Phụ thuộc hiện tại</dt>
                <dd>
                  {selected?.dependencies
                    .map(
                      (dep) =>
                        `${dep.id}${dep.attemptId !== dep.id && dep.attemptId ? ` (${dep.attemptId})` : ""} · ${dep.state ? taskLabels[dep.state] : "Không tìm thấy"}`,
                    )
                    .join("; ") || "—"}
                </dd>
                <dt>Workspace task / source</dt>
                <dd>{task?.workspace ?? run.workspace}</dd>
                {run.integration && (
                  <>
                    <dt>Workspace tích hợp</dt>
                    <dd>
                      {run.integration.workspace} · {run.integration.state}
                    </dd>
                  </>
                )}
                <dt>Attempt · execution</dt>
                <dd>
                  {task?.id ?? run.id} ·{" "}
                  {(task?.observation ?? (!task ? run.observation : undefined))
                    ?.executionId ?? "Chưa có metadata"}
                </dd>
                <dt>Source version</dt>
                <dd>
                  {task?.evidence?.sourceVersion ??
                    run.integration?.sourceVersion ??
                    "Chưa ghi nhận"}
                </dd>
                <dt>Kỹ năng snapshot</dt>
                <dd>
                  {(task?.skillSelection ?? run.skillSelection)?.skills
                    .map((s) => `${s.id} ${s.version}`)
                    .join(", ") || "Rule nền / profile đã lưu"}
                </dd>
                <dt>Bắt đầu · kết thúc</dt>
                <dd>
                  {task?.startedAt ?? run.startedAt ?? "—"} ·{" "}
                  {task?.endedAt ?? run.endedAt ?? "—"}
                </dd>
              </dl>
              {task?.acceptance.length ? (
                <section aria-label="Tiêu chí task">
                  <h3>Tiêu chí task</h3>
                  <ul>
                    {task.acceptance.map((text, i) => (
                      <li key={i}>{text}</li>
                    ))}
                  </ul>
                  <p className="small muted">
                    Task đã thực thi chưa đồng nghĩa acceptance đã được xác
                    minh. Xem Kết quả để đọc bằng chứng.
                  </p>
                </section>
              ) : null}
              {(task?.error || run.error) && (
                <p className="warning-text">{task?.error || run.error}</p>
              )}
              {capabilities?.permission &&
                run.permissions
                  .filter((p) => !task || p.taskId === task.id)
                  .map((p) => (
                    <section key={p.id} className="permission-box">
                      <strong>
                        {p.taskId ? `${p.taskId} · ` : ""}
                        {p.permission}
                      </strong>
                      <pre>{p.patterns.join("\n")}</pre>
                      <div className="inline">
                        {[false, true].map((allow) => (
                          <button
                            key={String(allow)}
                            disabled={locked}
                            onClick={() =>
                              void action(() =>
                                unwrap(
                                  window.worker.replyPermission({
                                    runId: run.id,
                                    requestId: p.id,
                                    allow,
                                  }),
                                ),
                              )
                            }
                          >
                            {allow ? "Cho phép một lần" : "Từ chối"}
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
              {capabilities?.recovery && !locked && (
                <RecoveryActions
                  key={run.id}
                  run={run}
                  onChanged={() => void feed.refresh?.()}
                />
              )}
            </div>
          )}
          {tab === "timeline" && (
            <ActivityLog
              key={`${run.id}:${task?.id}`}
              detail={detail!}
              taskId={task?.id}
            />
          )}
          {tab === "changes" &&
            (task ? (
              <TaskChanges key={evidenceKey} run={run} task={task} />
            ) : (
              <RunPanel
                detail={detail}
                tab="changes"
                busy={locked}
                showPermissions={false}
                onPermission={() => {}}
                onOpenWorkspace={onOpenWorkspace}
              />
            ))}
          {tab === "result" &&
            (task ? (
              <section key={evidenceKey} aria-label="Kết quả của task">
                <pre>{task.summary || "Chưa có kết quả."}</pre>
                {run.commands
                  .filter((c) => c.taskId === task.id)
                  .map((c) => (
                    <CommandEvidence
                      key={`${c.artifactId ?? c.callId}:${c.sourceVersion}:${c.status}`}
                      runId={run.id}
                      command={c}
                    />
                  ))}
                <TaskAcceptance detail={detail!} taskId={task.id} />
              </section>
            ) : (
              <RunPanel
                detail={detail}
                tab="result"
                busy={locked}
                showRecovery={!!capabilities?.recovery && !locked}
                showPermissions={false}
                onPermission={() => {}}
                onOpenWorkspace={onOpenWorkspace}
              />
            ))}
        </>
      )}
      <button onClick={() => void feed.refresh?.()} disabled={busy}>
        Cập nhật chi tiết
      </button>
    </dialog>
  );
}

function TaskAcceptance({
  detail,
  taskId,
}: {
  detail: RunDetail;
  taskId: string;
}) {
  const task = detail.run.tasks.find((t) => t.id === taskId)!;
  const original = task.originalTaskId ?? task.id;
  const review = detail.run.review;
  const criteria =
    review && "version" in review
      ? review.acceptance.filter((ac) =>
          ac.criterionId.startsWith(`${original}:`),
        )
      : [];
  if (!criteria.length)
    return (
      <p className="small muted">Chưa có review gắn với tiêu chí task này.</p>
    );
  return (
    <section>
      <h3>Review của lượt chạy</h3>
      <p className="small muted">
        Đọc attempt/source version trong từng bằng chứng; review có thể thuộc
        attempt mới hơn.
      </p>
      {criteria.map((ac) => (
        <article key={ac.criterionId} className="command-result">
          <strong>{ac.criterion}</strong>
          <span className="pill">
            {ac.status === "passed" &&
            review &&
            "verification" in review &&
            review.verification?.verified
              ? "Đạt · review đã xác minh"
              : ac.status === "failed"
                ? "Chưa đạt"
                : "Chưa xác minh"}
          </span>
          <p>{ac.evidence}</p>
          <AcceptanceEvidence key={JSON.stringify(ac.refs)} refs={ac.refs} />
        </article>
      ))}
    </section>
  );
}
