import type { Database } from "better-sqlite3";
import { projectSchema, type Project } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerMap } from "../commands/pipeline.js";

export const projectsCreateHandler: HandlerMap["projects.create"] = ({ raw, hub }, command) => {
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
