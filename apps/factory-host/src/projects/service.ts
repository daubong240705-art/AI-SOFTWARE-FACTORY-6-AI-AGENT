import type { Database } from "better-sqlite3";
import { projectSchema, type Project } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerMap } from "../commands/pipeline.js";
import { agentsFromPack, getPrimaryEngagement, type LoadedPack, type RosterDeps } from "../org/index.js";
import { ensureRoster } from "../org/agents.js";
import { registryPack, type RegistryPack } from "../org/registry.js";
import { requireGroup } from "../groups/service.js";

const createProject: HandlerMap["projects.create"] = ({ raw, hub }, command) => {
  const { projectId, payload } = command;
  if (raw.prepare("SELECT id FROM projects WHERE id = ?").get(projectId))
    throw new CommandError("conflict", "project already exists", "refresh");
  if (raw.prepare("SELECT id FROM projects WHERE workspace_root = ? AND disposition <> ?").get(payload.workspace.root, "archived"))
    throw new CommandError("conflict", "workspace already used by another project", "correct-input");
  if (payload.groupId !== undefined) requireGroup(raw, payload.groupId, { active: true });
  raw.prepare("INSERT INTO projects (id, revision, name, workspace_kind, workspace_root, disposition, group_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(projectId, 1, payload.name, payload.workspace.kind, payload.workspace.root, "active", payload.groupId ?? null);
  hub.ensureStream(projectId);
  return { effects: [{ kind: "project", id: projectId, revision: 1 }] };
};

export const projectsCreateHandler: HandlerMap["projects.create"] = createProject;

export function createProjectsCreateHandler({ pack, packs = [], startEmpty = false, multiTeam = false, checkWorkspaceRoot, defaultAgentCli }: {
  pack: LoadedPack; packs?: readonly RegistryPack[];
  /** true: without `teamTemplate` the project starts with no agents (the platform never imposes a team). */
  startEmpty?: boolean;
  multiTeam?: boolean; checkWorkspaceRoot?: (root: string) => boolean; defaultAgentCli?: RosterDeps["defaultAgentCli"];
}): HandlerMap["projects.create"] {
  return (ctx, command) => {
    // Agents run in worktrees of a clone under the Host's projects root; any other path would fail at the first task.
    if (checkWorkspaceRoot && !checkWorkspaceRoot(command.payload.workspace.root))
      throw new CommandError("validation", "workspace must be a clone under the Host projects root", "correct-input");
    const key = command.payload.teamTemplate;
    const entry = key === undefined ? undefined : packs.find((candidate) => candidate.key === key);
    if (key !== undefined && !entry && key !== pack.manifest.key)
      throw new CommandError("not-found", "team template not found", "correct-input");
    const result = createProject(ctx, command);
    // With multi-team the operator adds teams explicitly (teams.create-from-pack, engagements.create); no default team.
    if (multiTeam) return result;
    const source = entry ? registryPack(entry) : key !== undefined || !startEmpty ? pack : undefined;
    if (!source) {
      // An empty roster still gives the project its engagement, so tasks and agents can be added at once.
      const roster = ensureRoster(ctx.raw, command.projectId, ctx);
      result.effects.push({ kind: "team", id: roster.id, revision: roster.revision });
      result.effects.push({ kind: "engagement", id: getPrimaryEngagement(ctx.raw, command.projectId)!.id, revision: 1 });
      return result;
    }
    const roster = agentsFromPack(ctx.raw, { projectId: command.projectId, pack: source, actorId: ctx.actorId }, { ...ctx, defaultAgentCli });
    result.effects.push({ kind: "team", id: roster.rosterId, revision: 1 });
    result.effects.push({ kind: "engagement", id: getPrimaryEngagement(ctx.raw, command.projectId)!.id, revision: 1 });
    result.effects.push(...[...roster.agentIds.values()].map((id) => ({ kind: "seat" as const, id, revision: 1 })));
    return result;
  };
}

interface ProjectRow {
  id: string; revision: number; name: string; workspace_kind: string; workspace_root: string; disposition: string; group_id: string | null;
}
const projectFromRow = (row: ProjectRow): Project => projectSchema.parse({
  id: row.id, revision: row.revision, name: row.name,
  workspace: { kind: row.workspace_kind, root: row.workspace_root },
  leadAgentId: null, disposition: row.disposition, groupId: row.group_id,
});

export function listProjects(raw: Database, includeArchived = false): Project[] {
  return (raw.prepare(`SELECT id, revision, name, workspace_kind, workspace_root, disposition, group_id FROM projects
    WHERE (? OR disposition <> 'archived') ORDER BY id`).all(Number(includeArchived)) as ProjectRow[])
    .map(projectFromRow);
}

export function getProject(raw: Database, id: string): Project | undefined {
  const row = raw.prepare("SELECT id, revision, name, workspace_kind, workspace_root, disposition, group_id FROM projects WHERE id = ?")
    .get(id) as ProjectRow | undefined;
  return row === undefined ? undefined : projectFromRow(row);
}
