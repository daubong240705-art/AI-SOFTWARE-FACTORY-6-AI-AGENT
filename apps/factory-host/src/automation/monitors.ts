import type { Database } from "better-sqlite3";
import { monitorInputSchema, type MonitorInput } from "@factory/contracts";
import type { EventHub } from "../events/hub.js";

export interface MonitorRow {
  project_id: string; id: string; revision: number; name: string; kind: MonitorInput["kind"]; params_json: string;
  comparator: "gt" | "lt"; threshold: number; trip_after: number; recover_after: number; interval_seconds: number;
  state: "active" | "paused"; status: "unknown" | "ok" | "tripped"; breaches: number; recoveries: number;
  last_value: number | null; last_checked_at: string | null; next_check_at: string | null; created_at: string;
}
export interface MonitorDeps {
  raw: Database; hub: EventHub; stateDir: string;
  statfs: (path: string) => Promise<{ bavail: number; bsize: number }>;
}
export function getMonitor(raw: Database, projectId: string, id: string): MonitorRow | undefined {
  return raw.prepare("SELECT * FROM monitors WHERE project_id=? AND id=?").get(projectId,id) as MonitorRow | undefined;
}
export function monitorInput(row: MonitorRow): MonitorInput {
  return monitorInputSchema.parse({ name: row.name, kind: row.kind, params: JSON.parse(row.params_json) as unknown,
    comparator: row.comparator, threshold: row.threshold, tripAfter: row.trip_after, recoverAfter: row.recover_after,
    intervalSeconds: row.interval_seconds, enabled: row.state === "active" });
}
export function listMonitors(raw: Database, projectId: string) {
  return raw.prepare(`SELECT id,revision,name,kind,comparator,threshold,state,status,last_value AS lastValue,
    last_checked_at AS lastCheckedAt,next_check_at AS nextCheckAt,breaches,recoveries,trip_after AS tripAfter,
    recover_after AS recoverAfter,interval_seconds AS intervalSeconds FROM monitors WHERE project_id=?
    ORDER BY created_at DESC,rowid DESC LIMIT 100`).all(projectId);
}
export function listMonitorEvents(raw: Database, projectId: string, id: string) {
  return raw.prepare(`SELECT seq,from_status AS "from",to_status AS "to",value,at FROM monitor_events
    WHERE project_id=? AND monitor_id=? ORDER BY seq DESC LIMIT 50`).all(projectId,id);
}
async function probe(deps: MonitorDeps, row: MonitorRow, now: Date): Promise<number> {
  const input = monitorInput(row);
  if (input.kind === "disk-free") {
    const stats = await deps.statfs(deps.stateDir);
    const value = Math.round(stats.bavail * stats.bsize / 2 ** 30 * 100) / 100;
    if (!Number.isFinite(value) || value < 0) throw new Error("Invalid probe value");
    return value;
  }
  const params = input.params;
  if (input.kind === "artifact-age" && "days" in params && "kind" in params) return (deps.raw.prepare(`SELECT count(*) AS n FROM artifact_versions
    WHERE project_id=? AND kind=? AND status='approved' AND julianday(created_at)<julianday(?)`)
    .get(row.project_id,params.kind,new Date(now.getTime()-params.days*86400000).toISOString()) as { n: number }).n;
  if (input.kind === "approval-overdue" && "hours" in params) return (deps.raw.prepare(`SELECT count(*) AS n FROM approvals
    WHERE project_id=? AND state='pending' AND julianday(requested_at)<julianday(?)`)
    .get(row.project_id,new Date(now.getTime()-params.hours*3600000).toISOString()) as { n: number }).n;
  return (deps.raw.prepare("SELECT count(*) AS n FROM workflow_instances WHERE project_id=? AND state='stalled'").get(row.project_id) as { n: number }).n;
}
const running = new WeakSet<Database>();
export async function tickMonitors(deps: MonitorDeps, now: Date): Promise<void> {
  if (running.has(deps.raw)) return;
  running.add(deps.raw); let reported = false;
  const report = () => { if (!reported) { reported = true; console.error("Monitor tick failed"); } };
  try {
    const at = now.toISOString();
    const rows = deps.raw.prepare(`SELECT * FROM monitors WHERE state='active' AND next_check_at<=?
      ORDER BY next_check_at,id,project_id LIMIT 100`).all(at) as MonitorRow[];
    for (const row of rows) {
      let value: number | null = null;
      try { value = await probe(deps,row,now); } catch { report(); }
      try { deps.hub.transaction(() => {
        const current = getMonitor(deps.raw,row.project_id,row.id);
        // A command may have paused or changed the monitor while statfs was pending.
        if (!current || current.state !== "active" || current.revision !== row.revision || current.next_check_at !== row.next_check_at) return;
        const next = new Date(now.getTime()+row.interval_seconds*1000).toISOString();
        if (value === null) {
          deps.raw.prepare("UPDATE monitors SET last_checked_at=?,next_check_at=? WHERE project_id=? AND id=?").run(at,next,row.project_id,row.id);
          return;
        }
        const breach = row.comparator === "gt" ? value > row.threshold : value < row.threshold;
        const breaches = breach ? Math.min(10,row.breaches+1) : 0, recoveries = breach ? 0 : Math.min(10,row.recoveries+1);
        let status = row.status;
        if (status !== "tripped" && breaches >= row.trip_after) status = "tripped";
        else if (status === "tripped" && recoveries >= row.recover_after || status === "unknown" && !breach) status = "ok";
        const changed = status !== row.status;
        deps.raw.prepare(`UPDATE monitors SET status=?,breaches=?,recoveries=?,last_value=?,last_checked_at=?,next_check_at=?,
          revision=revision+? WHERE project_id=? AND id=?`).run(status,breaches,recoveries,value,at,next,changed ? 1 : 0,row.project_id,row.id);
        if (!changed) return;
        const seq = (deps.raw.prepare("SELECT COALESCE(MAX(seq),0)+1 AS n FROM monitor_events WHERE project_id=? AND monitor_id=?").get(row.project_id,row.id) as { n: number }).n;
        deps.raw.prepare("INSERT INTO monitor_events VALUES (?,?,?,?,?,?,?)").run(row.project_id,row.id,seq,row.status,status,value,at);
        deps.hub.append({ projectId: row.project_id,causationId: row.id,payload: { type: "entity.changed",entity: { kind: "monitor",id: row.id,revision: row.revision+1 } } });
        deps.hub.append({ projectId: row.project_id,causationId: row.id,payload: { type: "monitor.changed",monitorId: row.id,from: row.status,to: status } });
      }); } catch { report(); }
    }
  } catch { report(); } finally { running.delete(deps.raw); }
}
