import { flowRunStateSchema, isTerminalFlowRunState, type AgentInsights, type FlowInsights, type NodeInsights } from "@factory/contracts";
import type { Database } from "better-sqlite3";
import { nodeRef } from "../trace/sources.js";
import type { FlowRow, NodeRow, RunRow } from "../flow/store.js";
import { count, duration, measure, metric, percentiles, rate, tally, tokenTotals, type Sample, type TokenSample } from "./metrics.js";

const dayMs = 86_400_000;
export const insightsWindow = (projectId: string, days: number, now: Date) => ({ projectId, days,
  from: new Date(now.getTime() - days * dayMs).toISOString(), until: now.toISOString() });
type Window = ReturnType<typeof insightsWindow>;
type Run = Pick<RunRow, "id" | "flow_id" | "state" | "version" | "created_at" | "ended_at"> & Sample;
type Node = NodeRow & Sample & { run_id: string; title: string; ready_at: string | null;
  approval: "approved" | "rejected" | "timeout" | null; review_failed: number; review_decided: number };
type UsageRow = TokenSample["usage"][number] & { usage_id: string | null };
type AttemptRow = UsageRow & { id: string; agent_id: string | null; name: string | null; slots: number | null;
  node_ref: string | null; state: string; queued_at: string | null; entered_at: string | null; started_at: string | null; ended_at: string | null };
type Attempt = AttemptRow & TokenSample;

function groupBy<Row, Key>(rows: Row[], keyOf: (row: Row) => Key): Map<Key, Row[]> {
  const groups = new Map<Key, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row); else groups.set(key, [row]);
  }
  return groups;
}

function readAttempts(raw: Database, window: Window, flowId?: string): Attempt[] {
  const rows = raw.prepare(`WITH mapped AS (
    SELECT f.project_id, f.task_id, f.run_id, f.node_id, f.iteration,
      coalesce(d.attempt_no, p.attempt_no, CASE WHEN t.parent_task_id IS NULL THEN (
        SELECT max(n.attempt_no) FROM flow_node_runs n WHERE n.project_id=f.project_id AND n.run_id=f.run_id
          AND n.node_id=f.node_id AND n.iteration=f.iteration
      ) END) attempt_no
    FROM flow_tasks f JOIN flow_runs r ON r.project_id=f.project_id AND r.id=f.run_id
    JOIN tasks t ON t.project_id=f.project_id AND t.id=f.task_id
    LEFT JOIN flow_node_runs d ON d.project_id=f.project_id AND d.run_id=f.run_id AND d.node_id=f.node_id
      AND d.iteration=f.iteration AND d.task_id=f.task_id
    LEFT JOIN flow_node_runs p ON p.project_id=f.project_id AND p.run_id=f.run_id AND p.node_id=f.node_id
      AND p.iteration=f.iteration AND p.task_id=t.parent_task_id
    WHERE f.project_id=@projectId AND (@flowId IS NULL OR (r.flow_id=@flowId AND r.created_at BETWEEN @from AND @until))
  ), history AS (
    SELECT a.id,a.task_id,a.project_id,a.state,a.started_at,a.ended_at,s.id agent_id,s.name,s.slots,
      coalesce(parent.ref, ancestor.ref, m.run_id||':'||m.node_id||':'||m.iteration||':'||m.attempt_no) node_ref,
      q.queued_at, coalesce(q.queued_at,
        (SELECT e.at FROM attempt_events e WHERE e.project_id=a.project_id AND e.attempt_id=a.id ORDER BY e.seq LIMIT 1),
        a.started_at, a.ended_at, span.started_at) entered_at
    FROM attempts a JOIN tasks t ON t.project_id=a.project_id AND t.id=a.task_id
    LEFT JOIN attempt_seats ats ON ats.project_id=a.project_id AND ats.attempt_id=a.id
    LEFT JOIN seats s ON s.id=ats.seat_id
    LEFT JOIN insight_attempt_queued q ON q.project_id=a.project_id AND q.attempt_id=a.id
    LEFT JOIN mapped m ON m.project_id=a.project_id AND m.task_id=a.task_id
    LEFT JOIN trace_spans span ON span.project_id=a.project_id AND span.kind='attempt' AND span.ref=a.id
    LEFT JOIN trace_spans task ON task.project_id=span.project_id AND task.id=span.parent_id
    LEFT JOIN trace_spans parent ON parent.project_id=task.project_id AND parent.id=task.parent_id AND parent.kind='node-run'
    LEFT JOIN trace_spans main_task ON main_task.project_id=task.project_id AND main_task.kind='task' AND main_task.ref=t.parent_task_id
    LEFT JOIN trace_spans ancestor ON ancestor.project_id=main_task.project_id AND ancestor.id=main_task.parent_id AND ancestor.kind='node-run'
    WHERE a.project_id=@projectId AND (@flowId IS NULL OR m.task_id IS NOT NULL)
  )
  SELECT h.*,u.id usage_id,u.input_tokens,u.cached_input_tokens,u.output_tokens,u.reasoning_output_tokens,u.estimated_tokens,u.cost_kind
  FROM history h LEFT JOIN usage_records u ON u.project_id=h.project_id AND u.task_id=h.task_id AND u.attempt_id=h.id AND u.recorded_at<=@until
  WHERE @flowId IS NOT NULL OR h.entered_at BETWEEN @from AND @until OR
    (h.started_at<=@until AND (h.ended_at IS NULL OR h.ended_at>=@from))
  ORDER BY h.entered_at DESC,h.id,u.id`).all({ ...window, flowId: flowId ?? null }) as AttemptRow[];
  return [...groupBy(rows, ({ id }) => id).values()].map((items) => {
    const first = items[0]!;
    return { ...first, ref: first.node_ref ?? first.id, usage: items.filter(({ usage_id }) => usage_id !== null) };
  });
}

const stateCounts = (runs: Run[]): FlowInsights["runsByState"] =>
  Object.fromEntries(flowRunStateSchema.options.map((state) => [state, tally(runs, (row) => row.state === state)]));

function nodeSummary(nodes: Node[], attempts: Attempt[]): NodeInsights {
  const latest = nodes[0]!;
  const executed = nodes.filter((row) => row.started_at !== null);
  const finished = nodes.filter((row) => row.ended_at !== null && (row.started_at !== null || row.error !== null));
  const observed = nodes.filter((row) => row.ended_at !== null);
  const failed = tally(finished, (row) => row.state === "failed" || row.error !== null);
  const cohorts = [...groupBy(executed, (row) => row.run_id).values()].map((rows) => ({ ref: rows[0]!.ref,
    retries: rows.filter((row) => row.attempt_no > 1).length, iterations: Math.max(...rows.map((row) => row.iteration)) }));
  const average = (key: "retries" | "iterations") => metric(cohorts.length
    ? cohorts.reduce((sum, row) => sum + row[key], 0) / cohorts.length : null, cohorts);
  const decisions = nodes.filter((row) => row.approval !== null);
  const rejected = tally(decisions, (row) => row.approval === "rejected");
  const reviews = nodes.filter((row) => row.review_decided);
  const reviewFailures = tally(reviews, (row) => Boolean(row.review_failed));
  return { nodeId: latest.node_id, title: latest.title, titles: [...new Set(nodes.map(({ title }) => title))],
    executions: count(executed), failed, failureRate: rate(failed, finished), skipped: tally(observed, (row) => row.state === "skipped"),
    retries: tally(executed, (row) => row.attempt_no > 1), averageRetries: average("retries"),
    reworkIterations: tally(executed.filter((row) => row.attempt_no === 1), (row) => row.iteration > 1), averageIterations: average("iterations"),
    timeouts: tally(finished, (row) => row.approval === "timeout" || /^(timeout|timeout failure)(;|$)/.test(row.error ?? "")),
    wait: percentiles(measure(executed, (row) => duration(row.ready_at, row.started_at))),
    run: percentiles(measure(executed, (row) => duration(row.started_at, row.ended_at))),
    approvals: { approved: tally(decisions, (row) => row.approval === "approved"), rejected,
      timeout: tally(decisions, (row) => row.approval === "timeout"),
      rejectionRate: rate(rejected, decisions.filter((row) => row.approval !== "timeout")) },
    reviewFailures, reviewFailureRate: rate(reviewFailures, reviews), cost: tokenTotals(attempts) };
}

export function readFlowInsights(raw: Database, window: Window, flow: Pick<FlowRow, "id" | "title">): FlowInsights {
  const params = { ...window, flowId: flow.id };
  const runs = (raw.prepare(`SELECT id,flow_id,state,version,created_at,ended_at,id ref FROM flow_runs
    WHERE project_id=@projectId AND flow_id=@flowId AND created_at BETWEEN @from AND @until ORDER BY created_at DESC,id DESC`)
    .all(params) as Run[]);
  const nodes = (raw.prepare(`SELECT n.*,q.ready_at,coalesce(json_extract(def.value,'$.title'),n.node_id) title,
    CASE WHEN json_extract(def.value,'$.type')='approval' THEN CASE
      WHEN a.state='expired' OR (n.port='timeout' AND n.state='succeeded') THEN 'timeout'
      WHEN a.state='rejected' OR (n.port='rejected' AND n.state='succeeded') THEN 'rejected'
      WHEN a.state='approved' OR (n.port='approved' AND n.state='succeeded') THEN 'approved' END END approval,
    CASE WHEN json_extract(def.value,'$.type')='agent' THEN CASE json_type(def.value,'$.review')
      WHEN 'object' THEN n.error IN ('changes-requested','reviewer did not report a verdict','no agent matches reviewer')
        OR (n.error IS NOT NULL AND EXISTS (SELECT 1 FROM tasks t JOIN flow_tasks f ON f.project_id=t.project_id AND f.task_id=t.id
          WHERE t.project_id=n.project_id AND t.parent_task_id=n.task_id AND f.role='subtask' AND t.state IN ('failed','declined')))
      WHEN 'text' THEN json_extract(def.value,'$.review')='human' AND EXISTS (SELECT 1 FROM approvals review
        WHERE review.project_id=n.project_id AND review.task_id=n.task_id AND review.kind='review' AND review.state IN ('rejected','changes-requested'))
      END END review_failed,
    CASE WHEN json_extract(def.value,'$.type')='agent' THEN CASE json_type(def.value,'$.review')
      WHEN 'object' THEN n.state='succeeded' AND n.error IS NULL AND n.pinned=0 AND n.task_id IS NOT NULL
      WHEN 'text' THEN json_extract(def.value,'$.review')='human' AND EXISTS (SELECT 1 FROM approvals review
        WHERE review.project_id=n.project_id AND review.task_id=n.task_id AND review.kind='review' AND review.state='approved')
      END END review_passed
    FROM flow_runs r JOIN flow_node_runs n ON n.project_id=r.project_id AND n.run_id=r.id
    LEFT JOIN json_each(r.definition_json,'$.nodes') def ON json_extract(def.value,'$.id')=n.node_id
    LEFT JOIN insight_node_ready q ON q.project_id=n.project_id AND q.run_id=n.run_id AND q.node_id=n.node_id
      AND q.iteration=n.iteration AND q.attempt_no=n.attempt_no
    LEFT JOIN approvals a ON a.project_id=n.project_id AND a.id=n.approval_id
    WHERE r.project_id=@projectId AND r.flow_id=@flowId AND r.created_at BETWEEN @from AND @until
    ORDER BY r.created_at DESC,r.id DESC,n.node_id,n.iteration DESC,n.attempt_no DESC`).all(params) as (Node & { review_passed: number })[])
    .map((row) => ({ ...row, ref: nodeRef(row), review_decided: Number(Boolean(row.review_failed || row.review_passed)) }));
  const byReference = new Map(nodes.map((row) => [row.ref, row.node_id]));
  const attempts = readAttempts(raw, window, flow.id).filter((row) => byReference.has(row.ref));
  const byNode = groupBy(attempts, (row) => byReference.get(row.ref));
  const summaries = [...groupBy(nodes, (row) => row.node_id).values()].map((rows) => nodeSummary(rows, byNode.get(rows[0]!.node_id) ?? []))
    .sort((first, second) => first.nodeId.localeCompare(second.nodeId));
  const terminal = runs.filter((row) => isTerminalFlowRunState(row.state));
  const nodeMedians = summaries.flatMap(({ run: { medianMs } }) => medianMs.value === null || !medianMs.evidence[0]
    ? [] : [{ ref: medianMs.evidence[0], value: medianMs.value }]);
  return { flowId: flow.id, title: flow.title, totalRuns: count(runs), runsByState: stateCounts(runs),
    runsByVersion: [...groupBy(runs, (row) => row.version)].sort(([first], [second]) => (second ?? 0) - (first ?? 0))
      .map(([version, items]) => ({ version, totalRuns: count(items), runsByState: stateCounts(items) })),
    successRate: rate(tally(terminal, (row) => row.state === "succeeded"), terminal),
    totalDuration: percentiles(measure(terminal, (row) => duration(row.created_at, row.ended_at))),
    medianNodeRunMs: percentiles(nodeMedians).medianMs,
    nodes: summaries, cost: tokenTotals(attempts) };
}

export function readProjectAgents(raw: Database, window: Window): AgentInsights[] {
  return [...groupBy(readAttempts(raw, window), (row) => row.agent_id)].flatMap(([agentId, attempts]) => {
    const first = attempts[0]!;
    if (!agentId || !first.name || !first.slots) return [];
    const cohort = attempts.filter((row) => row.entered_at !== null && row.entered_at >= window.from && row.entered_at <= window.until);
    const decided = cohort.filter((row) => row.state === "succeeded" || row.state === "failed");
    const busy = measure(attempts, (row) => row.started_at && (row.ended_at ?? window.until) >= window.from
      ? duration(row.started_at < window.from ? window.from : row.started_at, !row.ended_at || row.ended_at > window.until ? window.until : row.ended_at) : null);
    return [{ agentId, name: first.name, attempts: count(cohort), failureRate: rate(tally(decided, (row) => row.state === "failed"), decided),
      medianQueueWaitMs: percentiles(measure(cohort, (row) => duration(row.queued_at, row.started_at))).medianMs,
      busyShare: metric(Math.min(1, busy.reduce((sum, row) => sum + row.value, 0) / (window.days * dayMs * first.slots)), busy),
      cost: tokenTotals(cohort) }];
  }).sort((first, second) => first.agentId.localeCompare(second.agentId));
}
