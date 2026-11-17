import type { Database } from "better-sqlite3";
import { PUSH_MAX_ATTEMPTS, PUSH_RETRY_MS, QUIET_HOURS, type NotificationCategory, type NotificationUrgency } from "@factory/contracts";
import { publicApprovalText } from "../approvals/service.js";
import { NotifySendError } from "./channels.js";

export interface PushChannel {
  name: string;
  send(payload: { title: string; body: string; level: "action" | "important" | "digest"; urgency: "normal" | "urgent"; link: string;
    approval?: { projectId: string; approvalId: string } }): Promise<void>;
}
interface Delivery {
  project_id: string; notification_id: string; title: string; body: string; category: NotificationCategory; urgency: NotificationUrgency;
  attempts: number; state: string; deliver_after: string | null;
  entity_kind: string | null; entity_id: string | null;
}
export function quietEnd(now: Date, utcOffsetMinutes: number): string | null {
  const local = new Date(now.getTime() + utcOffsetMinutes * 60_000);
  const hour = local.getUTCHours();
  if (hour >= QUIET_HOURS.endHour && hour < QUIET_HOURS.startHour) return null;
  if (hour >= QUIET_HOURS.startHour) local.setUTCDate(local.getUTCDate() + 1);
  local.setUTCHours(QUIET_HOURS.endHour, 0, 0, 0);
  return new Date(local.getTime() - utcOffsetMinutes * 60_000).toISOString();
}
/** Called inside the project's collection transaction. Reserve every attempt before any await.
 * `sent` also fences an in-flight send; only a caught failure reopens it for a bounded retry.
 * On a process crash an ambiguous in-flight send stays fenced, avoiding a duplicate push. */
export function claimDeliveries(raw: Database, projectId: string, channel: PushChannel, now: Date, offset: number): Delivery[] {
  const at = now.toISOString(), end = quietEnd(now, offset), claimed: Delivery[] = [];
  const rows = raw.prepare(`SELECT d.*,n.title,n.body,n.category,n.urgency,n.entity_kind,n.entity_id FROM notification_deliveries d JOIN notifications n
    ON n.project_id=d.project_id AND n.id=d.notification_id WHERE d.project_id=? AND d.channel=?
    AND d.state IN ('queued','held-quiet') AND d.attempts<? ORDER BY n.created_at,n.rowid`)
    .all(projectId, channel.name, PUSH_MAX_ATTEMPTS) as Delivery[];
  for (const row of rows) {
    if (row.deliver_after !== null && Date.parse(row.deliver_after) > now.getTime()) continue;
    if (end !== null && !(row.category === "action" && row.urgency === "urgent")) {
      raw.prepare(`UPDATE notification_deliveries SET state='held-quiet',deliver_after=?
        WHERE project_id=? AND notification_id=? AND channel=? AND state IN ('queued','held-quiet')`)
        .run(end, projectId, row.notification_id, channel.name);
      continue;
    }
    const result = raw.prepare(`UPDATE notification_deliveries SET state='sent',attempts=attempts+1,last_attempt_at=?,deliver_after=NULL,error_kind=NULL
      WHERE project_id=? AND notification_id=? AND channel=? AND state IN ('queued','held-quiet') AND attempts=?`)
      .run(at, projectId, row.notification_id, channel.name, row.attempts);
    if (result.changes) claimed.push({ ...row, attempts: row.attempts + 1 });
  }
  return claimed;
}
/** No exception text or channel-controlled fields are persisted or logged. */
export async function sendDeliveries(raw: Database, channel: PushChannel, rows: readonly Delivery[], now: Date, report: () => void, baseUrl?: string): Promise<void> {
  for (const row of rows) {
    try {
      await channel.send({ title: publicApprovalText(row.title).slice(0, 200), body: publicApprovalText(row.body).slice(0, 1000),
        level: row.category, urgency: row.urgency, link: notificationLink(baseUrl, row.category, row.project_id),
        ...(row.entity_kind === "approval" && row.entity_id && raw.prepare("SELECT 1 FROM approvals WHERE project_id=? AND id=? AND state='pending'").get(row.project_id, row.entity_id)
          ? { approval: { projectId: row.project_id, approvalId: row.entity_id } } : {}) });
    } catch (error) {
      report();
      const kind = error instanceof NotifySendError ? error.kind : "send-error";
      const failed = kind === "permanent" || row.attempts >= PUSH_MAX_ATTEMPTS;
      const delay = error instanceof NotifySendError && error.retryAfterMs !== undefined && Number.isFinite(error.retryAfterMs)
        ? Math.max(0, Math.min(error.retryAfterMs, 8_640_000_000_000_000 - now.getTime())) : PUSH_RETRY_MS;
      try {
        raw.transaction(() => {
          raw.prepare(`UPDATE notification_deliveries SET state=?,deliver_after=?,error_kind=?
            WHERE project_id=? AND notification_id=? AND channel=? AND state='sent' AND attempts=? AND last_attempt_at=?`)
            .run(failed ? "failed" : "queued", failed ? null : new Date(now.getTime() + delay).toISOString(), kind,
              row.project_id, row.notification_id, channel.name, row.attempts, now.toISOString());
        }).immediate();
      } catch { report(); }
    }
  }
}

export function notificationLink(baseUrl: string | undefined, category: NotificationCategory, projectId: string): string {
  return baseUrl ? `${baseUrl}/#/${category === "action" ? "attention" : `project/${encodeURIComponent(projectId)}`}` : "";
}
