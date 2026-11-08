import type { Database } from "better-sqlite3";
import { LIVE_ATTEMPT_STATES } from "@factory/contracts";
import { engagementLoad, seatLoad } from "../dispatch/node.js";
import { listSeats } from "./service.js";

export function projectEngagements(raw: Database, projectId: string) {
  return raw.prepare(`SELECT e.id, e.team_id AS teamId, t.name AS teamName, e.priority,
    e.max_concurrent AS maxConcurrent, e.state, e.revision, e.created_at AS createdAt
    FROM engagements e JOIN teams t ON t.id = e.team_id WHERE e.project_id = ? ORDER BY e.created_at, e.id`)
    .all(projectId) as { id: string; teamId: string; teamName: string; priority: number; maxConcurrent: number;
      state: string; revision: number; createdAt: string }[];
}

export function teamViews(raw: Database) {
  const teams = raw.prepare(`SELECT id, name, pack_key AS packKey, pack_version AS packVersion, lifecycle, revision
    FROM teams ORDER BY name, id`).all() as { id: string; name: string; packKey: string | null;
      packVersion: string | null; lifecycle: string; revision: number }[];
  return teams.map((team) => {
    const engagements = raw.prepare(`SELECT e.project_id AS projectId, p.name AS projectName, e.id AS engagementId,
      e.priority, e.max_concurrent AS maxConcurrent, e.state FROM engagements e JOIN projects p ON p.id = e.project_id
      WHERE e.team_id = ? ORDER BY e.priority DESC, e.created_at, e.id`).all(team.id) as {
        projectId: string; projectName: string; engagementId: string; priority: number; maxConcurrent: number; state: string }[];
    return { ...team, seats: listSeats(raw, team.id).map(({ id, name, role, slots, isLead }) =>
      ({ id, name, role, slots, isLead, live: seatLoad(raw, id).used })),
    engagements: engagements.map((engagement) => ({ ...engagement,
      live: engagementLoad(raw, engagement.projectId, engagement.engagementId) })) };
  });
}

export function teamQueue(raw: Database, teamId: string) {
  const states = [...LIVE_ATTEMPT_STATES];
  return raw.prepare(`SELECT t.project_id AS projectId, p.name AS projectName, t.id AS taskId, t.code, t.title,
    t.state, e.priority AS engagementPriority, s.name AS seatName, a.state AS liveAttemptState,
    (SELECT MIN(json_extract(body_json, '$.occurredAt')) FROM event_log log
      WHERE log.project_id = t.project_id AND json_extract(body_json, '$.payload.type') = 'entity.changed'
      AND json_extract(body_json, '$.payload.entity.kind') = 'attempt'
      AND json_extract(body_json, '$.payload.entity.id') = a.id
      AND json_extract(body_json, '$.payload.entity.revision') = 1) AS queuedAt
    FROM tasks t JOIN projects p ON p.id = t.project_id
    JOIN engagements e ON e.project_id = t.project_id AND e.id = t.engagement_id
    LEFT JOIN attempts a ON a.project_id = t.project_id AND a.task_id = t.id AND a.state IN (${states.map(() => "?").join(",")})
    LEFT JOIN attempt_seats ats ON ats.project_id = a.project_id AND ats.attempt_id = a.id
    LEFT JOIN seats s ON s.id = COALESCE(ats.seat_id, t.owner_seat_id)
    WHERE e.team_id = ? AND t.state IN ('draft','proposed','accepted','ready','awaiting-go','active')
    ORDER BY e.priority DESC, a.rowid IS NULL, a.rowid, t.rowid LIMIT 200`)
    .all(...states, teamId) as { projectId: string; projectName: string; taskId: string; code: string; title: string;
      state: string; engagementPriority: number; queuedAt: string | null; seatName: string | null; liveAttemptState: string | null }[];
}
