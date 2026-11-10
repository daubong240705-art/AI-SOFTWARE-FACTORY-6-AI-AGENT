import type { Database } from "better-sqlite3";
import { DIGEST_HOUR, REMINDER_FRACTIONS, STANDING_EXPIRY_WARNING_DAYS } from "@factory/contracts";
import type { EventHub } from "../events/hub.js";
import { createIdGenerator } from "../ids.js";
import { dayKey, DEFAULT_BUDGET_CONFIG, usedTokens } from "../policy/budget.js";
import { createNotification, notificationKey, type NotificationInput } from "./service.js";
import { claimDeliveries, sendDeliveries, type PushChannel } from "./push.js";

export interface NotificationDeps { raw: Database; hub: EventHub; pushChannel?: PushChannel; utcOffsetMinutes?: number }
interface ApprovalRow { id: string; revision: number; subject: string; summary: string; state: string; requested_at: string; expires_at: string }
interface BlockerRow { id: string; revision: number; name: string }

function collect(deps: NotificationDeps, projectId: string, now: Date, offset: number): void {
  const { raw, hub } = deps, newId = createIdGenerator(() => now);
  const add = (input: Omit<NotificationInput, "projectId" | "now" | "id">): void => {
    const id = newId();
    if (!createNotification(raw, { ...input, projectId, now, id }).created) return;
    hub.append({ projectId, causationId: id, payload: { type: "entity.changed", entity: { kind: "notification", id, revision: 1 } } });
    if (deps.pushChannel) raw.prepare(`INSERT INTO notification_deliveries
      (project_id,notification_id,channel,state,attempts) VALUES (?,?,?,'queued',0)
      ON CONFLICT(project_id,notification_id,channel) DO NOTHING`).run(projectId, id, deps.pushChannel.name);
  };
  const approvals = raw.prepare("SELECT * FROM approvals WHERE project_id=? AND state IN ('requested','pending') ORDER BY id")
    .all(projectId) as ApprovalRow[];
  for (const approval of approvals) {
    const expires = Date.parse(approval.expires_at), requested = Date.parse(approval.requested_at);
    const entity = { kind: "approval", id: approval.id };
    add({ dedupKey: notificationKey("approval", approval.id, approval.revision, "requested"), category: "action",
      urgency: expires - now.getTime() <= 86_400_000 ? "urgent" : "normal",
      title: `Approval needed: ${approval.subject}`, body: approval.summary, entity });
    if (approval.state !== "pending" || expires <= requested) continue;
    for (const fraction of REMINDER_FRACTIONS) if (now.getTime() - requested >= (expires - requested) * fraction) {
      const percent = fraction * 100;
      add({ dedupKey: notificationKey("approval", approval.id, `reminder-${percent}`), category: "action",
        urgency: fraction === 0.9 ? "urgent" : "normal", title: `Approval reminder (${percent}%): ${approval.subject}`,
        body: approval.summary, entity });
    }
  }
  const breakers = raw.prepare("SELECT team_id,opened_at,reason FROM team_breakers WHERE project_id=? AND state='open' ORDER BY team_id")
    .all(projectId) as { team_id: string; opened_at: string; reason: string | null }[];
  for (const row of breakers) add({ dedupKey: notificationKey("team", row.team_id, row.opened_at, "breaker"), category: "action",
    urgency: "urgent", title: "Team paused by circuit breaker", body: row.reason ?? "Team needs operator attention.", entity: { kind: "team", id: row.team_id } });
  const rules = raw.prepare("SELECT id,revision,name FROM automation_rules WHERE project_id=? AND state='quarantined' ORDER BY id")
    .all(projectId) as BlockerRow[];
  for (const row of rules) add({ dedupKey: notificationKey("rule", row.id, row.revision, "quarantined"), category: "action",
    urgency: "normal", title: `Automation rule quarantined: ${row.name}`, body: "Review and resume the rule.", entity: { kind: "rule", id: row.id } });
  const schedules = raw.prepare("SELECT id,revision,name FROM schedules WHERE project_id=? AND state='quarantined' ORDER BY id")
    .all(projectId) as BlockerRow[];
  for (const row of schedules) add({ dedupKey: notificationKey("schedule", row.id, row.revision, "quarantined"), category: "action",
    urgency: "normal", title: `Schedule quarantined: ${row.name}`, body: "Review and resume the schedule.", entity: { kind: "schedule", id: row.id } });
  const monitors = raw.prepare("SELECT id,revision,name FROM monitors WHERE project_id=? AND status<>'ok' ORDER BY id")
    .all(projectId) as BlockerRow[];
  for (const row of monitors) add({ dedupKey: notificationKey("monitor", row.id, row.revision, "non-ok"), category: "action",
    urgency: "normal", title: `Monitor needs attention: ${row.name}`, body: "Monitor is not healthy.", entity: { kind: "monitor", id: row.id } });
  const workflows = raw.prepare("SELECT id,revision,title,state_reason,last_progress_at FROM workflow_instances WHERE project_id=? AND state='stalled' ORDER BY id")
    .all(projectId) as { id: string; revision: number; title: string; state_reason: string | null; last_progress_at: string | null }[];
  for (const row of workflows) add({ dedupKey: notificationKey("workflow", row.id, row.last_progress_at ?? row.revision, "stalled"), category: "action",
    urgency: "normal", title: `Workflow stalled: ${row.title}`, body: row.state_reason ?? "Workflow needs operator attention.", entity: { kind: "workflow-instance", id: row.id } });

  const standing = raw.prepare("SELECT id,expires_at FROM standing_approvals WHERE project_id=? AND state='active' ORDER BY id")
    .all(projectId) as { id: string; expires_at: string }[];
  for (const row of standing) {
    const remaining = Date.parse(row.expires_at) - now.getTime();
    if (remaining > 0 && remaining <= STANDING_EXPIRY_WARNING_DAYS * 86_400_000)
      add({ dedupKey: notificationKey("standing-approval", row.id, row.expires_at, "expiry-warning"), category: "important",
        urgency: "normal", title: "Standing approval expires soon", body: "Review or replace the standing approval before it expires.",
        entity: { kind: "standing-approval", id: row.id } });
  }

  if (new Date(now.getTime() + offset * 60_000).getUTCHours() < DIGEST_HOUR) return;
  const date = dayKey(now, offset), key = notificationKey("project", date, "digest");
  if (raw.prepare("SELECT 1 FROM notifications WHERE project_id=? AND dedup_key=?").get(projectId, key)) return;
  const start = new Date(Date.parse(`${date}T00:00:00.000Z`) - offset * 60_000).toISOString();
  const end = new Date(Date.parse(start) + 86_400_000).toISOString();
  // Count transitions, including tasks that moved again afterwards. Repeated events count a task once.
  // Notification bookkeeping cannot manufacture activity and cause another day's empty digest.
  const counts = raw.prepare(`SELECT
    count(DISTINCT CASE WHEN json_extract(body_json,'$.payload.type')='task.status-changed'
      AND json_extract(body_json,'$.payload.to')='done' THEN json_extract(body_json,'$.payload.taskId') END) AS done,
    count(DISTINCT CASE WHEN json_extract(body_json,'$.payload.type')='task.status-changed'
      AND json_extract(body_json,'$.payload.to')='failed' THEN json_extract(body_json,'$.payload.taskId') END) AS failed,
    count(*) AS activity FROM event_log WHERE project_id=?
      AND julianday(json_extract(body_json,'$.occurredAt'))>=julianday(?)
      AND julianday(json_extract(body_json,'$.occurredAt'))<julianday(?)
      AND julianday(json_extract(body_json,'$.occurredAt'))<=julianday(?)
      AND (json_extract(body_json,'$.payload.type') IN
        ('task.status-changed','workflow.state-changed','artifact.status-changed','monitor.changed','message.appended','run.changed')
        OR (json_extract(body_json,'$.payload.type')='entity.changed' AND json_extract(body_json,'$.payload.entity.kind') IN
          ('task','approval','artifact-version','workflow-instance','rule','monitor','effect','conversation','message','work','run','decision','review','output')))`)
    .get(projectId, start, end, now.toISOString()) as { done: number; failed: number; activity: number };
  const { n: decided } = raw.prepare(`SELECT count(*) AS n FROM approvals WHERE project_id=?
    AND decided_at IS NOT NULL AND julianday(decided_at)>=julianday(?) AND julianday(decided_at)<julianday(?)
    AND julianday(decided_at)<=julianday(?)`).get(projectId, start, end, now.toISOString()) as { n: number };
  const { n: requestedToday } = raw.prepare(`SELECT count(*) AS n FROM approvals WHERE project_id=?
    AND julianday(requested_at)>=julianday(?) AND julianday(requested_at)<julianday(?) AND julianday(requested_at)<=julianday(?)`)
    .get(projectId, start, end, now.toISOString()) as { n: number };
  const { n: usageToday } = raw.prepare(`SELECT count(*) AS n FROM usage_records WHERE project_id=?
    AND julianday(recorded_at)>=julianday(?) AND julianday(recorded_at)<julianday(?)`).get(projectId, start, end) as { n: number };
  if (!counts.activity && !decided && !requestedToday && !usageToday && !approvals.length) return;
  const tokens = usedTokens(raw, projectId, "day", date, { ...DEFAULT_BUDGET_CONFIG, utcOffsetMinutes: offset });
  add({ dedupKey: key, category: "digest", urgency: "normal", title: `Daily digest: ${date}`,
    body: `Tasks done: ${counts.done}; approvals decided: ${decided}; approvals pending: ${approvals.length}; failed tasks: ${counts.failed}; ${tokens} tokens; cost: no price list`,
    entity: { kind: "project", id: projectId } });
}

/** One transaction per project; errors never escape and log only one fixed message per tick. */
export async function tickNotifications(deps: NotificationDeps, now: Date): Promise<void> {
  let reported = false;
  const report = (): void => { if (!reported) { reported = true; console.error("Notification tick failed"); } };
  try {
    const offset = deps.utcOffsetMinutes ?? DEFAULT_BUDGET_CONFIG.utcOffsetMinutes;
    const projects = deps.raw.prepare("SELECT id FROM projects ORDER BY id").all() as { id: string }[];
    for (const project of projects) try {
      const channel = deps.pushChannel;
      const deliveries = deps.hub.transaction(() => {
        collect(deps, project.id, now, offset);
        return channel ? claimDeliveries(deps.raw, project.id, channel, now, offset) : [];
      });
      if (channel) await sendDeliveries(deps.raw, channel, deliveries, now, report);
    } catch { report(); }
  } catch { report(); }
}
