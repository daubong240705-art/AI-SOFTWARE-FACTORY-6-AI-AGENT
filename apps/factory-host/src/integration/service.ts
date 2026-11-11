import type { Database } from "better-sqlite3";
import type { EventHub } from "../events/hub.js";
import type { WorkspaceProvider } from "../dispatch/workspace-provider.js";

export interface IntegrationRow {
  project_id: string; task_id: string; branch: string; state: "pending" | "merged" | "conflict" | "skipped";
  merge_sha: string | null; error_kind: "conflict" | "git-failed" | null; attempts: number;
  created_at: string; resolved_at: string | null;
}

/** Caller owns the acceptance transaction. Only the latest attempt can supply its branch. */
export function enqueueIntegration(raw: Database, input: { projectId: string; taskId: string; now: string }): void {
  const task = raw.prepare("SELECT state FROM tasks WHERE project_id=? AND id=?").get(input.projectId, input.taskId) as { state: string } | undefined;
  if (task?.state !== "done") return;
  const attempt = raw.prepare("SELECT id FROM attempts WHERE project_id=? AND task_id=? ORDER BY epoch DESC LIMIT 1")
    .get(input.projectId, input.taskId) as { id: string } | undefined;
  if (!attempt) return;
  const events = raw.prepare("SELECT body_json FROM attempt_events WHERE project_id=? AND attempt_id=? AND kind='state' ORDER BY seq DESC")
    .all(input.projectId, attempt.id) as { body_json: string }[];
  for (const event of events) {
    const body: unknown = JSON.parse(event.body_json);
    if (typeof body !== "object" || body === null || !("to" in body) || body.to !== "workspace-ready" ||
      !("branch" in body) || typeof body.branch !== "string" || !body.branch.startsWith("factory/")) continue;
    raw.prepare(`INSERT INTO integration_merges (project_id,task_id,branch,state,created_at)
      VALUES (?,?,?,'pending',?) ON CONFLICT(project_id,task_id) DO NOTHING`)
      .run(input.projectId, input.taskId, body.branch, input.now);
    return;
  }
}

export function integrationBlocked(raw: Database, projectId: string, taskId: string): boolean {
  return Boolean(raw.prepare(`SELECT 1 FROM task_dependencies d JOIN integration_merges m
    ON m.project_id=d.project_id AND m.task_id=d.depends_on_task_id
    WHERE d.project_id=? AND d.task_id=? AND m.state IN ('pending','conflict') LIMIT 1`).get(projectId, taskId));
}

// Claims are shared by dispatchers and connections to the same Host database, acquired
// synchronously before yielding and released even after bookkeeping errors. No stale
// persisted claim can strand a pending merge after a Host restart; Git retries are idempotent.
const claims = new WeakMap<Database, Set<string>>();
const fileClaims = new Map<string, Set<string>>();
export async function integratePending(deps: {
  raw: Database; hub: EventHub; workspace: WorkspaceProvider;
  projectRootFor: (projectId: string) => string | null; now: () => string;
}): Promise<boolean> {
  const { raw, hub, workspace } = deps;
  if (!workspace.integrate || raw.inTransaction) return false;
  const inMemory = raw.name === ":memory:" || raw.name === "";
  const held = (inMemory ? claims.get(raw) : fileClaims.get(raw.name)) ?? new Set<string>();
  if (inMemory) claims.set(raw, held);
  else fileClaims.set(raw.name, held);
  let worked = false;
  try {
    const rows = raw.prepare(`SELECT * FROM integration_merges WHERE state='pending'
      ORDER BY project_id,created_at,task_id`).all() as IntegrationRow[];
    const visited = new Set<string>();
    for (const row of rows) {
      if (visited.has(row.project_id) || held.has(row.project_id)) continue;
      visited.add(row.project_id);
      // Another pump may have finished this snapshot row while we awaited a different project.
      if (!raw.prepare("SELECT 1 FROM integration_merges WHERE project_id=? AND task_id=? AND state='pending'")
        .get(row.project_id, row.task_id)) continue;
      held.add(row.project_id);
      try {
        let outcome: Awaited<ReturnType<NonNullable<WorkspaceProvider["integrate"]>>> | undefined;
        try {
          const projectRoot = deps.projectRootFor(row.project_id);
          if (!projectRoot) throw new Error("workspace unavailable");
          outcome = await workspace.integrate({ projectRoot, taskBranch: row.branch, message: `Factory integration: ${row.task_id}` });
        } catch { /* Only a fixed error kind is persisted; Git output can contain local paths. */ }
        hub.transaction(() => {
          const current = raw.prepare("SELECT state,attempts FROM integration_merges WHERE project_id=? AND task_id=?")
            .get(row.project_id, row.task_id) as Pick<IntegrationRow, "state" | "attempts"> | undefined;
          if (current?.state !== "pending") return;
          const failed = outcome === undefined || outcome.outcome === "git-failed";
          const attempts = current.attempts + (failed ? 1 : 0);
          const state = outcome?.outcome === "merged" ? "merged" : outcome?.outcome === "conflict" || attempts >= 3 ? "conflict" : "pending";
          const error = outcome?.outcome === "conflict" ? "conflict" : failed ? "git-failed" : null;
          raw.prepare(`UPDATE integration_merges SET state=?,merge_sha=?,error_kind=?,attempts=?,resolved_at=?
            WHERE project_id=? AND task_id=? AND state='pending'`).run(state, outcome?.outcome === "merged" ? outcome.sha : null,
            error, attempts, state === "pending" ? null : deps.now(), row.project_id, row.task_id);
          if (state !== "pending") {
            raw.prepare("UPDATE tasks SET revision=revision+1 WHERE project_id=? AND id=?").run(row.project_id, row.task_id);
            const task = raw.prepare("SELECT revision FROM tasks WHERE project_id=? AND id=?").get(row.project_id, row.task_id) as { revision: number };
            hub.append({ projectId: row.project_id, causationId: row.task_id,
              payload: { type: "entity.changed", entity: { kind: "task", id: row.task_id, revision: task.revision } } });
          }
        });
        worked = true;
      } catch { /* A worker failure must never escape dispatch or leave its claim held. */ }
      finally { held.delete(row.project_id); }
    }
  } catch { /* Storage may be closing; the next pump can retry pending work. */ }
  return worked;
}
