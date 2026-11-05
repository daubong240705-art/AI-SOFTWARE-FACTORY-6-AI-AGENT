import type Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  inboxQuerySchema,
  inboxSeenSchema,
  inboxDismissSchema,
  type InboxItem,
  type InboxPage,
} from "../../shared/inbox";
import {
  attentionTitle,
  runIssue,
  type IssueInput,
} from "../../shared/attention";
import { redact } from "../runtime/security";

// One bounded query across projects. Seen is independent from actionable state.
const candidates = `WITH scoped_runs AS (
 SELECT r.*,r.rowid AS seq,COALESCE(s.item_id,CASE WHEN COALESCE(json_extract(r.value,'$.leadAdmission'),0)=0 THEN json_extract(r.value,'$.workContext.itemId') END) AS itemId,
 COALESCE(s.revision,json_extract(r.value,'$.workContext.revision')) AS revision
 FROM runs r LEFT JOIN work_attempts a ON a.run_id=r.id LEFT JOIN work_submissions s ON s.id=a.submission_id
), ranked_runs AS (
 SELECT *,max(seq) OVER(PARTITION BY project_id,COALESCE(itemId,id)) AS latestWork,
 max(seq) OVER(PARTITION BY project_id,COALESCE(json_extract(value,'$.attemptRoot'),id)) AS latestAttempt FROM scoped_runs
), current_runs AS (
 SELECT r.*,b.title AS workTitle,CASE WHEN b.number IS NOT NULL THEN 'W-'||printf('%04d',b.number) END AS code
 FROM ranked_runs r LEFT JOIN board_items b ON b.id=r.itemId AND b.project_id=r.project_id
 WHERE (r.itemId IS NULL OR (b.id IS NOT NULL AND b.archived_at IS NULL AND b.revision=r.revision))
 AND r.seq=r.latestWork AND r.seq=r.latestAttempt
), raw_candidates AS (
 SELECT 'permission:'||r.id AS key,'permission' AS kind,r.project_id AS projectId,
  substr(COALESCE(r.workTitle,json_extract(r.value,'$.prompt')),1,160) AS title,'Công cụ cần quyền thực thi.' AS detail,
  r.created_at AS at,r.id AS runId,json_extract(r.value,'$.conversationId') AS conversationId,
  json_extract(r.value,'$.permissions') AS token
 FROM current_runs r WHERE r.state IN ('running','blocked') AND json_array_length(r.value,'$.permissions')>0
 UNION ALL
 SELECT 'question:'||q.id,'question',q.project_id,substr(COALESCE(r.workTitle,b.title,json_extract(q.value,'$.summary')),1,160),'Lead đang chờ quyết định nghiệp vụ.',q.created_at,q.source_run_id,q.conversation_id,CAST(q.version AS TEXT)
 FROM question_sets q JOIN current_runs r ON r.id=q.source_run_id LEFT JOIN board_items b ON b.id=q.work_item_id
 WHERE q.state='pending' AND r.state='needs_input' AND (q.work_item_id IS NULL OR EXISTS(SELECT 1 FROM board_items b WHERE b.id=q.work_item_id AND b.revision=q.revision AND b.archived_at IS NULL))
 UNION ALL
 SELECT 'report:'||p.id,'report',p.project_id,substr(json_extract(p.value,'$.work.title'),1,160),'Đối chiếu source và xem báo cáo trước khi quyết định.',p.created_at,p.run_id,json_extract(p.value,'$.conversationId'),p.id
 FROM reports p JOIN current_runs cr ON cr.id=p.run_id JOIN report_policies policy ON policy.item_id=p.item_id JOIN board_items b ON b.id=p.item_id
 WHERE policy.required=1 AND cr.state='completed' AND b.archived_at IS NULL AND b.revision=p.revision
 AND NOT EXISTS(SELECT 1 FROM report_decisions d WHERE d.report_id=p.id)
 AND NOT EXISTS(SELECT 1 FROM work_attempts a JOIN work_submissions s ON s.id=a.submission_id JOIN runs r ON r.id=a.run_id WHERE s.item_id=p.item_id AND r.rowid>(SELECT rowid FROM runs WHERE id=p.run_id))
 UNION ALL
 SELECT 'failure:'||r.id,'failure',r.project_id,substr(COALESCE(r.workTitle,json_extract(r.value,'$.prompt')),1,160),substr(COALESCE(json_extract(r.value,'$.error'),''),1,240),COALESCE(json_extract(r.value,'$.endedAt'),r.created_at),r.id,json_extract(r.value,'$.conversationId'),r.state||COALESCE(json_extract(r.value,'$.endedAt'),'')
 FROM current_runs r WHERE r.state IN ('failed','interrupted','blocked','needs_input')
 AND NOT (r.state='blocked' AND json_array_length(r.value,'$.permissions')>0)
 AND NOT EXISTS(SELECT 1 FROM question_sets q WHERE q.source_run_id=r.id)

 AND NOT (r.itemId IS NULL AND (r.state='needs_input' OR COALESCE(json_extract(r.value,'$.failure.code'),'')='needs-context')
 AND COALESCE(json_array_length(r.value,'$.tasks'),0)=0 AND COALESCE(json_array_length(r.value,'$.changes'),0)=0 AND COALESCE(json_array_length(r.value,'$.commands'),0)=0)
 UNION ALL
 SELECT 'queue:'||f.id,'queue',json_extract(f.value,'$.projectId'),substr(COALESCE(b.title,json_extract(f.value,'$.prompt')),1,160),substr(json_extract(f.value,'$.reason'),1,240),json_extract(f.value,'$.createdAt'),NULL,f.conversation_id,json_extract(f.value,'$.reason')
 FROM follow_ups f LEFT JOIN work_submissions s ON s.follow_up_id=f.id LEFT JOIN board_items b ON b.id=s.item_id
 WHERE json_extract(f.value,'$.state')='held' AND (s.item_id IS NULL OR (b.archived_at IS NULL AND b.revision=s.revision AND s.state!='removed'))
), enriched AS (
 SELECT c.*,COALESCE(r.itemId,qb.id) AS itemId,COALESCE(r.code,CASE WHEN qb.number IS NOT NULL THEN 'W-'||printf('%04d',qb.number) END) AS code,
 CASE WHEN c.kind='failure' THEN json_object('state',r.state,'error',substr(COALESCE(json_extract(r.value,'$.error'),''),1,480),'failure',json_extract(r.value,'$.failure'),
 'review',CASE WHEN json_type(r.value,'$.review')='object' THEN json_object('status',json_extract(r.value,'$.review.status'),'summary',substr(json_extract(r.value,'$.review.summary'),1,480),'acceptance',json('[]')) END,
 'tasks',json(COALESCE((SELECT json_group_array(json_object('id',json_extract(t.value,'$.id'),'originalTaskId',json_extract(t.value,'$.originalTaskId'),'title',substr(json_extract(t.value,'$.title'),1,160),'role',json_extract(t.value,'$.role'),'state',json_extract(t.value,'$.state'),'kind',json_extract(t.value,'$.kind'),'error',substr(COALESCE(json_extract(t.value,'$.error'),''),1,480),'failure',json_extract(t.value,'$.failure'))) FROM json_each(r.value,'$.tasks') t),'[]'))) END AS context,
 c.kind='failure' AND r.state!='blocked' AS canDismiss
 FROM raw_candidates c LEFT JOIN current_runs r ON r.id=c.runId
 LEFT JOIN follow_ups f ON c.key='queue:'||f.id LEFT JOIN work_submissions qs ON qs.follow_up_id=f.id
 LEFT JOIN question_sets q ON c.key='question:'||q.id LEFT JOIN board_items qb ON qb.id=COALESCE(qs.item_id,q.work_item_id)
), candidates AS (SELECT *,inbox_token(json_array(token,title,detail,context)) AS currentToken FROM enriched)`;
type Row = Pick<
  InboxItem,
  | "key"
  | "kind"
  | "projectId"
  | "projectName"
  | "title"
  | "detail"
  | "at"
  | "runId"
  | "conversationId"
  | "itemId"
  | "code"
> & {
  currentToken: string;
  seen: number;
  dismissed: number;
  canDismiss: number;
  context: string | null;
};
export class Inbox {
  constructor(
    private db: Database.Database,
    directory: string,
    original: number,
  ) {
    db.function("inbox_token", { deterministic: true }, (value) =>
      createHash("sha256").update(String(value)).digest("hex"),
    );
    if ((db.pragma("user_version", { simple: true }) as number) >= 12) return;
    const backup = join(directory, "worker.schema11.pre-inbox.backup.sqlite");
    if (original === 11 && !existsSync(backup))
      db.prepare("VACUUM INTO ?").run(backup);
    db.transaction(() =>
      db.exec(
        `CREATE TABLE inbox_seen(key TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,token TEXT NOT NULL,seen_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS inbox_run_lineage ON runs(project_id,COALESCE(json_extract(value,'$.attemptRoot'),id));
        CREATE INDEX IF NOT EXISTS inbox_run_state ON runs(state);
        PRAGMA user_version=12;`,
      ),
    )();
  }
  list(
    input: import("zod").z.infer<typeof inboxQuerySchema>,
    secrets: string[] = [],
  ): InboxPage {
    const query = inboxQuerySchema.parse(input);
    const rows = this.db
      .prepare(
        `${candidates}
      SELECT c.key,c.kind,c.projectId,c.title,c.detail,c.at,c.runId,c.conversationId,c.itemId,c.code,c.context,c.canDismiss,c.currentToken,p.name AS projectName,(s.token=c.currentToken) AS seen,COALESCE(d.token=c.currentToken,0) AS dismissed
      FROM candidates c JOIN projects p ON p.id=c.projectId LEFT JOIN inbox_seen s ON s.key=c.key LEFT JOIN inbox_dismissals d ON d.key=c.key
      WHERE COALESCE(d.token=c.currentToken,0)=? AND (?=0 OR s.token IS NULL OR s.token!=c.currentToken)
      AND (? IS NULL OR c.projectId=?) AND (? IS NULL OR (?='decision' AND c.kind IN ('question','report','permission')) OR (?='blocked' AND c.kind IN ('failure','queue')))
      AND (? IS NULL OR c.at<? OR (c.at=? AND c.key<?))
      ORDER BY c.at DESC,c.key DESC LIMIT 51`,
      )
      .all(
        +(query.scope === "closed"),
        +query.unreadOnly,
        query.projectId ?? null,
        query.projectId ?? null,
        query.category ?? null,
        query.category ?? null,
        query.category ?? null,
        query.before?.at ?? null,
        query.before?.at ?? null,
        query.before?.at ?? null,
        query.before?.key ?? null,
      ) as Row[];
    const items: InboxItem[] = rows
      .slice(0, 50)
      .map(({ context, seen, currentToken, canDismiss, dismissed, ...row }) => {
        const issue = context
          ? runIssue(JSON.parse(context) as IssueInput)
          : null;
        const actionLabel = {
          permission: "Xem quyền công cụ",
          question: "Trả lời Lead",
          report: "Xem và quyết định",
          failure: "Xem vấn đề",
          queue: "Xem hàng chờ",
        }[row.kind];
        return {
          ...row,
          token: currentToken,
          projectName: redact(row.projectName, secrets, 160),
          title: attentionTitle(redact(row.title ?? "", secrets, 160)),
          detail: redact(issue?.reason ?? row.detail ?? "", secrets, 480),
          problem:
            issue?.label ??
            {
              permission: "Chờ quyền",
              question: "Cần trả lời",
              report: "Chờ nghiệm thu",
              failure: "Công việc bị chặn",
              queue: "Yêu cầu đang giữ",
            }[row.kind],
          nextAction:
            issue?.nextAction ??
            {
              permission: "Xem công cụ và phạm vi đang chờ quyền.",
              question: "Trả lời câu hỏi để Lead tiếp tục công việc.",
              report:
                "Xem kết quả, đối chiếu source rồi nghiệm thu hoặc yêu cầu sửa.",
              failure: "Xem nguyên nhân trước khi tiếp tục.",
              queue:
                "Mở trao đổi để xem lý do giữ yêu cầu; gửi lại hoặc bỏ yêu cầu.",
            }[row.kind],
          actionLabel,
          taskId: issue?.taskId ?? null,
          taskTitle: issue?.taskTitle
            ? redact(issue.taskTitle, secrets, 160)
            : null,
          unread: !seen,
          canDismiss: !!canDismiss,
          dismissed: !!dismissed,
        };
      });
    const last = items.at(-1);
    return {
      items,
      hasMore: rows.length > 50,
      next: rows.length > 50 && last ? { at: last.at, key: last.key } : null,
    };
  }
  count(): number {
    return (
      this.db
        .prepare(
          `${candidates} SELECT COUNT(*) AS total FROM candidates c JOIN projects p ON p.id=c.projectId LEFT JOIN inbox_dismissals d ON d.key=c.key WHERE COALESCE(d.token=c.currentToken,0)=0`,
        )
        .get() as { total: number }
    ).total;
  }
  seen(input: import("zod").z.infer<typeof inboxSeenSchema>) {
    const data = inboxSeenSchema.parse(input);
    return this.db.transaction(() => {
      const row = this.db
        .prepare(
          `${candidates} SELECT key,projectId,currentToken AS token FROM candidates WHERE key=?`,
        )
        .get(data.key) as
        | Pick<InboxItem, "key" | "projectId" | "token">
        | undefined;
      if (!row || row.token !== data.token)
        throw new Error(
          "Mục đã thay đổi hoặc đã được xử lý. Cập nhật hộp thư.",
        );
      this.db
        .prepare(
          "INSERT INTO inbox_seen VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET token=excluded.token,seen_at=excluded.seen_at",
        )
        .run(row.key, row.projectId, row.token, new Date().toISOString());
      // Bound tombstones without changing actionable state.
      this.db.exec(
        "DELETE FROM inbox_seen WHERE key IN (SELECT key FROM inbox_seen ORDER BY seen_at DESC LIMIT -1 OFFSET 10000)",
      );
    })();
  }
  dismiss(input: import("zod").z.infer<typeof inboxDismissSchema>) {
    const data = inboxDismissSchema.parse(input);
    this.db.transaction(() => {
      const row = this.db
        .prepare(
          `${candidates} SELECT key,projectId,currentToken AS token,canDismiss FROM candidates WHERE key=?`,
        )
        .get(data.key) as
        | { key: string; projectId: string; token: string; canDismiss: number }
        | undefined;
      if (!row || row.token !== data.token)
        throw new Error(
          "Mục đã thay đổi hoặc đã được xử lý. Cập nhật hộp thư.",
        );
      if (!row.canDismiss)
        throw new Error(
          "Chỉ đóng cảnh báo của lượt đã dừng. Câu hỏi, quyền và nghiệm thu cần xử lý tại công việc.",
        );
      if (data.dismissed)
        this.db
          .prepare(
            "INSERT INTO inbox_dismissals VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET token=excluded.token,closed_at=excluded.closed_at",
          )
          .run(row.key, row.projectId, row.token, new Date().toISOString());
      else
        this.db
          .prepare("DELETE FROM inbox_dismissals WHERE key=?")
          .run(row.key);
    })();
  }
}
