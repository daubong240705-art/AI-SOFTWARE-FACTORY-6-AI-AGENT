import type { Database } from "better-sqlite3";
import type { NotificationCategory, NotificationUrgency, NotificationView } from "@factory/contracts";
import { publicApprovalText } from "../approvals/service.js";

export interface NotificationInput {
  projectId: string; dedupKey: string; category: NotificationCategory; urgency: NotificationUrgency;
  title: string; body: string; entity?: { kind: string; id: string }; now: Date; id: string;
}
/** Canonical tuple: (entity kind, entity id, revision-or-opened-at, class).
 * Reminders use (approval, id, reminder-N); digests use (project, local date, digest).
 * JSON encoding prevents delimiter collisions in names and timestamps. */
export const notificationKey = (...parts: (string | number)[]): string => JSON.stringify(parts);

export function createNotification(raw: Database, input: NotificationInput): { created: boolean } {
  const result = raw.prepare(`INSERT INTO notifications
    (project_id,id,dedup_key,category,urgency,title,body,entity_kind,entity_id,state,created_at,read_at)
    VALUES (?,?,?,?,?,?,?,?,?,'unread',?,NULL) ON CONFLICT(project_id,dedup_key) DO NOTHING`)
    .run(input.projectId, input.id, input.dedupKey, input.category, input.urgency,
      publicApprovalText(input.title).trim().slice(0, 200) || "Notification", publicApprovalText(input.body).slice(0, 1000),
      input.entity?.kind ?? null, input.entity?.id ?? null, input.now.toISOString());
  return { created: result.changes > 0 };
}

export function listNotifications(raw: Database, projectId: string, state: NotificationView["state"] | "all" = "unread"):
  { items: NotificationView[]; unread: number } {
  const items = raw.prepare(`SELECT id,category,urgency,title,body,entity_kind AS entityKind,entity_id AS entityId,
    state,created_at AS createdAt,read_at AS readAt FROM notifications WHERE project_id=? AND (?='all' OR state=?)
    ORDER BY created_at DESC,rowid DESC LIMIT 100`).all(projectId, state, state) as NotificationView[];
  const { n } = raw.prepare("SELECT count(*) AS n FROM notifications WHERE project_id=? AND state='unread'").get(projectId) as { n: number };
  return { items: items.map((item) => ({ ...item, title: publicApprovalText(item.title), body: publicApprovalText(item.body) })), unread: n };
}
