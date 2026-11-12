import type { Database } from "better-sqlite3";
import { LIVE_ATTEMPT_STATES, type AttemptState } from "@factory/contracts";
import { sanitizeAgentText } from "../mcp/security.js";
import { meaningfulProgressSql } from "../dispatch/progress.js";
import { listSeats } from "./service.js";
import { listTeams } from "./views.js";

type Status = "waiting" | "problem" | "working" | "queued" | "done" | "idle";
interface Node {
  id: string; name: string; platform: string; trust: string; state: string;
  slots: { total: number; used: number }; lastHeartbeatAt: string | null;
}
interface Progress { message: string; percent: number | null; at: string }
interface Run {
  projectId: string; projectName: string; taskId: string; code: string; title: string;
  attemptId: string; attemptState: AttemptState; nodeId: string | null; startedAt: string | null; progress: Progress | null;
}
interface Need { approvalId: string; kind: string; taskId: string; code: string }
interface Finished { code: string; outcome: "succeeded" | "failed"; at: string | null }
interface Seat {
  id: string; name: string; role: string; isLead: boolean; slots: number; status: Status;
  runs: Run[]; queued: number; needsYou: Need[]; lastFinished: Finished | null;
}
interface Team {
  id: string; name: string; lifecycle: string;
  counts: { working: number; waiting: number; problem: number; queued: number; idle: number }; seats: Seat[];
}
interface Signals { waiting: number; problem: number; working: number }
type LiveRow = Omit<Run, "progress"> & Signals & { seatId: string };
interface EventRow {
  projectId: string; attemptId: string; firstStateAt: string | null; progressAt: string | null; message: unknown; percent: unknown;
}
const liveStates = [...LIVE_ATTEMPT_STATES];
const liveSql = liveStates.map(() => "?").join(",");
const text = (value: string, limit = 120): string => sanitizeAgentText(value).slice(0, limit);
const key = (projectId: string, attemptId: string): string => JSON.stringify([projectId, attemptId]);
const timestamp = (value: string | null): string | null =>
  value !== null && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

function nodes(raw: Database): Node[] {
  const rows = raw.prepare(`SELECT id, name, platform, trust, state, slots_total AS total, slots_used AS used,
    last_heartbeat_at AS lastHeartbeatAt FROM nodes ORDER BY name, id`).all() as {
      id: string; name: string; platform: string; trust: string; state: string; total: number; used: number; lastHeartbeatAt: string | null }[];
  return rows.map((row) => ({ id: row.id, name: text(row.name), platform: row.platform, trust: row.trust,
    state: row.state, slots: { total: row.total, used: row.used }, lastHeartbeatAt: timestamp(row.lastHeartbeatAt) }));
}

function liveAttempts(raw: Database, seatIds: string): LiveRow[] {
  // Parked attempts are terminal in contracts. Only an active task's latest parked attempt still waits;
  // it contributes to status, but never to runs. Window flags cover even attempts beyond the run cap.
  return raw.prepare(`WITH activity AS (
    SELECT ats.seat_id AS seatId, a.project_id AS projectId, p.name AS projectName, t.id AS taskId, t.code, t.title,
      a.id AS attemptId, a.state AS attemptState, a.node_id AS nodeId, a.started_at AS startedAt,
      MAX(a.state IN ('waiting-input','parked')) OVER (PARTITION BY ats.seat_id) AS waiting,
      MAX(a.state IN ('lease-expired','unknown','reconciling')) OVER (PARTITION BY ats.seat_id) AS problem,
      MAX(a.state IN ('leased','preparing','running','submitting','stopping')) OVER (PARTITION BY ats.seat_id) AS working,
      ROW_NUMBER() OVER (PARTITION BY ats.seat_id ORDER BY a.state = 'parked', a.rowid DESC) AS position
    FROM attempt_seats ats JOIN attempts a ON a.project_id = ats.project_id AND a.id = ats.attempt_id
    JOIN tasks t ON t.project_id = a.project_id AND t.id = a.task_id JOIN projects p ON p.id = a.project_id
    WHERE ats.seat_id IN (SELECT value FROM json_each(?)) AND (a.state IN (${liveSql})
      OR (a.state = 'parked' AND t.state = 'active' AND NOT EXISTS (
        SELECT 1 FROM attempts newer WHERE newer.project_id = a.project_id AND newer.task_id = a.task_id AND newer.epoch > a.epoch)))
    ) SELECT * FROM activity WHERE position <= 8 ORDER BY seatId, position`)
    .all(seatIds, ...liveStates) as LiveRow[];
}

function attemptEvents(raw: Database, rows: LiveRow[]): Map<string, EventRow> {
  const refs = JSON.stringify(rows.filter((row) => LIVE_ATTEMPT_STATES.has(row.attemptState))
    .map((row) => [row.projectId, row.attemptId]));
  const events = raw.prepare(`WITH latest AS (
    SELECT e.project_id, e.attempt_id, MIN(CASE WHEN e.kind = 'state' THEN e.seq END) AS firstState,
      MAX(CASE WHEN e.kind = 'progress' AND ${meaningfulProgressSql("e")} THEN e.seq END) AS progress
    FROM json_each(?) ref JOIN attempt_events e ON e.project_id = json_extract(ref.value, '$[0]')
      AND e.attempt_id = json_extract(ref.value, '$[1]') WHERE e.kind IN ('state','progress') GROUP BY e.project_id, e.attempt_id
    ) SELECT l.project_id AS projectId, l.attempt_id AS attemptId, s.at AS firstStateAt, p.at AS progressAt,
      json_extract(p.body_json, '$.message') AS message,
      CASE WHEN json_type(p.body_json, '$.percent') IN ('integer','real') THEN json_extract(p.body_json, '$.percent') END AS percent
    FROM latest l LEFT JOIN attempt_events s ON s.project_id = l.project_id AND s.attempt_id = l.attempt_id AND s.seq = l.firstState
    LEFT JOIN attempt_events p ON p.project_id = l.project_id AND p.attempt_id = l.attempt_id AND p.seq = l.progress
      AND json_type(p.body_json, '$.message') = 'text'`)
    .all(refs) as EventRow[];
  return new Map(events.map((event) => [key(event.projectId, event.attemptId), event]));
}

function queuedCounts(raw: Database, seatIds: string): Map<string, number> {
  const rows = raw.prepare(`SELECT t.owner_seat_id AS seatId, COUNT(*) AS count FROM tasks t
    WHERE t.owner_seat_id IN (SELECT value FROM json_each(?)) AND t.state IN ('ready','accepted','awaiting-go')
    AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.project_id = t.project_id AND a.task_id = t.id AND a.state IN (${liveSql}))
    GROUP BY t.owner_seat_id`).all(seatIds, ...liveStates) as { seatId: string; count: number }[];
  return new Map(rows.map((row) => [row.seatId, row.count]));
}

function needsYou(raw: Database, seatIds: string): Map<string, Need[]> {
  const rows = raw.prepare(`WITH seat_tasks AS (
    SELECT owner_seat_id AS seatId, project_id, id AS task_id FROM tasks WHERE owner_seat_id IN (SELECT value FROM json_each(?))
    UNION SELECT ats.seat_id AS seatId, a.project_id, a.task_id FROM attempt_seats ats
      JOIN attempts a ON a.project_id = ats.project_id AND a.id = ats.attempt_id
      WHERE ats.seat_id IN (SELECT value FROM json_each(?)) AND a.state IN (${liveSql})
    ), pending AS (
    SELECT st.seatId, ap.id AS approvalId, ap.kind, t.id AS taskId, t.code,
      ROW_NUMBER() OVER (PARTITION BY st.seatId ORDER BY ap.requested_at, ap.project_id, ap.id) AS position
    FROM seat_tasks st JOIN approvals ap ON ap.project_id = st.project_id AND ap.task_id = st.task_id
    JOIN tasks t ON t.project_id = st.project_id AND t.id = st.task_id WHERE ap.state IN ('pending','open')
    ) SELECT * FROM pending WHERE position <= 5 ORDER BY seatId, position`)
    .all(seatIds, seatIds, ...liveStates) as (Need & { seatId: string })[];
  const result = new Map<string, Need[]>();
  for (const row of rows) {
    const items = result.get(row.seatId) ?? [];
    items.push({ approvalId: row.approvalId, kind: text(row.kind, 40), taskId: row.taskId, code: text(row.code, 80) });
    result.set(row.seatId, items);
  }
  return result;
}

function lastFinished(raw: Database, seatIds: string): Map<string, Finished> {
  const rows = raw.prepare(`WITH finished AS (
    SELECT ats.seat_id AS seatId, t.code, a.state AS outcome, a.ended_at AS at,
      ROW_NUMBER() OVER (PARTITION BY ats.seat_id ORDER BY julianday(a.ended_at) DESC, a.rowid DESC) AS position
    FROM attempt_seats ats JOIN attempts a ON a.project_id = ats.project_id AND a.id = ats.attempt_id
    JOIN tasks t ON t.project_id = a.project_id AND t.id = a.task_id
    WHERE ats.seat_id IN (SELECT value FROM json_each(?)) AND a.state IN ('succeeded','failed')
    ) SELECT seatId, code, outcome, at FROM finished WHERE position = 1`).all(seatIds) as (Finished & { seatId: string })[];
  return new Map(rows.map((row) => [row.seatId, { code: text(row.code, 80), outcome: row.outcome, at: timestamp(row.at) }]));
}

function run(row: LiveRow, event: EventRow | undefined): Run {
  const at = timestamp(event?.progressAt ?? null);
  const percent = event?.percent;
  return { projectId: row.projectId, projectName: text(row.projectName), taskId: row.taskId,
    code: text(row.code, 80), title: text(row.title, 240), attemptId: row.attemptId, attemptState: row.attemptState,
    nodeId: row.nodeId, startedAt: timestamp(event?.firstStateAt ?? row.startedAt),
    progress: event && typeof event.message === "string" && at !== null ? {
      message: text(event.message, 160), percent: typeof percent === "number" && Number.isFinite(percent)
        && percent >= 0 && percent <= 100 ? percent : null, at,
    } : null };
}

function status(signals: Signals | undefined, needs: Need[], queued: number, finished: Finished | null, now: Date): Status {
  const age = finished?.at === null || !finished ? NaN : now.getTime() - Date.parse(finished.at);
  const recent = age >= 0 && age <= 30 * 60 * 1000;
  if (needs.length > 0 || signals?.waiting) return "waiting";
  if (signals?.problem || (finished?.outcome === "failed" && recent)) return "problem";
  if (signals?.working) return "working";
  if (queued > 0) return "queued";
  if (finished?.outcome === "succeeded" && recent) return "done";
  return "idle";
}

export function orgActivity(raw: Database, now: Date): { generatedAt: string; nodes: Node[]; teams: Team[] } {
  const teams = listTeams(raw);
  const seats = listSeats(raw, undefined, 200);
  const seatIds = JSON.stringify(seats.map((seat) => seat.id));
  const live = liveAttempts(raw, seatIds);
  const events = attemptEvents(raw, live);
  const queued = queuedCounts(raw, seatIds);
  const needs = needsYou(raw, seatIds);
  const finished = lastFinished(raw, seatIds);
  const runs = new Map<string, Run[]>();
  const signals = new Map<string, Signals>();
  for (const row of live) {
    signals.set(row.seatId, row);
    if (!LIVE_ATTEMPT_STATES.has(row.attemptState)) continue;
    const items = runs.get(row.seatId) ?? [];
    items.push(run(row, events.get(key(row.projectId, row.attemptId))));
    runs.set(row.seatId, items);
  }
  const byTeam = new Map<string, Seat[]>();
  for (const seat of seats) {
    const needsYou = needs.get(seat.id) ?? [];
    const lastFinished = finished.get(seat.id) ?? null;
    const count = queued.get(seat.id) ?? 0;
    const items = byTeam.get(seat.teamId) ?? [];
    items.push({ id: seat.id, name: text(seat.name), role: text(seat.role, 160), isLead: seat.isLead, slots: seat.slots,
      status: status(signals.get(seat.id), needsYou, count, lastFinished, now), runs: runs.get(seat.id) ?? [],
      queued: count, needsYou, lastFinished });
    byTeam.set(seat.teamId, items);
  }
  return { generatedAt: now.toISOString(), nodes: nodes(raw), teams: teams.map((team) => {
    const seats = byTeam.get(team.id) ?? [];
    const counts = { working: 0, waiting: 0, problem: 0, queued: 0, idle: 0 };
    // Recently done seats are free capacity, so they share the summary's idle bucket.
    for (const seat of seats) counts[seat.status === "done" ? "idle" : seat.status] += 1;
    return { id: team.id, name: text(team.name), lifecycle: team.lifecycle, counts, seats };
  }) };
}
