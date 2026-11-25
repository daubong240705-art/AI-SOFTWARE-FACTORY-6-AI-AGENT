import { LIVE_ATTEMPT_STATES, type Trace, type TraceSpan, type TraceTokenTotals } from "@factory/contracts";
import type { Database } from "better-sqlite3";
import { meaningfulProgressSql } from "../dispatch/progress.js";
import { dayKey } from "../policy/budget.js";
import { spanId } from "./recorder.js";
import { usageTotals, type Usage } from "./sources.js";

type SpanRow = { id: string; trace_id: string; parent_id: string | null; kind: TraceSpan["kind"]; ref: string; title: string;
  status: string; started_at: string; ended_at: string | null; tokens: number | null; detail_json: string };
function span(row: SpanRow): TraceSpan {
  return { id: row.id, traceId: row.trace_id, parentId: row.parent_id, kind: row.kind, ref: row.ref, title: row.title, status: row.status,
    startedAt: row.started_at, endedAt: row.ended_at, tokens: row.tokens, detail: JSON.parse(row.detail_json) as TraceSpan["detail"] };
}
const empty = (): TraceTokenTotals => ({ known: 0, estimated: 0, unknownSpans: 0 });
const add = (total: TraceTokenTotals, part: TraceTokenTotals) => {
  total.known += part.known; total.estimated += part.estimated; total.unknownSpans += part.unknownSpans;
  return total;
};
function summary(spans: TraceSpan[]): TraceTokenTotals {
  return spans.reduce((total, item) => item.detail.usage ? add(total, item.detail.usage as TraceTokenTotals) : total, empty());
}

const chatRows = `SELECT s.*,t.state chat_state,
  CASE WHEN t.state NOT IN ('queued','running') THEN t.updated_at END chat_ended_at
  FROM trace_spans s LEFT JOIN lead_turns t ON t.project_id=s.project_id AND s.kind='request' AND s.title='chat.send'
    AND s.status<>'rejected' AND t.id=json_extract(s.detail_json,'$.targetId')`;
const withChat = (row: SpanRow & { chat_state: string | null; chat_ended_at: string | null }) => span(row.chat_state
  ? { ...row, status: row.chat_state, ended_at: row.chat_ended_at } : row);
export function listTraces(raw: Database, projectId: string, limit: number): TraceSpan[] {
  return (raw.prepare(`${chatRows} WHERE s.project_id=? AND s.parent_id IS NULL ORDER BY s.started_at DESC,s.id DESC LIMIT ?`)
    .all(projectId, limit) as Parameters<typeof withChat>[0][]).map(withChat);
}

export function readTrace(raw: Database, projectId: string, traceId: string): Trace | undefined {
  const spans = (raw.prepare(`${chatRows} WHERE s.project_id=? AND s.trace_id=? ORDER BY s.parent_id IS NOT NULL,s.started_at,s.id`)
    .all(projectId, traceId) as Parameters<typeof withChat>[0][]).map(withChat);
  if (spans.length) return { traceId, spans, summary: summary(spans) };
  return;
}

export function readArtifactTrace(raw: Database, projectId: string, artifactId: string, version?: number): (Trace & { artifactId: string; version: number }) | undefined {
  const target = raw.prepare(`SELECT version FROM artifact_versions WHERE project_id=? AND artifact_id=? AND (? IS NULL OR version=?)
    ORDER BY version DESC LIMIT 1`).get(projectId, artifactId, version ?? null, version ?? null) as { version: number } | undefined;
  if (!target) return;
  const spans = (raw.prepare(`WITH RECURSIVE chain AS (
      SELECT *,0 depth FROM trace_spans WHERE project_id=? AND id=?
      UNION ALL SELECT parent.*,chain.depth+1 FROM chain JOIN trace_spans parent
      ON parent.project_id=chain.project_id AND parent.id=chain.parent_id AND parent.trace_id=chain.trace_id WHERE chain.depth<256
    ) SELECT * FROM chain ORDER BY depth DESC`).all(projectId, spanId("artifact", `${artifactId}:${target.version}`)) as SpanRow[]).map(span);
  if (spans.length) return { traceId: spans[0]!.traceId, artifactId, version: target.version, spans, summary: summary(spans) };
  return;
}

const liveStates = [...LIVE_ATTEMPT_STATES].map((state) => `'${state}'`).join(",");
type Agent = { agentId: string | null; agentName: string | null };
const agent = (row: Agent) => row.agentId && row.agentName ? { id: row.agentId, name: row.agentName } : null;

function todayUsage(raw: Database, projectId: string, now: Date, offset: number) {
  const date = dayKey(now, offset);
  const start = Date.parse(`${date}T00:00:00.000Z`) - offset * 60_000;
  const from = new Date(start).toISOString(), until = new Date(start + 86_400_000).toISOString();
  const rows = raw.prepare(`SELECT coalesce(u.attempt_id,u.id) unit,u.provider,u.model,u.input_tokens,u.cached_input_tokens,u.output_tokens,
      u.reasoning_output_tokens,u.estimated_tokens, s.id agentId,s.name agentName
    FROM usage_records u LEFT JOIN attempt_seats ats ON ats.project_id=u.project_id AND ats.attempt_id=u.attempt_id
    LEFT JOIN conversations c ON c.project_id=u.project_id AND c.id=u.conversation_id
    LEFT JOIN seats s ON s.id=coalesce(ats.seat_id,c.seat_id)
    WHERE u.project_id=? AND u.recorded_at>=? AND u.recorded_at<?
    UNION ALL SELECT a.id,a.provider,a.model,NULL,NULL,NULL,NULL,NULL,s.id,s.name FROM attempts a
    JOIN trace_spans t ON t.project_id=a.project_id AND t.kind='attempt' AND t.ref=a.id
    LEFT JOIN attempt_seats ats ON ats.project_id=a.project_id AND ats.attempt_id=a.id LEFT JOIN seats s ON s.id=ats.seat_id
    WHERE a.project_id=? AND t.started_at>=? AND t.started_at<? AND NOT EXISTS (
      SELECT 1 FROM usage_records u WHERE u.project_id=a.project_id AND u.attempt_id=a.id)`)
    .all(projectId, from, until, projectId, from, until) as Array<Usage & Agent & { unit: string; provider: string; model: string }>;
  const grouped = new Map<string, { provider: string; model: string; agent: ReturnType<typeof agent>; units: Map<string, Usage[]> }>();
  for (const row of rows) {
    const key = JSON.stringify([row.agentId, row.provider, row.model]);
    let group = grouped.get(key);
    if (!group) { group = { agent: agent(row), provider: row.provider, model: row.model, units: new Map() }; grouped.set(key, group); }
    const unit = group.units.get(row.unit);
    if (unit) unit.push(row); else group.units.set(row.unit, [row]);
  }
  const byAgentAndModel = [...grouped.values()].map(({ units, ...identity }) => ({ ...identity,
    ...[...units.values()].reduce((total, usage) => add(total, usageTotals(usage)), empty()) }));
  const totals = { ...empty(), known: byAgentAndModel.reduce((sum, group) => sum + group.known, 0),
    estimated: byAgentAndModel.reduce((sum, group) => sum + group.estimated, 0),
    unknownSpans: new Set(rows.filter((row) => row.input_tokens === null || row.output_tokens === null).map((row) => row.unit)).size };
  return { date, ...totals, byAgentAndModel };
}

export function readMonitor(raw: Database, projectId: string, now: Date, utcOffsetMinutes: number) {
  const attempts = raw.prepare(`SELECT a.id,a.state status,a.started_at startedAt,t.id taskId,t.title taskTitle,
      ts.trace_id traceId,ts.started_at enqueuedAt,s.id agentId,s.name agentName,
      p.at progressAt,json_extract(p.body_json,'$.message') message,json_extract(p.body_json,'$.percent') percent
    FROM attempts a JOIN tasks t ON t.project_id=a.project_id AND t.id=a.task_id
    LEFT JOIN trace_spans ts ON ts.project_id=a.project_id AND ts.kind='attempt' AND ts.ref=a.id
    LEFT JOIN attempt_seats ats ON ats.project_id=a.project_id AND ats.attempt_id=a.id LEFT JOIN seats s ON s.id=ats.seat_id
    LEFT JOIN attempt_events p ON p.project_id=a.project_id AND p.attempt_id=a.id AND p.seq=(SELECT seq FROM attempt_events e
      WHERE e.project_id=a.project_id AND e.attempt_id=a.id AND e.kind='progress' AND ${meaningfulProgressSql("e")} ORDER BY seq DESC LIMIT 1)
    WHERE a.project_id=? AND a.state IN (${liveStates}) ORDER BY coalesce(a.started_at,ts.started_at) DESC,a.id LIMIT 200`).all(projectId) as
    Array<Agent & { id: string; status: string; startedAt: string | null; enqueuedAt: string | null; traceId: string | null;
      taskId: string; taskTitle: string; progressAt: string | null; message: string | null; percent: number | null }>;
  const liveAttempts = attempts.map((row) => ({ id: row.id, traceId: row.traceId, status: row.status, agent: agent(row),
    task: { id: row.taskId, title: row.taskTitle }, startedAt: row.startedAt,
    elapsedMs: Math.max(0, now.getTime() - Date.parse(row.startedAt ?? row.enqueuedAt ?? now.toISOString())),
    lastProgress: row.progressAt && row.message ? { at: row.progressAt, message: row.message, percent: row.percent } : null }));
  const runs = raw.prepare(`SELECT r.id,f.title,r.state status,r.started_at startedAt,ts.trace_id traceId,
      json_array_length(r.definition_json,'$.nodes') total,
      (SELECT count(*) FROM flow_node_runs n WHERE n.project_id=r.project_id AND n.run_id=r.id
        AND n.state IN ('succeeded','skipped','failed','cancelled') AND NOT EXISTS (SELECT 1 FROM flow_node_runs newer
          WHERE newer.project_id=n.project_id AND newer.run_id=n.run_id AND newer.node_id=n.node_id
          AND (newer.iteration,newer.attempt_no)>(n.iteration,n.attempt_no))) completed
    FROM flow_runs r JOIN flows f ON f.project_id=r.project_id AND f.id=r.flow_id
    LEFT JOIN trace_spans ts ON ts.project_id=r.project_id AND ts.kind='flow-run' AND ts.ref=r.id
    WHERE r.project_id=? AND r.state NOT IN ('succeeded','failed','cancelled') ORDER BY r.created_at DESC,r.id LIMIT 200`).all(projectId) as
    Array<{ id: string; title: string; status: string; startedAt: string | null; traceId: string | null; total: number; completed: number }>;
  const recentToolCalls = raw.prepare(`SELECT id,attempt_id attemptId,agent_id agentId,name,status,duration_ms durationMs,
    args_bytes argsBytes,result_bytes resultBytes,created_at createdAt FROM tool_calls WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 50`).all(projectId);
  const recentFailures = (raw.prepare(`SELECT * FROM trace_spans WHERE project_id=? AND status IN ('failed','error','rejected','unknown','budget-blocked')
    ORDER BY coalesce(ended_at,started_at) DESC,id DESC LIMIT 50`).all(projectId) as SpanRow[]).map(span);
  return { liveAttempts, activeFlowRuns: runs.map(({ total, completed, ...run }) => ({ ...run, progress: { total, completed } })),
    recentToolCalls, recentFailures, today: todayUsage(raw, projectId, now, utcOffsetMinutes) };
}
