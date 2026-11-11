import type { Database } from "better-sqlite3";
import { nodeSchema, type NodeInfo } from "@factory/contracts";
import { deterministicUuid } from "../org/service.js";
import { CAPACITY_ATTEMPT_STATES } from "./attempts.js";

export const LOCAL_NODE_ID = deterministicUuid("node:local");
interface NodeRow {
  id: string; revision: number; name: string; platform: string; trust: string; state: string;
  slots_total: number; slots_used: number; last_heartbeat_at: string | null;
}
const fromRow = (row: NodeRow): NodeInfo => nodeSchema.parse({
  id: row.id, revision: row.revision, name: row.name, platform: row.platform, trust: row.trust, state: row.state,
  slots: { total: row.slots_total, used: row.slots_used }, runtimes: ["fake"], capabilities: [], lastHeartbeatAt: row.last_heartbeat_at,
});

export function ensureLocalNode(raw: Database, { slots, now }: { slots: number; now: string }): NodeInfo {
  return raw.transaction(() => {
    const existing = raw.prepare("SELECT * FROM nodes WHERE id = ?").get(LOCAL_NODE_ID) as NodeRow | undefined;
    const row: NodeRow = existing ? { ...existing, revision: existing.revision + 1, slots_total: slots, last_heartbeat_at: now, state: "online" }
      : { id: LOCAL_NODE_ID, revision: 1, name: "local", platform: process.platform === "win32" ? "windows" : "linux",
        trust: "server-sandboxed", state: "online", slots_total: slots, slots_used: 0, last_heartbeat_at: now };
    const node = fromRow(row);
    raw.prepare(`INSERT INTO nodes (id, revision, name, platform, trust, state, slots_total, slots_used, last_heartbeat_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
      revision = excluded.revision, slots_total = excluded.slots_total, last_heartbeat_at = excluded.last_heartbeat_at, state = excluded.state`)
      .run(row.id, row.revision, row.name, row.platform, row.trust, row.state, row.slots_total, row.slots_used, row.last_heartbeat_at);
    return node;
  }).immediate();
}

export function nodeLoad(raw: Database, nodeId: string): { total: number; used: number } {
  const states = [...CAPACITY_ATTEMPT_STATES];
  const row = raw.prepare(`SELECT slots_total AS total, (SELECT COUNT(*) FROM attempts WHERE node_id = ?
    AND state IN (${states.map(() => "?").join(",")})) AS used FROM nodes WHERE id = ?`)
    .get(nodeId, ...states, nodeId) as { total: number; used: number } | undefined;
  return row ?? { total: 0, used: 0 };
}

export function seatLoad(raw: Database, seatId: string): { slots: number; used: number } {
  const states = [...CAPACITY_ATTEMPT_STATES];
  const row = raw.prepare(`SELECT slots, (SELECT COUNT(*) FROM attempts AS a JOIN attempt_seats AS s
    ON s.project_id = a.project_id AND s.attempt_id = a.id WHERE s.seat_id = ?
    AND a.state IN (${states.map(() => "?").join(",")})) AS used FROM seats WHERE id = ?`)
    .get(seatId, ...states, seatId) as { slots: number; used: number } | undefined;
  return row ?? { slots: 0, used: 0 };
}

/** Queued attempts do not hold capacity; uncertain executions do. */
export function engagementLoad(raw: Database, projectId: string, engagementId: string): number {
  const states = [...CAPACITY_ATTEMPT_STATES];
  return (raw.prepare(`SELECT COUNT(*) AS used FROM attempts a JOIN tasks t
    ON t.project_id = a.project_id AND t.id = a.task_id
    WHERE t.project_id = ? AND t.engagement_id = ? AND a.state IN (${states.map(() => "?").join(",")})`)
    .get(projectId, engagementId, ...states) as { used: number }).used;
}

export function heartbeatNode(raw: Database, nodeId: string, now: string): void {
  raw.prepare("UPDATE nodes SET last_heartbeat_at = ?, revision = revision + 1 WHERE id = ?").run(now, nodeId);
}

export function markNodeSlots(raw: Database, nodeId: string): void {
  raw.transaction(() => {
    raw.prepare("UPDATE nodes SET slots_used = ?, revision = revision + 1 WHERE id = ?").run(nodeLoad(raw, nodeId).used, nodeId);
  }).immediate();
}
