import type { Database } from "better-sqlite3";

export function projectEngagements(raw: Database, projectId: string) {
  return raw.prepare(`SELECT e.id, e.team_id AS teamId, t.name AS teamName, e.priority,
    e.max_concurrent AS maxConcurrent, e.state, e.revision, e.created_at AS createdAt
    FROM engagements e JOIN teams t ON t.id = e.team_id WHERE e.project_id = ? ORDER BY e.created_at, e.id`)
    .all(projectId) as { id: string; teamId: string; teamName: string; priority: number; maxConcurrent: number;
      state: string; revision: number; createdAt: string }[];
}
