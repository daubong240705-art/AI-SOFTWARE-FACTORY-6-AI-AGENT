import { lstatSync, mkdirSync, renameSync } from "node:fs";
import { basename, join, relative, isAbsolute, sep, resolve } from "node:path";
import { LIVE_ATTEMPT_STATES, type EntityRef } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerMap } from "../commands/pipeline.js";
import { getProject } from "./service.js";
import { cancelProjectTasks } from "./cancel-tasks.js";
import { withoutWorkflowAdvancement } from "../workflow/lifecycle.js";
import { assertInside, canonicalPath } from "../workspace/paths.js";
import { withdrawPendingApprovals } from "../approvals/service.js";

/** Plan the new historical path in the transaction, but perform filesystem writes only after commit. */
function planArchiveWorkspace(projectsRoot: string, workspace: string, now: Date): { root: string; move: () => string } {
  const root = canonicalPath(projectsRoot);
  const rel = relative(root, resolve(workspace));
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
    return { root: workspace, move: () => "Dự án đã được lưu trữ. Thư mục nằm ngoài thư mục game nên được giữ nguyên; không xoá file." };
  const source = assertInside(root, workspace);
  // A symbolic link is not an owned game directory, even when its target happens to be inside the root.
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
      return `Dự án đã được lưu trữ. Thư mục đã chuyển đến ${target}. Không có file nào bị xoá; bản đã phát hành trên Portal giữ nguyên.`;
    } catch {
      return `Dự án đã được lưu trữ nhưng chưa chuyển được thư mục từ ${workspace} đến ${target}. Không có file nào bị xoá. Hãy chuyển thư mục thủ công trước khi tạo lại game.`;
    }
  } };
}

export function createProjectsArchiveHandler(deps: {
  cancelWorkflow: HandlerMap["workflows.cancel"]; projectsRoot: string;
}): HandlerMap["projects.archive"] {
  return (ctx, command) => withoutWorkflowAdvancement(ctx.raw, () => {
    const { raw } = ctx, { projectId, payload } = command;
    if (!ctx.actorIsOperator) throw new CommandError("forbidden", "Chỉ người vận hành được lưu trữ dự án.", "correct-input");
    const project = getProject(raw, projectId);
    if (!project) throw new CommandError("not-found", "Không tìm thấy dự án.", "correct-input");
    if (project.disposition === "archived") throw new CommandError("conflict", "Dự án đã được lưu trữ.", "refresh");
    if (raw.prepare("SELECT 1 FROM portal_settings WHERE project_id=?").get(projectId))
      throw new CommandError("conflict", "Không thể xoá dự án quản trị Portal.", "correct-input");
    if (project.revision !== payload.expectedRevision)
      throw new CommandError("conflict", "Dự án đã thay đổi. Hãy tải lại trước khi xoá.", "refresh", { currentRevision: project.revision });
    if (payload.confirmName !== project.name)
      throw new CommandError("validation", "Tên xác nhận phải trùng khớp chính xác với tên dự án.", "correct-input");
    const live = [...LIVE_ATTEMPT_STATES];
    if (raw.prepare(`SELECT 1 FROM attempts WHERE project_id=? AND state IN (${live.map(() => "?").join(",")}) LIMIT 1`).get(projectId, ...live))
      throw new CommandError("conflict", "Dự án còn lượt chạy đang hoạt động hoặc chưa rõ kết quả. Hãy dừng lượt chạy và đối soát trước khi xoá dự án.", "refresh");
    if (raw.prepare("SELECT 1 FROM game_releases WHERE project_id=? AND state='pending' LIMIT 1").get(projectId))
      throw new CommandError("conflict", "Dự án đang phát hành. Hãy chờ phát hành hoàn tất trước khi xoá dự án.", "refresh");

    let workspace: ReturnType<typeof planArchiveWorkspace>;
    try { workspace = planArchiveWorkspace(deps.projectsRoot, project.workspace.root, ctx.clock()); }
    catch { workspace = { root: project.workspace.root, move: () => "Dự án đã được lưu trữ nhưng chưa chuyển được thư mục. Không có file nào bị xoá. Hãy kiểm tra đường dẫn và chuyển thư mục thủ công trước khi tạo lại game." }; }
    // Fence lifecycle callbacks before they can resume a parked requester during cancellation.
    // The historical record must never point at a replacement game created at the original root.
    raw.prepare("UPDATE projects SET disposition='archived',workspace_root=?,revision=revision+1 WHERE id=?").run(workspace.root, projectId);
    const changes: EntityRef[] = [];
    const instances = raw.prepare(`SELECT id,revision FROM workflow_instances WHERE project_id=?
      AND state NOT IN ('completed','failed','cancelled','superseded') ORDER BY id`).all(projectId) as { id: string; revision: number }[];
    for (const instance of instances) changes.push(...deps.cancelWorkflow(ctx, {
      ...command, type: "workflows.cancel", payload: { instanceId: instance.id, expectedRevision: instance.revision, reason: "Dự án đã được lưu trữ" },
    }).effects);
    changes.push(...cancelProjectTasks(ctx, projectId));
    // Also withdraw approvals without a task (for example workflow patch approvals).
    changes.push(...withdrawPendingApprovals(raw, projectId));
    for (const [table, kind] of [["schedules", "schedule"], ["automation_rules", "rule"], ["monitors", "monitor"], ["engagements", "engagement"]] as const) {
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
