import type Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  inboxQuerySchema,
  inboxSeenSchema,
  type InboxItem,
  type InboxPage,
} from "../../shared/inbox";
import { redact } from "../runtime/security";

// One bounded query across projects. Seen is independent from actionable state.
const candidates = `WITH raw_candidates AS (
 SELECT 'permission:'||r.id AS key,'permission' AS kind,r.project_id AS projectId,
  substr(json_extract(r.value,'$.prompt'),1,160) AS title,'Công cụ cần quyền thực thi.' AS detail,
  r.created_at AS at,r.id AS runId,json_extract(r.value,'$.conversationId') AS conversationId,
  json_extract(r.value,'$.permissions') AS token
 FROM runs r WHERE r.state IN ('running','blocked') AND json_array_length(r.value,'$.permissions')>0
 UNION ALL
 SELECT 'question:'||q.id,'question',q.project_id,substr(json_extract(q.value,'$.summary'),1,160),'Lead đang chờ quyết định nghiệp vụ.',q.created_at,q.source_run_id,q.conversation_id,CAST(q.version AS TEXT)
 FROM question_sets q JOIN runs r ON r.id=q.source_run_id
 WHERE q.state='pending' AND r.state='needs_input' AND (q.work_item_id IS NULL OR EXISTS(SELECT 1 FROM board_items b WHERE b.id=q.work_item_id AND b.revision=q.revision AND b.archived_at IS NULL))
 UNION ALL
 SELECT 'report:'||p.id,'report',p.project_id,substr(json_extract(p.value,'$.work.title'),1,160),'Đối chiếu source và xem báo cáo trước khi quyết định.',p.created_at,p.run_id,json_extract(p.value,'$.conversationId'),p.id
 FROM reports p JOIN report_policies policy ON policy.item_id=p.item_id JOIN board_items b ON b.id=p.item_id
 WHERE policy.required=1 AND b.archived_at IS NULL AND b.revision=p.revision
 AND NOT EXISTS(SELECT 1 FROM report_decisions d WHERE d.report_id=p.id)
 AND NOT EXISTS(SELECT 1 FROM work_attempts a JOIN work_submissions s ON s.id=a.submission_id JOIN runs r ON r.id=a.run_id WHERE s.item_id=p.item_id AND r.rowid>(SELECT rowid FROM runs WHERE id=p.run_id))
 UNION ALL
 SELECT 'failure:'||r.id,'failure',r.project_id,substr(json_extract(r.value,'$.prompt'),1,160),substr(COALESCE(json_extract(r.value,'$.error'),''),1,240),COALESCE(json_extract(r.value,'$.endedAt'),r.created_at),r.id,json_extract(r.value,'$.conversationId'),r.state||COALESCE(json_extract(r.value,'$.endedAt'),'')
 FROM runs r WHERE r.state IN ('failed','interrupted','blocked','needs_input')
 AND NOT (r.state='blocked' AND json_array_length(r.value,'$.permissions')>0)
 AND NOT EXISTS(SELECT 1 FROM question_sets q WHERE q.source_run_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM runs n WHERE n.project_id=r.project_id AND COALESCE(json_extract(n.value,'$.attemptRoot'),n.id)=COALESCE(json_extract(r.value,'$.attemptRoot'),r.id) AND n.rowid>r.rowid)
 UNION ALL
 SELECT 'queue:'||f.id,'queue',json_extract(f.value,'$.projectId'),substr(json_extract(f.value,'$.prompt'),1,160),substr(json_extract(f.value,'$.reason'),1,240),json_extract(f.value,'$.createdAt'),NULL,f.conversation_id,json_extract(f.value,'$.reason')
 FROM follow_ups f WHERE json_extract(f.value,'$.state')='held'
), candidates AS (SELECT key,kind,projectId,title,detail,at,runId,conversationId,inbox_token(json_array(token,title,detail)) AS token FROM raw_candidates)`;
type Row = Omit<InboxItem, "unread"> & { seen: number };
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
      SELECT c.*,p.name AS projectName,(s.token=c.token) AS seen FROM candidates c JOIN projects p ON p.id=c.projectId LEFT JOIN inbox_seen s ON s.key=c.key
      WHERE (?=0 OR s.token IS NULL OR s.token!=c.token) AND (? IS NULL OR c.at<? OR (c.at=? AND c.key<?))
      ORDER BY c.at DESC,c.key DESC LIMIT 51`,
      )
      .all(
        +query.unreadOnly,
        query.before?.at ?? null,
        query.before?.at ?? null,
        query.before?.at ?? null,
        query.before?.key ?? null,
      ) as Row[];
    const items = rows.slice(0, 50).map((row) => ({
      ...row,
      projectName: redact(row.projectName, secrets, 160),
      title: redact(row.title ?? "", secrets, 160),
      detail: redact(row.detail ?? "", secrets, 240),
      unread: !row.seen,
    }));
    const last = items.at(-1);
    return {
      items,
      hasMore: rows.length > 50,
      next: rows.length > 50 && last ? { at: last.at, key: last.key } : null,
    };
  }
  seen(input: import("zod").z.infer<typeof inboxSeenSchema>) {
    const data = inboxSeenSchema.parse(input);
    return this.db.transaction(() => {
      const row = this.db
        .prepare(
          `${candidates} SELECT key,projectId,token FROM candidates WHERE key=?`,
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
}
