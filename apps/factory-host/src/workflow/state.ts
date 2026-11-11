import { canTransitionWorkflow, isTerminalWorkflowState, type WorkflowInstanceState } from "@factory/contracts";
import type { Database } from "better-sqlite3";
import type { EventHub } from "../events/hub.js";
import type { WorkflowInstanceRow } from "./service.js";

/** All instance state updates share progress tracking and event emission. Caller owns the transaction. */
export function writeWorkflowState(deps: { raw: Database; hub: EventHub }, row: WorkflowInstanceRow,
  target: WorkflowInstanceState, reason: string | null, now: string): void {
  const via = row.state === "paused" && target === "active" ? "resuming"
    : row.state === "awaiting-approval" && target !== "active" ? "active" : null;
  if (target !== row.state && !(via ? canTransitionWorkflow(row.state,via) && canTransitionWorkflow(via,target)
    : canTransitionWorkflow(row.state,target))) throw new Error("Invalid workflow transition");
  deps.raw.prepare(`UPDATE workflow_instances SET state=?,state_reason=?,revision=revision+1,
    started_at=?,ended_at=?,last_progress_at=? WHERE project_id=? AND id=?`)
    .run(target, reason, row.started_at ?? (target === "active" ? now : null), isTerminalWorkflowState(target) ? now : null,
      now, row.project_id, row.id);
  if (target !== row.state && deps.hub.currentCursor(row.project_id)) deps.hub.append({ projectId: row.project_id,
    causationId: row.id, payload: { type: "workflow.state-changed", instanceId: row.id, to: target } });
}
