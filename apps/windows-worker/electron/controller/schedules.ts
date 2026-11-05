import { createHash, randomUUID } from "node:crypto";
import { setImmediate as yieldTurn } from "node:timers/promises";
import {
  previewSchedule,
  scheduleDraftSchema,
  schedulePreviewSchema,
  scheduleSaveSchema,
  scheduleToggleSchema,
  type ScheduleRecord,
} from "../../shared/schedules";
import type { Store } from "../storage/database";

export class ScheduleService {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = true;
  private error = "";
  private previews = new Map<
    string,
    { hash: string; expires: number; firstAt: string }
  >();
  constructor(
    private store: Store,
    private clock = () => new Date().toISOString(),
  ) {}
  private hash(input: unknown) {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex");
  }
  list(projectId: string) {
    this.store.project(projectId);
    const schedules = this.store.schedules.list(projectId);
    const latest = Object.fromEntries(
      schedules.flatMap((schedule) => {
        const receipt = this.store.schedules.history(
          projectId,
          schedule.id,
          undefined,
          1,
        ).items[0];
        return receipt ? [[schedule.id, receipt]] : [];
      }),
    );
    return {
      schedules,
      latest,
      paused: this.store.schedules.isPaused(),
      error: this.error,
    };
  }
  preview(input: unknown) {
    const data = schedulePreviewSchema.parse(input);
    this.store.project(data.draft.projectId);
    if (data.ref) {
      if (data.ref.projectId !== data.draft.projectId)
        throw Error("Lịch không thuộc dự án.");
      if (
        this.store.schedules.get(data.ref.projectId, data.ref.id).version !==
        data.ref.version
      )
        throw Error("Lịch đã thay đổi. Tải lại trước khi sửa.");
    }
    const now = this.clock();
    const preview = previewSchedule(data.draft, now);
    if (!preview.occurrences.length)
      throw Error("Lịch không còn thời điểm trong tương lai.");
    const token = randomUUID(),
      expires = Date.parse(now) + 300000;
    for (const [key, value] of this.previews)
      if (value.expires <= Date.parse(now)) this.previews.delete(key);
    if (this.previews.size >= 100)
      this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(token, {
      hash: this.hash(data),
      expires,
      firstAt: preview.occurrences[0],
    });
    return { ...preview, token, expiresAt: new Date(expires).toISOString() };
  }
  private consume(token: string, data: unknown) {
    const preview = this.previews.get(token);
    this.previews.delete(token);
    if (
      !preview ||
      preview.expires <= Date.parse(this.clock()) ||
      preview.firstAt <= this.clock() ||
      preview.hash !== this.hash(data)
    )
      throw Error("Bản xem trước đã thay đổi hoặc hết hạn. Xem trước lại.");
  }
  save(input: unknown) {
    const { token, ...data } = scheduleSaveSchema.parse(input);
    this.store.project(data.draft.projectId);
    this.consume(token, data);
    if (!previewSchedule(data.draft, this.clock()).occurrences.length)
      throw Error("Thời điểm đã qua. Chỉnh lịch và xem trước lại.");
    if (data.ref) {
      if (data.ref.projectId !== data.draft.projectId)
        throw Error("Lịch không thuộc dự án.");
      return this.store.schedules.update(
        data.ref.id,
        data.ref.version,
        data.draft,
        this.clock(),
      );
    }
    return this.store.schedules.create(data.draft, this.clock());
  }
  toggle(input: unknown) {
    const data = scheduleToggleSchema.parse(input);
    this.store.project(data.projectId);
    if (data.enabled) {
      const current = this.store.schedules.get(data.projectId, data.id);
      const draft = scheduleDraftSchema.parse({
        projectId: current.projectId,
        name: current.name,
        timing: current.timing,
        action: current.action,
        missedPolicy: current.missedPolicy,
      });
      if (!data.token) throw Error("Xem trước lịch trước khi bật.");
      this.consume(data.token, {
        draft,
        ref: { projectId: data.projectId, id: data.id, version: data.version },
      });
    }
    return this.store.schedules.setEnabled(
      data.projectId,
      data.id,
      data.version,
      data.enabled,
      this.clock(),
    );
  }
  pause(paused: boolean) {
    this.store.schedules.setPaused(paused, this.clock());
    this.error = "";
    if (!paused) void this.tick();
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), 30000);
    void this.tick();
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.previews.clear();
  }
  async tick() {
    if (this.running || this.stopped || this.error) return;
    this.running = true;
    try {
      const now = this.clock();
      this.store.schedules.prune(now);
      if (this.store.schedules.isPaused()) return;
      const due = this.store.schedules.due(now);
      for (const schedule of due) {
        if (this.stopped || this.store.schedules.isPaused()) break;
        try {
          this.store.schedules.deliverDue(schedule.id, this.clock());
        } catch {
          this.recordFailure(schedule);
        }
        await yieldTurn();
      }
    } catch {
      this.error =
        "Không ghi được lịch. Đã tạm dừng tất cả; kiểm tra dung lượng và quyền dữ liệu rồi tiếp tục.";
      try {
        this.store.schedules.setPaused(true, this.clock());
      } catch {
        /* Keep visible error even when storage is unavailable. */
      }
    } finally {
      this.running = false;
    }
  }
  private recordFailure(schedule: ScheduleRecord) {
    // Fixed text avoids persisting raw SQL, file paths or credentials from errors.
    this.store.schedules.fail(
      schedule,
      this.clock(),
      "Không tạo được công việc: kiểm tra giới hạn thẻ/lịch sử hoặc dữ liệu. Lịch đã tắt; sửa nguyên nhân rồi xem trước và bật lại.",
    );
  }
}
