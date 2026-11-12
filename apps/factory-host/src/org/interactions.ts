import type { Database } from "better-sqlite3";
import { sanitizeAgentText } from "../mcp/security.js";
import { meaningfulProgressSql } from "../dispatch/progress.js";
import { orgActivity } from "./activity.js";
import { getPrimaryEngagement } from "./service.js";
import { projectEngagements } from "./views.js";

/**
 * The project's "office": who is working on what and who handed what to whom. It is a read-only projection
 * over tasks, attempts, approvals, artifacts and Lead chat. Agents never message each other directly (doc 14);
 * every item here is one of the structured channels: assignment, hand-off of dependency outputs, cross-team
 * request, question or review to the operator and the answer, registered output, progress and completion.
 */
export type Party = { kind: "seat"; seatId: string; name: string } | { kind: "operator" } | { kind: "knowledge" };
export type InteractionKind = "message" | "assign" | "rework" | "request" | "handoff" | "progress" | "question"
  | "review" | "start-gate" | "answer" | "output" | "finished" | "failed";
export interface Interaction {
  id: string; at: string; kind: InteractionKind; from: Party; to: Party | null;
  taskId: string | null; code: string | null; text: string;
}
type ActivitySeat = ReturnType<typeof orgActivity>["teams"][number]["seats"][number];

const text = (value: unknown, limit = 160): string => typeof value === "string" ? sanitizeAgentText(value).replace(/\s+/g, " ").trim().slice(0, limit) : "";
const time = (value: string | null | undefined): string | null =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const seat = (seatId: string | null, name: string | null): Party | null =>
  seatId === null ? null : { kind: "seat", seatId, name: text(name ?? "", 80) };

export function projectInteractions(raw: Database, projectId: string, now: Date, limit = 100): {
  generatedAt: string; seats: Array<ActivitySeat & { teamId: string; teamName: string; chat?: { since: string } }>; items: Interaction[];
} {
  const engagement = getPrimaryEngagement(raw, projectId);
  const teamIds = new Set(projectEngagements(raw, projectId).map((item) => item.teamId));
  if (engagement) teamIds.add(engagement.teamId);
  const lead = engagement === undefined ? undefined : raw.prepare("SELECT id, name FROM seats WHERE team_id = ? AND is_lead = 1 LIMIT 1")
    .get(engagement.teamId) as { id: string; name: string } | undefined;
  const leadParty = lead === undefined ? null : seat(lead.id, lead.name);
  const activity = orgActivity(raw, now);
  // A Lead chat turn is work too, though it is not a task attempt: show the Lead as working while it answers.
  const turn = lead === undefined ? undefined : raw.prepare(`SELECT created_at AS since FROM lead_turns
    WHERE project_id = ? AND state IN ('queued','running') ORDER BY created_at LIMIT 1`).get(projectId) as { since: string } | undefined;
  const chatSince = time(turn?.since);
  const seats = activity.teams.filter((team) => teamIds.has(team.id)).flatMap((team) => team.seats.map((item) => {
    const answering = chatSince !== null && item.id === lead?.id;
    return { ...item, teamId: team.id, teamName: team.name, runs: item.runs.filter((run) => run.projectId === projectId),
      ...(answering ? { chat: { since: chatSince }, status: item.status === "waiting" || item.status === "problem" ? item.status : "working" as const } : {}) };
  }));
  const items: Interaction[] = [];
  const push = (item: Omit<Interaction, "at"> & { at: string | null }): void => {
    if (item.at !== null && (item.to === null || item.from.kind !== item.to.kind
      || (item.from.kind === "seat" && item.to.kind === "seat" && item.from.seatId !== item.to.seatId))) items.push({ ...item, at: item.at });
  };

  // Assignments, rework, cross-team requests, hand-offs and completions, from each attempt.
  const attempts = raw.prepare(`SELECT a.id, a.epoch, a.state, a.started_at AS startedAt, a.ended_at AS endedAt,
      (SELECT MIN(e.at) FROM attempt_events e WHERE e.project_id = a.project_id AND e.attempt_id = a.id AND e.kind = 'state') AS firstAt,
      t.id AS taskId, t.code, t.title, t.request_kind AS requestKind, ats.seat_id AS seatId, s.name AS seatName,
      rt.owner_seat_id AS requesterSeatId, rs.name AS requesterName
    FROM attempts a JOIN tasks t ON t.project_id = a.project_id AND t.id = a.task_id
    LEFT JOIN attempt_seats ats ON ats.project_id = a.project_id AND ats.attempt_id = a.id
    LEFT JOIN seats s ON s.id = ats.seat_id
    LEFT JOIN tasks rt ON rt.project_id = t.project_id AND rt.id = t.requester_task_id
    LEFT JOIN seats rs ON rs.id = rt.owner_seat_id
    WHERE a.project_id = ? AND a.state <> 'queued' ORDER BY a.rowid DESC LIMIT 200`).all(projectId) as Array<{
      id: string; epoch: number; state: string; startedAt: string | null; endedAt: string | null; firstAt: string | null;
      taskId: string; code: string; title: string; requestKind: string | null; seatId: string | null; seatName: string | null;
      requesterSeatId: string | null; requesterName: string | null }>;
  const dependencies = raw.prepare(`SELECT d.depends_on_task_id AS taskId, dt.code, dt.title, dt.owner_seat_id AS seatId, s.name AS seatName
    FROM task_dependencies d JOIN tasks dt ON dt.project_id = d.project_id AND dt.id = d.depends_on_task_id
    LEFT JOIN seats s ON s.id = dt.owner_seat_id WHERE d.project_id = ? AND d.task_id = ?`);
  for (const row of attempts) {
    const to = seat(row.seatId, row.seatName);
    const started = time(row.firstAt ?? row.startedAt);
    if (to !== null && started !== null) {
      const requester = seat(row.requesterSeatId, row.requesterName);
      const from: Party | null = row.epoch > 1 ? { kind: "operator" } : requester ?? leadParty;
      if (from !== null) push({ id: `start:${row.id}`, at: started, kind: row.epoch > 1 ? "rework" : requester ? "request" : "assign",
        from, to, taskId: row.taskId, code: text(row.code, 40), text: text(row.title) });
      if (row.epoch === 1) for (const dependency of dependencies.all(projectId, row.taskId) as Array<{
        taskId: string; code: string; title: string; seatId: string | null; seatName: string | null }>) {
        const owner = seat(dependency.seatId, dependency.seatName);
        if (owner !== null) push({ id: `handoff:${row.id}:${dependency.taskId}`, at: started, kind: "handoff", from: owner, to,
          taskId: dependency.taskId, code: text(dependency.code, 40), text: text(dependency.title) });
      }
    }
    const ended = time(row.endedAt);
    if (to !== null && ended !== null && (row.state === "succeeded" || row.state === "failed"))
      push({ id: `end:${row.id}`, at: ended, kind: row.state === "succeeded" ? "finished" : "failed", from: to, to: leadParty,
        taskId: row.taskId, code: text(row.code, 40), text: text(row.title) });
  }

  // Filter legacy tool chatter before the cap so it cannot crowd out actual milestones.
  // Consecutive identical reports in one attempt describe the same milestone; keep its first timestamp.
  for (const row of raw.prepare(`WITH reports AS (
      SELECT e.*, trim(json_extract(e.body_json, '$.message')) AS message,
        LAG(trim(json_extract(e.body_json, '$.message'))) OVER (PARTITION BY e.attempt_id ORDER BY e.seq) AS previousMessage,
        LAG(json_extract(e.body_json, '$.percent')) OVER (PARTITION BY e.attempt_id ORDER BY e.seq) AS previousPercent
      FROM attempt_events e WHERE e.project_id = ? AND e.kind = 'progress' AND ${meaningfulProgressSql("e")}
    ) SELECT e.attempt_id AS attemptId, e.seq, e.at, e.message,
      t.id AS taskId, t.code, ats.seat_id AS seatId, s.name AS seatName
    FROM reports e JOIN attempts a ON a.project_id = e.project_id AND a.id = e.attempt_id
    JOIN tasks t ON t.project_id = a.project_id AND t.id = a.task_id
    LEFT JOIN attempt_seats ats ON ats.project_id = a.project_id AND ats.attempt_id = a.id LEFT JOIN seats s ON s.id = ats.seat_id
    WHERE e.message IS NOT e.previousMessage OR json_extract(e.body_json, '$.percent') IS NOT e.previousPercent
    ORDER BY e.at DESC, e.seq DESC LIMIT 60`).all(projectId) as Array<{
      attemptId: string; seq: number; at: string; message: string; taskId: string; code: string; seatId: string | null; seatName: string | null }>) {
    const from = seat(row.seatId, row.seatName);
    if (from !== null) push({ id: `progress:${row.attemptId}:${row.seq}`, at: time(row.at), kind: "progress", from, to: null,
      taskId: row.taskId, code: text(row.code, 40), text: text(row.message, 2000) });
  }

  // Questions, reviews and start gates go to the operator; the decision comes back.
  for (const row of raw.prepare(`SELECT ap.id, ap.kind, ap.subject, ap.requested_at AS requestedAt, ap.decided_at AS decidedAt,
      ap.outcome_option_id AS outcome, t.id AS taskId, t.code,
      COALESCE(t.owner_seat_id, (SELECT ats.seat_id FROM attempts a JOIN attempt_seats ats ON ats.project_id = a.project_id
        AND ats.attempt_id = a.id WHERE a.project_id = t.project_id AND a.task_id = t.id ORDER BY a.rowid DESC LIMIT 1)) AS seatId
    FROM approvals ap JOIN tasks t ON t.project_id = ap.project_id AND t.id = ap.task_id
    WHERE ap.project_id = ? ORDER BY ap.requested_at DESC LIMIT 100`).all(projectId) as Array<{
      id: string; kind: "question" | "review" | "start-gate"; subject: string; requestedAt: string; decidedAt: string | null;
      outcome: string | null; taskId: string; code: string; seatId: string | null }>) {
    const name = row.seatId === null ? null : (raw.prepare("SELECT name FROM seats WHERE id = ?").get(row.seatId) as { name: string } | undefined)?.name ?? null;
    const asker = row.kind === "start-gate" ? leadParty : seat(row.seatId, name);
    if (asker === null) continue;
    push({ id: `ask:${row.id}`, at: time(row.requestedAt), kind: row.kind, from: asker, to: { kind: "operator" },
      taskId: row.taskId, code: text(row.code, 40), text: text(row.subject) });
    if (row.decidedAt !== null) push({ id: `answer:${row.id}`, at: time(row.decidedAt), kind: "answer", from: { kind: "operator" }, to: asker,
      taskId: row.taskId, code: text(row.code, 40), text: text(row.outcome ?? "", 80) });
  }

  // Registered outputs, which later tasks read through the Context Pack.
  for (const row of raw.prepare(`SELECT av.artifact_id AS artifactId, av.version, av.kind, av.title, av.created_at AS createdAt,
      a.task_id AS taskId, t.code, ats.seat_id AS seatId, s.name AS seatName
    FROM artifact_versions av JOIN attempts a ON a.project_id = av.project_id AND a.id = av.produced_by_attempt_id
    JOIN tasks t ON t.project_id = a.project_id AND t.id = a.task_id
    LEFT JOIN attempt_seats ats ON ats.project_id = a.project_id AND ats.attempt_id = a.id LEFT JOIN seats s ON s.id = ats.seat_id
    WHERE av.project_id = ? ORDER BY av.created_at DESC LIMIT 60`).all(projectId) as Array<{
      artifactId: string; version: number; kind: string; title: string; createdAt: string; taskId: string; code: string;
      seatId: string | null; seatName: string | null }>) {
    const from = seat(row.seatId, row.seatName);
    if (from !== null) push({ id: `output:${row.artifactId}:${row.version}`, at: time(row.createdAt), kind: "output", from,
      to: { kind: "knowledge" }, taskId: row.taskId, code: text(row.code, 40), text: `${text(row.kind, 30)}: ${text(row.title, 120)}` });
  }

  // The operator's chat with the Lead.
  if (leadParty !== null) for (const row of raw.prepare(`SELECT id, body_json AS body FROM messages WHERE project_id = ?
    ORDER BY rowid DESC LIMIT 20`).all(projectId) as Array<{ id: string; body: string }>) {
    let message: { speaker?: unknown; text?: unknown; createdAt?: unknown } = {};
    try { message = (JSON.parse(row.body) as { message?: typeof message }).message ?? {}; } catch { continue; }
    if (message.speaker !== "user" && message.speaker !== "agent") continue;
    push({ id: `message:${row.id}`, at: time(typeof message.createdAt === "string" ? message.createdAt : null), kind: "message",
      from: message.speaker === "user" ? { kind: "operator" } : leadParty, to: message.speaker === "user" ? leadParty : { kind: "operator" },
      taskId: null, code: null, text: text(message.text, 200) });
  }

  const order = (item: Interaction): number => Date.parse(item.at);
  items.sort((left, right) => order(right) - order(left) || right.id.localeCompare(left.id));
  return { generatedAt: now.toISOString(), seats, items: items.slice(0, Math.max(1, Math.min(limit, 300))) };
}
