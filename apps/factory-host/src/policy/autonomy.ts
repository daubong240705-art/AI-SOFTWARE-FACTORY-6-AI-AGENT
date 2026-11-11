import type { Database } from "better-sqlite3";
import { DEFAULT_AUTONOMY_LEVELS, type AutonomyLevel } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerMap } from "../commands/pipeline.js";

type Subject = "project" | "team";
interface AutonomyRow { level: AutonomyLevel; revision: number }
const setting = (raw: Database, projectId: string, subject: Subject, subjectRef: string): AutonomyRow | undefined =>
  raw.prepare("SELECT level, revision FROM autonomy_settings WHERE project_id = ? AND subject = ? AND subject_ref = ?")
    .get(projectId, subject, subjectRef) as AutonomyRow | undefined;

/** The configured level; team authority is additionally capped by the project. */
export function autonomyLevel(raw: Database, projectId: string, subject: Subject, subjectRef: string): {
  level: AutonomyLevel; source: "explicit" | "default";
} {
  const row = setting(raw, projectId, subject, subjectRef);
  return row ? { level: row.level, source: "explicit" } : { level: DEFAULT_AUTONOMY_LEVELS[subject], source: "default" };
}
export function effectiveTeamLevel(raw: Database, projectId: string, teamId: string): AutonomyLevel {
  return Math.min(autonomyLevel(raw, projectId, "project", projectId).level,
    autonomyLevel(raw, projectId, "team", teamId).level) as AutonomyLevel;
}
export function autonomyStatus(raw: Database, projectId: string) {
  const teams = raw.prepare("SELECT DISTINCT team_id FROM engagements WHERE project_id = ? ORDER BY team_id")
    .all(projectId) as { team_id: string }[];
  return {
    project: { ...autonomyLevel(raw, projectId, "project", projectId), revision: setting(raw, projectId, "project", projectId)?.revision ?? null },
    teams: teams.map(({ team_id }) => ({ teamId: team_id, ...autonomyLevel(raw, projectId, "team", team_id),
      effectiveLevel: effectiveTeamLevel(raw, projectId, team_id) })),
    defaults: DEFAULT_AUTONOMY_LEVELS,
  };
}
export const setAutonomyHandler: HandlerMap["autonomy.set"] = ({ raw, clock }, { projectId, payload }) => {
  if (!raw.prepare("SELECT id FROM projects WHERE id = ?").get(projectId))
    throw new CommandError("not-found", "project not found", "correct-input");
  if (payload.subject === "project" && payload.subjectRef !== projectId)
    throw new CommandError("validation", "project subject must match project id", "correct-input");
  // Teams are global; an existing team may be configured before its first engagement.
  if (payload.subject === "team" && !raw.prepare("SELECT id FROM teams WHERE id = ?").get(payload.subjectRef))
    throw new CommandError("not-found", "team not found", "correct-input");
  const stored = setting(raw, projectId, payload.subject, payload.subjectRef);
  if (stored && stored.revision !== payload.expectedRevision)
    throw new CommandError("conflict", "autonomy revision changed", "refresh", { currentRevision: stored.revision });
  if (!stored && payload.expectedRevision !== null)
    throw new CommandError("conflict", "autonomy setting does not exist", "refresh");
  raw.prepare(`INSERT INTO autonomy_settings (project_id,subject,subject_ref,revision,level,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(project_id,subject,subject_ref) DO UPDATE SET revision=excluded.revision,level=excluded.level,updated_at=excluded.updated_at`)
    .run(projectId, payload.subject, payload.subjectRef, stored ? stored.revision + 1 : 1, payload.level, clock().toISOString());
  // Settings have their own revision; do not advertise it as a project/team entity revision.
  return { effects: [] };
};
