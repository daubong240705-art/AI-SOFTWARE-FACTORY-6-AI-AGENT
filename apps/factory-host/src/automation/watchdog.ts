import { canTransitionWorkflow, workflowDefinitionSchema } from "@factory/contracts";
import { advanceWorkflow, type WorkflowEngineDeps } from "../workflow/engine.js";
import { getWorkflowInstance, type WorkflowInstanceRow } from "../workflow/service.js";
import { writeWorkflowState } from "../workflow/state.js";

export function runWatchdog(deps: WorkflowEngineDeps, now: Date): string[] {
  const changed: string[] = []; let reported = false;
  const report = () => { if (!reported) { reported = true; console.error("Workflow watchdog failed"); } };
  try {
    const rows = deps.raw.prepare("SELECT * FROM workflow_instances WHERE state='active' ORDER BY project_id,id").all() as WorkflowInstanceRow[];
    for (const row of rows) try {
      deps.hub.transaction(() => {
        const instance = getWorkflowInstance(deps.raw, row.project_id, row.id);
        if (!instance || instance.state !== "active") return;
        const definition = workflowDefinitionSchema.parse(JSON.parse(instance.definition_json) as unknown);
        const timeouts = definition.timeouts ?? { stallAfterMinutes: 1440, maxDurationMinutes: 43200 };
        const stages = () => deps.raw.prepare("SELECT stage_key,state FROM workflow_stages WHERE project_id=? AND instance_id=? ORDER BY stage_key")
          .all(row.project_id, row.id) as { stage_key: string; state: string }[];
        const nonterminal = () => Boolean(deps.raw.prepare(`SELECT 1 FROM workflow_stage_tasks l JOIN tasks t ON t.project_id=l.project_id AND t.id=l.task_id
          WHERE l.project_id=? AND l.instance_id=? AND t.state NOT IN ('done','failed','cancelled','declined','superseded') LIMIT 1`).get(row.project_id,row.id));
        let reason: string | null = null;
        if (instance.started_at && now.getTime() - Date.parse(instance.started_at) > timeouts.maxDurationMinutes * 60000) reason = "max duration reached";
        else if (now.getTime() - Date.parse(instance.last_progress_at ?? instance.started_at ?? now.toISOString()) > timeouts.stallAfterMinutes * 60000
          && (nonterminal() || stages().some((s) => ["pending", "ready"].includes(s.state)))) reason = `no progress for ${timeouts.stallAfterMinutes} minutes`;
        else if (!nonterminal() && !stages().some((s) => ["ready", "active"].includes(s.state))
          && stages().some((s) => ["pending", "blocked"].includes(s.state))) {
          const effects = advanceWorkflow({ ...deps, clock: () => now }, row.project_id, row.id);
          const current = getWorkflowInstance(deps.raw, row.project_id, row.id)!;
          if (current.state !== "active" || effects.length) return;
          const blocked = stages().filter((s) => ["pending", "blocked"].includes(s.state));
          if (!nonterminal() && !stages().some((s) => ["ready", "active"].includes(s.state)) && blocked.length)
            reason = `deadlock: ${definition.stages.filter((s) => blocked.some((b) => b.stage_key === s.key)).slice(0,5).map((s) => s.key).join(", ")}`;
        }
        if (!reason || !canTransitionWorkflow(instance.state, "stalled")) return;
        writeWorkflowState(deps, instance, "stalled", reason, now.toISOString());
        deps.hub.append({ projectId: row.project_id, causationId: row.id,
          payload: { type: "entity.changed", entity: { kind: "workflow-instance", id: row.id, revision: instance.revision + 1 } } });
        changed.push(row.id);
      });
    } catch { report(); }
  } catch { report(); }
  return changed;
}
