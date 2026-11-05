import { useEffect, useRef, useState } from "react";
import { Select } from "../ui/Select";
import { z } from "zod";
import type { Reply } from "../../shared/contracts";
import {
  scheduleDraftSchema,
  type ScheduleDraft,
  type ScheduleRecord,
  type ScheduleList,
  type SchedulePreview,
  type ScheduleHistory,
} from "../../shared/schedules";

async function value<T>(input: Promise<Reply<T>>) {
  const reply = await input;
  if (!reply.ok) throw Error(reply.error);
  return reply.value;
}
function editorMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    const path = error.issues[0]?.path.join(".") ?? "";
    if (path.startsWith("action.criteria"))
      return "Tiêu chí tối đa 30 dòng, mỗi dòng tối đa 500 ký tự.";
    if (path === "timing.timeZone")
      return "Múi giờ không hợp lệ. Ví dụ: Asia/Ho_Chi_Minh.";
    if (path.startsWith("timing.weekdays"))
      return "Chọn ít nhất một ngày trong tuần.";
    return "Kiểm tra tên lịch, thời điểm và tiêu đề công việc trước khi xem trước.";
  }
  return error instanceof Error ? error.message : "Không lưu được lịch.";
}
const dateLabel = (at: string | null, zone = "Asia/Ho_Chi_Minh") =>
  at ? new Date(at).toLocaleString("vi-VN", { timeZone: zone }) : "—";
const weekdays = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const draftOf = (record: ScheduleRecord): ScheduleDraft =>
  scheduleDraftSchema.parse({
    projectId: record.projectId,
    name: record.name,
    timing: record.timing,
    action: record.action,
    missedPolicy: record.missedPolicy,
  });
const refOf = (record: ScheduleRecord) => ({
  projectId: record.projectId,
  id: record.id,
  version: record.version,
});
function blank(projectId: string): ScheduleDraft {
  return {
    projectId,
    name: "",
    timing: {
      kind: "daily",
      time: "09:00",
      timeZone: "Asia/Ho_Chi_Minh",
      weekdays: [1, 2, 3, 4, 5],
    },
    action: { kind: "create_work_item", title: "", body: "", criteria: [] },
    missedPolicy: "skip",
  };
}
export function SchedulesWorkspace({
  projectId,
  onOpenItem,
}: {
  projectId: string;
  onOpenItem: (id: string) => void;
}) {
  const [data, setData] = useState<ScheduleList | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{
    draft: ScheduleDraft;
    record?: ScheduleRecord;
    enable: boolean;
  } | null>(null);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [history, setHistory] = useState<{
    record: ScheduleRecord;
    page: ScheduleHistory;
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [editorError, setEditorError] = useState("");
  async function reload() {
    setData(await value(window.worker.scheduleList(projectId)));
  }
  useEffect(() => {
    let alive = true;
    const load = () =>
      value(window.worker.scheduleList(projectId))
        .then((next) => {
          if (alive) {
            setData(next);
            setError("");
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [projectId]);
  useEffect(() => {
    if (editor && !dialog.current?.open) dialog.current?.showModal();
  }, [editor]);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không cập nhật được lịch.");
    } finally {
      setBusy(false);
    }
  }
  function open(record?: ScheduleRecord, enable = false) {
    setEditor({
      record,
      draft: record ? draftOf(record) : blank(projectId),
      enable,
    });
    setPreview(null);
    setEditorError("");
  }
  function change(draft: ScheduleDraft) {
    if (!editor) return;
    setEditor({ ...editor, draft });
    setPreview(null);
    setEditorError("");
  }
  async function editorAction(save: boolean) {
    if (!editor) return;
    setBusy(true);
    setEditorError("");
    try {
      const input = {
        draft: scheduleDraftSchema.parse({
          ...editor.draft,
          action: {
            ...editor.draft.action,
            criteria: editor.draft.action.criteria
              .map((line) => line.trim())
              .filter(Boolean),
          },
        }),
        ...(editor.record ? { ref: refOf(editor.record) } : {}),
      };
      if (!save) {
        setPreview(await value(window.worker.schedulePreview(input)));
        return;
      }
      if (!preview) throw Error("Xem trước lịch trước khi lưu.");
      if (editor.enable && editor.record)
        await value(
          window.worker.scheduleToggle({
            ...refOf(editor.record),
            enabled: true,
            token: preview.token,
          }),
        );
      else
        await value(
          window.worker.scheduleSave({ ...input, token: preview.token }),
        );
      dialog.current?.close();
      setEditor(null);
      setPreview(null);
      await reload();
    } catch (e) {
      setEditorError(editorMessage(e));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  const zone =
    editor?.draft.timing.kind === "daily"
      ? editor.draft.timing.timeZone
      : "UTC";
  return (
    <section className="schedules-workspace" aria-label="Lịch công việc">
      <header className="card-heading">
        <h1>Lịch</h1>
        <div className="inline">
          <button
            disabled={busy || !data}
            onClick={() =>
              void act(() => value(window.worker.schedulePause(!data!.paused)))
            }
          >
            {data?.paused ? "Tiếp tục tất cả" : "Tạm dừng tất cả"}
          </button>
          <button className="primary" disabled={busy} onClick={() => open()}>
            Tạo lịch
          </button>
        </div>
      </header>
      <p className="muted small">
        Chỉ tạo công việc vào backlog khi ứng dụng đang mở. Trễ quá 5 phút sẽ bỏ
        qua, không chạy bù.
      </p>
      {data?.paused && (
        <p role="status" className="notice">
          Tất cả lịch đang tạm dừng trên mọi dự án.
        </p>
      )}
      {(error || data?.error) && (
        <div role="alert" className="notice error">
          <span>{error || data?.error}</span>
          <button disabled={busy} onClick={() => void act(reload)}>
            Tải lại
          </button>
        </div>
      )}
      {!data ? (
        <p>{error ? "Chưa tải được lịch." : "Đang tải lịch…"}</p>
      ) : !data.schedules.length ? (
        <div className="empty">
          <strong>Chưa có lịch</strong>
          <span>Tạo lịch cho công việc định kỳ hoặc một lần.</span>
        </div>
      ) : (
        <ul className="schedule-list">
          {data.schedules.map((record) => (
            <li key={record.id} className="card schedule-card">
              <div className="schedule-info">
                <h2>{record.name}</h2>
                <p>
                  {record.timing.kind === "once"
                    ? `Một lần · ${dateLabel(record.timing.at, "UTC")} UTC`
                    : `${record.timing.time} · ${record.timing.weekdays.map((day) => weekdays[day - 1]).join(", ")} · ${record.timing.timeZone}`}
                </p>
                <p className="small muted">
                  {record.enabled
                    ? `Lần tới: ${dateLabel(record.nextAt, record.timing.kind === "daily" ? record.timing.timeZone : "UTC")}`
                    : "Đã tắt"}
                </p>
                {data.latest[record.id] && (
                  <p className="small">
                    Kết quả gần nhất:{" "}
                    {data.latest[record.id].state === "created"
                      ? "Đã tạo công việc"
                      : data.latest[record.id].state === "missed"
                        ? "Đã bỏ lỡ"
                        : "Lỗi · Cần kiểm tra lịch sử"}
                  </p>
                )}
              </div>
              <div className="schedule-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    record.enabled
                      ? void act(() =>
                          value(
                            window.worker.scheduleToggle({
                              ...refOf(record),
                              enabled: false,
                            }),
                          ),
                        )
                      : open(record, true)
                  }
                >
                  {record.enabled ? "Tắt" : "Xem trước & bật"}
                </button>
                <button disabled={busy} onClick={() => open(record)}>
                  Sửa
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      setHistory({
                        record,
                        page: await value(
                          window.worker.scheduleHistory({
                            projectId,
                            id: record.id,
                          }),
                        ),
                      });
                    })
                  }
                >
                  Lịch sử
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {history && (
        <section className="card schedule-history" aria-label="Lịch sử lịch">
          <div className="card-heading">
            <h2>{history.record.name} · Lịch sử</h2>
            <button onClick={() => setHistory(null)}>Đóng lịch sử</button>
          </div>
          {!history.page.items.length && <p>Chưa tới lượt thực hiện.</p>}
          <ul>
            {history.page.items.map((item) => (
              <li key={item.occurrenceKey}>
                <div>
                  <strong>
                    {item.state === "created"
                      ? "Đã tạo công việc"
                      : item.state === "missed"
                        ? "Đã bỏ lỡ"
                        : "Lỗi · Lịch đã tắt"}
                  </strong>
                  <p className="small muted">
                    {dateLabel(item.dueAt)} · Asia/Ho_Chi_Minh
                  </p>
                  {item.reason && <p>{item.reason}</p>}
                </div>
                {item.workItemId && (
                  <button onClick={() => onOpenItem(item.workItemId!)}>
                    Mở công việc
                  </button>
                )}
              </li>
            ))}
          </ul>
          {history.page.nextBefore && (
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const page = await value(
                    window.worker.scheduleHistory({
                      projectId,
                      id: history.record.id,
                      before: history.page.nextBefore!,
                    }),
                  );
                  setHistory({
                    ...history,
                    page: {
                      items: [...history.page.items, ...page.items],
                      nextBefore: page.nextBefore,
                    },
                  });
                })
              }
            >
              Xem trước đó
            </button>
          )}
        </section>
      )}
      {editor && (
        <dialog
          ref={dialog}
          className="schedule-dialog"
          aria-labelledby="schedule-editor-title"
          onCancel={(event) => {
            if (busy) event.preventDefault();
          }}
          onClose={() => {
            setEditor(null);
            setPreview(null);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void editorAction(false);
            }}
          >
            <div className="card-heading">
              <h2 id="schedule-editor-title">
                {editor.enable
                  ? "Bật lịch"
                  : editor.record
                    ? "Sửa lịch"
                    : "Tạo lịch"}
              </h2>
              <button
                type="button"
                disabled={busy}
                onClick={() => dialog.current?.close()}
              >
                Đóng
              </button>
            </div>
            <fieldset
              disabled={busy || editor.enable}
              className="schedule-fields"
            >
              <label>
                Tên lịch
                <input
                  required
                  maxLength={100}
                  value={editor.draft.name}
                  onChange={(e) =>
                    change({ ...editor.draft, name: e.target.value })
                  }
                />
              </label>
              <label>
                Loại lịch
                <Select
                  aria-label="Loại lịch"
                  value={editor.draft.timing.kind}
                  onValueChange={(kind) =>
                    change({
                      ...editor.draft,
                      timing:
                        kind === "once"
                          ? {
                              kind: "once",
                              at: new Date(Date.now() + 3600000).toISOString(),
                            }
                          : {
                              kind: "daily",
                              time: "09:00",
                              timeZone: "Asia/Ho_Chi_Minh",
                              weekdays: [1, 2, 3, 4, 5],
                            },
                    })
                  }
                >
                  <option value="daily">Hằng ngày theo ngày chọn</option>
                  <option value="once">Một lần · UTC</option>
                </Select>
              </label>
              {editor.draft.timing.kind === "once" ? (
                <label>
                  Thời điểm (UTC)
                  <input
                    type="datetime-local"
                    required
                    value={editor.draft.timing.at.slice(0, 16)}
                    onChange={(e) => {
                      const at = new Date(`${e.target.value}:00.000Z`);
                      if (Number.isFinite(at.getTime()))
                        change({
                          ...editor.draft,
                          timing: { kind: "once", at: at.toISOString() },
                        });
                    }}
                  />
                </label>
              ) : (
                <>
                  <div className="schedule-grid">
                    <label>
                      Giờ
                      <input
                        type="time"
                        required
                        value={editor.draft.timing.time}
                        onChange={(e) => {
                          if (editor.draft.timing.kind === "daily")
                            change({
                              ...editor.draft,
                              timing: {
                                ...editor.draft.timing,
                                time: e.target.value,
                              },
                            });
                        }}
                      />
                    </label>
                    <label>
                      Múi giờ IANA
                      <input
                        required
                        maxLength={100}
                        value={editor.draft.timing.timeZone}
                        onChange={(e) => {
                          if (editor.draft.timing.kind === "daily")
                            change({
                              ...editor.draft,
                              timing: {
                                ...editor.draft.timing,
                                timeZone: e.target.value,
                              },
                            });
                        }}
                      />
                    </label>
                  </div>
                  <fieldset className="schedule-days">
                    <legend>Ngày trong tuần</legend>
                    {weekdays.map((day, i) => (
                      <label key={day}>
                        <input
                          type="checkbox"
                          checked={
                            editor.draft.timing.kind === "daily" &&
                            editor.draft.timing.weekdays.includes(i + 1)
                          }
                          onChange={(e) => {
                            if (editor.draft.timing.kind === "daily")
                              change({
                                ...editor.draft,
                                timing: {
                                  ...editor.draft.timing,
                                  weekdays: e.target.checked
                                    ? [
                                        ...editor.draft.timing.weekdays,
                                        i + 1,
                                      ].sort()
                                    : editor.draft.timing.weekdays.filter(
                                        (d) => d !== i + 1,
                                      ),
                                },
                              });
                          }}
                        />
                        {day}
                      </label>
                    ))}
                  </fieldset>
                </>
              )}
              <label>
                Tiêu đề công việc
                <input
                  required
                  maxLength={160}
                  value={editor.draft.action.title}
                  onChange={(e) =>
                    change({
                      ...editor.draft,
                      action: { ...editor.draft.action, title: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                Nội dung
                <textarea
                  rows={4}
                  maxLength={12000}
                  value={editor.draft.action.body}
                  onChange={(e) =>
                    change({
                      ...editor.draft,
                      action: { ...editor.draft.action, body: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                Tiêu chí hoàn thành · mỗi dòng một tiêu chí
                <textarea
                  rows={3}
                  value={editor.draft.action.criteria.join("\n")}
                  onChange={(e) =>
                    change({
                      ...editor.draft,
                      action: {
                        ...editor.draft.action,
                        criteria: e.target.value.split("\n"),
                      },
                    })
                  }
                />
              </label>
            </fieldset>
            {editorError && (
              <p role="alert" className="notice error">
                {editorError}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void (async () => {
                      try {
                        if (editor.record) {
                          const latest = await value(
                            window.worker.scheduleList(projectId),
                          );
                          setData(latest);
                          const record = latest.schedules.find(
                            (item) => item.id === editor.record!.id,
                          );
                          if (record) open(record, editor.enable);
                        }
                      } catch {
                        setEditorError("Không tải lại được lịch.");
                      }
                    })()
                  }
                >
                  Tải bản mới
                </button>
              </p>
            )}
            {preview && (
              <section className="schedule-preview" aria-label="Xem trước lịch">
                <h3>{preview.workItem.title}</h3>
                <p>{preview.workItem.body}</p>
                <ul>
                  {preview.workItem.criteria?.map((criterion, i) => (
                    <li key={i}>{criterion}</li>
                  ))}
                </ul>
                <h3>Thời điểm tới · {zone}</h3>
                <ol>
                  {preview.occurrences.map((at) => (
                    <li key={at}>
                      {dateLabel(at, zone)}
                      <details>
                        <summary>UTC</summary>
                        {at}
                      </details>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            <div className="modal-actions">
              <button type="submit" disabled={busy}>
                Xem trước
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || !preview}
                onClick={() => void editorAction(true)}
              >
                {editor.enable
                  ? "Bật lịch"
                  : editor.record
                    ? "Lưu thay đổi"
                    : "Lưu · mặc định tắt"}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </section>
  );
}
