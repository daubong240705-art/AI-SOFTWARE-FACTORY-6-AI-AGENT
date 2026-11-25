import { lstatSync, mkdirSync, renameSync } from "node:fs";
import { basename, join, relative, isAbsolute, sep, resolve } from "node:path";
import { isTerminalFlowRunState, LIVE_ATTEMPT_STATES, type EntityRef } from "@factory/contracts";
import type { Database } from "better-sqlite3";
import { EventHub } from "../events/hub.js";
import { createIdGenerator, systemClock, type Clock } from "../ids.js";
import { cancelRun, type FlowEngineDeps } from "../flow/engine.js";
import { getRun } from "../flow/store.js";
import { retiredGamePacks } from "../org/pack.js";
import { CommandError } from "../commands/errors.js";
import type { HandlerMap } from "../commands/pipeline.js";
import { getProject } from "./service.js";
import { cancelProjectTasks } from "./cancel-tasks.js";
import { withoutWorkflowAdvancement } from "../flow/lifecycle.js";
import { assertInside, canonicalPath } from "../workspace/paths.js";
import { withdrawPendingApprovals } from "../approvals/service.js";

/** Plan the new historical path in the transaction, but perform filesystem writes only after commit. */
function planArchiveWorkspace(projectsRoot: string, workspace: string, now: Date): { root: string; move: () => string } {
  const root = canonicalPath(projectsRoot);
  const rel = relative(root, resolve(workspace));
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
    return { root: workspace, move: () => "Dự án đã được lưu trữ. Thư mục nằm ngoài vùng dự án nên được giữ nguyên; không xoá file." };
  const source = assertInside(root, workspace);
  const identity = lstatSync(workspace);
  if (!identity.isDirectory() || identity.isSymbolicLink())
    throw new Error("Unsafe workspace");
  const archive = assertInside(root, join(root, "_archived"));
  const fromArchive = relative(archive, source);
  if (fromArchive === "" || (!isAbsolute(fromArchive) && fromArchive !== ".." && !fromArchive.startsWith(`..${sep}`)))
    throw new Error("Workspace already inside archive");
  const stamp = now.toISOString().replaceAll(":", "-");
  const target = assertInside(archive, join(archive, `${basename(source)}-${stamp}`));
  try { lstatSync(target); throw new Error("Archive destination exists"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { root: target, move: () => {
    try {
      const current = lstatSync(workspace);
      if (current.dev !== identity.dev || current.ino !== identity.ino || current.isSymbolicLink()) throw new Error("Workspace replaced");
      if (assertInside(root, workspace) !== source || assertInside(root, join(root, "_archived")) !== archive)
        throw new Error("Workspace boundary changed");
      mkdirSync(archive, { recursive: true });
      if (assertInside(archive, target) !== target) throw new Error("Archive boundary changed");
      try { lstatSync(target); throw new Error("Archive destination exists"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      renameSync(source, target);
      return `Dự án đã được lưu trữ. Thư mục đã chuyển đến ${target}. Không có file nào bị xoá.`;
    } catch {
      return `Dự án đã được lưu trữ nhưng chưa chuyển được thư mục từ ${workspace} đến ${target}. Không có file nào bị xoá.`;
    }
  } };
}

function hasLiveAttempt(raw: Database, projectId: string): boolean {
  const states = [...LIVE_ATTEMPT_STATES];
  return Boolean(raw.prepare(`SELECT 1 FROM attempts WHERE project_id=? AND state IN (${states.map(() => "?").join(",")}) LIMIT 1`)
    .get(projectId, ...states));
}

function cancelProjectFlows(engine: FlowEngineDeps, projectId: string): void {
  const runs = engine.raw.prepare(`SELECT id FROM flow_runs WHERE project_id=?
    AND state NOT IN ('succeeded','failed','cancelled') ORDER BY depth,id`).all(projectId) as { id: string }[];
  for (const { id } of runs) {
    const run = getRun(engine.raw, projectId, id);
    if (run && !isTerminalFlowRunState(run.state)) cancelRun(engine, run, "Project archived");
  }
}

export function archiveGameProjects(raw: Database, hub = new EventHub(raw), clock: Clock = systemClock): void {
  const engine = { raw, hub, clock, newId: createIdGenerator(clock) };
  const projects = raw.prepare(`SELECT p.id, p.revision FROM projects p
    WHERE p.disposition<>'archived' AND EXISTS (
      SELECT 1 FROM teams t WHERE t.kind IN ('roster','pack') AND t.pack_key IN (SELECT value FROM json_each(?))
        AND (t.project_id=p.id OR EXISTS (SELECT 1 FROM engagements e WHERE e.project_id=p.id AND e.team_id=t.id))
    ) ORDER BY p.id`).all(JSON.stringify(retiredGamePacks)) as { id: string; revision: number }[];
  for (const { id, revision } of projects) {
    const archived = hub.transaction(() => withoutWorkflowAdvancement(raw, () => {
      if (hasLiveAttempt(raw, id)) return false;
      raw.prepare("UPDATE projects SET disposition='archived',revision=revision+1 WHERE id=?").run(id);
      cancelProjectFlows(engine, id);
      if (hub.currentCursor(id)) hub.append({ projectId: id, causationId: id, payload: { type: "entity.changed",
        entity: { kind: "project", id, revision: revision + 1 } } });
      return true;
    }));
    console.log(`Legacy project ${id}: ${archived ? "archived" : "skipped (live attempt)"}`);
  }
}

export function createProjectsArchiveHandler(deps: {
  engine: FlowEngineDeps; projectsRoot: string;
}): HandlerMap["projects.archive"] {
  return (ctx, command) => withoutWorkflowAdvancement(ctx.raw, () => {
    const { raw } = ctx, { projectId, payload } = command;
    if (!ctx.actorIsOperator) throw new CommandError("forbidden", "Chỉ người vận hành được lưu trữ dự án.", "correct-input");
    const project = getProject(raw, projectId);
    if (!project) throw new CommandError("not-found", "Không tìm thấy dự án.", "correct-input");
    if (project.disposition === "archived") throw new CommandError("conflict", "Dự án đã được lưu trữ.", "refresh");
    if (project.revision !== payload.expectedRevision)
      throw new CommandError("conflict", "Dự án đã thay đổi. Hãy tải lại trước khi xoá.", "refresh", { currentRevision: project.revision });
    if (payload.confirmName !== project.name)
      throw new CommandError("validation", "Tên xác nhận phải trùng khớp chính xác với tên dự án.", "correct-input");
    if (hasLiveAttempt(raw, projectId))
      throw new CommandError("conflict", "Dự án còn run đang hoạt động hoặc chưa rõ kết quả. Hãy dừng run và đối soát trước khi xoá dự án.", "refresh");

    let workspace: ReturnType<typeof planArchiveWorkspace>;
    try { workspace = planArchiveWorkspace(deps.projectsRoot, project.workspace.root, ctx.clock()); }
    catch { workspace = { root: project.workspace.root, move: () => "Dự án đã được lưu trữ nhưng chưa chuyển được thư mục. Không có file nào bị xoá." }; }
    // Fence lifecycle callbacks before they can resume a parked requester during cancellation.
    raw.prepare("UPDATE projects SET disposition='archived',workspace_root=?,revision=revision+1 WHERE id=?").run(workspace.root, projectId);
    const changes: EntityRef[] = [];
    cancelProjectFlows(deps.engine, projectId);
    changes.push(...cancelProjectTasks(ctx, projectId));
    changes.push(...withdrawPendingApprovals(raw, projectId));
    for (const [table, kind] of [["automation_rules", "rule"], ["monitors", "monitor"], ["engagements", "engagement"]] as const) {
      const state = kind === "engagement" ? "ended" : "paused";
      const rows = raw.prepare(`SELECT id,revision FROM ${table} WHERE project_id=? AND state<>?`).all(projectId, state) as { id: string; revision: number }[];
      for (const row of rows) {
        raw.prepare(`UPDATE ${table} SET state=?,revision=revision+1 WHERE project_id=? AND id=?`).run(state, projectId, row.id);
        changes.push({ kind, id: row.id, revision: row.revision + 1 });
      }
    }
    const unique = [...new Map(changes.map(entity => [`${entity.kind}:${entity.id}`, entity])).values()];
    return {
      effects: [{ kind: "project", id: projectId, revision: project.revision + 1 }],
      events: unique.map(entity => ({ type: "entity.changed" as const, entity })),
      afterCommit: workspace.move,
    };
  });
}
