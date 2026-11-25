import type { Database } from "better-sqlite3";
import { countedTokens } from "../policy/budget.js";

export const terminalTasks = ["done", "failed", "cancelled", "declined", "superseded"];
export const terminalApprovals = ["approved", "rejected", "changes-requested", "superseded", "expired", "withdrawn", "applied"];
export const terminalNodes = ["succeeded", "failed", "skipped", "cancelled"];

export type Usage = Parameters<typeof countedTokens>[0];
export const reported = (row: Usage) => row.input_tokens !== null && row.output_tokens !== null;
export function usageTotals(rows: Usage[]) {
  return rows.reduce((totals, row) => {
    if (reported(row)) totals.known += countedTokens(row);
    else { totals.unknownSpans = 1; totals.estimated += countedTokens(row); }
    return totals;
  }, { known: 0, estimated: 0, unknownSpans: Number(rows.length === 0) });
}

export type NodeKey = { run_id: string; node_id: string; iteration: number; attempt_no: number };
export const nodeRef = (row: NodeKey) => `${row.run_id}:${row.node_id}:${row.iteration}:${row.attempt_no}`;

export type Entity = { kind: "flow-run" | "node-run" | "task" | "attempt" | "approval" | "effect" | "artifact"; ref: string };
interface Source {
  title: string; status: string; startedAt?: string | null; endedAt?: string | null; terminal?: boolean;
  detail?: Record<string, unknown>; parent?: Entity;
}

export function source(raw: Database, projectId: string, { kind, ref }: Entity): Source | undefined {
  const get = <Row>(sql: string, ...args: Array<string | number>) => raw.prepare(sql).get(projectId, ...args) as Row | undefined;
  const node = (sql: string, ...args: Array<string | number>): Entity | undefined => {
    const row = get<NodeKey>(sql, ...args);
    return row ? { kind: "node-run", ref: nodeRef(row) } : undefined;
  };
  const attempt = (id: string | null): Entity | undefined => id ? { kind: "attempt", ref: id } : undefined;
  const task = (id: string | null): Entity | undefined => id ? { kind: "task", ref: id } : undefined;
  switch (kind) {
    case "flow-run": {
      const row = get<{ title: string; state: string; test: number; trigger: string; flow_id: string; version: number | null;
        created_at: string; ended_at: string | null; parent_run_id: string | null }>(`SELECT f.title,r.state,r.test,r.trigger,r.flow_id,r.version,r.created_at,r.ended_at,
        coalesce(r.parent_run_id,CASE WHEN r.trigger='error' THEN json_extract(r.inputs_json,'$.runId') END) parent_run_id
        FROM flow_runs r JOIN flows f ON f.project_id=r.project_id AND f.id=r.flow_id WHERE r.project_id=? AND r.id=?`, ref);
      if (!row) return;
      const parent = row.parent_run_id ? node(`SELECT run_id,node_id,iteration,attempt_no FROM flow_node_runs
        WHERE project_id=? AND child_run_id=? LIMIT 1`, ref) ?? { kind: "flow-run", ref: row.parent_run_id } as const : undefined;
      return { title: row.title, status: row.state, startedAt: row.created_at, endedAt: row.ended_at,
        detail: { flowId: row.flow_id, version: row.version, test: Boolean(row.test), trigger: row.trigger }, ...(parent && { parent }) };
    }
    case "node-run": {
      const [runId, nodeId, iteration, attemptNo] = ref.split(":") as [string, string, string, string];
      const row = get<{ title: string | null; state: string; started_at: string | null; ended_at: string | null; created_at: string }>(`
        SELECT (SELECT json_extract(value,'$.title') FROM json_each(r.definition_json,'$.nodes') WHERE json_extract(value,'$.id')=n.node_id) title,
          n.state,n.started_at,n.ended_at,r.created_at FROM flow_node_runs n JOIN flow_runs r ON r.project_id=n.project_id AND r.id=n.run_id
        WHERE n.project_id=? AND n.run_id=? AND n.node_id=? AND n.iteration=? AND n.attempt_no=?`, runId, nodeId, Number(iteration), Number(attemptNo));
      if (row) return { title: row.title ?? nodeId, status: row.state, startedAt: row.started_at, endedAt: row.ended_at,
        terminal: terminalNodes.includes(row.state), detail: { runId, nodeId, iteration: Number(iteration), attemptNo: Number(attemptNo) },
        parent: { kind: "flow-run", ref: runId } };
      return;
    }
    case "task": {
      const row = get<{ title: string; state: string; parent_task_id: string | null; requester_task_id: string | null;
        owner_seat_id: string | null; code: string; created_by_agent_id: string | null; source_task_id: string | null }>(`
        SELECT t.title,t.state,t.parent_task_id,t.requester_task_id,t.owner_seat_id,t.code,t.created_by_agent_id,a.source_task_id
        FROM tasks t LEFT JOIN collab_assignments a ON a.project_id=t.project_id AND a.task_id=t.id WHERE t.project_id=? AND t.id=?`, ref);
      if (!row) return;
      const parent = task(row.created_by_agent_id ? row.parent_task_id ?? row.source_task_id : row.requester_task_id)
        ?? node(`SELECT run_id,node_id,iteration,attempt_no FROM flow_node_runs WHERE project_id=? AND task_id=? LIMIT 1`, ref)
        ?? node(`SELECT n.run_id,n.node_id,n.iteration,n.attempt_no FROM flow_tasks f JOIN flow_node_runs n
          ON n.project_id=f.project_id AND n.run_id=f.run_id AND n.node_id=f.node_id AND n.iteration=f.iteration
          WHERE f.project_id=? AND f.task_id=? ORDER BY n.attempt_no DESC LIMIT 1`, ref) ?? task(row.parent_task_id);
      return { title: row.title, status: row.state, terminal: terminalTasks.includes(row.state),
        detail: { code: row.code, agentId: row.owner_seat_id, createdByAgentId: row.created_by_agent_id }, ...(parent && { parent }) };
    }
    case "attempt": {
      const row = get<{ task_id: string; epoch: number; runtime: string; state: string; provider: string; model: string;
        started_at: string | null; ended_at: string | null; seat_id: string | null; first_at: string | null }>(`
        SELECT a.task_id,a.epoch,a.runtime,a.state,a.provider,a.model,a.started_at,a.ended_at,s.seat_id,
          (SELECT at FROM attempt_events e WHERE e.project_id=a.project_id AND e.attempt_id=a.id ORDER BY seq LIMIT 1) first_at
        FROM attempts a LEFT JOIN attempt_seats s ON s.project_id=a.project_id AND s.attempt_id=a.id WHERE a.project_id=? AND a.id=?`, ref);
      if (row) return { title: `Attempt ${row.epoch}`, status: row.state, startedAt: row.started_at ?? row.first_at,
        endedAt: row.ended_at, detail: { taskId: row.task_id, agentId: row.seat_id, model: row.model, provider: row.provider, runtime: row.runtime },
        parent: { kind: "task", ref: row.task_id } };
      return;
    }
    case "approval": {
      const row = get<{ kind: string; task_id: string | null; state: string; requested_at: string; decided_at: string | null; expires_at: string }>(`
        SELECT kind,task_id,state,requested_at,decided_at,expires_at FROM approvals WHERE project_id=? AND id=?`, ref);
      if (!row) return;
      const parent = node(`SELECT run_id,node_id,iteration,attempt_no FROM flow_node_runs WHERE project_id=? AND approval_id=? LIMIT 1`, ref)
        ?? task(row.task_id);
      return { title: `${row.kind} approval`, status: row.state, startedAt: row.requested_at,
        endedAt: row.decided_at, terminal: terminalApprovals.includes(row.state), ...(parent && { parent }) };
    }
    case "effect": {
      const row = get<{ kind: string; state: string; created_at: string; completed_at: string | null; attempt_id: string | null;
        caller: string | null; node_attempt: number | null }>(`SELECT kind,state,created_at,completed_at,attempt_id,
        json_extract(target_json,'$.caller') caller,json_extract(target_json,'$.nodeAttempt') node_attempt FROM effects WHERE project_id=? AND id=?`, ref);
      if (!row) return;
      const parent = attempt(row.attempt_id) ?? (row.caller?.startsWith("flow:") && row.node_attempt !== null
        ? { kind: "node-run", ref: `${row.caller.slice(5)}:${row.node_attempt}` } as const : undefined);
      return { title: row.kind, status: row.state, startedAt: row.created_at, endedAt: row.completed_at, ...(parent && { parent }) };
    }
    case "artifact": {
      const [id, version] = ref.split(":") as [string, string];
      const row = get<{ title: string; status: string; created_at: string; produced_by_attempt_id: string | null }>(`
        SELECT title,status,created_at,produced_by_attempt_id FROM artifact_versions WHERE project_id=? AND artifact_id=? AND version=?`, id, Number(version));
      if (!row) return;
      const parent = attempt(row.produced_by_attempt_id);
      return { title: row.title, status: row.status, startedAt: row.created_at, endedAt: row.created_at,
        detail: { artifactId: id, version: Number(version) }, ...(parent && { parent }) };
    }
  }
}
