import type { Database } from "better-sqlite3";
import type { EventHub } from "../events/hub.js";

export const TEAM_FAILURE_THRESHOLD = 5;
export const TEAM_FAILURE_WINDOW_MS = 3_600_000;
interface TeamBreakerRow { state: "open" | "closed"; closed_at: string | null }
export function listTeamBreakers(raw: Database, projectId: string) {
  return raw.prepare(`SELECT team_id AS teamId,state,opened_at AS openedAt,closed_at AS closedAt,failures,reason
    FROM team_breakers WHERE project_id=? ORDER BY team_id`).all(projectId) as {
    teamId: string; state: "open" | "closed"; openedAt: string | null; closedAt: string | null; failures: number; reason: string | null;
  }[];
}

/** Each project's state, lifecycle changes, and notification commit together. */
export function tickTeamBreakers(deps: { raw: Database; hub: EventHub }, now: Date): void {
  let reported = false;
  const report = (): void => { if (!reported) { reported = true; console.error("Team breaker tick failed"); } };
  try {
    const at = now.toISOString();
    const projects = deps.raw.prepare("SELECT id FROM projects ORDER BY id").all() as { id: string }[];
    for (const project of projects) try {
      deps.hub.transaction(() => {
        // Reconcile manual resumes even if their engagement has since ended.
        deps.raw.prepare(`UPDATE team_breakers SET state='closed',opened_at=NULL,closed_at=?
          WHERE project_id=? AND state='open' AND team_id IN (SELECT id FROM teams WHERE lifecycle='active')`).run(at, project.id);
        const teams = deps.raw.prepare(`SELECT DISTINCT t.id,t.revision,t.lifecycle FROM teams t JOIN engagements e ON e.team_id=t.id
          WHERE e.project_id=? AND e.state='active' AND t.lifecycle<>'archived' ORDER BY t.id`).all(project.id) as {
          id: string; revision: number; lifecycle: string;
        }[];
        for (const team of teams) {
          const breaker = deps.raw.prepare("SELECT state,closed_at FROM team_breakers WHERE project_id=? AND team_id=?")
            .get(project.id, team.id) as TeamBreakerRow | undefined;
          if (team.lifecycle !== "active" || breaker?.state === "open") continue;
          const since = new Date(Math.max(now.getTime() - TEAM_FAILURE_WINDOW_MS,
            breaker?.closed_at ? Date.parse(breaker.closed_at) : -Infinity)).toISOString();
          const { n } = deps.raw.prepare(`SELECT count(DISTINCT t.id) AS n FROM event_log l
            JOIN tasks t ON t.project_id=l.project_id AND t.id=json_extract(l.body_json,'$.payload.taskId')
            JOIN engagements e ON e.project_id=t.project_id AND e.id=t.engagement_id
            WHERE l.project_id=? AND e.team_id=? AND json_extract(l.body_json,'$.payload.type')='task.status-changed'
              AND json_extract(l.body_json,'$.payload.to')='failed'
              AND julianday(json_extract(l.body_json,'$.occurredAt'))>=julianday(?)
              AND julianday(json_extract(l.body_json,'$.occurredAt'))<=julianday(?)
              AND (? IS NULL OR julianday(json_extract(l.body_json,'$.occurredAt'))>julianday(?))`)
            .get(project.id, team.id, since, at, breaker?.closed_at ?? null, breaker?.closed_at ?? null) as { n: number };
          if (n < TEAM_FAILURE_THRESHOLD) continue;
          deps.raw.prepare("UPDATE teams SET lifecycle='paused',revision=revision+1 WHERE id=?").run(team.id);
          deps.raw.prepare(`INSERT INTO team_breakers (project_id,team_id,state,opened_at,closed_at,failures,reason)
            VALUES (?,?,'open',?,NULL,?,?) ON CONFLICT(project_id,team_id) DO UPDATE SET
            state='open',opened_at=excluded.opened_at,failures=excluded.failures,reason=excluded.reason`)
            .run(project.id, team.id, at, n, `${n} tasks failed within 60 minutes`);
          deps.hub.append({ projectId: project.id, causationId: team.id,
            payload: { type: "entity.changed", entity: { kind: "team", id: team.id, revision: team.revision + 1 } } });
        }
      });
    } catch { report(); }
  } catch { report(); }
}
