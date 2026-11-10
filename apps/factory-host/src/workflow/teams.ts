import type { Database } from "better-sqlite3";
import type { Task, WorkflowDefinition } from "@factory/contracts";
import { engagementAvailable, pickSeat, DispatchCommandError } from "../dispatch/seats.js";
import { engagementLoad } from "../dispatch/node.js";
import { getSeatCapabilities } from "../instructions/snapshot.js";
import { listSeats } from "../org/service.js";

export function selectWorkflowEngagement(raw: Database, projectId: string,
  stage: WorkflowDefinition["stages"][number], override: string | null): string | undefined {
  if (override !== null && engagementAvailable(raw, projectId, override)) return override;
  const rows = raw.prepare(`SELECT e.id, e.team_id, e.priority, t.name, t.pack_key FROM engagements e
    JOIN teams t ON t.id = e.team_id WHERE e.project_id = ? AND e.state = 'active' AND t.lifecycle = 'active'`)
    .all(projectId) as { id: string; team_id: string; priority: number; name: string; pack_key: string | null }[];
  const candidates = rows.flatMap((row) => {
    const workers = listSeats(raw, row.team_id).filter((seat) => !seat.isLead);
    if (!workers.length) return [];
    const declared = workers.some((seat) => getSeatCapabilities(raw, { seatId: seat.id }) !== null);
    // Reuse dispatch's capability matching, including its dotted-prefix and case rules.
    const probe: Task = { id: row.id, projectId, revision: 1, code: "WF-001", title: stage.title, goal: stage.title,
      brief: stage.title, parentTaskId: null, engagementId: row.id, ownerSeatId: null, origin: { kind: "operator" },
      state: "draft", disposition: "active", holds: [], placement: stage.placement, sideEffect: "none",
      reviewPolicy: "human-final", gate: { requiresGo: false }, requiredCapabilities: stage.requiredCapabilities,
      acceptance: [], inputs: [], dependsOn: [] };
    try { pickSeat(raw, projectId, probe); } catch (error) { if (error instanceof DispatchCommandError) return []; throw error; }
    const hint = stage.teamHint?.toLowerCase();
    return [{ ...row, declared: Number(declared), hint: Number(Boolean(hint && `${row.name} ${row.pack_key ?? ""}`.toLowerCase().includes(hint))),
      load: engagementLoad(raw, projectId, row.id) }];
  });
  candidates.sort((a, b) => b.declared - a.declared || b.hint - a.hint || a.load - b.load || b.priority - a.priority
    || a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en"));
  return candidates[0]?.id;
}
