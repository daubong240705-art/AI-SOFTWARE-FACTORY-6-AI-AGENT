import type { Database } from "better-sqlite3";
import { projectSchema, type Project } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerMap } from "../commands/pipeline.js";
import { ensureEngagement, ensureTeamFromPack, getTeam, type LoadedPack } from "../org/index.js";

const createProject: HandlerMap["projects.create"] = ({ raw, hub }, command) => {
  const { projectId, payload } = command;
  if (raw.prepare("SELECT id FROM projects WHERE id = ?").get(projectId))
    throw new CommandError("conflict", "project already exists", "refresh");
  if (raw.prepare("SELECT id FROM projects WHERE workspace_root = ? AND disposition <> ?").get(payload.workspace.root, "archived"))
    throw new CommandError("conflict", "workspace already used by another project", "correct-input");
  raw.prepare("INSERT INTO projects (id, revision, name, workspace_kind, workspace_root, disposition) VALUES (?, ?, ?, ?, ?, ?)")
    .run(projectId, 1, payload.name, payload.workspace.kind, payload.workspace.root, "active");
  hub.ensureStream(projectId);
  return { effects: [{ kind: "project", id: projectId, revision: 1 }] };
};

export const projectsCreateHandler: HandlerMap["projects.create"] = createProject;

export function createProjectsCreateHandler({ pack, multiTeam = false, checkWorkspaceRoot }: {
  pack: LoadedPack; multiTeam?: boolean; checkWorkspaceRoot?: (root: string) => boolean;
}): HandlerMap["projects.create"] {
  return (ctx, command) => {
    // Agents run in worktrees of a clone under the Host's projects root; any other path would fail at the first task.
    if (checkWorkspaceRoot && !checkWorkspaceRoot(command.payload.workspace.root))
      throw new CommandError("validation", "workspace must be a clone under the Host projects root", "correct-input");
    const result = createProject(ctx, command);
    const team = ensureTeamFromPack(ctx.raw, pack, ctx);
    if (multiTeam && getTeam(ctx.raw, team.teamId)?.lifecycle !== "active")
      throw new CommandError("conflict", "default team is not active", "refresh");
    const engagement = ensureEngagement(ctx.raw, { projectId: command.projectId, teamId: team.teamId }, ctx);
    if (team.created) result.effects.push({ kind: "team", id: team.teamId, revision: 1 });
    result.effects.push({ kind: "engagement", id: engagement.engagementId, revision: 1 });
    return result;
  };
}

interface ProjectRow {
  id: string; revision: number; name: string; workspace_kind: string; workspace_root: string; disposition: string;
}
const projectFromRow = (row: ProjectRow): Project => projectSchema.parse({
  id: row.id, revision: row.revision, name: row.name,
  workspace: { kind: row.workspace_kind, root: row.workspace_root },
  leadAgentId: null, disposition: row.disposition,
});

export function listProjects(raw: Database): Project[] {
  return (raw.prepare("SELECT id, revision, name, workspace_kind, workspace_root, disposition FROM projects ORDER BY id").all() as ProjectRow[])
    .map(projectFromRow);
}

export function getProject(raw: Database, id: string): Project | undefined {
  const row = raw.prepare("SELECT id, revision, name, workspace_kind, workspace_root, disposition FROM projects WHERE id = ?")
    .get(id) as ProjectRow | undefined;
  return row === undefined ? undefined : projectFromRow(row);
}
