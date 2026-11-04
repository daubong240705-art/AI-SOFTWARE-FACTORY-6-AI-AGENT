import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  createBoardItemSchema,
  updateBoardItemSchema,
  moveBoardItemSchema,
  boardVersionSchema,
  submitBoardItemSchema,
  type BoardItem,
  type BoardLink,
  type BoardSubmission,
} from "../../shared/board";
import type { z } from "zod";

const fields = `id, project_id AS projectId, title, body, suggested_role AS suggestedRole,
 priority, planning_state AS planningState, position, archived_at AS archivedAt,
 version, created_at AS createdAt, updated_at AS updatedAt`;
export class BoardStore {
  constructor(private db: Database.Database) {}
  item(id: string): BoardItem {
    const item = this.db
      .prepare(`SELECT ${fields} FROM board_items WHERE id=?`)
      .get(id) as BoardItem | undefined;
    if (!item) throw new Error("Không tìm thấy thẻ kế hoạch.");
    return item;
  }
  link(id: string): BoardLink | null {
    return (
      (this.db
        .prepare(
          "SELECT item_id AS itemId,run_id AS runId,follow_up_id AS followUpId,created_at AS createdAt FROM board_links WHERE item_id=?",
        )
        .get(id) as BoardLink | undefined) ?? null
    );
  }
  summaries(projectId: string): Omit<BoardItem, "body">[] {
    return this.db
      .prepare(
        `SELECT ${fields.replace("title, body,", "title,")} FROM board_items WHERE project_id=? ORDER BY position,id`,
      )
      .all(projectId) as Omit<BoardItem, "body">[];
  }
  links(): BoardLink[] {
    return this.db
      .prepare(
        "SELECT item_id AS itemId,run_id AS runId,follow_up_id AS followUpId,created_at AS createdAt FROM board_links",
      )
      .all() as BoardLink[];
  }
  create(input: z.infer<typeof createBoardItemSchema>): BoardItem {
    const data = createBoardItemSchema.parse(input);
    return this.db.transaction(() => {
      if (
        !this.db
          .prepare("SELECT id FROM projects WHERE id=?")
          .get(data.projectId)
      )
        throw new Error("Không tìm thấy dự án.");
      const count = this.db
        .prepare("SELECT COUNT(*) AS n FROM board_items WHERE project_id=?")
        .get(data.projectId) as { n: number };
      if (count.n >= 2000) throw new Error("Dự án đã đủ 2.000 thẻ kế hoạch.");
      const last = this.db
        .prepare(
          "SELECT COALESCE(MAX(position),0) AS n FROM board_items WHERE project_id=?",
        )
        .get(data.projectId) as { n: number };
      const id = randomUUID(),
        at = new Date().toISOString();
      this.db
        .prepare("INSERT INTO board_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          id,
          data.projectId,
          data.title,
          data.body,
          data.suggestedRole,
          data.priority,
          data.planningState,
          last.n + 1,
          null,
          1,
          at,
          at,
        );
      return this.item(id);
    })();
  }
  private editable(id: string, version: number): BoardItem {
    const item = this.item(id);
    if (item.version !== version)
      throw new Error("Thẻ đã thay đổi. Tải lại trước khi sửa.");
    if (this.link(id))
      throw new Error(
        "Thẻ đã gửi thực thi; không sửa trạng thái runtime từ Kanban.",
      );
    if (item.archivedAt)
      throw new Error("Thẻ đã lưu trữ; khôi phục trước khi sửa.");
    return item;
  }
  update(input: z.infer<typeof updateBoardItemSchema>): BoardItem {
    const data = updateBoardItemSchema.parse(input);
    return this.db.transaction(() => {
      const item = { ...this.editable(data.id, data.version), ...data.patch };
      this.db
        .prepare(
          "UPDATE board_items SET title=?,body=?,suggested_role=?,priority=?,planning_state=?,version=version+1,updated_at=? WHERE id=?",
        )
        .run(
          item.title,
          item.body,
          item.suggestedRole,
          item.priority,
          item.planningState,
          new Date().toISOString(),
          item.id,
        );
      return this.item(item.id);
    })();
  }
  move(input: z.infer<typeof moveBoardItemSchema>): BoardItem {
    const data = moveBoardItemSchema.parse(input);
    return this.db.transaction(() => {
      const item = this.editable(data.id, data.version);
      const others = this.summaries(item.projectId).filter(
        (i) =>
          i.id !== item.id &&
          !i.archivedAt &&
          !this.link(i.id) &&
          i.planningState === data.planningState,
      );
      const before = data.beforeId
        ? others.findIndex((i) => i.id === data.beforeId)
        : others.length;
      if (before < 0) throw new Error("Vị trí đích không còn hợp lệ.");
      const order = others.map((i) => i.id);
      order.splice(before, 0, item.id);
      const at = new Date().toISOString();
      for (const [index, id] of order.entries())
        this.db
          .prepare(
            "UPDATE board_items SET position=?,version=version+1,updated_at=? WHERE id=?",
          )
          .run(index + 1, at, id);
      this.db
        .prepare("UPDATE board_items SET planning_state=? WHERE id=?")
        .run(data.planningState, item.id);
      return this.item(item.id);
    })();
  }
  archive(
    input: z.infer<typeof boardVersionSchema> & { archived: boolean },
  ): BoardItem {
    const item = this.item(input.id);
    if (item.version !== input.version)
      throw new Error("Thẻ đã thay đổi. Tải lại trước khi sửa.");
    if (this.link(item.id))
      throw new Error(
        "Giữ thẻ thực thi để theo dõi kết quả; không lưu trữ thẻ đang liên kết.",
      );
    this.db
      .prepare(
        "UPDATE board_items SET archived_at=?,version=version+1,updated_at=? WHERE id=?",
      )
      .run(
        input.archived ? new Date().toISOString() : null,
        new Date().toISOString(),
        item.id,
      );
    return this.item(item.id);
  }
  submit(
    input: z.infer<typeof submitBoardItemSchema>,
    launch: (item: BoardItem) => BoardSubmission,
  ): BoardSubmission {
    const data = submitBoardItemSchema.parse(input);
    return this.db.transaction(() => {
      const item = this.item(data.id),
        link = this.link(item.id);
      if (link) {
        if (item.version !== data.version && item.version !== data.version + 1)
          throw new Error("Thẻ đã thay đổi. Tải lại trước khi gửi.");
        const row = link.runId
          ? this.db
              .prepare(
                "SELECT json_extract(value,'$.conversationId') AS id FROM runs WHERE id=?",
              )
              .get(link.runId)
          : this.db
              .prepare(
                "SELECT conversation_id AS id FROM follow_ups WHERE id=?",
              )
              .get(link.followUpId);
        return {
          ...link,
          conversationId: (row as { id: string }).id,
          queued: !!link.followUpId,
        };
      }
      this.editable(item.id, data.version);
      if (item.planningState !== "ready")
        throw new Error("Đưa thẻ sang Sẵn sàng trước khi gửi Lead.");
      const result = launch(item);
      this.db
        .prepare(
          "INSERT INTO board_links (item_id,run_id,follow_up_id,created_at) VALUES (?,?,?,?)",
        )
        .run(item.id, result.runId, result.followUpId, result.createdAt);
      this.db
        .prepare(
          "UPDATE board_items SET version=version+1,updated_at=? WHERE id=?",
        )
        .run(new Date().toISOString(), item.id);
      return result;
    })();
  }
  claimQueue(followUpId: string, runId: string): void {
    this.db
      .prepare(
        "UPDATE board_links SET run_id=?,follow_up_id=NULL WHERE follow_up_id=?",
      )
      .run(runId, followUpId);
  }
  releaseQueue(id: string): void {
    this.db
      .prepare(
        "UPDATE board_items SET version=version+1,updated_at=? WHERE id IN (SELECT item_id FROM board_links WHERE follow_up_id=?)",
      )
      .run(new Date().toISOString(), id);
    this.db.prepare("DELETE FROM board_links WHERE follow_up_id=?").run(id);
  }
  assertQueueEditable(id: string): void {
    if (
      this.db
        .prepare("SELECT item_id FROM board_links WHERE follow_up_id=?")
        .get(id)
    )
      throw new Error(
        "Yêu cầu đã liên kết Kanban. Bỏ khỏi hàng chờ rồi sửa thẻ để gửi lại.",
      );
  }
  retargetRun(previous: string, next: string): void {
    this.db
      .prepare("UPDATE board_links SET run_id=? WHERE run_id=?")
      .run(next, previous);
  }
}
