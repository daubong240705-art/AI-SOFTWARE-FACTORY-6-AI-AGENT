import type { Database } from "better-sqlite3";
import { workflowDefinitionSchema, workflowStageStateSchema, type WorkflowInstanceState } from "@factory/contracts";

export interface WorkflowInstanceRow {
  project_id: string; id: string; revision: number; key: string; pack_key: string; pack_version: string;
  definition_revision: number; definition_json: string; params_json: string; title: string;
  state: WorkflowInstanceState; state_reason: string | null; created_at: string; started_at: string | null; ended_at: string | null;
}
export function getWorkflowInstance(raw: Database, projectId: string, id: string): WorkflowInstanceRow | undefined {
  return raw.prepare("SELECT * FROM workflow_instances WHERE project_id = ? AND id = ?").get(projectId, id) as WorkflowInstanceRow | undefined;
}
function summary(raw: Database, row: WorkflowInstanceRow) {
  const counts = Object.fromEntries(workflowStageStateSchema.options.map((state) => [state, 0]));
  const rows = raw.prepare("SELECT state, COUNT(*) AS count FROM workflow_stages WHERE project_id = ? AND instance_id = ? GROUP BY state")
    .all(row.project_id, row.id) as { state: string; count: number }[];
  for (const item of rows) counts[item.state] = item.count;
  return { id: row.id, key: row.key, title: row.title, state: row.state, revision: row.revision,
    createdAt: row.created_at, startedAt: row.started_at, endedAt: row.ended_at, counts };
}
export function listWorkflowInstances(raw: Database, projectId: string) {
  const rows = raw.prepare("SELECT * FROM workflow_instances WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 100")
    .all(projectId) as WorkflowInstanceRow[];
  return rows.map((row) => summary(raw, row));
}
export function workflowInstanceView(raw: Database, projectId: string, id: string) {
  const row = getWorkflowInstance(raw, projectId, id);
  if (!row) return undefined;
  const definition = workflowDefinitionSchema.parse(JSON.parse(row.definition_json) as unknown);
  const stages = raw.prepare("SELECT stage_key AS key, phase, state, optional, loop_count AS loopCount, blocked_reason AS blockedReason, engagement_id AS engagementId FROM workflow_stages WHERE project_id = ? AND instance_id = ?")
    .all(projectId, id) as { key: string; phase: string; state: string; optional: number; loopCount: number; blockedReason: string | null; engagementId: string | null }[];
  const order = new Map(definition.stages.map((s, i) => [s.key, i]));
  return { ...summary(raw, row), stages: stages.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0))
    .map((s) => {
      const tasks = raw.prepare(`SELECT l.iteration, t.id AS taskId, t.code, t.state FROM workflow_stage_tasks l
        JOIN tasks t ON t.project_id = l.project_id AND t.id = l.task_id
        WHERE l.project_id = ? AND l.instance_id = ? AND l.stage_key = ? ORDER BY l.iteration DESC, t.code, t.id`)
        .all(projectId, id, s.key) as { iteration: number; taskId: string; code: string; state: string }[];
      return { ...s, optional: s.optional === 1, iteration: tasks[0]?.iteration ?? 1,
        tasks: tasks.map(({ taskId, code, state }) => ({ taskId, code, state })) };
    }), params: JSON.parse(row.params_json) as Record<string, unknown>,
    definitionRevision: row.definition_revision, packKey: row.pack_key, packVersion: row.pack_version,
    definitionTitle: definition.title, phases: definition.phases };
}
