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
  type WorkItemDetail,
  type WorkRevision,
  type WorkSubmission,
  type WorkComment,
  workItemPageSchema,
  workCommentSchema,
  workItemRefSchema,
  materializeWorkItemSchema,
} from "../../shared/board";
import { normalizeRun } from "../../shared/runs";
import type { z } from "zod";

const fields = `id, project_id AS projectId, title, body, suggested_role AS suggestedRole,
 priority, planning_state AS planningState, position, archived_at AS archivedAt,
 version, created_at AS createdAt, updated_at AS updatedAt, criteria,
 number, revision, conversation_id AS conversationId`;
type ItemRow = Omit<BoardItem, "criteria" | "code"> & {
  criteria: string;
  number: number;
};
const decode = (item: ItemRow): BoardItem => {
  const { number, ...row } = item;
  return {
    ...row,
    criteria: JSON.parse(row.criteria),
    code: `W-${String(number).padStart(4, "0")}`,
  };
};
export class BoardStore {
  constructor(private db: Database.Database) {}
  item(id: string): BoardItem {
    const item = this.db
      .prepare(`SELECT ${fields} FROM board_items WHERE id=?`)
      .get(id) as ItemRow | undefined;
    if (!item) throw new Error("Không tìm thấy thẻ kế hoạch.");
    return decode(item);
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
    return (
      this.db
        .prepare(
          `SELECT ${fields.replace("title, body,", "title,").replace("updatedAt, criteria,", "updatedAt, '[]' AS criteria,")} FROM board_items WHERE project_id=? ORDER BY position,id`,
        )
        .all(projectId) as ItemRow[]
    ).map(decode);
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
        .prepare(
          "INSERT INTO board_items (id,project_id,title,body,suggested_role,priority,planning_state,position,archived_at,version,created_at,updated_at,criteria,number) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
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
          JSON.stringify(data.criteria ?? []),
          this.nextNumber(data.projectId),
        );
      this.recordRevision(this.item(id));
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
      const previous = this.versioned(data.id, data.version);
      if (this.link(previous.id) && data.patch.planningState !== undefined)
        throw new Error(
          "Thẻ đã gửi thực thi; không sửa trạng thái runtime từ Kanban.",
        );
      const item = { ...previous, ...data.patch };
      const changed =
        item.title !== previous.title ||
        item.body !== previous.body ||
        JSON.stringify(item.criteria) !== JSON.stringify(previous.criteria);
      if (changed && previous.revision >= 500)
        throw new Error("Công việc đã đủ 500 phiên bản.");
      this.db
        .prepare(
          "UPDATE board_items SET title=?,body=?,suggested_role=?,priority=?,planning_state=?,criteria=?,revision=revision+?,version=version+1,updated_at=? WHERE id=?",
        )
        .run(
          item.title,
          item.body,
          item.suggestedRole,
          item.priority,
          item.planningState,
          JSON.stringify(item.criteria),
          Number(changed),
          new Date().toISOString(),
          item.id,
        );
      if (changed) this.recordRevision(this.item(item.id));
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
    return this.db.transaction(() => {
      const item = this.item(input.id);
      if (item.version !== input.version)
        throw new Error("Thẻ đã thay đổi. Tải lại trước khi sửa.");
      if (this.pending(item.id))
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
    })();
  }
  private nextNumber(projectId: string): number {
    this.db
      .prepare("INSERT OR IGNORE INTO work_counters VALUES (?,1)")
      .run(projectId);
    const row = this.db
      .prepare(
        "UPDATE work_counters SET next_number=next_number+1 WHERE project_id=? RETURNING next_number-1 AS n",
      )
      .get(projectId) as { n: number };
    return row.n;
  }
  private recordRevision(item: BoardItem, origin = "user") {
    this.db
      .prepare("INSERT INTO work_revisions VALUES (?,?,?,?,?,?,?)")
      .run(
        item.id,
        item.revision,
        item.title,
        item.body,
        JSON.stringify(item.criteria),
        item.updatedAt,
        origin,
      );
  }
  private versioned(id: string, version: number) {
    const item = this.item(id);
    if (item.version !== version)
      throw new Error("Thẻ đã thay đổi. Tải lại trước khi sửa.");
    if (item.archivedAt)
      throw new Error("Thẻ đã lưu trữ; khôi phục trước khi sửa.");
    return item;
  }
  private pending(id: string): boolean {
    return !!this.db
      .prepare(
        `SELECT s.id FROM work_submissions s LEFT JOIN runs r ON r.id=s.current_run_id
      WHERE s.item_id=? AND (s.follow_up_id IS NOT NULL OR r.state IN ('queued','running','blocked','cancelling')) LIMIT 1`,
      )
      .get(id);
  }
  submit(
    input: z.infer<typeof submitBoardItemSchema>,
    launch: (item: BoardItem) => BoardSubmission,
  ): BoardSubmission {
    const data = submitBoardItemSchema.parse(input);
    return this.db.transaction(() => {
      const item = this.item(data.id);
      const existing = data.submissionKey
        ? this.db
            .prepare("SELECT * FROM work_submissions WHERE request_key=?")
            .get(data.submissionKey)
        : this.db
            .prepare(
              "SELECT * FROM work_submissions WHERE item_id=? AND revision=? AND state!='removed' ORDER BY rowid DESC LIMIT 1",
            )
            .get(item.id, item.revision);
      if (existing) {
        const row = existing as {
          item_id: string;
          request_version: number;
          run_id: string | null;
          current_run_id: string | null;
          follow_up_id: string | null;
          conversation_id: string;
          created_at: string;
          state: string;
        };
        if (row.state === "removed")
          throw new Error(
            "Lần gửi đã bỏ khỏi hàng chờ. Tải lại để gửi lần mới.",
          );
        if (data.conversationId && data.conversationId !== row.conversation_id)
          throw new Error("Lần gửi đã thuộc hội thoại khác.");
        if (
          row.item_id !== item.id ||
          (data.version !== row.request_version &&
            data.version !== item.version)
        )
          throw new Error("Thẻ đã thay đổi. Tải lại trước khi gửi.");
        return {
          itemId: item.id,
          runId: row.current_run_id ?? row.run_id,
          followUpId: row.follow_up_id,
          conversationId: row.conversation_id,
          createdAt: row.created_at,
          queued: !!row.follow_up_id,
        };
      }
      this.versioned(item.id, data.version);
      if (this.pending(item.id))
        throw new Error(
          "Công việc đang chạy hoặc chờ lượt; chưa thể gửi lần mới.",
        );
      if (!this.link(item.id) && item.planningState !== "ready")
        throw new Error("Đưa thẻ sang Sẵn sàng trước khi gửi Lead.");
      const count = this.db
        .prepare("SELECT count(*) AS n FROM work_submissions WHERE item_id=?")
        .get(item.id) as { n: number };
      if (count.n >= 100) throw new Error("Công việc đã đủ 100 lần gửi.");
      const result = launch(item);
      const submission = randomUUID();
      this.db
        .prepare(
          "INSERT INTO work_submissions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          submission,
          item.id,
          item.revision,
          data.submissionKey ?? randomUUID(),
          data.version,
          result.runId,
          result.runId,
          result.followUpId,
          result.followUpId,
          result.conversationId,
          result.queued ? "queued" : "running",
          result.createdAt,
        );
      if (result.runId)
        this.db
          .prepare("INSERT INTO work_attempts VALUES (?,?)")
          .run(result.runId, submission);
      if (!this.link(item.id))
        this.db
          .prepare(
            "INSERT INTO board_links (item_id,run_id,follow_up_id,created_at) VALUES (?,?,?,?)",
          )
          .run(item.id, result.runId, result.followUpId, result.createdAt);
      this.db
        .prepare(
          "UPDATE board_items SET conversation_id=?,version=version+1,updated_at=? WHERE id=?",
        )
        .run(result.conversationId, result.createdAt, item.id);
      return result;
    })();
  }
  claimQueue(followUpId: string, runId: string) {
    this.db
      .prepare(
        "UPDATE board_links SET run_id=?,follow_up_id=NULL WHERE follow_up_id=?",
      )
      .run(runId, followUpId);
    const row = this.db
      .prepare("SELECT id FROM work_submissions WHERE follow_up_id=?")
      .get(followUpId) as { id: string } | undefined;
    if (row) {
      this.db
        .prepare(
          "UPDATE work_submissions SET run_id=?,current_run_id=?,follow_up_id=NULL,state='running' WHERE id=?",
        )
        .run(runId, runId, row.id);
      this.db
        .prepare("INSERT INTO work_attempts VALUES (?,?)")
        .run(runId, row.id);
    }
  }
  releaseQueue(id: string) {
    const row = this.db
      .prepare("SELECT item_id FROM work_submissions WHERE follow_up_id=?")
      .get(id) as { item_id: string } | undefined;
    if (row) {
      this.db
        .prepare(
          "UPDATE work_submissions SET follow_up_id=NULL,state='removed' WHERE follow_up_id=?",
        )
        .run(id);
      this.db
        .prepare(
          "UPDATE board_items SET version=version+1,updated_at=? WHERE id=?",
        )
        .run(new Date().toISOString(), row.item_id);
    }
    this.db.prepare("DELETE FROM board_links WHERE follow_up_id=?").run(id);
  }
  assertQueueEditable(id: string) {
    if (
      this.db
        .prepare("SELECT id FROM work_submissions WHERE follow_up_id=?")
        .get(id)
    )
      throw new Error(
        "Yêu cầu đã liên kết Kanban. Bỏ khỏi hàng chờ rồi sửa thẻ để gửi lại.",
      );
  }
  retargetRun(previous: string, next: string) {
    this.db
      .prepare("UPDATE board_links SET run_id=? WHERE run_id=?")
      .run(next, previous);
    const row = this.db
      .prepare("SELECT submission_id FROM work_attempts WHERE run_id=?")
      .get(previous) as { submission_id: string } | undefined;
    if (row) {
      this.db
        .prepare("INSERT OR IGNORE INTO work_attempts VALUES (?,?)")
        .run(next, row.submission_id);
      // Retrying an older submission must never supersede a newer submission.
      this.db
        .prepare("UPDATE work_submissions SET current_run_id=? WHERE id=?")
        .run(next, row.submission_id);
    }
  }
  currentLinks(projectId?: string): BoardLink[] {
    return this.db
      .prepare(
        `SELECT s.item_id AS itemId,s.revision,s.current_run_id AS runId,s.follow_up_id AS followUpId,s.created_at AS createdAt
      FROM work_submissions s JOIN board_items b ON b.id=s.item_id WHERE (? IS NULL OR b.project_id=?) AND s.state!='removed' AND s.rowid=(SELECT max(n.rowid) FROM work_submissions n WHERE n.item_id=s.item_id AND n.state!='removed')`,
      )
      .all(projectId ?? null, projectId ?? null) as BoardLink[];
  }
  projectionLinks(projectId?: string): BoardLink[] {
    const latest = this.currentLinks(projectId);
    const currentRuns = new Set(latest.map((l) => l.runId));
    const history = this.db
      .prepare(
        `SELECT s.item_id AS itemId,a.run_id AS runId,NULL AS followUpId,s.created_at AS createdAt FROM work_attempts a JOIN work_submissions s ON s.id=a.submission_id JOIN board_items b ON b.id=s.item_id WHERE (? IS NULL OR b.project_id=?)`,
      )
      .all(projectId ?? null, projectId ?? null) as BoardLink[];
    return [
      ...latest.map((link) => ({ ...link, current: true })),
      ...history
        .filter((link) => !currentRuns.has(link.runId))
        .map((link) => ({ ...link, current: false })),
    ];
  }
  protectedRunIds(): string[] {
    return (
      this.db.prepare("SELECT run_id AS id FROM work_attempts").all() as {
        id: string;
      }[]
    ).map((r) => r.id);
  }
  detail(input: z.infer<typeof workItemPageSchema>): WorkItemDetail {
    const data = workItemPageSchema.parse(input);
    const item = this.scoped(data.projectId, data.itemId);
    const revisions = (
      this.db
        .prepare(
          `SELECT revision,title,body,criteria,created_at AS createdAt,origin FROM work_revisions WHERE item_id=? AND revision<? ORDER BY revision DESC LIMIT 21`,
        )
        .all(item.id, data.before ?? 2147483647) as (Omit<
        WorkRevision,
        "criteria"
      > & { criteria: string })[]
    ).map((r) => ({ ...r, criteria: JSON.parse(r.criteria) }));
    const comments = this.comments(item.id);
    const submissions = this.submissions(item.id, data.offset ?? 0);
    return {
      item,
      revisions: revisions.slice(0, 20),
      hasEarlierRevisions: revisions.length > 20,
      comments: comments.slice(0, 50),
      hasEarlierComments: comments.length > 50,
      submissions: submissions.slice(0, 20),
      hasMoreSubmissions: submissions.length > 20,
    };
  }
  private scoped(project: string, id: string) {
    const item = this.item(id);
    if (item.projectId !== project)
      throw new Error("Công việc không thuộc dự án.");
    return item;
  }
  private comments(id: string, before = 2147483647): WorkComment[] {
    return this.db
      .prepare(
        "SELECT id,sequence,body,created_at AS createdAt,'user' AS actor FROM work_comments WHERE item_id=? AND sequence<? ORDER BY sequence DESC LIMIT 51",
      )
      .all(id, before) as WorkComment[];
  }
  commentPage(input: z.infer<typeof workItemPageSchema>) {
    const data = workItemPageSchema.parse(input);
    this.scoped(data.projectId, data.itemId);
    const rows = this.comments(data.itemId, data.before);
    return { comments: rows.slice(0, 50), hasMore: rows.length > 50 };
  }
  addComment(input: z.infer<typeof workCommentSchema>): WorkComment {
    const data = workCommentSchema.parse(input);
    return this.db.transaction(() => {
      this.scoped(data.projectId, data.itemId);
      const prior = this.db
        .prepare("SELECT item_id,body FROM work_comments WHERE id=?")
        .get(data.clientId) as { item_id: string; body: string } | undefined;
      if (prior && (prior.item_id !== data.itemId || prior.body !== data.body))
        throw new Error("Mã tin nhắn đã được dùng cho nội dung khác.");
      const count = this.db
        .prepare("SELECT count(*) AS n FROM work_comments WHERE item_id=?")
        .get(data.itemId) as { n: number };
      if (!prior && count.n >= 1000)
        throw new Error("Công việc đã đủ 1.000 trao đổi.");
      this.db
        .prepare(
          "INSERT OR IGNORE INTO work_comments(id,item_id,body,created_at) VALUES (?,?,?,?)",
        )
        .run(data.clientId, data.itemId, data.body, new Date().toISOString());
      return this.db
        .prepare(
          "SELECT id,sequence,body,created_at AS createdAt,'user' AS actor FROM work_comments WHERE id=?",
        )
        .get(data.clientId) as WorkComment;
    })();
  }
  private submissions(itemId: string, offset = 0): WorkSubmission[] {
    const rows = this.db
      .prepare(
        `SELECT id,item_id AS itemId,revision,run_id AS runId,current_run_id AS currentRunId,follow_up_id AS followUpId,
      conversation_id AS conversationId,state,created_at AS createdAt FROM work_submissions WHERE item_id=? ORDER BY rowid DESC LIMIT 21 OFFSET ?`,
      )
      .all(itemId, offset) as Omit<
      WorkSubmission,
      "attempts" | "hasEarlierAttempts"
    >[];
    return rows.map((row) => {
      const attempts = this.db
        .prepare(
          `SELECT r.id,r.state,json_extract(r.value,'$.role') AS role,json_extract(r.value,'$.model') AS model,
      r.created_at AS createdAt,json_extract(r.value,'$.endedAt') AS endedAt FROM work_attempts a JOIN runs r ON a.run_id=r.id WHERE a.submission_id=? ORDER BY r.rowid DESC LIMIT 101`,
        )
        .all(row.id) as WorkSubmission["attempts"];
      return {
        ...row,
        attempts: attempts.slice(0, 100),
        hasEarlierAttempts: attempts.length > 100,
      };
    });
  }
  materialize(input: z.infer<typeof materializeWorkItemSchema>): BoardItem {
    const data = materializeWorkItemSchema.parse(input);
    return this.db.transaction(() => {
      const row = this.db
        .prepare("SELECT value FROM runs WHERE id=? AND project_id=?")
        .get(data.runId, data.projectId) as { value: string } | undefined;
      if (!row) throw new Error("Lượt chạy không thuộc dự án.");
      const run = normalizeRun(JSON.parse(row.value));
      const existing = this.db
        .prepare(
          "SELECT s.item_id FROM work_attempts a JOIN work_submissions s ON s.id=a.submission_id WHERE a.run_id=?",
        )
        .get(run.id) as { item_id: string } | undefined;
      if (existing) return this.item(existing.item_id);
      const root = run.attemptRoot ?? run.id;
      const attempts = this.db
        .prepare(
          "SELECT id,value FROM runs WHERE project_id=? AND COALESCE(json_extract(value,'$.attemptRoot'),id)=? ORDER BY created_at DESC,rowid DESC",
        )
        .all(data.projectId, root) as { id: string; value: string }[];
      const latest = normalizeRun(JSON.parse(attempts[0].value));
      const item = this.create({
        projectId: data.projectId,
        title: run.prompt.slice(0, 160) || "Công việc",
        body: run.prompt.slice(0, 12000),
        criteria: [],
        priority: 0,
        suggestedRole: null,
        planningState: "ready",
      });
      this.db
        .prepare("UPDATE work_revisions SET origin='legacy' WHERE item_id=?")
        .run(item.id);
      let conversation = latest.conversationId;
      if (
        !conversation ||
        !this.db
          .prepare("SELECT id FROM conversations WHERE id=? AND project_id=?")
          .get(conversation, data.projectId)
      ) {
        conversation = randomUUID();
        const at = new Date().toISOString();
        this.db
          .prepare("INSERT INTO conversations VALUES (?,?,?,?,?,'')")
          .run(conversation, data.projectId, item.title.slice(0, 100), at, at);
      }
      const submission = randomUUID();
      this.db
        .prepare(
          "INSERT INTO work_submissions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          submission,
          item.id,
          1,
          `legacy:${item.id}`,
          item.version,
          run.id,
          latest.id,
          null,
          null,
          conversation,
          "running",
          run.createdAt,
        );
      for (const attempt of attempts)
        this.db
          .prepare("INSERT INTO work_attempts VALUES (?,?)")
          .run(attempt.id, submission);
      this.db
        .prepare(
          "INSERT INTO board_links(item_id,run_id,follow_up_id,created_at) VALUES (?,?,NULL,?)",
        )
        .run(item.id, latest.id, run.createdAt);
      this.db
        .prepare("UPDATE board_items SET conversation_id=? WHERE id=?")
        .run(conversation, item.id);
      return this.item(item.id);
    })();
  }
  exportItem(input: z.infer<typeof workItemRefSchema>) {
    const data = workItemRefSchema.parse(input),
      item = this.scoped(data.projectId, data.itemId);
    return {
      version: 1,
      format: "asf-work-item",
      exportedAt: new Date().toISOString(),
      artifacts: {
        included: false,
        note: "Hồ sơ chứa yêu cầu, trao đổi và liên kết thực thi. Xuất báo cáo từng lượt để lấy evidence; file source không nằm trong gói này.",
      },
      item,
      revisions: (
        this.db
          .prepare(
            "SELECT revision,title,body,criteria,origin,created_at AS createdAt FROM work_revisions WHERE item_id=? ORDER BY revision",
          )
          .all(item.id) as (Omit<WorkRevision, "criteria"> & {
          criteria: string;
        })[]
      ).map((r) => ({ ...r, criteria: JSON.parse(r.criteria) })),
      comments: this.db
        .prepare(
          "SELECT id,body,created_at FROM work_comments WHERE item_id=? ORDER BY sequence",
        )
        .all(item.id),
      submissions: this.db
        .prepare(
          "SELECT * FROM work_submissions WHERE item_id=? ORDER BY rowid",
        )
        .all(item.id),
      attempts: this.db
        .prepare(
          "SELECT a.run_id AS runId,a.submission_id AS submissionId,r.state,r.created_at AS createdAt,json_extract(r.value,'$.endedAt') AS endedAt FROM work_attempts a JOIN work_submissions s ON s.id=a.submission_id JOIN runs r ON r.id=a.run_id WHERE s.item_id=? ORDER BY r.rowid",
        )
        .all(item.id),
    };
  }
  runReference(runId: string) {
    return (
      this.db
        .prepare(
          `SELECT s.id AS submissionId,s.item_id AS itemId,s.revision,r.title,r.body,r.criteria,r.origin
      FROM work_attempts a JOIN work_submissions s ON s.id=a.submission_id
      JOIN work_revisions r ON r.item_id=s.item_id AND r.revision=s.revision WHERE a.run_id=?`,
        )
        .get(runId) ?? null
    );
  }
}
