import type { Database } from "better-sqlite3";
import { workflowChanged } from "../workflow/lifecycle.js";
import { CommandError } from "../commands/errors.js";
import type { HandlerMap } from "../commands/pipeline.js";
import { ensureTeamFromPack, getTeam } from "./service.js";
import { registryPack, type RegistryPack } from "./registry.js";

const disabled = (): never => { throw new CommandError("unsupported", "multi-team is disabled", "contact-host"); };
const revisionCheck = (actual: number, expected: number): void => {
  if (actual !== expected) throw new CommandError("conflict", "revision changed", "refresh", { currentRevision: actual });
};
const requireProject = (raw: Database, projectId: string): void => {
  if (!raw.prepare("SELECT id FROM projects WHERE id = ?").get(projectId))
    throw new CommandError("not-found", "project not found", "correct-input");
};
const requireActiveTeam = (raw: Database, teamId: string): void => {
  const team = getTeam(raw, teamId);
  if (!team) throw new CommandError("not-found", "team not found", "correct-input");
  if (team.lifecycle !== "active") throw new CommandError("conflict", "team is not active", "refresh");
};
const noActiveDuplicate = (raw: Database, projectId: string, teamId: string, except: string): void => {
  if (raw.prepare("SELECT id FROM engagements WHERE project_id = ? AND team_id = ? AND state = 'active' AND id <> ?")
    .get(projectId, teamId, except)) throw new CommandError("conflict", "active engagement already exists", "refresh");
};

export const ORG_COMMANDS = ["teams.create-from-pack", "teams.set-lifecycle", "engagements.create", "engagements.update", "seats.update"] as const;

export function createOrgHandlers(deps: { multiTeam?: boolean; packs: readonly RegistryPack[] }): Partial<HandlerMap> {
  const enabled = (): void => { if (!deps.multiTeam) disabled(); };
  return {
    "teams.create-from-pack": (ctx, { projectId, payload }) => {
      enabled(); requireProject(ctx.raw, projectId);
      const entry = deps.packs.find((pack) => pack.key === payload.packKey && pack.version === payload.packVersion);
      if (!entry) throw new CommandError("not-found", "pack version not found", "correct-input");
      const existing = getTeam(ctx.raw, payload.teamId);
      if (existing && (existing.pack?.key !== payload.packKey || existing.pack.version !== payload.packVersion))
        throw new CommandError("conflict", "team id already exists", "correct-input");
      const result = ensureTeamFromPack(ctx.raw, registryPack(entry), { ...ctx, teamId: payload.teamId });
      const team = getTeam(ctx.raw, result.teamId)!;
      return { effects: [{ kind: "team", id: team.id, revision: team.revision },
        ...(result.created ? result.seatIds.map((id) => ({ kind: "seat" as const, id, revision: 1 })) : [])] };
    },
    "teams.set-lifecycle": ({ raw }, { projectId, payload }) => {
      enabled(); requireProject(raw, projectId);
      const team = getTeam(raw, payload.teamId);
      if (!team) throw new CommandError("not-found", "team not found", "correct-input");
      revisionCheck(team.revision, payload.expectedRevision);
      raw.prepare("UPDATE teams SET lifecycle = ?, revision = revision + 1 WHERE id = ?").run(payload.lifecycle, team.id);
      return { effects: [{ kind: "team", id: team.id, revision: team.revision + 1 }] };
    },
    "engagements.create": ({ raw, clock }, { projectId, payload }) => {
      if (!deps.multiTeam && raw.prepare("SELECT id FROM engagements WHERE project_id = ? AND state = 'active'").get(projectId)) disabled();
      requireProject(raw, projectId); requireActiveTeam(raw, payload.teamId);
      if (raw.prepare("SELECT id FROM engagements WHERE project_id = ? AND id = ?").get(projectId, payload.engagementId))
        throw new CommandError("conflict", "engagement already exists", "correct-input");
      noActiveDuplicate(raw, projectId, payload.teamId, payload.engagementId);
      // Preserve creation order even with a coarse clock or a clock adjustment.
      const latest = raw.prepare("SELECT MAX(created_at) AS at FROM engagements WHERE project_id = ?")
        .get(projectId) as { at: string | null };
      const createdAt = new Date(Math.max(clock().getTime(), latest.at === null ? 0 : Date.parse(latest.at) + 1)).toISOString();
      raw.prepare(`INSERT INTO engagements (project_id, id, team_id, revision, priority, max_concurrent, state, created_at)
        VALUES (?, ?, ?, 1, ?, ?, 'active', ?)`)
        .run(projectId, payload.engagementId, payload.teamId, payload.priority, payload.maxConcurrent, createdAt);
      workflowChanged(raw, projectId);
      return { effects: [{ kind: "engagement", id: payload.engagementId, revision: 1 }] };
    },
    "engagements.update": ({ raw }, { projectId, payload }) => {
      enabled(); requireProject(raw, projectId);
      const row = raw.prepare("SELECT team_id, revision, priority, max_concurrent, state FROM engagements WHERE project_id = ? AND id = ?")
        .get(projectId, payload.engagementId) as { team_id: string; revision: number; priority: number; max_concurrent: number; state: string } | undefined;
      if (!row) throw new CommandError("not-found", "engagement not found in project", "correct-input");
      revisionCheck(row.revision, payload.expectedRevision);
      if (payload.state === "active") {
        requireActiveTeam(raw, row.team_id); noActiveDuplicate(raw, projectId, row.team_id, payload.engagementId);
      }
      raw.prepare(`UPDATE engagements SET priority = ?, max_concurrent = ?, state = ?, revision = revision + 1
        WHERE project_id = ? AND id = ?`).run(payload.priority ?? row.priority, payload.maxConcurrent ?? row.max_concurrent,
        payload.state ?? row.state, projectId, payload.engagementId);
      workflowChanged(raw, projectId);
      return { effects: [{ kind: "engagement", id: payload.engagementId, revision: row.revision + 1 }] };
    },
    "seats.update": ({ raw }, { projectId, payload }) => {
      enabled(); requireProject(raw, projectId);
      const seat = raw.prepare("SELECT revision, slots FROM seats WHERE id = ?").get(payload.seatId) as { revision: number; slots: number } | undefined;
      if (!seat) throw new CommandError("not-found", "seat not found", "correct-input");
      revisionCheck(seat.revision, payload.expectedRevision);
      // O1 changes capacity only. Node policy stays elastic; dedicated nodes arrive in M4.
      raw.prepare("UPDATE seats SET slots = ?, revision = revision + 1 WHERE id = ?").run(payload.slots ?? seat.slots, payload.seatId);
      return { effects: [{ kind: "seat", id: payload.seatId, revision: seat.revision + 1 }] };
    },
  };
}
