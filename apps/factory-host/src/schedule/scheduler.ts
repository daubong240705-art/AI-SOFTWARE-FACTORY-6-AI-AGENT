import { createHash } from "node:crypto";
import { Cron } from "croner";
import type { Database } from "better-sqlite3";
import type { ScheduleAction } from "@factory/contracts";
import type { createCommandPipeline } from "../commands/pipeline.js";
import type { EventHub } from "../events/hub.js";
import type { RegistryPack } from "../org/registry.js";
import { getSchedule, nextRunAfter, resolveScheduleAction, type ScheduleRow } from "./service.js";

export interface SchedulerDeps {
  raw: Database; hub: EventHub; packs: readonly RegistryPack[]; pipeline: ReturnType<typeof createCommandPipeline>;
}
export function occurrenceId(projectId: string, scheduleId: string, scheduledFor: string, trigger: "time" | "manual", purpose = "create"): string {
  const identity = `${projectId}|${scheduleId}|${scheduledFor}|${trigger}`;
  const hex = createHash("sha256").update(purpose === "create" ? identity : `${identity}|${purpose}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
/** The caller owns a hub transaction spanning the entire schedule, including commands and receipts. */
export function fireOccurrence(deps: SchedulerDeps, schedule: ScheduleRow, scheduledFor: string, trigger: "time" | "manual", now: Date): boolean {
  return deps.hub.transaction(() => {
    const { raw } = deps;
    const latest = getSchedule(raw, schedule.project_id, schedule.id);
    if (!latest || (latest.last_run_at && now.getTime() < Date.parse(latest.last_run_at))) return false;
    const inserted = raw.prepare(`INSERT INTO schedule_occurrences
      (project_id,schedule_id,scheduled_for,trigger,status,reason,fired_at) VALUES (?,?,?,?,'no-op',NULL,?)
      ON CONFLICT(project_id,schedule_id,scheduled_for,trigger) DO NOTHING`)
      .run(schedule.project_id, schedule.id, scheduledFor, trigger, now.toISOString());
    if (!inserted.changes) return false;
    const row = getSchedule(raw, schedule.project_id, schedule.id)!;
    const running = (raw.prepare(`SELECT count(DISTINCT w.id) AS n FROM schedule_occurrences o JOIN workflow_instances w
      ON w.project_id=o.project_id AND w.id=o.instance_id WHERE o.project_id=? AND o.schedule_id=?
      AND w.state NOT IN ('completed','failed','cancelled','superseded')`).get(row.project_id, row.id) as { n: number }).n;
    let reason: string | null = row.concurrency === "skip-if-running" && running >= 1 ? "previous still running"
      : row.concurrency === "queue-one" && running >= 2 ? "queue full"
      : row.concurrency === "allow-parallel" && running >= row.parallel_limit ? "parallel limit" : null;
    if (row.state !== "active") reason = "schedule inactive";
    let status = "skipped", instanceId: string | null = null;
    let failures = row.consecutive_failures;
    if (!reason) {
      try {
        const action = JSON.parse(row.action_json) as ScheduleAction;
        const definition = resolveScheduleAction(deps.packs, action);
        const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: row.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(scheduledFor));
        const id = occurrenceId(row.project_id, row.id, scheduledFor, trigger);
        const command = (type: string, payload: unknown, purpose: string) => {
          const result = deps.pipeline.execute({ apiVersion: 1, projectId: row.project_id,
            commandId: occurrenceId(row.project_id, row.id, scheduledFor, trigger, purpose), type, payload }, "scheduler");
          if (!result.body.ok) throw new Error("Workflow command rejected");
        };
        // A failed start rolls back creation, receipts, and workflow effects together.
        raw.transaction(() => {
          command("workflows.create", { instanceId: id, definitionKey: action.definitionKey,
            ...(action.packKey === undefined ? {} : { packKey: action.packKey }),
            ...(action.params === undefined ? {} : { params: action.params }),
            title: action.title ?? `${definition.title.slice(0, 149)} ${localDate}` }, "create");
          if (action.autoStart) command("workflows.start", { instanceId: id, expectedRevision: 1 }, "start");
        })();
        status = "started"; instanceId = id; failures = 0;
      } catch { status = "failed"; reason = "workflow start failed"; failures = Math.min(10, failures + 1); }
    }
    raw.prepare(`UPDATE schedule_occurrences SET status=?,reason=?,instance_id=?
      WHERE project_id=? AND schedule_id=? AND scheduled_for=? AND trigger=?`)
      .run(status, reason, instanceId, row.project_id, row.id, scheduledFor, trigger);
    raw.prepare(`UPDATE schedules SET consecutive_failures=?, state=?, last_run_at=?,last_status=? WHERE project_id=? AND id=?`)
      .run(failures, failures >= 3 ? "quarantined" : row.state, now.toISOString(), status, row.project_id, row.id);
    return true;
  });
}

// Retain the latest 50 due times even after a long outage. Croner's reverse enumeration
// avoids an unbounded scan from the beginning of the outage.
function dueTimes(row: ScheduleRow, now: Date): Date[] {
  const first = Date.parse(row.next_run_at!);
  if (row.kind === "once") return [new Date(first)];
  if (row.kind === "interval") {
    const step = Number(row.expr) * 1000, count = Math.floor((now.getTime() - first) / step) + 1;
    return Array.from({ length: Math.min(50, count) }, (_, i) => new Date(first + (Math.max(0, count - 50) + i) * step));
  }
  // nextRunAfter is the single forward-time calculation; reverse enumeration only bounds backlog.
  return cronDue(row, first, now);
}
function cronDue(row: ScheduleRow, first: number, now: Date): Date[] {
  const cron = new Cron(row.expr, { timezone: row.timezone });
  return cron.previousRuns(50, new Date(Math.floor(now.getTime() / 1000) * 1000 + 1000))
    .filter((date) => date.getTime() >= first && date.getTime() <= now.getTime()).reverse();
}
/** Counts the outcome of each started run once: a failed run adds to run_failures, a completed run clears it, and three
 * consecutive failed runs quarantine the schedule (doc 04 section 16.2). Cancelled or superseded runs change nothing. */
export function reconcileScheduleRuns(raw: Database, now: Date): void {
  // A failed stage stalls the instance ("stage failed: <key>") instead of failing it, so that stall is the failed run.
  // Other stalls (no progress, exhausted rework) are not run failures: an Operator can resume them.
  const runs = raw.prepare(`SELECT o.project_id, o.schedule_id, o.scheduled_for, o.trigger,
      CASE WHEN w.state = 'stalled' THEN 'failed' ELSE w.state END AS run_state
    FROM schedule_occurrences o JOIN workflow_instances w ON w.project_id = o.project_id AND w.id = o.instance_id
    WHERE o.status = 'started' AND o.reconciled_at IS NULL AND (w.state IN ('completed','failed','cancelled','superseded')
      OR (w.state = 'stalled' AND w.state_reason LIKE 'stage failed:%'))
    ORDER BY o.fired_at, o.rowid LIMIT 200`).all() as
    { project_id: string; schedule_id: string; scheduled_for: string; trigger: string; run_state: string }[];
  for (const run of runs) raw.transaction(() => {
    raw.prepare("UPDATE schedule_occurrences SET reconciled_at = ? WHERE project_id = ? AND schedule_id = ? AND scheduled_for = ? AND trigger = ?")
      .run(now.toISOString(), run.project_id, run.schedule_id, run.scheduled_for, run.trigger);
    if (run.run_state === "failed") raw.prepare("UPDATE schedules SET run_failures = MIN(10, run_failures + 1) WHERE project_id = ? AND id = ?")
      .run(run.project_id, run.schedule_id);
    else if (run.run_state === "completed") raw.prepare("UPDATE schedules SET run_failures = 0 WHERE project_id = ? AND id = ?")
      .run(run.project_id, run.schedule_id);
    raw.prepare("UPDATE schedules SET state = 'quarantined' WHERE project_id = ? AND id = ? AND state = 'active' AND run_failures >= 3")
      .run(run.project_id, run.schedule_id);
  })();
}
export function tickSchedules(deps: SchedulerDeps, now: Date): void {
  let reported = false, remaining = 100;
  const report = () => { if (!reported) { reported = true; console.error("Schedule tick failed"); } };
  try {
    reconcileScheduleRuns(deps.raw, now);
    const schedules = deps.raw.prepare(`SELECT * FROM schedules WHERE state='active' AND next_run_at<=?
      ORDER BY next_run_at,id,project_id LIMIT 100`).all(now.toISOString()) as ScheduleRow[];
    for (const row of schedules) {
      if (remaining <= 0) break;
      if (row.last_run_at && now.getTime() < Date.parse(row.last_run_at)) continue;
      try {
        const consumed = deps.hub.transaction(() => {
          const due = dueTimes(row, now), late = due.filter((date) => now.getTime() - date.getTime() > 90_000);
          const onTime = due.filter((date) => now.getTime() - date.getTime() <= 90_000);
          const selected = row.missed_policy === "skip" ? onTime
            : row.missed_policy === "coalesce-once" ? due.slice(-1)
            : [...late.slice(-row.catch_up_limit), ...onTime];
          const firing = new Set(selected.map((date) => date.toISOString()));
          const omitted = due.filter((date) => !firing.has(date.toISOString()));
          const missed = row.missed_policy === "skip" ? omitted.slice(-10) : omitted;
          const work = [...missed, ...selected].sort((a, b) => a.getTime() - b.getTime());
          // Defer this schedule if its atomic batch would exceed the global budget.
          if (work.length > remaining) return 0;
          let count = 0;
          for (const date of work) {
            const scheduledFor = date.toISOString();
            if (firing.has(scheduledFor)) {
              if (fireOccurrence(deps, row, scheduledFor, "time", now)) count++;
            } else {
              const reason = row.missed_policy === "skip" ? "missed" : row.missed_policy === "coalesce-once" ? "coalesced" : "beyond catch-up limit";
              count += deps.raw.prepare(`INSERT INTO schedule_occurrences
                (project_id,schedule_id,scheduled_for,trigger,status,reason,fired_at) VALUES (?,?,?,'time','skipped',?,?)
                ON CONFLICT(project_id,schedule_id,scheduled_for,trigger) DO NOTHING`)
                .run(row.project_id, row.id, scheduledFor, reason, now.toISOString()).changes;
            }
          }
          const current = getSchedule(deps.raw, row.project_id, row.id)!;
          const state = current.state === "quarantined" ? "quarantined" : row.kind === "once" ? "paused" : current.state;
          deps.raw.prepare(`UPDATE schedules SET next_run_at=?,state=?,last_run_at=?,last_status=?,revision=revision+1 WHERE project_id=? AND id=?`)
            .run(state === "active" ? nextRunAfter(row, now)?.toISOString() ?? null : null, state, now.toISOString(),
              row.kind === "once" && state !== "quarantined" ? "done" : selected.length ? current.last_status ?? "skipped" : "skipped", row.project_id, row.id);
          deps.hub.append({ projectId: row.project_id, causationId: occurrenceId(row.project_id, row.id, now.toISOString(), "time", "tick"),
            payload: { type: "entity.changed", entity: { kind: "schedule", id: row.id, revision: current.revision + 1 } } });
          return count;
        });
        remaining -= consumed;
      } catch { report(); }
    }
  } catch { report(); }
}
