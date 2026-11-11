import type { Database } from "better-sqlite3";
import { publicApprovalText } from "../approvals/service.js";
import type { IntegrationRow } from "./service.js";

export function listIntegration(raw: Database, projectId: string) {
  return (raw.prepare(`SELECT m.*,t.code,t.title FROM integration_merges m JOIN tasks t
    ON t.project_id=m.project_id AND t.id=m.task_id WHERE m.project_id=?
    ORDER BY m.created_at DESC,m.rowid DESC LIMIT 100`).all(projectId) as (IntegrationRow & { code: string; title: string })[])
    .map((row) => ({ taskId: row.task_id, code: row.code, title: publicApprovalText(row.title), state: row.state,
      branch: publicApprovalText(row.branch), mergeSha: row.merge_sha, errorKind: row.error_kind,
      createdAt: row.created_at, resolvedAt: row.resolved_at }));
}

export function integrationConflicts(raw: Database, projectId: string) {
  return (raw.prepare(`SELECT m.project_id AS projectId,m.task_id AS taskId,t.code,t.title,m.branch
    FROM integration_merges m JOIN tasks t ON t.project_id=m.project_id AND t.id=m.task_id
    WHERE m.project_id=? AND m.state='conflict' ORDER BY m.created_at,m.task_id`).all(projectId) as
    { projectId: string; taskId: string; code: string; title: string; branch: string }[])
    .map((row) => ({ ...row, title: publicApprovalText(row.title), branch: publicApprovalText(row.branch) }));
}
