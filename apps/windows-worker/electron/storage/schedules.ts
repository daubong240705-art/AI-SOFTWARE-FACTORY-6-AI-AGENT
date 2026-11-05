import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  nextScheduleOccurrence,
  planScheduleTick,
  scheduleDeliverySchema,
  scheduleDraftSchema,
  scheduleRecordSchema,
  scheduleInstantSchema,
  type ScheduleDelivery,
  type ScheduleDraft,
  type ScheduleRecord,
} from "../../shared/schedules";
import { createBoardItemSchema, type BoardItem } from "../../shared/board";
import type { BoardStore } from "./board";

const idSchema = z.string().uuid();
const nowSchema = scheduleInstantSchema;
type Row = {
  id: string;
  projectId: string;
  value: string;
  enabled: number;
  version: number;
  nextAt: string | null;
  createdAt: string;
  updatedAt: string;
};
const decode = (row: Row): ScheduleRecord =>
  scheduleRecordSchema.parse({
    ...JSON.parse(row.value),
    id: row.id,
    projectId: row.projectId,
    enabled: !!row.enabled,
    version: row.version,
    nextAt: row.nextAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
export type DeliveryResult =
  | { state: "created"; delivery: ScheduleDelivery; workItem: BoardItem }
  | { state: "missed"; delivery: ScheduleDelivery; workItem: null }
  | null;

export class Schedules {
  constructor(
    private db: Database.Database,
    private board: BoardStore,
  ) {}
  private row(id: string): Row {
    const value = this.db
      .prepare(
        "SELECT id,project_id AS projectId,value,enabled,version,next_at AS nextAt,created_at AS createdAt,updated_at AS updatedAt FROM schedules WHERE id=?",
      )
      .get(idSchema.parse(id)) as Row | undefined;
    if (!value) throw Error("Không tìm thấy lịch.");
    return value;
  }
  get(projectId: string, id: string): ScheduleRecord {
    idSchema.parse(projectId);
    const record = decode(this.row(id));
    if (record.projectId !== projectId) throw Error("Lịch không thuộc dự án.");
    return record;
  }
  list(projectId?: string): ScheduleRecord[] {
    if (projectId !== undefined) idSchema.parse(projectId);
    return (
      this.db
        .prepare(
          "SELECT id,project_id AS projectId,value,enabled,version,next_at AS nextAt,created_at AS createdAt,updated_at AS updatedAt FROM schedules WHERE (? IS NULL OR project_id=?) ORDER BY updated_at DESC,id",
        )
        .all(projectId ?? null, projectId ?? null) as Row[]
    ).map(decode);
  }
  hasProject(projectId: string): boolean {
    idSchema.parse(projectId);
    return !!this.db
      .prepare("SELECT 1 FROM schedules WHERE project_id=? LIMIT 1")
      .get(projectId);
  }
  create(input: ScheduleDraft, now = new Date().toISOString()): ScheduleRecord {
    return this.db
      .transaction(() => {
        const draft = scheduleDraftSchema.parse(input);
        const at = nowSchema.parse(now);
        if (this.list(draft.projectId).length >= 20)
          throw Error("Mỗi dự án chỉ có tối đa 20 lịch.");
        const count = this.db
          .prepare("SELECT COUNT(*) AS n FROM schedules")
          .get() as { n: number };
        if (count.n >= 100) throw Error("Ứng dụng chỉ có tối đa 100 lịch.");
        const id = randomUUID();
        this.db
          .prepare(
            "INSERT INTO schedules(id,project_id,value,enabled,version,next_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(id, draft.projectId, JSON.stringify(draft), 0, 1, null, at, at);
        return this.get(draft.projectId, id);
      })
      .immediate();
  }
  update(
    id: string,
    version: number,
    input: ScheduleDraft,
    now = new Date().toISOString(),
  ): ScheduleRecord {
    return this.db
      .transaction(() => {
        const draft = scheduleDraftSchema.parse(input),
          current = this.get(draft.projectId, id),
          at = nowSchema.parse(now);
        z.number().int().positive().max(999999).parse(version);
        if (current.version !== version)
          throw Error("Lịch đã thay đổi. Tải lại trước khi sửa.");
        if (current.projectId !== draft.projectId)
          throw Error("Không thể chuyển lịch sang dự án khác.");
        const nextAt = current.enabled
          ? nextScheduleOccurrence(draft.timing, at)
          : null;
        this.db
          .prepare(
            "UPDATE schedules SET value=?,enabled=?,version=?,next_at=?,updated_at=? WHERE id=? AND version=?",
          )
          .run(
            JSON.stringify(draft),
            current.enabled && nextAt ? 1 : 0,
            current.version + 1,
            nextAt,
            at,
            id,
            version,
          );
        return this.get(draft.projectId, id);
      })
      .immediate();
  }
  setEnabled(
    projectId: string,
    id: string,
    version: number,
    enabled: boolean,
    now = new Date().toISOString(),
  ): ScheduleRecord {
    return this.db
      .transaction(() => {
        const current = this.get(projectId, id),
          at = nowSchema.parse(now);
        z.number().int().positive().max(999999).parse(version);
        z.boolean().parse(enabled);
        if (current.version !== version)
          throw Error("Lịch đã thay đổi. Tải lại trước khi sửa.");
        const nextAt = enabled
          ? nextScheduleOccurrence(current.timing, at)
          : null;
        if (enabled && !nextAt)
          throw Error("Lịch không còn thời điểm thực hiện trong tương lai.");
        this.db
          .prepare(
            "UPDATE schedules SET enabled=?,version=?,next_at=?,updated_at=? WHERE id=? AND version=?",
          )
          .run(enabled ? 1 : 0, current.version + 1, nextAt, at, id, version);
        return this.get(projectId, id);
      })
      .immediate();
  }
  isPaused(): boolean {
    return !!(
      this.db
        .prepare("SELECT paused FROM schedule_control WHERE id=1")
        .get() as {
        paused: number;
      }
    ).paused;
  }
  setPaused(paused: boolean, now = new Date().toISOString()): void {
    z.boolean().parse(paused);
    this.db
      .prepare("UPDATE schedule_control SET paused=?,updated_at=? WHERE id=1")
      .run(paused ? 1 : 0, nowSchema.parse(now));
  }
  deliveries(
    projectId: string,
    scheduleId: string,
    limit = 50,
  ): ScheduleDelivery[] {
    this.get(projectId, scheduleId);
    const size = z.number().int().min(1).max(50).parse(limit);
    return (
      this.db
        .prepare(
          "SELECT occurrence_key AS occurrenceKey,schedule_id AS scheduleId,schedule_version AS scheduleVersion,due_at AS dueAt,observed_at AS observedAt,state,work_item_id AS workItemId,reason,config FROM schedule_deliveries WHERE schedule_id=? ORDER BY due_at DESC LIMIT ?",
        )
        .all(scheduleId, size) as (Omit<ScheduleDelivery, "config"> & {
        config: string;
      })[]
    ).map((value) =>
      scheduleDeliverySchema.parse({
        ...value,
        config: JSON.parse(value.config),
      }),
    );
  }
  deliverDue(id: string, now: string): DeliveryResult {
    const observedAt = nowSchema.parse(now);
    return this.db
      .transaction(() => {
        const current = decode(this.row(id));
        if (!current.enabled || !current.nextAt || this.isPaused()) return null;
        const plan = planScheduleTick({
          id,
          version: current.version,
          timing: current.timing,
          nextAt: current.nextAt,
          now: observedAt,
        });
        if (plan.state === "waiting") return null;
        if (
          this.db
            .prepare("SELECT 1 FROM schedule_deliveries WHERE occurrence_key=?")
            .get(plan.key)
        )
          return null;
        let workItem: BoardItem | null = null;
        if (plan.state === "due") {
          workItem = this.board.create(
            createBoardItemSchema.parse({
              projectId: current.projectId,
              title: current.action.title,
              body: current.action.body,
              criteria: current.action.criteria,
              suggestedRole: null,
              priority: 0,
              planningState: "backlog",
            }),
          );
        }
        const delivery = scheduleDeliverySchema.parse({
          occurrenceKey: plan.key,
          scheduleId: id,
          scheduleVersion: current.version,
          dueAt: current.nextAt,
          observedAt,
          state: plan.state === "due" ? "created" : "missed",
          workItemId: workItem?.id ?? null,
          reason:
            plan.state === "missed" ? "Lịch đã lỡ quá thời gian cho phép." : "",
          config: scheduleDraftSchema.parse({
            projectId: current.projectId,
            name: current.name,
            timing: current.timing,
            action: current.action,
            missedPolicy: current.missedPolicy,
          }),
        });
        this.db
          .prepare(
            "INSERT INTO schedule_deliveries(occurrence_key,schedule_id,schedule_version,due_at,observed_at,state,work_item_id,reason,config) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            delivery.occurrenceKey,
            delivery.scheduleId,
            delivery.scheduleVersion,
            delivery.dueAt,
            delivery.observedAt,
            delivery.state,
            delivery.workItemId,
            delivery.reason,
            JSON.stringify(delivery.config),
          );
        this.db
          .prepare(
            "UPDATE schedules SET enabled=?,version=?,next_at=?,updated_at=? WHERE id=? AND version=?",
          )
          .run(
            plan.nextAt ? 1 : 0,
            current.version + 1,
            plan.nextAt,
            observedAt,
            id,
            current.version,
          );
        return workItem
          ? { state: "created" as const, delivery, workItem }
          : { state: "missed" as const, delivery, workItem: null };
      })
      .immediate();
  }
}
